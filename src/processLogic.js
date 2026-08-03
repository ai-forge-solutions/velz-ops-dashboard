export const PROCESS_STEP_OPTIONS = [
  { id: "brand_context", label: "Contexto de marca", defaultMode: "preserve_success", group: "ETL" },
  { id: "meta_ads", label: "Meta Ads", defaultMode: "preserve_success", group: "ETL" },
  { id: "similarweb", label: "SimilarWeb", defaultMode: "preserve_success", group: "ETL" },
  { id: "reviews", label: "Reviews", defaultMode: "preserve_success", group: "ETL" },
  { id: "email_generation", label: "Generar email", defaultMode: "overwrite", group: "Outreach" },
  { id: "email_send", label: "Enviar email", defaultMode: "overwrite", group: "Outreach", explicit: true },
];

const VALID_STEP_IDS = new Set(PROCESS_STEP_OPTIONS.map((step) => step.id));
const VALID_STEP_MODES = new Set(["preserve_success", "overwrite"]);
const VALID_EXECUTION_STRATEGIES = new Set(["serial", "parallel"]);

export function defaultProcessSteps() {
  return PROCESS_STEP_OPTIONS.map((step) => ({
    id: step.id,
    enabled: !step.explicit,
    mode: step.defaultMode,
  }));
}

export function normalizeProcessStep(step) {
  if (!step || !VALID_STEP_IDS.has(step.id)) return null;
  return {
    id: step.id,
    mode: VALID_STEP_MODES.has(step.mode) ? step.mode : PROCESS_STEP_OPTIONS.find((option) => option.id === step.id).defaultMode,
  };
}

export function resolveProcessBrandIds({ brands = [], selectedIds = new Set(), scope = "all", fitScoreMin = 70, limit = 500 } = {}) {
  const rows = scope === "selected"
    ? brands.filter((brand) => selectedIds.has(brand.id))
    : scope === "fit_score"
      ? brands.filter((brand) => Number(brand.fit ?? brand.fit_score ?? 0) >= Number(fitScoreMin))
      : brands;
  return rows.slice(0, Math.max(0, Number(limit) || 0)).map((brand) => brand.id);
}

export function buildProcessPayload({
  brandIds = [],
  fitScoreMin = 70,
  limit = 500,
  steps = [],
  strategy = "serial",
  maxConcurrency = 5,
  continueOnError = true,
} = {}) {
  const normalizedSteps = steps
    .filter((step) => step.enabled !== false)
    .map(normalizeProcessStep)
    .filter(Boolean);

  return {
    brand_ids: Array.from(new Set((brandIds || []).filter(Boolean))),
    filters: {
      fit_score_min: Number(fitScoreMin),
      limit: Number(limit),
    },
    steps: normalizedSteps,
    execution: {
      strategy: VALID_EXECUTION_STRATEGIES.has(strategy) ? strategy : "serial",
      max_concurrency: Number(maxConcurrency),
      continue_on_error: Boolean(continueOnError),
    },
  };
}

export function payloadSignature(payload) {
  return JSON.stringify(payload);
}
