// functions/api/channel-lookup.js  (Cloudflare Pages Function)
// Bemenet: { url: "https://youtube.com/@valami" }
// Kimenet: { name, thumbnail, subscriberCount, channelId }
//
// Ehhez egy YOUTUBE_API_KEY kornyezeti valtozo szukseges a Cloudflare Pages-en.
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

  const API_KEY = env.YOUTUBE_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'A YOUTUBE_API_KEY nincs beállítva a szerveren.' }), { status: 500, headers: CORS });
  }

  try {
    const { url } = await request.json();
    if (!url) {
      return new Response(JSON.stringify({ error: 'Hiányzik a csatorna URL.' }), { status: 400, headers: CORS });
    }

    let apiUrl = null;
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
    const channelIdMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
    const legacyMatch = url.match(/youtube\.com\/(?:c|user)\/([a-zA-Z0-9_.-]+)/);

    if (channelIdMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIdMatch[1]}&key=${API_KEY}`;
    } else if (handleMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent('@' + handleMatch[1])}&key=${API_KEY}`;
    } else if (legacyMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forUsername=${encodeURIComponent(legacyMatch[1])}&key=${API_KEY}`;
    } else {
      return new Response(JSON.stringify({ error: 'Nem ismerhető fel a csatorna URL formátuma. Próbáld a /channel/UC... vagy /@nev formátumot.' }), { status: 400, headers: CORS });
    }

    const ytRes = await fetch(apiUrl);
    const data = await ytRes.json();

    if (!data.items || data.items.length === 0) {
      return new Response(JSON.stringify({ error: 'Nem található csatorna ezzel az URL-lel.' }), { status: 404, headers: CORS });
    }

    const item = data.items[0];
    return new Response(JSON.stringify({
      channelId: item.id,
      name: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
      subscriberCount: item.statistics.hiddenSubscriberCount ? null : parseInt(item.statistics.subscriberCount, 10),
    }), { status: 200, headers: CORS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Hiba történt a csatorna lekérdezése közben.' }), { status: 500, headers: CORS });
  }
}
