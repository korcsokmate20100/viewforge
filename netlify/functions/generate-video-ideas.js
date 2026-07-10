// netlify/functions/generate-video-ideas.js
// Bemenet: { game, platform, channelSize, styles: [...], goal, channelName }
// Kimenet: { ideas: [ { title, why, thumbnail, hook } ] }
//
// Ehhez egy ANTHROPIC_API_KEY kornyezeti valtozo szukseges a Netlify-on.
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

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Az ANTHROPIC_API_KEY nincs beállítva a szerveren.' }) };
  }

  try {
    const { game, platform, channelSize, styles, goal, channelName } = JSON.parse(event.body || '{}');
    if (!game) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Hiányzik a játék neve.' }) };
    }

    const prompt = `Te egy tapasztalt YouTube/Twitch tartalom-stratéga vagy, aki gamer creatoroknak segít.

Csatorna: ${channelName || 'ismeretlen'}
Játék: ${game}
Platform: ${platform || 'YouTube'}
Csatorna méret: ${channelSize || 'ismeretlen'} feliratkozó
Stílus: ${(styles || []).join(', ') || 'nincs megadva'}
Cél: ${goal || 'több nézettség'}

Adj 3 konkrét videó-ötletet magyarul. Válaszolj KIZÁRÓLAG egy valid JSON tömbbel, semmi mást (nincs bevezető, nincs magyarázat, nincs markdown code block jelölés), pontosan ilyen formában:
[
  {"title": "videó cím", "why": "1 mondat, miért működhet", "thumbnail": "rövid thumbnail-ötlet", "hook": "az első pár másodperc mondata", "ctr": 1-5 közötti szám}
]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    let ideas;
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      ideas = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse hiba:', text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Az AI válasza nem volt feldolgozható. Próbáld újra.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ideas }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Hiba történt a generálás közben.' }) };
  }
};
