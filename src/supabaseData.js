import { outreachActionConfiguredMap } from "./conductorApi";
import { deriveOutreachStatus, QA_LEAD_ID } from "./outreachStatus";

const VITE_ENV = import.meta.env || {};

function envValue(key) {
  const runtimeEnv = globalThis.__VELZ_RUNTIME_CONFIG__ || {};
  return runtimeEnv[key] || VITE_ENV[key];
}

const BRAND_FIELDS = [
  "id",
  "name",
  "domain",
  "website_url",
  "monthly_revenue_usd",
  "fit_score",
].join(",");

const RUN_FIELDS = [
  "id",
  "brand_id",
  "service_key",
  "status",
  "started_at",
  "finished_at",
  "duration_ms",
  "created_at",
  "error_payload",
  "response_payload",
].join(",");

const META_SCRAPE_FIELDS = [
  "brand_id",
  "service_run_id",
  "ad_count",
  "raw_payload",
  "scraped_at",
].join(",");

const META_AD_FIELDS = [
  "title",
  "body_text",
  "cta_text",
  "platforms",
  "image_count",
  "video_count",
  "status",
  "start_date",
  "end_date",
  "reach",
  "reach_by_location_age_gender",
].join(",");

const REVIEW_FIELDS = [
  "score",
  "body",
  "author",
  "country_code",
  "published_at_text",
  "published_at",
  "source",
].join(",");

const STACK_FIELDS = [
  "id",
  "brand_id",
  "canonical_url",
  "http_status",
  "language",
  "analyzed_at",
  "created_at",
  "description",
  "title",
  "final_url",
].join(",");

const DETECTION_FIELDS = [
  "technology_id",
  "confidence",
  "evidence",
].join(",");

const CONTEXT_FIELDS = [
  "response_markdown",
  "created_at",
].join(",");

const OUTREACH_LIMIT = "2000";

const LEAD_MAGNET_TOOL_FIELDS = [
  "tool_key",
  "display_name",
  "segment",
  "description",
  "required_signals",
  "status",
].join(",");

const LEAD_MAGNET_ASSIGNMENT_FIELDS = [
  "lead_id",
  "brand_id",
  "suggested_tool",
  "assigned_tool_key",
  "resolved_tool_key",
  "resolved_tool_name",
  "resolved_segment",
  "required_signals",
  "assignment_source",
].join(",");


const PROCESS_RUN_FIELDS = [
  "id",
  "status",
  "request_payload",
  "brand_count",
  "item_count",
  "created_at",
  "updated_at",
].join(",");

const BRAND_GROUP_FIELDS = [
  "id",
  "name",
  "description",
  "brand_count",
  "brand_ids",
  "archived_at",
  "archived_by",
  "archive_reason",
  "created_at",
  "updated_at",
].join(",");

// Supabase is reached only through the same-origin Netlify proxy
// (netlify/functions/supabase-proxy.js), which holds the server-side key.
const SUPABASE_PROXY_BASE = "/api/supabase";

async function supabaseRest(path, searchParams = new URLSearchParams()) {
  const params = new URLSearchParams();
  searchParams.forEach((value, name) => params.set(name, value));
  const query = params.toString();
  const endpoint = `${SUPABASE_PROXY_BASE}/rest/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(endpoint, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase ${path} respondió ${response.status}: ${details}`);
  }

  return response.json();
}

async function supabaseRpc(functionName, body) {
  const response = await fetch(`${SUPABASE_PROXY_BASE}/rpc/${functionName}`, {
    method: "POST",
    credentials: "same-origin",
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
    const message = typeof payload === "string" ? payload : payload?.message || JSON.stringify(payload);
    throw new Error(`Supabase RPC ${functionName} respondió ${response.status}: ${message}`);
  }

  return payload;
}

function toDashboardBrand(row) {
  return {
    id: row.id,
    name: row.name || row.domain || "Marca sin nombre",
    domain: row.domain || row.website_url || "—",
    websiteUrl: row.website_url || null,
    fit: Number(row.fit_score ?? 0),
    revenue: Number(row.monthly_revenue_usd ?? 0),
    runs: {},
  };
}

function summarizeMetaScrape(scrape) {
  const raw = scrape?.raw_payload && typeof scrape.raw_payload === "object" ? scrape.raw_payload : {};
  const rawSummary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  return {
    ad_count: rawSummary.ad_count ?? raw.ad_count ?? scrape?.ad_count,
    stop_reason: rawSummary.stop_reason ?? raw.stop_reason,
    targeting: rawSummary.targeting ?? raw.targeting,
  };
}

function mergeMetaScrapeIntoRun(run, scrape) {
  if (!scrape) return run;
  const summary = summarizeMetaScrape(scrape);
  const currentPayload = run.response_payload && typeof run.response_payload === "object" ? run.response_payload : {};
  const currentSummary = currentPayload.summary && typeof currentPayload.summary === "object" ? currentPayload.summary : {};
  return {
    ...run,
    response_payload: {
      ...currentPayload,
      summary: {
        ...summary,
        ...currentSummary,
        targeting: currentSummary.targeting ?? summary.targeting,
        stop_reason: currentSummary.stop_reason ?? summary.stop_reason,
        ad_count: currentSummary.ad_count ?? summary.ad_count,
      },
    },
  };
}

function runMessage(run) {
  if (run.error_payload) {
    const phase = run.error_payload.phase;
    const type = run.error_payload.type || run.error_payload.name;
    const error = run.error_payload.error || run.error_payload.message || run.error_payload.detail;
    return [phase, type, error].filter(Boolean).join(": ") || JSON.stringify(run.error_payload);
  }

  if (run.response_payload) {
    const summary = run.response_payload.summary && typeof run.response_payload.summary === "object" ? run.response_payload.summary : null;
    if (summary) {
      const chunks = [];
      if (summary.ad_count != null) chunks.push(`${summary.ad_count} ads`);
      if (summary.stop_reason) chunks.push(`stop_reason=${summary.stop_reason}`);
      if (summary.targeting?.view_all_page_id) chunks.push(`view_all_page_id=${summary.targeting.view_all_page_id}`);
      if (chunks.length > 0) return chunks.join(" · ");
    }
    return run.response_payload.message || run.response_payload.error || run.response_payload.detail || null;
  }

  return null;
}

function attachLatestRuns(brands, runs, metaScrapes = []) {
  const byBrand = new Map(brands.map((brand) => [brand.id, { ...brand, runs: {} }]));
  const scrapeByRunId = new Map();

  for (const scrape of metaScrapes) {
    if (scrape?.service_run_id) scrapeByRunId.set(scrape.service_run_id, scrape);
  }
  const seen = new Set();

  for (const row of runs) {
    let run = row;
    if (run.service_key === "meta_ad_library_scraper") {
      run = mergeMetaScrapeIntoRun(run, scrapeByRunId.get(run.id));
    }
    if (!run.brand_id || !run.service_key) continue;
    const key = `${run.brand_id}:${run.service_key}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const brand = byBrand.get(run.brand_id);
    if (!brand) continue;

    brand.runs[run.service_key] = {
      id: run.id,
      service_run_id: run.id,
      status: run.status || "not_run",
      started_at: run.started_at || run.created_at,
      finished_at: run.finished_at,
      duration_ms: run.duration_ms,
      message: runMessage(run),
      error_payload: run.error_payload,
      response_payload: run.response_payload,
    };
  }

  return Array.from(byBrand.values());
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows || []) {
    const value = row?.[key];
    if (!value) continue;
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return grouped;
}

function latestOutreachRow(rows = []) {
  return rows.filter(Boolean).reduce((latest, row) => {
    if (!latest) return row;
    const left = new Date(latest.updated_at || latest.created_at || latest.sent_at || latest.last_provider_sync_at || 0).getTime();
    const right = new Date(row.updated_at || row.created_at || row.sent_at || row.last_provider_sync_at || 0).getTime();
    return right >= left ? row : latest;
  }, null);
}

function activeSuppressionForEmail(suppressionsByEmail, email) {
  if (!email) return null;
  const rows = suppressionsByEmail.get(String(email).toLowerCase()) || [];
  return latestOutreachRow(rows.filter((row) => row.active !== false));
}

function idsForInFilter(ids) {
  return Array.from(new Set(ids.filter(Boolean))).join(",");
}

// Netlify rejects long request URLs (414), so `in.(...)` filters are split into
// chunks whose encoded value stays well under that limit.
const IN_FILTER_MAX_ENCODED_LENGTH = 4000;

export function chunkInFilterValues(values, maxEncodedLength = IN_FILTER_MAX_ENCODED_LENGTH) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const chunks = [];
  let current = [];
  let length = 0;
  for (const value of unique) {
    const size = encodeURIComponent(`${value},`).length;
    if (current.length > 0 && length + size > maxEncodedLength) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(value);
    length += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Runs one request per chunk and concatenates the rows. Each value lands in a
// single chunk, so per-key ordering from `order=` is preserved.
async function supabaseRestIn(path, values, buildParams) {
  const chunks = chunkInFilterValues(values);
  const results = await Promise.all(
    chunks.map((chunk) => supabaseRest(path, buildParams(chunk.join(",")))),
  );
  return results.flat();
}

export function buildMetaScrapeParams(brandIds) {
  const ids = Array.isArray(brandIds) ? idsForInFilter(brandIds) : brandIds;
  return new URLSearchParams({
    select: META_SCRAPE_FIELDS,
    brand_id: `in.(${ids})`,
    order: "scraped_at.desc.nullslast",
    limit: "2000",
  });
}

async function loadOutreachForBrands(brands) {
  if (brands.length === 0) return new Map();
  const brandIds = brands.map((brand) => brand.id);
  const leads = await supabaseRestIn("v_lead_overview", brandIds, (ids) => new URLSearchParams({
    select: "*",
    brand_id: `in.(${ids})`,
    limit: OUTREACH_LIMIT,
  }));
  const normalizedLeads = leads.map((lead) => ({ ...lead, lead_id: lead.lead_id || lead.id }));
  const leadIds = normalizedLeads.map((lead) => lead.lead_id).filter(Boolean);
  if (leadIds.length === 0) return new Map();

  const byLead = (select, order) => (ids) => new URLSearchParams({
    select,
    lead_id: `in.(${ids})`,
    ...(order ? { order } : {}),
    limit: OUTREACH_LIMIT,
  });
  const [sequences, sends, events, magnetEvents, toolAssignments] = await Promise.all([
    supabaseRestIn("email_sequences", leadIds, byLead("*", "updated_at.desc.nullslast,created_at.desc.nullslast")),
    supabaseRestIn("email_sends", leadIds, byLead("*", "updated_at.desc.nullslast,created_at.desc.nullslast")),
    supabaseRestIn("email_events", leadIds, byLead("*", "event_at.desc.nullslast,created_at.desc.nullslast")),
    supabaseRestIn("lead_magnet_events", leadIds, byLead("*", "event_at.desc.nullslast,created_at.desc.nullslast")),
    supabaseRestIn("v_lead_magnet_tool_assignments", leadIds, byLead(LEAD_MAGNET_ASSIGNMENT_FIELDS)),
  ]);

  let suppressions = [];
  const emails = normalizedLeads.map((lead) => lead.primary_email || lead.email).filter(Boolean).map((email) => `"${String(email).toLowerCase()}"`);
  if (emails.length > 0) {
    suppressions = await supabaseRestIn("email_suppression_entries", emails, (values) => new URLSearchParams({
      select: "*",
      // Real schema uses email_address/email_hash; there is no `email` column.
      email_address: `in.(${values})`,
      order: "updated_at.desc.nullslast,created_at.desc.nullslast",
      limit: OUTREACH_LIMIT,
    }));
  }

  const leadsByBrand = groupBy(normalizedLeads, "brand_id");
  const sequencesByLead = groupBy(sequences, "lead_id");
  const sendsByLead = groupBy(sends, "lead_id");
  const eventsByLead = groupBy(events, "lead_id");
  const magnetEventsByLead = groupBy(magnetEvents, "lead_id");
  const toolAssignmentByLead = new Map((toolAssignments || []).filter((row) => row?.lead_id).map((row) => [row.lead_id, row]));
  const suppressionsByEmail = groupBy(suppressions.map((row) => ({ ...row, email: String(row.email_address || row.recipient_email || "").toLowerCase() })), "email");

  return new Map(brands.map((brand) => {
    const brandLeads = leadsByBrand.get(brand.id) || [];
    const lead = brandLeads.find((item) => item.lead_id === QA_LEAD_ID) || brandLeads[0] || null;
    if (!lead) return [brand.id, null];
    const sequence = latestOutreachRow(sequencesByLead.get(lead.lead_id) || []);
    const sendRows = sendsByLead.get(lead.lead_id) || [];
    const send = latestOutreachRow(sequence?.id ? sendRows.filter((row) => row.email_sequence_id === sequence.id) : sendRows);
    const email = lead.primary_email || lead.email;
    const toolAssignment = toolAssignmentByLead.get(lead.lead_id) || null;
    return [brand.id, deriveOutreachStatus({
      leadId: lead.lead_id,
      lead: {
        ...lead,
        contactName: lead.contact_name || null,
        accountEmail: email || null,
        toolAssignment,
        tool_key: toolAssignment?.assigned_tool_key ?? lead.tool_key,
      },
      sequence,
      send,
      events: eventsByLead.get(lead.lead_id) || [],
      magnetEvents: magnetEventsByLead.get(lead.lead_id) || [],
      suppression: activeSuppressionForEmail(suppressionsByEmail, email),
      launchConfigured: Boolean(envValue("VITE_OUTREACH_ORCHESTRATION_BASE_URL") || envValue("VITE_OUTREACH_API_BASE_URL")),
      actionConfigured: outreachActionConfiguredMap(),
    })];
  }));
}

function attachOutreach(brands, outreachByBrand, error = null) {
  return brands.map((brand) => ({
    ...brand,
    outreach: outreachByBrand?.get(brand.id) || null,
    outreachLoadError: error,
  }));
}

function toBrandGroup(row) {
  const rawBrandIds = Array.isArray(row.brand_ids) ? row.brand_ids : [];
  return {
    id: row.id,
    name: row.name || "Grupo sin nombre",
    description: row.description || "",
    brandCount: Number(row.brand_count ?? rawBrandIds.length ?? 0),
    brandIds: rawBrandIds.filter(Boolean).map(String),
    archivedAt: row.archived_at || null,
    archivedBy: row.archived_by || null,
    archiveReason: row.archive_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export async function loadRecentProcessRuns({ limit = 20 } = {}) {
  const params = new URLSearchParams({
    select: PROCESS_RUN_FIELDS,
    order: "created_at.desc",
    limit: String(limit),
  });
  const rows = await supabaseRest("process_runs", params);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    brand_count: row.brand_count,
    item_count: row.item_count,
    request_payload: row.request_payload,
    steps: Array.isArray(row.request_payload?.steps) ? row.request_payload.steps : [],
  }));
}

export async function loadBrandGroups() {
  const params = new URLSearchParams({
    select: BRAND_GROUP_FIELDS,
    order: "name.asc",
  });
  const rows = await supabaseRest("v_brand_groups", params);
  return rows.map(toBrandGroup);
}

export async function saveBrandGroup({ id = null, name, description = "", brandIds = [] } = {}) {
  const row = await supabaseRpc("save_brand_group", {
    p_group_id: id || null,
    p_name: name || "",
    p_description: description || "",
    p_brand_ids: Array.from(new Set((brandIds || []).filter(Boolean))),
  });
  return toBrandGroup(Array.isArray(row) ? row[0] : row);
}

export async function deleteBrandGroup(id) {
  if (!id) throw new Error("Falta id de grupo para borrar.");
  await supabaseRpc("delete_brand_group", { p_group_id: id });
}

export async function loadLeadMagnetTools() {
  const params = new URLSearchParams({
    select: LEAD_MAGNET_TOOL_FIELDS,
    order: "segment.asc,display_name.asc",
  });
  return supabaseRest("lead_magnet_tools", params);
}

export async function setLeadMagnetToolKey(leadId, toolKey) {
  if (!leadId) throw new Error("Falta lead_id para asignar lead magnet/tool.");
  return supabaseRpc("set_lead_magnet_tool_key", {
    p_lead_id: leadId,
    p_tool_key: toolKey || null,
  });
}

export async function loadDashboardBrands({ limit = 500 } = {}) {
  const brandParams = new URLSearchParams({
    select: BRAND_FIELDS,
    order: "fit_score.desc.nullslast,monthly_revenue_usd.desc.nullslast,name.asc",
    limit: String(limit),
  });
  const brandRows = await supabaseRest("brands", brandParams);
  const brands = brandRows.map(toDashboardBrand);

  if (brands.length === 0) return [];

  const ids = brands.map((brand) => brand.id);
  const runRows = await supabaseRestIn("service_runs", ids, (chunk) => new URLSearchParams({
    select: RUN_FIELDS,
    brand_id: `in.(${chunk})`,
    order: "created_at.desc.nullslast",
    limit: "2000",
  }));

  let metaScrapeRows = [];
  try {
    metaScrapeRows = await supabaseRestIn("meta_ad_scrapes", ids, buildMetaScrapeParams);
  } catch (error) {
    console.warn("No se pudo leer meta_ad_scrapes para enriquecer el resumen Meta Ads", error);
  }

  const withRuns = attachLatestRuns(brands, runRows, metaScrapeRows);
  try {
    const outreachByBrand = await loadOutreachForBrands(withRuns);
    return attachOutreach(withRuns, outreachByBrand);
  } catch (error) {
    console.warn("No se pudo leer el estado Outreach desde Supabase; el dashboard de señales sigue disponible", error);
    return attachOutreach(withRuns, new Map(), error);
  }
}

export async function loadBrandOutreach(brandId) {
  const brands = await loadDashboardBrands({ limit: 500 });
  return brands.find((brand) => brand.id === brandId)?.outreach || null;
}

export async function loadMetaAds(brandId) {
  const params = new URLSearchParams({
    select: META_AD_FIELDS,
    brand_id: `eq.${brandId}`,
    order: "start_date.desc.nullslast",
    // Visual safety cap for the drawer/detail view. Keep this as a UI limit until
    // Meta Ads needs true pagination or infinite scroll; it is not a scraper cap.
    limit: "500",
  });
  return supabaseRest("meta_ads", params);
}

export async function loadBrandReviews(brandId) {
  const params = new URLSearchParams({
    select: REVIEW_FIELDS,
    brand_id: `eq.${brandId}`,
    order: "published_at.desc.nullslast,created_at.desc.nullslast",
    limit: "500",
  });
  return supabaseRest("brand_reviews", params);
}

export async function loadTechStack(brandId) {
  const analysisParams = new URLSearchParams({
    select: STACK_FIELDS,
    brand_id: `eq.${brandId}`,
    order: "analyzed_at.desc.nullslast,created_at.desc.nullslast",
    limit: "1",
  });
  const [analysis] = await supabaseRest("web_stack_analyses", analysisParams);
  if (!analysis) return { analysis: null, detections: [] };

  const detectionParams = new URLSearchParams({
    select: DETECTION_FIELDS,
    analysis_id: `eq.${analysis.id}`,
    order: "confidence.desc.nullslast",
    limit: "200",
  });
  const detections = await supabaseRest("brand_technology_detections", detectionParams);
  const technologyIds = Array.from(new Set(detections.map((d) => d.technology_id).filter(Boolean)));

  let techById = new Map();
  if (technologyIds.length > 0) {
    const techParams = new URLSearchParams({
      select: "id,name,slug",
      id: `in.(${technologyIds.join(",")})`,
      limit: "200",
    });
    const technologies = await supabaseRest("technologies", techParams);
    techById = new Map(technologies.map((tech) => [tech.id, tech]));
  }

  return {
    analysis,
    detections: detections.map((detection) => ({
      ...detection,
      technology: techById.get(detection.technology_id) || null,
    })),
  };
}

export async function loadBrandContext(brandId) {
  const params = new URLSearchParams({
    select: CONTEXT_FIELDS,
    brand_id: `eq.${brandId}`,
    order: "created_at.desc.nullslast",
    limit: "1",
  });
  const [context] = await supabaseRest("brand_context_analyses", params);
  return context || null;
}

export async function loadBrandSource(source, brandId) {
  if (source === "metaAds") return loadMetaAds(brandId);
  if (source === "reviews") return loadBrandReviews(brandId);
  if (source === "techStack") return loadTechStack(brandId);
  if (source === "context") return loadBrandContext(brandId);
  throw new Error(`Fuente de verificación desconocida: ${source}`);
}
