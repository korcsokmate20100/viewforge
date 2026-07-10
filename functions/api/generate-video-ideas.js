// functions/api/generate-video-ideas.js  (Cloudflare Pages Function)
// Bemenet: { game, platform, channelSize, styles: [...], goal, channelName }
// Kimenet: { ideas: [ { title, why, thumbnail, hook } ] }
//
// Ehhez egy GEMINI_API_KEY kornyezeti valtozo szukseges a Cloudflare Pages-en
// (ingyenes, kartya nelkul: aistudio.google.com -> Get API Key).
// Csak bejelentkezett ViewForge felhasznalok hivhatjak — a Clerk munkamenet-tokent
// KULSO CSOMAG NELKUL, a Web Crypto API-val ellenorizzuk.

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

  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );

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
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nincs bejelentkezve.' }), { status: 401, headers: CORS });
  }
  try {
    await verifyClerkToken(token);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Érvénytelen vagy lejárt munkamenet: ' + e.message }), { status: 401, headers: CORS });
  }

  const API_KEY = env.GEMINI_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'A GEMINI_API_KEY nincs beállítva a szerveren.' }), { status: 500, headers: CORS });
  }

  try {
    const { game, platform, channelSize, styles, goal, channelName } = await request.json();
    if (!game) {
      return new Response(JSON.stringify({ error: 'Hiányzik a játék neve.' }), { status: 400, headers: CORS });
    }

    const prompt = `Te egy elit YouTube/Twitch tartalom-stratéga vagy, aki a legsikeresebb gamer csatornák növekedését elemezte. Nem generikus ötleteket adsz, hanem olyat, ami MOST, ebben a pillanatban működne a platform algoritmusán.

Csatorna: ${channelName || 'ismeretlen'}
Játék: ${game}
Platform: ${platform || 'YouTube'}
Csatorna méret: ${channelSize || 'ismeretlen'} feliratkozó
Stílus: ${(styles || []).join(', ') || 'nincs megadva'}
Cél: ${goal || 'több nézettség'}

Szabályok a jó ötlethez:
- Legyen KONKRÉT forgatókönyv, ne általános téma (pl. ne "vicces Minecraft videó", hanem egy pontos szituáció/csavar)
- Legyen benne feszültség, kíváncsiság vagy tét — amiért végig kell nézni
- Vedd figyelembe a csatorna méretét: kis csatornánál merészebb, figyelemfelkeltőbb formátum javasolt, nagy csatornánál a márka konzisztenciája is számít
- Kerüld a klisét és azt, amit már ezerszer láttak — legyen benne egyedi csavar

Adj 3 különböző jellegű, konkrét videó-ötletet magyarul (ne mind ugyanolyan felépítésű legyen). Válaszolj KIZÁRÓLAG egy valid JSON tömbbel, semmi mást (nincs bevezető, nincs magyarázat, nincs markdown code block jelölés), pontosan ilyen formában:
[
  {"title": "videó cím", "why": "1 konkrét mondat, miért működhet EBBEN a niche-ben", "thumbnail": "rövid thumbnail-ötlet", "hook": "az első pár másodperc mondata", "ctr": 1-5 közötti szám}
]`;

    const data = await callGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );

    if (data.error) {
      console.error('Gemini API hiba:', data.error);
      return new Response(JSON.stringify({ error: 'Túlterhelt (' + (data.error.code || '?') + '): ' + (data.error.message || 'ismeretlen hiba') + ' — kérlek próbáld újra pár másodperc múlva.' }), { status: 502, headers: CORS });
    }
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    let ideas;
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      ideas = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse hiba:', text);
      return new Response(JSON.stringify({ error: 'Az AI válasza nem volt feldolgozható. Próbáld újra.' }), { status: 502, headers: CORS });
    }

    return new Response(JSON.stringify({ ideas }), { status: 200, headers: CORS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Hiba történt a generálás közben.' }), { status: 500, headers: CORS });
  }
}
