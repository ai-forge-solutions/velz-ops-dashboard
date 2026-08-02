export const CASCADE_ETL_FILTERS = [
  { key: "all", label: "Todos (incluye éxitos)" },
  { key: "not_run", label: "ETL sin ejecutar" },
  { key: "ran_error", label: "ETL ejecutado con error" },
];

const ERROR_STATUSES = new Set(["error", "fail", "failed", "bounced", "rejected"]);
const NOT_RUN_STATUSES = new Set(["", "not_run", "skipped", "not-ran", "not_ran"]);

export function normalizeCascadeStep(step) {
  if (!step) return null;
  if (typeof step === "string") return { type: "etl", key: step, delay: 0 };
  if (step.type) return step;
  return { ...step, type: "etl" };
}

export function cascadeEtlServiceKeys(steps = [], services = []) {
  const deployedServiceKeys = new Set(services.filter((service) => service.deployed !== false).map((service) => service.key));
  return steps
    .map(normalizeCascadeStep)
    .filter((step) => step?.type === "etl" && deployedServiceKeys.has(step.key))
    .map((step) => step.key);
}

function runStatus(brand, serviceKey) {
  return String(brand?.runs?.[serviceKey]?.status || "not_run").trim().toLowerCase();
}

export function brandMatchesEtlFilter(brand, etlServiceKeys = [], filter = "all") {
  if (filter === "all" || etlServiceKeys.length === 0) return true;
  const statuses = etlServiceKeys.map((key) => runStatus(brand, key));
  if (filter === "not_run") return statuses.every((status) => NOT_RUN_STATUSES.has(status));
  if (filter === "ran_error") return statuses.some((status) => ERROR_STATUSES.has(status));
  return true;
}

export function resolveCascadeTargets({ brands = [], selectedIds = new Set(), cascade = {}, services = [] } = {}) {
  const explicitSelectedIds = new Set(cascade.scopeBrandIds || selectedIds || []);
  const scoped = cascade.scope === "fit_score"
    ? brands.filter((brand) => Number(brand.fit ?? brand.fit_score ?? 0) >= Number(cascade.fitMin ?? 0))
    : cascade.scope === "selected"
      ? brands.filter((brand) => explicitSelectedIds.has(brand.id))
      : brands;

  const etlServiceKeys = cascadeEtlServiceKeys(cascade.steps || [], services);
  return scoped.filter((brand) => brandMatchesEtlFilter(brand, etlServiceKeys, cascade.etlStateFilter || "all"));
}
