// functions/api/set-plan.js  (Cloudflare Pages Function)
// Bemenet: { plan: 'free' | 'basic' | 'pro' }
// Kimenet: { ok: true, plan }
//
// A csomagot a Clerk publicMetadata-jaba irja (nem unsafeMetadata!), mert azt
// csakis a szerver (ez a function) tudja modositani a sajat sk_ kulcsaval —
// a felhasznalo bongeszojebol NEM irhato at kozvetlenul, igy nem hamisithato.

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

async function getClerkUser(userId, secretKey){
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { 'Authorization': 'Bearer ' + secretKey },
  });
  if (!res.ok) throw new Error('Nem sikerült lekérni a felhasználói adatokat.');
  return await res.json();
}

async function updateClerkPublicMetadata(userId, secretKey, publicMetadata){
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: publicMetadata }),
  });
  if (!res.ok) throw new Error('Nem sikerült frissíteni a metaadatot.');
  return await res.json();
}

const VALID_PLANS = ['free', 'basic', 'pro'];

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

  try {
    const { plan } = await request.json();
    if (!VALID_PLANS.includes(plan)) {
      return new Response(JSON.stringify({ error: 'Érvénytelen csomag.' }), { status: 400, headers: CORS });
    }

    const clerkUser = await getClerkUser(userPayload.sub, CLERK_SECRET_KEY);
    const vf = (clerkUser.public_metadata && clerkUser.public_metadata.viewforge) || {};

    await updateClerkPublicMetadata(userPayload.sub, CLERK_SECRET_KEY, {
      ...vf,
      plan,
    });

    return new Response(JSON.stringify({ ok: true, plan }), { status: 200, headers: CORS });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Hiba történt a csomagváltás közben.' }), { status: 500, headers: CORS });
  }
}
