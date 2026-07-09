const REALM = "Velz Ops Dashboard";

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }

  return diff === 0;
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch (_error) {
    return null;
  }
}

export default async (request, context) => {
  const expectedUsername = Netlify.env.get("VELZ_DASHBOARD_USERNAME");
  const expectedPassword = Netlify.env.get("VELZ_DASHBOARD_PASSWORD");

  if (!expectedUsername || !expectedPassword) {
    return new Response("Security access is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  const isAllowed = credentials
    && timingSafeEqual(credentials.username, expectedUsername)
    && timingSafeEqual(credentials.password, expectedPassword);

  if (!isAllowed) return unauthorized();

  return context.next();
};
