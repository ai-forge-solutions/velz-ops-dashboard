// Session cookie helpers shared by the security-access Edge Function (Deno)
// and the Supabase proxy Function (Node). Only Web APIs are used here.
export const COOKIE_NAME = "velz_dashboard_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export function timingSafeEqual(a, b) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }

  return diff === 0;
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64UrlFromBytes(new Uint8Array(signature));
}

function getCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const prefix = `${name}=`;
  return cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || null;
}

export async function createSessionCookie(username, password, sessionSecret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${username}:${expiresAt}`;
  const signature = await hmac(payload, sessionSecret || password);
  return [
    `${COOKIE_NAME}=${expiresAt}.${signature}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export async function hasValidSession(request, username, password, sessionSecret) {
  if (!username || !password) return false;
  const raw = getCookie(request, COOKIE_NAME);
  if (!raw) return false;

  const [expiresAtText, signature] = raw.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const expected = await hmac(`${username}:${expiresAt}`, sessionSecret || password);
  return timingSafeEqual(signature, expected);
}
