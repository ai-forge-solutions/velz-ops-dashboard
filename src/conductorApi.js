const DEFAULT_CONDUCTOR_BASE_URL =
  "https://velz-signals-conductor-stg.blackocean-de4b65c4.westeurope.azurecontainerapps.io";

export const CONDUCTOR_ENDPOINTS = {
  meta_ad_library_scraper: "/microservices/meta-ad-library",
  brand_reviews: "/microservices/brand-reviews",
  web_stack_wappalyzer: "/microservices/web-stack",
  shopify_signals: "/microservices/shopify-signals",
  brand_context: "/microservices/brand-context",
};

export function conductorServiceAvailable(serviceKey) {
  return Object.prototype.hasOwnProperty.call(CONDUCTOR_ENDPOINTS, serviceKey);
}

function conductorBaseUrl() {
  return (import.meta.env.VITE_CONDUCTOR_BASE_URL || DEFAULT_CONDUCTOR_BASE_URL).replace(/\/$/, "");
}

function normalizeErrorPayload(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (payload.detail) return Array.isArray(payload.detail) ? JSON.stringify(payload.detail) : String(payload.detail);
  if (payload.message) return String(payload.message);
  return fallback;
}

async function conductorRequest(path, options = {}) {
  const response = await fetch(`${conductorBaseUrl()}${path}`, {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...options,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = normalizeErrorPayload(payload, `Conductor respondió HTTP ${response.status}`);
    throw new Error(message);
  }

  return payload;
}

async function conductorPost(path, body) {
  return conductorRequest(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function conductorGet(path) {
  return conductorRequest(path, { method: "GET" });
}

export async function runConductorService(brandId, serviceKey) {
  const endpoint = CONDUCTOR_ENDPOINTS[serviceKey];
  if (!endpoint) {
    throw new Error(`El servicio ${serviceKey} aún no tiene endpoint desplegado en el orquestador.`);
  }

  return conductorPost(endpoint, { supabase_id: brandId });
}

export async function runConductorPipeline(brandId) {
  return conductorPost("/microservices/run-all", { supabase_id: brandId });
}

export async function getMetaAdLibraryRun(serviceRunId) {
  if (!serviceRunId) throw new Error("Falta service_run_id para consultar Meta Ads.");
  return conductorGet(`/microservices/meta-ad-library/runs/${encodeURIComponent(serviceRunId)}`);
}
