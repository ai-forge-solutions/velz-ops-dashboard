// Server-side proxy between the dashboard and Supabase PostgREST.
// The browser never sees a Supabase key: this function adds the service_role
// key from server env and only forwards an explicit allowlist of reads/RPCs.
import { hasValidSession } from "../shared/session.js";

export const PROXY_PREFIX = "/api/supabase";

export const ALLOWED_TABLES = new Set([
  "v_lead_overview",
  "email_sequences",
  "email_sends",
  "email_events",
  "lead_magnet_events",
  "v_lead_magnet_tool_assignments",
  "email_suppression_entries",
  "process_runs",
  "v_brand_groups",
  "lead_magnet_tools",
  "brands",
  "service_runs",
  "meta_ad_scrapes",
  "meta_ads",
  "brand_reviews",
  "web_stack_analyses",
  "brand_technology_detections",
  "technologies",
  "brand_context_analyses",
]);

export const ALLOWED_RPCS = new Set([
  "save_brand_group",
  "delete_brand_group",
  "set_lead_magnet_tool_key",
]);

function jsonResponse(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8",
      ...extra,
    },
  });
}

const forbidden = () => jsonResponse(403, { message: "Forbidden" });

// Maps an incoming /api/supabase/... request to the PostgREST path it may reach,
// or returns an error Response when the request is outside the allowlist.
export function resolveProxyTarget(method, pathname) {
  if (!pathname.startsWith(`${PROXY_PREFIX}/`)) return { error: forbidden() };
  const segments = pathname.slice(PROXY_PREFIX.length + 1).split("/");
  if (segments.length !== 2) return { error: forbidden() };
  const [kind, name] = segments;

  if (kind === "rest" && ALLOWED_TABLES.has(name)) {
    if (method !== "GET") {
      return { error: jsonResponse(403, { message: "Method not allowed" }, { Allow: "GET" }) };
    }
    return { path: name };
  }

  if (kind === "rpc" && ALLOWED_RPCS.has(name)) {
    if (method !== "POST") {
      return { error: jsonResponse(403, { message: "Method not allowed" }, { Allow: "POST" }) };
    }
    return { path: `rpc/${name}` };
  }

  return { error: forbidden() };
}

export function createSupabaseProxyHandler({ getEnv, fetchImpl = fetch }) {
  return async (request) => {
    const isAuthenticated = await hasValidSession(
      request,
      getEnv("VELZ_DASHBOARD_USERNAME"),
      getEnv("VELZ_DASHBOARD_PASSWORD"),
      getEnv("VELZ_DASHBOARD_SESSION_SECRET"),
    );
    if (!isAuthenticated) return jsonResponse(401, { message: "Unauthorized" });

    const url = new URL(request.url);
    const target = resolveProxyTarget(request.method, url.pathname);
    if (target.error) return target.error;

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(503, { message: "Supabase proxy is not configured" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    };
    const init = { method: request.method, headers };

    if (request.method === "POST") {
      // Requiring JSON forces a CORS preflight for any cross-site caller.
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return jsonResponse(415, { message: "Content-Type must be application/json" });
      }
      headers["Content-Type"] = "application/json";
      init.body = await request.text();
    }

    const upstream = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${target.path}${url.search}`,
      init,
    );

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=UTF-8",
      },
    });
  };
}

const getEnv = (key) => globalThis.Netlify?.env.get(key) ?? process.env[key];

export default createSupabaseProxyHandler({ getEnv });

export const config = {
  path: `${PROXY_PREFIX}/*`,
};
