export const COLORS = {
  ink: "#14161A",
  muted: "#8B8E92",
  line: "#E3E1DB",
  green: "#2A6B4F",
  red: "#B3402A",
  amber: "#A9791F",
  paper: "#FFFFFF",
  soft: "#F4F3EF",
  wash: "#FAFAF8",
};

export const VERIFICATION_SERVICES = [
  { key: "meta_ad_library_scraper", source: "metaAds", label: "Meta Ads" },
  { key: "brand_reviews", source: "reviews", label: "Reviews" },
  { key: "web_stack_wappalyzer", source: "techStack", label: "Tech Stack" },
  { key: "brand_context", source: "context", label: "Contexto (Triage)" },
];

export function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtInt(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("es-ES");
}

export function statusLabel(status) {
  return {
    not_run: "Sin ejecutar",
    queued: "En cola",
    running: "Ejecutando",
    success: "Éxito",
    partial: "Parcial",
    error: "Error",
    skipped: "Omitido",
  }[status || "not_run"] || status;
}

export function statusTone(status) {
  if (status === "success" || status === "running") return COLORS.green;
  if (status === "error") return COLORS.red;
  if (status === "partial") return COLORS.amber;
  return COLORS.muted;
}
