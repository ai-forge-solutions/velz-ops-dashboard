const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const BRAND_FIELDS = [
  "id",
  "name",
  "domain",
  "website_url",
  "monthly_revenue_usd",
  "fit_score",
].join(",");

const RUN_FIELDS = [
  "brand_id",
  "service_key",
  "status",
  "started_at",
  "duration_ms",
  "created_at",
].join(",");

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para leer datos reales de Supabase."
    );
  }

  return {
    url: SUPABASE_URL.replace(/\/$/, ""),
    key: SUPABASE_ANON_KEY,
  };
}

async function supabaseRest(path, searchParams = new URLSearchParams()) {
  const { url, key } = requireSupabaseConfig();
  const endpoint = new URL(`${url}/rest/v1/${path}`);
  searchParams.forEach((value, name) => endpoint.searchParams.set(name, value));

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase ${path} respondió ${response.status}: ${details}`);
  }

  return response.json();
}

function toDashboardBrand(row) {
  return {
    id: row.id,
    name: row.name || row.domain || "Marca sin nombre",
    domain: row.domain || row.website_url || "—",
    fit: Number(row.fit_score ?? 0),
    revenue: Number(row.monthly_revenue_usd ?? 0),
    runs: {},
  };
}

function attachLatestRuns(brands, runs) {
  const byBrand = new Map(brands.map((brand) => [brand.id, { ...brand, runs: {} }]));
  const seen = new Set();

  for (const run of runs) {
    if (!run.brand_id || !run.service_key) continue;
    const key = `${run.brand_id}:${run.service_key}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const brand = byBrand.get(run.brand_id);
    if (!brand) continue;

    brand.runs[run.service_key] = {
      status: run.status || "not_run",
      started_at: run.started_at || run.created_at,
      duration_ms: run.duration_ms,
    };
  }

  return Array.from(byBrand.values());
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

  const ids = brands.map((brand) => brand.id).join(",");
  const runParams = new URLSearchParams({
    select: RUN_FIELDS,
    brand_id: `in.(${ids})`,
    order: "created_at.desc.nullslast",
    limit: "2000",
  });
  const runRows = await supabaseRest("service_runs", runParams);

  return attachLatestRuns(brands, runRows);
}
