// netlify/functions/channel-lookup.js
// Bemenet: { url: "https://youtube.com/@valami" }
// Kimenet: { name, thumbnail, subscriberCount, channelId }
//
// Ehhez egy YOUTUBE_API_KEY kornyezeti valtozo szukseges a Netlify-on.
// Csak bejelentkezett ViewForge felhasznalok hivhatjak — a Clerk munkamenet-tokent
// KULSO CSOMAG NELKUL, a Node sajat crypto moduljaval ellenorizzuk.

const crypto = require('crypto');

const CLERK_FRONTEND_API = 'fancy-bullfrog-66.clerk.accounts.dev';
let cachedJWKS = null;
let cachedJWKSAt = 0;

function base64UrlDecode(str){
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
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

  const header = JSON.parse(base64UrlDecode(headerB64).toString());
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString());

  const keys = await getJWKS();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Nem található megfelelő kulcs.');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signedData = headerB64 + '.' + payloadB64;
  const signature = base64UrlDecode(signatureB64);

  const verified = crypto.verify('RSA-SHA256', Buffer.from(signedData), publicKey, signature);
  if (!verified) throw new Error('Érvénytelen aláírás.');
  if (payload.exp && Date.now() >= payload.exp * 1000) throw new Error('Lejárt token.');

  return payload;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Csak POST kérés engedélyezett.' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Nincs bejelentkezve.' }) };
  }
  try {
    await verifyClerkToken(token);
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Érvénytelen vagy lejárt munkamenet: ' + e.message }) };
  }

  const API_KEY = process.env.YOUTUBE_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'A YOUTUBE_API_KEY nincs beállítva a szerveren.' }) };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Hiányzik a csatorna URL.' }) };
    }

    let apiUrl = null;

    // https://www.youtube.com/@handle vagy https://www.youtube.com/@handle/videos stb.
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
    // https://www.youtube.com/channel/UCxxxxxxxx
    const channelIdMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
    // https://www.youtube.com/c/CustomName vagy /user/Username (régi formátum)
    const legacyMatch = url.match(/youtube\.com\/(?:c|user)\/([a-zA-Z0-9_.-]+)/);

    if (channelIdMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIdMatch[1]}&key=${API_KEY}`;
    } else if (handleMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent('@' + handleMatch[1])}&key=${API_KEY}`;
    } else if (legacyMatch) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forUsername=${encodeURIComponent(legacyMatch[1])}&key=${API_KEY}`;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nem ismerhető fel a csatorna URL formátuma. Próbáld a /channel/UC... vagy /@nev formátumot.' }) };
    }

    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Nem található csatorna ezzel az URL-lel.' }) };
    }

    const item = data.items[0];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        channelId: item.id,
        name: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.default?.url || '',
        subscriberCount: item.statistics.hiddenSubscriberCount ? null : parseInt(item.statistics.subscriberCount, 10),
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Hiba történt a csatorna lekérdezése közben.' }) };
  }
};
