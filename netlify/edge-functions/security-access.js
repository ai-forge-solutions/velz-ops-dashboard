const COOKIE_NAME = "velz_dashboard_session";
const LOGIN_PATH = "/auth/login";
const LOGOUT_PATH = "/auth/logout";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function noStoreHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    ...extra,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timingSafeEqual(a, b) {
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

function safeReturnTo(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith(LOGIN_PATH) || value.startsWith(LOGOUT_PATH)) return "/";
  return value;
}

async function createSessionCookie(username, password, sessionSecret) {
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

async function hasValidSession(request, username, password, sessionSecret) {
  const raw = getCookie(request, COOKIE_NAME);
  if (!raw) return false;

  const [expiresAtText, signature] = raw.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const expected = await hmac(`${username}:${expiresAt}`, sessionSecret || password);
  return timingSafeEqual(signature, expected);
}

function renderLoginPage({ returnTo = "/", error = "" } = {}) {
  const safeNext = safeReturnTo(returnTo);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Acceso · Velz Outreach Ops</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    :root { color-scheme: light; --ink:#14161A; --muted:#8B8E92; --line:#E3E1DB; --green:#2A6B4F; --paper:#FFFFFF; --wash:#F4F3EF; --red:#B3402A; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: 'Hanken Grotesk', system-ui, sans-serif; color: var(--ink); background: radial-gradient(circle at top, #FAFAF8 0, var(--paper) 38rem); display: grid; place-items: center; padding: 2rem; }
    main { width: min(100%, 420px); }
    .brand { display: flex; align-items: center; gap: .75rem; justify-content: center; margin-bottom: 2rem; }
    .display { font-family: 'Cormorant Garamond', serif; font-size: 2rem; letter-spacing: .04em; font-weight: 300; text-transform: lowercase; }
    .eyebrow { color: var(--muted); font-size: .68rem; letter-spacing: .18em; text-transform: uppercase; margin-top: .25rem; }
    .card { background: rgba(255,255,255,.94); border: 1px solid var(--line); border-radius: 18px; padding: 2rem; box-shadow: 0 18px 50px rgba(20,22,26,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 .45rem; font-weight: 600; }
    p { margin: 0 0 1.4rem; color: var(--muted); line-height: 1.45; font-size: .92rem; }
    label { display: block; font-size: .72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; margin: 0 0 .45rem; }
    input { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: .85rem .9rem; font: inherit; color: var(--ink); background: #fff; outline: none; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(42,107,79,.12); }
    .field { margin-bottom: 1rem; }
    button { width: 100%; border: 0; border-radius: 999px; background: var(--ink); color: white; font: inherit; font-weight: 600; padding: .9rem 1rem; cursor: pointer; margin-top: .35rem; }
    button:hover { background: #000; }
    .error { color: var(--red); background: #FFF8F6; border: 1px solid #F1D4CB; border-radius: 10px; padding: .75rem .85rem; margin-bottom: 1rem; font-size: .86rem; }
    .note { margin-top: 1rem; font-size: .76rem; color: var(--muted); text-align: center; }
    .mono { font-family: 'IBM Plex Mono', monospace; }
  </style>
</head>
<body>
  <main>
    <div class="brand" aria-label="Velz Outreach Ops">
      <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
        <line x1="0" y1="12" x2="22" y2="12" stroke="#14161A" stroke-width="1.3" />
        <line x1="11" y1="0" x2="11" y2="18" stroke="#14161A" stroke-width="1.3" />
        <circle cx="11" cy="12" r="3" fill="#14161A" />
      </svg>
      <span class="display">velz</span>
      <span class="eyebrow">outreach ops</span>
    </div>
    <section class="card">
      <h1>Acceso al dashboard</h1>
      <p>Introduce tus credenciales para abrir el panel. Guardaremos una sesión segura en este navegador para que no tengas que repetirlo cada vez.</p>
      ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="${LOGIN_PATH}">
        <input type="hidden" name="returnTo" value="${escapeHtml(safeNext)}" />
        <div class="field">
          <label for="username">Usuario</label>
          <input id="username" name="username" autocomplete="username" required autofocus />
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button type="submit">Entrar</button>
      </form>
      <div class="note mono">Sesión privada · cookie HttpOnly · 30 días</div>
    </section>
  </main>
</body>
</html>`;
}

function loginResponse(options = {}, init = {}) {
  return new Response(renderLoginPage(options), {
    status: init.status || 200,
    headers: noStoreHeaders({ "Content-Type": "text/html; charset=UTF-8", ...(init.headers || {}) }),
  });
}

function redirect(location, headers = {}) {
  return new Response(null, {
    status: 303,
    headers: noStoreHeaders({ Location: location, ...headers }),
  });
}

function loginRedirectFor(request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(`${url.pathname}${url.search}`);
  return redirect(`${LOGIN_PATH}?next=${encodeURIComponent(returnTo)}`);
}

export default async (request, context) => {
  const expectedUsername = Netlify.env.get("VELZ_DASHBOARD_USERNAME");
  const expectedPassword = Netlify.env.get("VELZ_DASHBOARD_PASSWORD");
  const sessionSecret = Netlify.env.get("VELZ_DASHBOARD_SESSION_SECRET");

  if (!expectedUsername || !expectedPassword) {
    return new Response("Security access is not configured", {
      status: 503,
      headers: noStoreHeaders(),
    });
  }

  const url = new URL(request.url);

  if (url.pathname === LOGOUT_PATH) {
    return redirect(LOGIN_PATH, {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
  }

  if (url.pathname === LOGIN_PATH) {
    if (request.method === "GET" || request.method === "HEAD") {
      const returnTo = safeReturnTo(url.searchParams.get("next") || "/");
      const isAuthenticated = await hasValidSession(
        request,
        expectedUsername,
        expectedPassword,
        sessionSecret,
      );
      if (isAuthenticated) return redirect(returnTo);
      return loginResponse({ returnTo });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: noStoreHeaders({ Allow: "GET, HEAD, POST" }),
      });
    }

    const form = await request.formData();
    const username = String(form.get("username") || "");
    const password = String(form.get("password") || "");
    const returnTo = safeReturnTo(String(form.get("returnTo") || "/"));
    const isAllowed = timingSafeEqual(username, expectedUsername)
      && timingSafeEqual(password, expectedPassword);

    if (!isAllowed) {
      return loginResponse(
        { returnTo, error: "Usuario o contraseña incorrectos." },
        { status: 401 },
      );
    }

    const cookie = await createSessionCookie(expectedUsername, expectedPassword, sessionSecret);
    return redirect(returnTo, { "Set-Cookie": cookie });
  }

  const isAuthenticated = await hasValidSession(
    request,
    expectedUsername,
    expectedPassword,
    sessionSecret,
  );

  if (!isAuthenticated) return loginRedirectFor(request);

  return context.next();
};
