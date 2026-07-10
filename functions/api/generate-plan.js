// functions/api/generate-plan.js  (Cloudflare Pages Function)
// Bemenet: { uploadsPerWeek, game, styles, channelName }
// Kimenet: { plan: [ { day, type, title } ] }

const CLERK_FRONTEND_API = 'fancy-bullfrog-66.clerk.accounts.dev';
let cachedJWKS = null;
let cachedJWKSAt = 0;

function base64UrlToUint8Array(str){
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function base64UrlDecodeText(str){
  return new TextDecoder().decode(base64UrlToUint8Array(str));
}

async function getJWKS(){
  if (cachedJWKS && (Date.now() - cachedJWKSAt) < 60 * 60 * 1000) return cachedJWKS;
  const res = await fetch(`https://${CLERK_FRONTEND_API}/.well-known/jwks.json`);
  const data = await res.json();
  cachedJWKS = data.keys || [];
  cachedJWKSAt = Date.now();
  return cachedJWKS;
}

async function verifyClerkToken(token){
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Érvénytelen token formátum.');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecodeText(headerB64));
  const payload = JSON.parse(base64UrlDecodeText(payloadB64));
  const keys = await getJWKS();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Nem található megfelelő kulcs.');
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedData = new TextEncoder().encode(headerB64 + '.' + payloadB64);
  const signature = base64UrlToUint8Array(signatureB64);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
  if (!verified) throw new Error('Érvénytelen aláírás.');
  if (payload.exp && Date.now() >= payload.exp * 1000) throw new Error('Lejárt token.');
  return payload;
}

async function callGeminiWithRetry(apiUrl, body, maxRetries = 4){
  let lastData = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!data.error) return data;

    lastData = data;
    const isOverloaded = response.status === 503 || response.status === 429 ||
      /overloaded|high demand|unavailable/i.test(data.error.message || '');
    if (!isOverloaded || attempt === maxRetries - 1) return data;

    await new Promise(r => setTimeout(r, 1000 * (attempt + 1) + Math.random() * 500));
  }
  return lastData;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function onRequestOptions(){
  return new Response('', { status: 200, headers: CORS });
}

export async function onRequestPost(context){
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Nincs bejelentkezve.' }), { status: 401, headers: CORS });
  try { await verifyClerkToken(token); }
  catch (e) { return new Response(JSON.stringify({ error: 'Érvénytelen vagy lejárt munkamenet: ' + e.message }), { status: 401, headers: CORS }); }

  const API_KEY = env.GEMINI_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'A GEMINI_API_KEY nincs beállítva a szerveren.' }), { status: 500, headers: CORS });

  try {
    const { uploadsPerWeek, game, styles, channelName } = await request.json();
    if (!uploadsPerWeek) return new Response(JSON.stringify({ error: 'Hiányzik a heti feltöltési gyakoriság.' }), { status: 400, headers: CORS });

    const prompt = `Te egy elit YouTube tartalom-stratéga vagy, aki csatornák növekedési tervét építi fel.

Csatorna: ${channelName || 'ismeretlen'}
Játék: ${game || 'ismeretlen'}
Stílus: ${(styles || []).join(', ') || 'nincs megadva'}
Heti feltöltés: ${uploadsPerWeek} videó/hét

Építs egy stratégiailag átgondolt heti tervet:
- Keverd a tartalom-típusokat (pl. ne legyen mind ugyanaz a formátum) — Short a napi elérésért, egy nagyobb "húzó" videó a hét közepén/végén, esetleg stream/közösségi tartalom
- A legjobb napokra időzítsd a legfontosabb tartalmat (hétfő/szerda/péntek/hétvége a gaming közönségnél jellemzően erős)
- Minden elem legyen KONKRÉT ötlet, ne csak "készíts egy videót" jellegű általánosság

Válaszolj KIZÁRÓLAG egy valid JSON tömbbel, semmi mást:
[
  {"day": "nap magyarul", "type": "Short / Fő videó / Stream / stb.", "title": "konkrét tartalom-ötlet"}
]`;

    const data = await callGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    if (data.error) return new Response(JSON.stringify({ error: 'Az AI szolgáltatás jelenleg túlterhelt, kérlek próbáld újra pár másodperc múlva.' }), { status: 502, headers: CORS });
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    let plan;
    try { plan = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch (e) { return new Response(JSON.stringify({ error: 'Az AI válasza nem volt feldolgozható. Próbáld újra.' }), { status: 502, headers: CORS }); }

    return new Response(JSON.stringify({ plan }), { status: 200, headers: CORS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Hiba történt a tervezés közben.' }), { status: 500, headers: CORS });
  }
}
