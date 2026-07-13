// functions/api/generate-seo.js  (Cloudflare Pages Function)
// Bemenet: { topic, game, styles, channelName }
// Kimenet: { description, tags: [...] }

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

const PLAN_RULES = {
  free:  { monthlyLimit: 10,       allowedTools: ['videoIdeas'] },
  basic: { monthlyLimit: 100,      allowedTools: 'all' },
  pro:   { monthlyLimit: Infinity, allowedTools: 'all' },
};
const THIS_TOOL_KEY = 'seo';

async function getClerkUser(userId, secretKey){
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { 'Authorization': 'Bearer ' + secretKey },
  });
  if (!res.ok) throw new Error('Nem sikerult lekerni a felhasznaloi adatokat.');
  return await res.json();
}

async function updateClerkPublicMetadata(userId, secretKey, publicMetadata){
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: publicMetadata }),
  });
  if (!res.ok) throw new Error('Nem sikerult frissiteni a metaadatot.');
  return await res.json();
}

async function enforcePlanLimits(userId, secretKey){
  const clerkUser = await getClerkUser(userId, secretKey);
  const vf = (clerkUser.public_metadata && clerkUser.public_metadata.viewforge) || {};
  const planId = vf.plan || 'free';
  const rules = PLAN_RULES[planId] || PLAN_RULES.free;

  if (rules.allowedTools !== 'all' && !rules.allowedTools.includes(THIS_TOOL_KEY)) {
    return { ok: false, status: 403, error: 'Ez az eszkoz a Basic vagy Pro csomagtol erheto el.' };
  }

  const thisMonth = new Date().toISOString().slice(0, 7);
  const used = (vf.usage && vf.usage.month === thisMonth) ? vf.usage.count : 0;
  if (rules.monthlyLimit !== Infinity && used >= rules.monthlyLimit) {
    return { ok: false, status: 403, error: `Elerted a(z) ${planId} csomag havi limitjet (${rules.monthlyLimit}).` };
  }

  return { ok: true, vf, planId, used, thisMonth };
}

async function incrementUsageServerSide(userId, secretKey, vf, used, thisMonth){
  await updateClerkPublicMetadata(userId, secretKey, {
    ...vf,
    usage: { count: used + 1, month: thisMonth },
  });
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
  let userPayload;
  try { userPayload = await verifyClerkToken(token); }
  catch (e) { return new Response(JSON.stringify({ error: 'Érvénytelen vagy lejárt munkamenet: ' + e.message }), { status: 401, headers: CORS }); }

  const CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;
  if (!CLERK_SECRET_KEY) return new Response(JSON.stringify({ error: 'A CLERK_SECRET_KEY nincs beállítva a szerveren.' }), { status: 500, headers: CORS });
  let planCheck;
  try { planCheck = await enforcePlanLimits(userPayload.sub, CLERK_SECRET_KEY); }
  catch (e) { return new Response(JSON.stringify({ error: 'Nem sikerult ellenorizni a csomagodat: ' + e.message }), { status: 500, headers: CORS }); }
  if (!planCheck.ok) return new Response(JSON.stringify({ error: planCheck.error }), { status: planCheck.status, headers: CORS });

  const API_KEY = env.GEMINI_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'A GEMINI_API_KEY nincs beállítva a szerveren.' }), { status: 500, headers: CORS });

  try {
    const { topic, game, styles, channelName, aiTips } = await request.json();
    if (!topic) return new Response(JSON.stringify({ error: 'Hiányzik a videó témája.' }), { status: 400, headers: CORS });

    const prompt = `Te egy elit YouTube SEO-szakértő vagy, aki gamer csatornák kereshetőségét optimalizálja.

Csatorna: ${channelName || 'ismeretlen'}
Játék: ${game || 'ismeretlen'}
Stílus: ${(styles || []).join(', ') || 'nincs megadva'}
Videó témája: ${topic}

Készíts:
1. Egy YouTube-leírást (kb. 3-4 bekezdés): az első 1-2 mondat legyen a legfontosabb (ez jelenik meg keresésben), tartalmazzon természetesen beépített kulcsszavakat, végén 3-5 releváns hashtaget
2. 12-15 SEO címkét (tags) — keverd a széles (pl. játék neve) és szűk, konkrét kifejezéseket

${(aiTips && aiTips.length) ? `\nA felhasználó saját tanításai — EZEKET MINDIG vedd figyelembe:\n${aiTips.map(t => '- ' + t).join('\n')}\n` : ''}
Válaszolj KIZÁRÓLAG egy valid JSON objektummal, semmi mást:
{
  "description": "a teljes leírás szövege, sortörésekkel \\n karakterrel jelölve",
  "tags": ["címke1", "címke2", "..."]
}`;

    const data = await callGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    if (data.error) {
      return new Response(JSON.stringify({ error: 'Túlterhelt (' + (data.error.code || '?') + '): ' + (data.error.message || 'ismeretlen hiba') + ' — kérlek próbáld újra pár másodperc múlva.' }), { status: 502, headers: CORS });
    }
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    let result;
    try { result = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch (e) { return new Response(JSON.stringify({ error: 'Az AI válasza nem volt feldolgozható. Próbáld újra.' }), { status: 502, headers: CORS }); }

    try {
      await incrementUsageServerSide(userPayload.sub, CLERK_SECRET_KEY, planCheck.vf, planCheck.used, planCheck.thisMonth);
    } catch (e) {
      console.error('Usage increment hiba:', e);
    }

    return new Response(JSON.stringify(result), { status: 200, headers: CORS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Hiba történt a generálás közben.' }), { status: 500, headers: CORS });
  }
}
