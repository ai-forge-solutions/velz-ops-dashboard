import assert from "node:assert/strict";
import { createSessionCookie } from "../netlify/shared/session.js";
import {
  ALLOWED_RPCS,
  ALLOWED_TABLES,
  createSupabaseProxyHandler,
  resolveProxyTarget,
} from "../netlify/functions/supabase-proxy.js";

const env = {
  VELZ_DASHBOARD_USERNAME: "miguel",
  VELZ_DASHBOARD_PASSWORD: "pw",
  VELZ_DASHBOARD_SESSION_SECRET: "secret",
  SUPABASE_URL: "https://db.example.com/",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
};

// Allowlist resolution.
assert.equal(ALLOWED_TABLES.size, 19);
assert.deepEqual([...ALLOWED_RPCS].sort(), ["delete_brand_group", "save_brand_group", "set_lead_magnet_tool_key"]);
for (const table of ALLOWED_TABLES) {
  assert.deepEqual(resolveProxyTarget("GET", `/api/supabase/rest/${table}`), { path: table });
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
    assert.equal(resolveProxyTarget(method, `/api/supabase/rest/${table}`).error.status, 403);
  }
}
for (const rpc of ALLOWED_RPCS) {
  assert.deepEqual(resolveProxyTarget("POST", `/api/supabase/rpc/${rpc}`), { path: `rpc/${rpc}` });
  assert.equal(resolveProxyTarget("GET", `/api/supabase/rpc/${rpc}`).error.status, 403);
}
for (const pathname of [
  "/api/supabase/rest/brand_contacts",
  "/api/supabase/rest/brands/extra",
  "/api/supabase/rest/",
  "/api/supabase/rest/..%2Fbrand_contacts",
  "/api/supabase/rpc/exec_sql",
  "/api/supabase/rest/rpc/save_brand_group",
  "/api/supabase/rpc/brands",
  "/api/supabase/graphql/v1",
  "/api/supabase",
  "/api/other/rest/brands",
]) {
  for (const method of ["GET", "POST"]) {
    assert.equal(resolveProxyTarget(method, pathname).error.status, 403, `${method} ${pathname}`);
  }
}

// Handler: session gate, forwarding and key handling.
const upstreamCalls = [];
const fetchImpl = async (url, init) => {
  upstreamCalls.push({ url, init });
  return new Response(JSON.stringify([{ ok: true }]), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "upstream=1" },
  });
};
const handler = createSupabaseProxyHandler({ getEnv: (key) => env[key], fetchImpl });
const sessionCookie = (await createSessionCookie(env.VELZ_DASHBOARD_USERNAME, env.VELZ_DASHBOARD_PASSWORD, env.VELZ_DASHBOARD_SESSION_SECRET)).split(";")[0];
const forgedCookie = (await createSessionCookie(env.VELZ_DASHBOARD_USERNAME, env.VELZ_DASHBOARD_PASSWORD, "wrong-secret")).split(";")[0];
const request = (path, init = {}) => new Request(`https://dash.example.com${path}`, init);

let response = await handler(request("/api/supabase/rest/brands?select=id"));
assert.equal(response.status, 401);
response = await handler(request("/api/supabase/rest/brands?select=id", { headers: { cookie: forgedCookie } }));
assert.equal(response.status, 401);
assert.equal(upstreamCalls.length, 0);

response = await handler(request("/api/supabase/rest/brand_contacts?select=*", { headers: { cookie: sessionCookie } }));
assert.equal(response.status, 403);
assert.equal(upstreamCalls.length, 0);

const query = "?select=id,name&order=name.asc&brand_id=in.(a,b)&limit=2000";
response = await handler(request(`/api/supabase/rest/brands${query}`, { headers: { cookie: sessionCookie, apikey: "client-key" } }));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), [{ ok: true }]);
assert.equal(response.headers.get("set-cookie"), null);
assert.equal(upstreamCalls[0].url, `https://db.example.com/rest/v1/brands${query}`);
assert.equal(upstreamCalls[0].init.method, "GET");
assert.equal(upstreamCalls[0].init.headers.apikey, "service-role-test");
assert.equal(upstreamCalls[0].init.headers.Authorization, "Bearer service-role-test");
assert.equal(upstreamCalls[0].init.body, undefined);

response = await handler(request("/api/supabase/rpc/save_brand_group", {
  method: "POST",
  headers: { cookie: sessionCookie, "content-type": "text/plain" },
  body: "{}",
}));
assert.equal(response.status, 415);

response = await handler(request("/api/supabase/rpc/delete_brand_group", {
  method: "POST",
  headers: { cookie: sessionCookie, "content-type": "application/json" },
  body: JSON.stringify({ p_group_id: "g1" }),
}));
assert.equal(response.status, 200);
assert.equal(upstreamCalls[1].url, "https://db.example.com/rest/v1/rpc/delete_brand_group");
assert.equal(upstreamCalls[1].init.method, "POST");
assert.equal(upstreamCalls[1].init.body, JSON.stringify({ p_group_id: "g1" }));

const unconfigured = createSupabaseProxyHandler({
  getEnv: (key) => (key.startsWith("SUPABASE_") ? undefined : env[key]),
  fetchImpl,
});
response = await unconfigured(request("/api/supabase/rest/brands", { headers: { cookie: sessionCookie } }));
assert.equal(response.status, 503);

// Netlify only registers custom routes declared as string literals.
const { config } = await import("../netlify/functions/supabase-proxy.js");
assert.equal(config.path, "/api/supabase/*");
const source = (await import("node:fs")).readFileSync(new URL("../netlify/functions/supabase-proxy.js", import.meta.url), "utf8");
assert.match(source, /path:\s*"\/api\/supabase\/\*"/);
