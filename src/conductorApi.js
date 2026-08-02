const DEFAULT_CONDUCTOR_BASE_URL =
  "https://velz-signals-conductor-stg.blackocean-de4b65c4.westeurope.azurecontainerapps.io";
const OUTREACH_ORCHESTRATION_BASE_URL = import.meta.env.VITE_OUTREACH_ORCHESTRATION_BASE_URL;
const OUTREACH_API_BASE_URL = import.meta.env.VITE_OUTREACH_API_BASE_URL || OUTREACH_ORCHESTRATION_BASE_URL;
const SALES_HANDY_QA_LAUNCH_PATH = "/orchestration/saleshandy/bulks/qa-single-lead/launch";

const OUTREACH_ACTION_PATHS = {
  generate: import.meta.env.VITE_OUTREACH_GENERATE_SEQUENCE_PATH,
  approve: import.meta.env.VITE_OUTREACH_APPROVE_SEQUENCE_PATH,
  reject: import.meta.env.VITE_OUTREACH_REJECT_SEQUENCE_PATH,
  launch: import.meta.env.VITE_OUTREACH_LAUNCH_SALESHANDY_PATH || SALES_HANDY_QA_LAUNCH_PATH,
};

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

function outreachApiBaseUrl() {
  return OUTREACH_API_BASE_URL?.replace(/\/$/, "") || null;
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

function interpolateLeadPath(path, leadId) {
  return path
    .replace(/:leadId/g, encodeURIComponent(leadId))
    .replace(/\{lead_id\}/g, encodeURIComponent(leadId))
    .replace(/\{leadId\}/g, encodeURIComponent(leadId));
}

async function outreachPost(action, { leadId, body = {} }) {
  const baseUrl = outreachApiBaseUrl();
  const path = OUTREACH_ACTION_PATHS[action];
  if (!baseUrl || !path) {
    throw new Error(`Endpoint Outreach ${action} no configurado. Define VITE_OUTREACH_API_BASE_URL y la ruta VITE_OUTREACH_${action.toUpperCase()}_SEQUENCE_PATH cuando el backend esté desplegado.`);
  }

  const response = await fetch(`${baseUrl}${interpolateLeadPath(path, leadId)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lead_id: leadId, ...body }),
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
    throw new Error(normalizeErrorPayload(payload, `Outreach ${action} respondió HTTP ${response.status}`));
  }
  return payload;
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

export function outreachActionConfigured(action) {
  const baseUrl = outreachApiBaseUrl();
  return Boolean(baseUrl && OUTREACH_ACTION_PATHS[action]);
}

export function outreachActionConfiguredMap() {
  return {
    generate: outreachActionConfigured("generate"),
    approve: outreachActionConfigured("approve"),
    reject: outreachActionConfigured("reject"),
    launch: outreachActionConfigured("launch"),
  };
}

export function saleshandyQaLaunchConfigured() {
  return outreachActionConfigured("launch");
}

export async function generateOutreachSequence(leadId) {
  return outreachPost("generate", { leadId });
}

export async function approveOutreachSequence(leadId) {
  return outreachPost("approve", { leadId });
}

export async function rejectOutreachSequence(leadId, note = "") {
  return outreachPost("reject", { leadId, body: note ? { note } : {} });
}

export async function launchSaleshandyQaBulk(leadId = "4768fa1e-21f7-4ff3-a82d-639deec5c4dd") {
  return outreachPost("launch", {
    leadId,
    body: {
      requested_by: "miguel",
      allow_pending_review_for_qa: false,
    },
  });
}
