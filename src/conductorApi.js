const DEFAULT_CONDUCTOR_BASE_URL =
  "https://velz-signals-conductor-stg.blackocean-de4b65c4.westeurope.azurecontainerapps.io";
const VITE_ENV = import.meta.env || {};

function envValue(key) {
  const runtimeEnv = globalThis.__VELZ_RUNTIME_CONFIG__ || {};
  return runtimeEnv[key] || VITE_ENV[key];
}

export const OUTREACH_DEFAULT_ACTION_PATHS = {
  generate: "/outreach/leads/{lead_id}/sequences/generate",
  approve: "/outreach/sequences/{sequence_id}/approve",
  reject: "/outreach/sequences/{sequence_id}/reject",
  editDraft: "/outreach/sequences/{sequence_id}/draft-fields",
  launch: "/outreach/sequences/{sequence_id}/launch-saleshandy",
};

const OUTREACH_ACTION_ENV_KEYS = {
  generate: "VITE_OUTREACH_GENERATE_SEQUENCE_PATH",
  approve: "VITE_OUTREACH_APPROVE_SEQUENCE_PATH",
  reject: "VITE_OUTREACH_REJECT_SEQUENCE_PATH",
  editDraft: "VITE_OUTREACH_EDIT_SEQUENCE_DRAFT_PATH",
  launch: "VITE_OUTREACH_LAUNCH_SALESHANDY_PATH",
};

function outreachActionPath(action) {
  return envValue(OUTREACH_ACTION_ENV_KEYS[action]) || OUTREACH_DEFAULT_ACTION_PATHS[action];
}

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
  return (envValue("VITE_CONDUCTOR_BASE_URL") || DEFAULT_CONDUCTOR_BASE_URL).replace(/\/$/, "");
}

function outreachApiBaseUrl() {
  const baseUrl = envValue("VITE_OUTREACH_API_BASE_URL") || envValue("VITE_OUTREACH_ORCHESTRATION_BASE_URL");
  return baseUrl?.replace(/\/$/, "") || null;
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

function interpolateOutreachPath(path, { leadId, sequenceId }) {
  return path
    .replace(/:leadId/g, encodeURIComponent(leadId || ""))
    .replace(/\{lead_id\}/g, encodeURIComponent(leadId || ""))
    .replace(/\{leadId\}/g, encodeURIComponent(leadId || ""))
    .replace(/:sequenceId/g, encodeURIComponent(sequenceId || ""))
    .replace(/\{sequence_id\}/g, encodeURIComponent(sequenceId || ""))
    .replace(/\{sequenceId\}/g, encodeURIComponent(sequenceId || ""));
}

export function buildOutreachActionUrl(baseUrl, action, { leadId, sequenceId } = {}) {
  const path = outreachActionPath(action);
  if (!baseUrl || !path) return null;
  if (path.match(/(:leadId|\{lead_?id\})/) && !leadId) throw new Error(`Falta lead_id para Outreach ${action}.`);
  if (path.match(/(:sequenceId|\{sequence_?id\})/) && !sequenceId) throw new Error(`Falta sequence_id para Outreach ${action}.`);
  return `${baseUrl.replace(/\/$/, "")}${interpolateOutreachPath(path, { leadId, sequenceId })}`;
}

async function outreachRequest(action, { leadId, sequenceId, body = {}, method = "POST" }) {
  const baseUrl = outreachApiBaseUrl();
  const path = outreachActionPath(action);
  if (!baseUrl || !path) {
    throw new Error(`Endpoint Outreach ${action} no configurado. Define VITE_OUTREACH_API_BASE_URL; las rutas reales de Outreach tienen defaults seguros.`);
  }

  const response = await fetch(buildOutreachActionUrl(baseUrl, action, { leadId, sequenceId }), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

async function outreachPost(action, payload) {
  return outreachRequest(action, { ...payload, method: "POST" });
}

async function outreachPatch(action, payload) {
  return outreachRequest(action, { ...payload, method: "PATCH" });
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

export async function previewProcess(payload) {
  return conductorPost("/processes/preview", payload);
}

export async function runProcess(payload) {
  return conductorPost("/processes/runs", payload);
}

export async function executeProcess(processRunId, execution = {}) {
  if (!processRunId) throw new Error("Falta process_run_id para lanzar el proceso.");
  return conductorPost(`/processes/runs/${encodeURIComponent(processRunId)}/execute`, execution);
}

export async function getProcessRun(processRunId) {
  if (!processRunId) throw new Error("Falta process_run_id para consultar el proceso.");
  return conductorGet(`/processes/runs/${encodeURIComponent(processRunId)}`);
}

export async function getMetaAdLibraryRun(serviceRunId) {
  if (!serviceRunId) throw new Error("Falta service_run_id para consultar Meta Ads.");
  return conductorGet(`/microservices/meta-ad-library/runs/${encodeURIComponent(serviceRunId)}`);
}

export function outreachActionConfigured(action) {
  const baseUrl = outreachApiBaseUrl();
  return Boolean(baseUrl && outreachActionPath(action));
}

export function outreachActionConfiguredMap() {
  return {
    generate: outreachActionConfigured("generate"),
    approve: outreachActionConfigured("approve"),
    reject: outreachActionConfigured("reject"),
    editDraft: outreachActionConfigured("editDraft"),
    launch: outreachActionConfigured("launch"),
  };
}

export function saleshandyQaLaunchConfigured() {
  return outreachActionConfigured("launch");
}

export async function generateOutreachSequence(leadId) {
  return outreachPost("generate", {
    leadId,
    body: {
      requested_by: "miguel",
      mode: "draft",
      force_regenerate: false,
    },
  });
}

export async function approveOutreachSequence(sequenceId) {
  return outreachPost("approve", {
    sequenceId,
    body: {
      reviewed_by: "miguel",
      notes: "Approved from Velz Ops Dashboard.",
    },
  });
}

export async function rejectOutreachSequence(sequenceId, notes = "") {
  return outreachPost("reject", {
    sequenceId,
    body: {
      reviewed_by: "miguel",
      ...(notes ? { notes } : {}),
    },
  });
}

export async function editOutreachSequenceDraft(sequenceId, draftPayload) {
  return outreachPatch("editDraft", {
    sequenceId,
    body: draftPayload,
  });
}

export async function launchSaleshandyQaBulk(sequenceId, leadId = "4768fa1e-21f7-4ff3-a82d-639deec5c4dd") {
  return outreachPost("launch", {
    sequenceId,
    leadId,
    body: {
      lead_id: leadId,
      requested_by: "miguel",
      allow_pending_review_for_qa: false,
    },
  });
}
