import { useState, useEffect, useRef } from "react";
import {
  Check, X, Loader2, Clock, AlertTriangle, Minus, Play, Search,
  ChevronDown, Plus, Trash2, PlayCircle, Users, ChevronRight, Info, RotateCcw
} from "lucide-react";
import { loadDashboardBrands } from "./supabaseData";
import {
  conductorServiceAvailable,
  executeProcess,
  getMetaAdLibraryRun,
  getProcessRun,
  previewProcess,
  runConductorPipeline,
  runConductorService,
  runProcess,
} from "./conductorApi";
import BrandDrawer from "./BrandDrawer";
import {
  buildProcessPayload,
  defaultProcessSteps,
  findProcessRunItem,
  isProcessRunTerminal,
  payloadSignature,
  PROCESS_RUN_STATUSES,
  PROCESS_STEP_OPTIONS,
  processRunBrands,
  processRunStatusSummary,
  processRunSteps,
  processStepLabel,
  resolveProcessBrandIds,
} from "./processLogic";
import { deriveOutreachFilters } from "./outreachStatus";
// ---------------------------------------------------------------------------
// Pipeline definition — service_key values match the real `service_runs` table
// in the velz-outreach Supabase project. Services marked deployed:false have
// no orchestrator endpoint yet (per project notes) but are wired into the UI
// so triggering them is a no-op until the real service exists.
// ---------------------------------------------------------------------------
const META_ADS_SERVICE_KEY = "meta_ad_library_scraper";
const META_ADS_POLL_INTERVAL_MS = 15_000;

const SERVICES = [
  { key: META_ADS_SERVICE_KEY, label: "Meta Ads", deployed: true },
  { key: "brand_reviews", label: "Reviews", deployed: true },
  { key: "web_stack_wappalyzer", label: "Tech Stack", deployed: true },
  { key: "shopify_signals", label: "Shopify Signals", deployed: true },
  { key: "similarweb", label: "SimilarWeb", deployed: false },
  { key: "brand_context", label: "Contexto (Triage)", deployed: true },
  { key: "drafting", label: "Drafting", deployed: false },
  { key: "export", label: "Export", deployed: false },
];

function serviceLabel(serviceKey) {
  return SERVICES.find((service) => service.key === serviceKey)?.label || serviceKey;
}

const COLORS = {
  ink: "#14161A",
  muted: "#8B8E92",
  line: "#E3E1DB",
  green: "#2A6B4F",
  red: "#B3402A",
  amber: "#A9791F",
  paper: "#FFFFFF",
};

function fmtMoney(n) {
  return "€" + Math.round(n / 1.08).toLocaleString("es-ES");
}
function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function statusOf(brand, key) {
  return brand.runs[key]?.status || "not_run";
}

// -- Status cell: a small horizon-line + point, echoing the Velz mark -------
function StatusDot({ status }) {
  const cfg = {
    not_run: { fill: "none", stroke: COLORS.line, icon: null },
    queued: { fill: "none", stroke: COLORS.muted, icon: Clock },
    running: { fill: COLORS.green, stroke: COLORS.green, icon: Loader2, spin: true },
    success: { fill: COLORS.green, stroke: COLORS.green, icon: Check },
    partial: { fill: COLORS.amber, stroke: COLORS.amber, icon: AlertTriangle },
    failed: { fill: COLORS.red, stroke: COLORS.red, icon: X },
    cancelled: { fill: "none", stroke: COLORS.red, icon: X },
    error: { fill: COLORS.red, stroke: COLORS.red, icon: X },
    skipped: { fill: "none", stroke: COLORS.muted, icon: Minus },
    skipped_preserved: { fill: "none", stroke: COLORS.muted, icon: Check },
  }[status];
  const Icon = cfg.icon;
  return (
    <div className="relative flex items-center justify-center w-full h-6">
      <svg width="36" height="10" className="absolute">
        <line x1="0" y1="5" x2="36" y2="5" stroke={COLORS.line} strokeWidth="1" />
      </svg>
      <div
        className="relative z-10 flex items-center justify-center rounded-full"
        style={{
          width: 18, height: 18,
          background: cfg.fill === "none" ? COLORS.paper : cfg.fill,
          border: `1.5px solid ${cfg.stroke}`,
        }}
      >
        {Icon && (
          <Icon
            size={11}
            strokeWidth={2}
            color={cfg.fill === "none" ? cfg.stroke : "#fff"}
            className={cfg.spin ? "animate-spin" : ""}
          />
        )}
      </div>
    </div>
  );
}

function StatusLabel({ status }) {
  const map = {
    not_run: "Sin ejecutar", queued: "En cola", running: "Ejecutando",
    success: "Éxito", partial: "Parcial", failed: "Fallido", cancelled: "Cancelado",
    error: "Error", skipped: "Omitido", skipped_preserved: "Preservado",
  };
  return map[status];
}

function OutreachBadge({ value, tone = "muted" }) {
  const color = tone === "green" ? COLORS.green : tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : COLORS.muted;
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color, background: `${color}14`, border: `1px solid ${color}33` }}>
      {value || "—"}
    </span>
  );
}

function OutreachJourneyMini({ steps = [] }) {
  if (!steps.length) return null;
  const colorFor = (status) => status === "done" ? COLORS.green : status === "current" ? COLORS.amber : status === "blocked" ? COLORS.red : COLORS.line;
  return (
    <div className="mt-1 flex items-center gap-0.5" title="Readiness → Sequence → Review → Saleshandy → Engagement">
      {steps.map((step) => (
        <span key={step.key} className="h-1.5 w-5 rounded-full" style={{ background: colorFor(step.status) }} />
      ))}
    </div>
  );
}

function outreachTone(outreach) {
  if (!outreach) return "muted";
  if (outreach.lifecycle?.key === "suppressed" || outreach.lifecycle?.key === "failed" || outreach.readiness?.key === "blocked") return "red";
  if (outreach.readiness?.key === "pending_review" || outreach.lifecycle?.key === "import_pending") return "amber";
  if (["approved", "sent", "opened", "clicked"].includes(outreach.readiness?.key) || ["sent", "opened", "clicked"].includes(outreach.lifecycle?.key)) return "green";
  return "muted";
}

function OutreachStatusCell({ outreach, error }) {
  if (error) return <OutreachBadge value="Read blocked" tone="amber" />;
  if (!outreach) return <OutreachBadge value="No lead" />;
  const tone = outreachTone(outreach);
  return (
    <div className="flex flex-col items-start gap-1">
      <OutreachBadge value={outreach.readiness?.label} tone={tone} />
      <OutreachBadge value={outreach.lifecycle?.label} tone={tone} />
      <OutreachJourneyMini steps={outreach.journey} />
    </div>
  );
}

function statusFromConductorResult(result) {
  if (result?.status === "accepted") return "running";
  if (result?.status === "fail") return "error";
  if (result?.status) return result.status;
  return result?.success ? "success" : "error";
}

function activeMetaAdRunIds(brands) {
  return brands
    .map((brand) => brand.runs?.[META_ADS_SERVICE_KEY])
    .filter((run) => run?.service_run_id && ["queued", "running"].includes(run.status))
    .map((run) => run.service_run_id);
}

function runSummaryChunks(run) {
  const summary = run?.response_payload?.summary;
  if (!summary || typeof summary !== "object") return [];
  return [
    summary.ad_count != null ? `ad_count: ${summary.ad_count}` : null,
    summary.stop_reason ? `stop_reason: ${summary.stop_reason}` : null,
    summary.targeting?.view_all_page_id ? `view_all_page_id: ${summary.targeting.view_all_page_id}` : null,
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------
export default function App() {
  const [tab, setTab] = useState("runs");
  const [brands, setBrands] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [popover, setPopover] = useState(null); // {brandId, serviceKey}
  const [drawerBrand, setDrawerBrand] = useState(null);
  const popRef = useRef(null);

  const [actionMessage, setActionMessage] = useState(null);
  const activeMetaRunSignature = activeMetaAdRunIds(brands).join("|");

  async function refreshDashboardBrands({ showLoading = false } = {}) {
    if (showLoading) setLoadingBrands(true);
    setLoadError(null);
    try {
      const rows = await loadDashboardBrands();
      setBrands(rows);
      return rows;
    } catch (error) {
      setLoadError(error);
      throw error;
    } finally {
      if (showLoading) setLoadingBrands(false);
    }
  }

  function updateRun(brandId, serviceKey, patch) {
    setBrands(prev => prev.map(b => b.id !== brandId ? b : {
      ...b,
      runs: {
        ...b.runs,
        [serviceKey]: {
          ...b.runs[serviceKey],
          ...patch,
        },
      },
    }));
  }

  function markServiceRunning(brandId, serviceKey) {
    updateRun(brandId, serviceKey, {
      status: "running",
      started_at: new Date().toISOString(),
      duration_ms: null,
      message: "Ejecutando en el orquestador…",
    });
  }

  function markServiceFinished(brandId, serviceKey, result, fallbackMessage) {
    const nextStatus = statusFromConductorResult(result);
    const accepted = nextStatus === "running";
    const success = nextStatus === "success";
    updateRun(brandId, serviceKey, {
      status: nextStatus,
      service_run_id: result?.service_run_id,
      message: result?.message || fallbackMessage,
    });
    setActionMessage({
      tone: success ? "success" : accepted ? "warning" : "error",
      text: `${serviceKey}: ${result?.message || fallbackMessage}${result?.service_run_id ? ` · service_run_id ${result.service_run_id}` : ""}`,
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadBrands() {
      setLoadingBrands(true);
      setLoadError(null);
      try {
        const rows = await loadDashboardBrands();
        if (!cancelled) setBrands(rows);
      } catch (error) {
        if (!cancelled) setLoadError(error);
      } finally {
        if (!cancelled) setLoadingBrands(false);
      }
    }

    loadBrands();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onClick(e) {
      if (e.target?.closest?.("[data-cell-popover]")) return;
      setPopover(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const runIds = activeMetaAdRunIds(brands);
    if (runIds.length === 0) return undefined;

    let cancelled = false;
    async function pollMetaRuns() {
      try {
        await Promise.all(runIds.map((runId) => getMetaAdLibraryRun(runId).catch((error) => ({ error, runId }))));
        if (!cancelled) await refreshDashboardBrands();
      } catch (error) {
        if (!cancelled) {
          setActionMessage({ tone: "error", text: `No se pudo refrescar el run async de Meta Ads: ${error.message}` });
        }
      }
    }

    pollMetaRuns();
    const timer = window.setInterval(pollMetaRuns, META_ADS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeMetaRunSignature]);

  // -- Real conductor calls --------------------------------------------------
  async function triggerService(brandId, serviceKey) {
    if (!conductorServiceAvailable(serviceKey)) {
      const text = "Este servicio aún no tiene endpoint desplegado en el orquestador.";
      updateRun(brandId, serviceKey, { status: "skipped", message: text });
      setActionMessage({ tone: "warning", text });
      return;
    }

    markServiceRunning(brandId, serviceKey);
    const brandName = brands.find((brand) => brand.id === brandId)?.name || brandId;
    setActionMessage({ tone: "success", text: `Lanzando ${serviceLabel(serviceKey)} para ${brandName}…` });
    try {
      const result = await runConductorService(brandId, serviceKey);
      markServiceFinished(brandId, serviceKey, result, "El orquestador terminó sin mensaje.");
    } catch (error) {
      updateRun(brandId, serviceKey, {
        status: "error",
        message: error.message || "No se pudo llamar al orquestador.",
      });
      setActionMessage({ tone: "error", text: error.message || "No se pudo llamar al orquestador." });
    } finally {
      try {
        await refreshDashboardBrands();
      } catch (error) {
        setActionMessage({ tone: "error", text: `El servicio terminó, pero no se pudo refrescar Supabase: ${error.message}` });
      }
    }
  }

  async function triggerPipeline(brandId) {
    const runnableServices = SERVICES.filter(s => s.deployed && conductorServiceAvailable(s.key));
    runnableServices.forEach(s => markServiceRunning(brandId, s.key));

    try {
      const result = await runConductorPipeline(brandId);
      const results = Array.isArray(result?.results) ? result.results : [];
      results.forEach(serviceResult => {
        if (serviceResult?.service_key) {
          markServiceFinished(brandId, serviceResult.service_key, serviceResult, serviceResult.message);
        }
      });
      if (!result?.success) {
        const text = "El pipeline terminó con errores en el orquestador.";
        runnableServices
          .filter(s => !results.some(r => r?.service_key === s.key))
          .forEach(s => updateRun(brandId, s.key, { status: "error", message: text }));
        setActionMessage({ tone: "error", text });
      } else {
        setActionMessage({ tone: "success", text: "Pipeline ejecutado y persistido por el orquestador." });
      }
    } catch (error) {
      runnableServices.forEach(s => updateRun(brandId, s.key, {
        status: "error",
        message: error.message || "No se pudo ejecutar el pipeline.",
      }));
      setActionMessage({ tone: "error", text: error.message || "No se pudo ejecutar el pipeline." });
    } finally {
      try {
        await refreshDashboardBrands();
      } catch (error) {
        setActionMessage({ tone: "error", text: `El pipeline terminó, pero no se pudo refrescar Supabase: ${error.message}` });
      }
    }
  }

  async function triggerBulk(serviceKey) {
    for (const id of selected) {
      await triggerService(id, serviceKey);
    }
  }

  const filtered = brands.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.domain.toLowerCase().includes(search.toLowerCase())
  );

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", background: COLORS.paper, color: COLORS.ink }}
      className="w-full min-h-screen text-sm">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .display { font-family: 'Cormorant Garamond', serif; font-weight: 300; }
        table { border-collapse: collapse; }
      `}</style>

      {/* Header */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
        <div className="flex min-w-0 items-center gap-3">
          <svg width="22" height="18" viewBox="0 0 22 18">
            <line x1="0" y1="12" x2="22" y2="12" stroke={COLORS.ink} strokeWidth="1.3" />
            <line x1="11" y1="0" x2="11" y2="18" stroke={COLORS.ink} strokeWidth="1.3" />
            <circle cx="11" cy="12" r="3" fill={COLORS.ink} />
          </svg>
          <span className="display text-2xl tracking-wide lowercase">velz</span>
          <span className="mt-1 truncate text-xs uppercase tracking-widest" style={{ color: COLORS.muted }}>outreach ops</span>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-full p-1 sm:flex" style={{ background: "#F4F3EF" }}>
          {["runs", "outreach", "processes"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{ background: tab === t ? COLORS.ink : "transparent", color: tab === t ? "#fff" : COLORS.ink }}>
              {t === "runs" ? "Ejecuciones" : t === "outreach" ? "Outreach" : "Procesos"}
            </button>
          ))}
        </div>
      </div>

      {tab === "runs" ? (
        <RunsView
          brands={filtered} search={search} setSearch={setSearch}
          loading={loadingBrands} error={loadError}
          actionMessage={actionMessage} clearActionMessage={() => setActionMessage(null)}
          selected={selected} toggleRow={toggleRow}
          triggerService={triggerService} triggerPipeline={triggerPipeline} triggerBulk={triggerBulk}
          popover={popover} setPopover={setPopover} popRef={popRef}
          openBrandDrawer={setDrawerBrand}
        />
      ) : tab === "outreach" ? (
        <OutreachView brands={filtered} loading={loadingBrands} error={loadError} openBrandDrawer={setDrawerBrand} />
      ) : (
        <ProcessesView
          brands={brands} selected={selected}
          actionMessage={actionMessage}
          setActionMessage={setActionMessage}
          clearActionMessage={() => setActionMessage(null)}
        />
      )}

      <BrandDrawer
        brand={drawerBrand}
        onClose={() => setDrawerBrand(null)}
        onRefresh={async () => {
          const rows = await refreshDashboardBrands();
          setDrawerBrand((current) => current ? rows.find((brand) => brand.id === current.id) || current : current);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function RunsView({ brands, search, setSearch, loading, error, actionMessage, clearActionMessage, selected, toggleRow, triggerService, triggerPipeline, triggerBulk, popover, setPopover, popRef, openBrandDrawer }) {
  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex w-full items-center gap-2 rounded-md px-3 py-2 sm:w-auto sm:py-1.5" style={{ border: `1px solid ${COLORS.line}` }}>
          <Search size={14} color={COLORS.muted} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar marca o dominio…"
            className="w-full bg-transparent text-sm outline-none sm:w-56 sm:text-xs" />
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: COLORS.muted }}>{selected.size} seleccionadas</span>
            <BulkTrigger onTrigger={triggerBulk} />
          </div>
        )}
        <div className="flex items-center gap-3 text-xs sm:ml-auto" style={{ color: COLORS.muted }}>
          <Legend />
        </div>
      </div>

      {actionMessage && (
        <div
          className="mb-4 flex items-start justify-between gap-3 rounded-md px-3 py-2 text-xs"
          style={{
            border: `1px solid ${actionMessage.tone === "error" ? COLORS.red : actionMessage.tone === "warning" ? COLORS.amber : COLORS.green}`,
            color: actionMessage.tone === "error" ? COLORS.red : actionMessage.tone === "warning" ? COLORS.amber : COLORS.green,
            background: "#fff",
          }}
        >
          <span>{actionMessage.text}</span>
          <button onClick={clearActionMessage} className="mono text-[10px] uppercase">cerrar</button>
        </div>
      )}

      {/* Table */}
      <div className="hidden overflow-x-auto rounded-md sm:block" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr style={{ background: "#FAFAF8", borderBottom: `1px solid ${COLORS.line}` }}>
              <th className="w-8 py-2.5"></th>
              <th className="text-left px-3 py-2.5 font-medium" style={{ color: COLORS.muted }}>Marca</th>
              <th className="text-right px-3 py-2.5 font-medium mono" style={{ color: COLORS.muted }}>Revenue/mes</th>
              <th className="text-left px-3 py-2.5 font-medium" style={{ color: COLORS.muted }}>Outreach</th>
              {SERVICES.map(s => (
                <th key={s.key} className="px-2 py-2.5 font-medium text-center" style={{ color: s.deployed ? COLORS.ink : COLORS.muted, minWidth: 88 }}>
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{s.label}</span>
                    {!s.deployed && <span className="text-[9px] normal-case" style={{ color: COLORS.muted }}>no desplegado</span>}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={SERVICES.length + 5} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}>
                  <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando datos reales desde Supabase…</span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={SERVICES.length + 5} className="px-4 py-8 text-center" style={{ color: COLORS.red }}>
                  No se pudieron leer los datos reales de Supabase: {error.message}
                </td>
              </tr>
            )}
            {!loading && !error && brands.length === 0 && (
              <tr>
                <td colSpan={SERVICES.length + 5} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}>
                  No hay marcas en Supabase para mostrar.
                </td>
              </tr>
            )}
            {!loading && !error && brands.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: `1px solid ${COLORS.line}`, background: selected.has(b.id) ? "#F6F8F6" : i % 2 ? "#FDFDFC" : "#fff" }}>
                <td className="text-center">
                  <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleRow(b.id)} />
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => openBrandDrawer(b)}
                    className="group text-left"
                    title="Abrir panel de verificación de marca"
                  >
                    <div className="font-medium underline-offset-2 group-hover:underline">{b.name}</div>
                    <div className="mono text-[11px]" style={{ color: COLORS.muted }}>{b.domain}</div>
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right mono">{fmtMoney(b.revenue)}</td>
                <td className="px-3 py-2.5"><OutreachStatusCell outreach={b.outreach} error={b.outreachLoadError} /></td>
                {SERVICES.map(s => (
                  <td key={s.key} className="px-2 py-1.5 relative">
                    <button className="w-full" onClick={() => setPopover(p => p?.brandId === b.id && p?.serviceKey === s.key ? null : { brandId: b.id, serviceKey: s.key })}>
                      <StatusDot status={statusOf(b, s.key)} />
                    </button>
                    {popover?.brandId === b.id && popover?.serviceKey === s.key && (
                      <div ref={popRef}>
                        <CellPopoverImpl brand={b} service={s} onTrigger={() => { triggerService(b.id, s.key); }} onClose={() => setPopover(null)} />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5">
                  <button onClick={() => triggerPipeline(b.id)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap"
                    style={{ border: `1px solid ${COLORS.ink}`, color: COLORS.ink }}>
                    <Play size={10} /> Pipeline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 sm:hidden">
        {loading && (
          <div className="rounded-md px-4 py-8 text-center text-xs" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.muted }}>
            <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando datos reales desde Supabase…</span>
          </div>
        )}
        {!loading && error && (
          <div className="rounded-md px-4 py-8 text-center text-xs" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.red }}>
            No se pudieron leer los datos reales de Supabase: {error.message}
          </div>
        )}
        {!loading && !error && brands.length === 0 && (
          <div className="rounded-md px-4 py-8 text-center text-xs" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.muted }}>
            No hay marcas en Supabase para mostrar.
          </div>
        )}
        {!loading && !error && brands.map((brand) => (
          <MobileBrandCard
            key={brand.id}
            brand={brand}
            selected={selected.has(brand.id)}
            toggleRow={toggleRow}
            triggerService={triggerService}
            triggerPipeline={triggerPipeline}
            popover={popover}
            setPopover={setPopover}
            popRef={popRef}
            openBrandDrawer={openBrandDrawer}
          />
        ))}
      </div>

      <div className="mt-3 flex items-start gap-1.5 text-[11px]" style={{ color: COLORS.muted }}>
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Marcas y estado leídos en vivo desde Supabase <span className="mono">velz-outreach</span>. “Ejecutar ahora” y Pipeline llaman al conductor configurado en <span className="mono">VITE_CONDUCTOR_BASE_URL</span>; Meta Ads arranca como job async, guarda <span className="mono">service_run_id</span> y se refresca con polling corto sin mantener una request larga abierta. La pestaña Procesos usa <span className="mono">POST /processes/preview</span> y <span className="mono">POST /processes/runs</span>.</span>
      </div>
    </div>
  );
}

function MobileBrandCard({ brand, selected, toggleRow, triggerService, triggerPipeline, popover, setPopover, popRef, openBrandDrawer }) {
  const mobilePopoverService = SERVICES.find((service) => popover?.brandId === brand.id && popover?.serviceKey === service.key);

  return (
    <article className="rounded-lg p-4" style={{ border: `1px solid ${COLORS.line}`, background: selected ? "#F6F8F6" : COLORS.paper }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <label className="mt-1 flex shrink-0 items-center gap-2 text-xs" style={{ color: COLORS.muted }}>
          <input type="checkbox" checked={selected} onChange={() => toggleRow(brand.id)} />
          Sel.
        </label>
        <button type="button" onClick={() => openBrandDrawer(brand)} className="min-w-0 flex-1 text-left" title="Abrir panel de verificación de marca">
          <div className="truncate font-medium underline-offset-2 hover:underline">{brand.name}</div>
          <div className="mono truncate text-[11px]" style={{ color: COLORS.muted }}>{brand.domain}</div>
        </button>
        <div className="shrink-0 text-right mono text-[11px]">
          <div style={{ color: COLORS.muted }}>Revenue/mes</div>
          <div>{fmtMoney(brand.revenue)}</div>
        </div>
      </div>

      <div className="mb-3 rounded-md px-3 py-2" style={{ background: "#FAFAF8", border: `1px solid ${COLORS.line}` }}>
        <div className="mb-1 text-[10px] uppercase tracking-wide" style={{ color: COLORS.muted }}>Outreach</div>
        <OutreachStatusCell outreach={brand.outreach} error={brand.outreachLoadError} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SERVICES.map((service) => {
          const status = statusOf(brand, service.key);
          return (
            <div key={service.key} className="relative">
              <button
                type="button"
                onClick={() => setPopover((current) => current?.brandId === brand.id && current?.serviceKey === service.key ? null : { brandId: brand.id, serviceKey: service.key })}
                className="flex min-h-[70px] w-full flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-center"
                style={{ border: `1px solid ${COLORS.line}`, color: service.deployed ? COLORS.ink : COLORS.muted, background: "#FAFAF8" }}
              >
                <StatusDot status={status} />
                <span className="text-[11px] leading-tight">{service.label}</span>
                {!service.deployed && <span className="text-[9px] leading-none" style={{ color: COLORS.muted }}>no desplegado</span>}
              </button>
            </div>
          );
        })}
      </div>

      {mobilePopoverService && (
        <div ref={popRef} className="mt-2">
          <CellPopoverImpl
            brand={brand}
            service={mobilePopoverService}
            onTrigger={() => { triggerService(brand.id, mobilePopoverService.key); }}
            onClose={() => setPopover(null)}
          />
        </div>
      )}

      <button onClick={() => triggerPipeline(brand.id)}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded px-3 py-2 text-xs font-medium"
        style={{ border: `1px solid ${COLORS.ink}`, color: COLORS.ink }}>
        <Play size={12} /> Ejecutar pipeline
      </button>
    </article>
  );
}

function Legend() {
  const items = [
    { s: "success", l: "Éxito" }, { s: "error", l: "Error" },
    { s: "partial", l: "Parcial" }, { s: "running", l: "Ejecutando" }, { s: "not_run", l: "Sin ejecutar" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:min-w-max sm:flex-nowrap">
      {items.map(it => (
        <div key={it.s} className="flex items-center gap-1">
          <div style={{ transform: "scale(0.6)" }}><StatusDot status={it.s} /></div>
          <span>{it.l}</span>
        </div>
      ))}
    </div>
  );
}

function BulkTrigger({ onTrigger }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium"
        style={{ background: COLORS.green, color: "#fff" }}>
        <Play size={10} /> Ejecutar servicio <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 rounded-md shadow-lg py-1 w-48" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
          {SERVICES.map(s => (
            <button key={s.key} onClick={() => { if (s.deployed) onTrigger(s.key); setOpen(false); }}
              disabled={!s.deployed}
              className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45">
              {s.label}{!s.deployed ? " · no desplegado" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CellPopoverImpl({ brand, service, onTrigger, onClose }) {
  const run = brand.runs[service.key];
  const status = run?.status || "not_run";
  return (
    <div data-cell-popover className="z-30 w-full min-w-56 rounded-md p-3 text-left sm:absolute sm:left-1/2 sm:top-8 sm:w-56 sm:-translate-x-1/2"
      style={{ background: "#fff", border: `1px solid ${COLORS.line}`, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-[11px]">{service.label}</span>
        <div className="w-10 shrink-0"><StatusDot status={status} /></div>
      </div>
      <div className="text-[11px] mb-2" style={{ color: COLORS.muted }}><StatusLabel status={status} /></div>
      {run?.started_at && (
        <div className="mono text-[10px] mb-1" style={{ color: COLORS.muted }}>
          Inicio: {fmtTime(run.started_at)} · Duración: {fmtDuration(run.duration_ms)}
        </div>
      )}
      {run?.service_run_id && (
        <div className="mono text-[10px] mb-1 break-all" style={{ color: COLORS.muted }}>
          service_run_id: {run.service_run_id}
        </div>
      )}
      {runSummaryChunks(run).map((chunk) => (
        <div key={chunk} className="mono text-[10px] mb-1" style={{ color: COLORS.muted }}>
          {chunk}
        </div>
      ))}
      {run?.message && (
        <div className="text-[10px] mb-2" style={{ color: status === "error" ? COLORS.red : COLORS.muted }}>
          {run.message}
        </div>
      )}
      {!service.deployed && (
        <div className="text-[10px] mb-2 flex items-start gap-1" style={{ color: COLORS.amber }}>
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Este servicio aún no está desplegado en el orquestador.
        </div>
      )}
      <button onClick={onTrigger}
        disabled={!service.deployed}
        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
        style={{ background: service.deployed ? COLORS.ink : COLORS.line, color: service.deployed ? "#fff" : COLORS.muted }}>
        <RotateCcw size={11} /> {service.deployed ? "Ejecutar ahora" : "No disponible"}
      </button>
    </div>
  );
}
// ---------------------------------------------------------------------------
const OUTREACH_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "ready_to_generate", label: "Ready to generate" },
  { key: "needs_review", label: "Needs review" },
  { key: "ready_to_launch", label: "Ready to launch" },
  { key: "launched", label: "Launched" },
  { key: "provider_pending", label: "Provider pending" },
  { key: "engaged", label: "Engaged" },
  { key: "failed_blocked", label: "Failed / blocked" },
  { key: "suppressed", label: "Suppressed" },
];

function OutreachView({ brands, loading, error, openBrandDrawer }) {
  const [filter, setFilter] = useState("all");
  const rows = brands.filter((brand) => filter === "all" || deriveOutreachFilters(brand.outreach).includes(filter));

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {OUTREACH_FILTERS.map((item) => (
          <button key={item.key} onClick={() => setFilter(item.key)} className="rounded-full px-3 py-1 font-medium" style={{ background: filter === item.key ? COLORS.ink : COLORS.soft, color: filter === item.key ? "#fff" : COLORS.ink }}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr style={{ background: "#FAFAF8", borderBottom: `1px solid ${COLORS.line}` }}>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: COLORS.muted }}>Marca / lead</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: COLORS.muted }}>Readiness</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: COLORS.muted }}>Lifecycle</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: COLORS.muted }}>Provider / engagement</th>
              <th className="px-3 py-2.5 text-left font-medium" style={{ color: COLORS.muted }}>Next action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}><Loader2 size={14} className="mr-2 inline animate-spin" /> Cargando Outreach desde Supabase…</td></tr>}
            {!loading && error && <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: COLORS.red }}>No se pudieron leer marcas: {error.message}</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}>No hay leads para este filtro.</td></tr>}
            {!loading && !error && rows.map((brand) => {
              const outreach = brand.outreach;
              const tone = outreachTone(outreach);
              return (
                <tr key={brand.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <td className="px-3 py-3 align-top">
                    <button onClick={() => openBrandDrawer(brand)} className="text-left underline-offset-2 hover:underline">
                      <div className="font-medium">{brand.name}</div>
                      <div className="mono text-[11px]" style={{ color: COLORS.muted }}>{outreach?.leadId || "sin lead"} · {outreach?.email || brand.domain}</div>
                    </button>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <OutreachBadge value={outreach?.readiness?.label || (brand.outreachLoadError ? "Read blocked" : "Not ready")} tone={brand.outreachLoadError ? "amber" : tone} />
                      <OutreachJourneyMini steps={outreach?.journey} />
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top"><OutreachBadge value={outreach?.lifecycle?.label || "Not launched"} tone={tone} /></td>
                  <td className="px-3 py-3 align-top mono text-[11px]" style={{ color: COLORS.muted }}>
                    <div>sequence: {outreach?.provider?.provider_sequence_id || "—"}</div>
                    <div>import: {outreach?.provider?.provider_import_status || outreach?.provider?.provider_import_request_id || "—"}</div>
                    <div>events: {Object.entries(outreach?.events?.counts || {}).map(([key, count]) => `${key}:${count}`).join(" · ") || "—"}</div>
                    <div>tool: {Object.entries(outreach?.magnetEvents?.counts || {}).map(([key, count]) => `${key}:${count}`).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-3 py-3 align-top" style={{ color: outreach?.blockers?.length ? COLORS.red : COLORS.ink }}>
                    {brand.outreachLoadError ? `Supabase read blocked: ${brand.outreachLoadError.message}` : outreach?.nextAction?.label || "No outreach data"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProcessesView({ brands, selected, actionMessage, setActionMessage, clearActionMessage }) {
  const [scope, setScope] = useState("selected");
  const [fitScoreMin, setFitScoreMin] = useState(70);
  const [limit, setLimit] = useState(500);
  const [steps, setSteps] = useState(defaultProcessSteps);
  const [strategy, setStrategy] = useState("serial");
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const [continueOnError, setContinueOnError] = useState(true);
  const [preview, setPreview] = useState(null);
  const [validatedSignature, setValidatedSignature] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [activeProcessRunId, setActiveProcessRunId] = useState(() => new URLSearchParams(window.location.search).get("process_run_id") || "");
  const [processRunInput, setProcessRunInput] = useState(() => new URLSearchParams(window.location.search).get("process_run_id") || "");
  const [processRunDetail, setProcessRunDetail] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [executingRunId, setExecutingRunId] = useState(null);

  const brandIds = resolveProcessBrandIds({ brands, selectedIds: selected, scope, fitScoreMin, limit });
  const payload = buildProcessPayload({ brandIds, fitScoreMin, limit, steps, strategy, maxConcurrency, continueOnError });
  const currentSignature = payloadSignature(payload);
  const previewIsCurrent = validatedSignature === currentSignature;
  const selectedSteps = payload.steps;
  const executionPayload = payload.execution;

  function rememberProcessRunId(processRunId) {
    setActiveProcessRunId(processRunId);
    setProcessRunInput(processRunId);
    const url = new URL(window.location.href);
    if (processRunId) {
      url.searchParams.set("process_run_id", processRunId);
    } else {
      url.searchParams.delete("process_run_id");
    }
    window.history.replaceState({}, "", url);
  }

  async function refreshProcessRun(processRunId = activeProcessRunId, { quiet = false } = {}) {
    if (!processRunId) return null;
    if (!quiet) setLoadingDetail(true);
    try {
      const detail = await getProcessRun(processRunId);
      setProcessRunDetail(detail);
      setActiveProcessRunId(detail?.id || processRunId);
      setProcessRunInput(detail?.id || processRunId);
      return detail;
    } catch (error) {
      if (!quiet) setActionMessage({ tone: "error", text: `No se pudo leer process_run_id ${processRunId}: ${error.message}` });
      throw error;
    } finally {
      if (!quiet) setLoadingDetail(false);
    }
  }

  function updateStep(id, patch) {
    setPreview(null);
    setValidatedSignature(null);
    setRunResult(null);
    setSteps((prev) => prev.map((step) => step.id === id ? { ...step, ...patch } : step));
  }

  function resetPreviewState() {
    setPreview(null);
    setValidatedSignature(null);
    setRunResult(null);
  }

  async function handlePreview() {
    if (payload.brand_ids.length === 0 || payload.steps.length === 0) return;
    setLoadingPreview(true);
    setRunResult(null);
    try {
      const result = await previewProcess(payload);
      setPreview(result || {});
      setValidatedSignature(currentSignature);
      setActionMessage({ tone: "success", text: "Preview real generado por el backend de procesos." });
    } catch (error) {
      setPreview(null);
      setValidatedSignature(null);
      setActionMessage({ tone: "error", text: `No se pudo generar preview: ${error.message}` });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleRun() {
    if (!previewIsCurrent) return;
    setLoadingRun(true);
    setProcessRunDetail(null);
    try {
      const result = await runProcess(payload);
      setRunResult(result || {});
      const processRunId = result?.process_run_id || result?.id || result?.run_id;
      if (!processRunId) throw new Error("El backend creó el proceso sin devolver process_run_id.");
      rememberProcessRunId(processRunId);
      setActionMessage({ tone: "success", text: `Proceso creado · process_run_id ${processRunId}. Lanzando ejecución backend…` });
      await refreshProcessRun(processRunId, { quiet: true });
      setExecutingRunId(processRunId);
      executeProcess(processRunId, executionPayload)
        .then(async (executeResult) => {
          setRunResult((current) => ({ ...(current || result || {}), execute: executeResult }));
          await refreshProcessRun(processRunId, { quiet: true });
          setActionMessage({ tone: "success", text: `Ejecución backend terminada para process_run_id ${processRunId}: ${executeResult?.message || executeResult?.status || "sin mensaje"}` });
        })
        .catch((error) => {
          setActionMessage({ tone: "error", text: `El proceso se creó, pero execute falló para ${processRunId}: ${error.message}` });
        })
        .finally(() => setExecutingRunId(null));
    } catch (error) {
      setActionMessage({ tone: "error", text: `No se pudo ejecutar el proceso: ${error.message}` });
    } finally {
      setLoadingRun(false);
    }
  }

  async function handleLoadRun(event) {
    event.preventDefault();
    const processRunId = processRunInput.trim();
    if (!processRunId) return;
    rememberProcessRunId(processRunId);
    await refreshProcessRun(processRunId);
  }

  useEffect(() => {
    if (!activeProcessRunId) return undefined;
    let cancelled = false;
    async function pollProcessRun() {
      try {
        const detail = await getProcessRun(activeProcessRunId);
        if (!cancelled) setProcessRunDetail(detail);
      } catch (error) {
        if (!cancelled) setActionMessage({ tone: "error", text: `Polling de process_run_id ${activeProcessRunId} falló: ${error.message}` });
      }
    }
    pollProcessRun();
    if (isProcessRunTerminal(processRunDetail?.status)) return () => { cancelled = true; };
    const timer = window.setInterval(pollProcessRun, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeProcessRunId, processRunDetail?.status]);

  const estimatedTotal = preview?.total_items_estimated ?? preview?.estimated_total_items ?? preview?.total_items ?? preview?.items_estimated;
  const previewBrandCount = preview?.brand_count ?? preview?.brands_count ?? preview?.brand_ids_count ?? payload.brand_ids.length;
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const processRunId = activeProcessRunId || runResult?.process_run_id || runResult?.id || runResult?.run_id;
  const itemSummary = processRunStatusSummary(processRunDetail?.items || []);

  return (
    <div className="grid grid-cols-1 gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] sm:px-6 sm:py-5">
      <div className="rounded-md p-4" style={{ border: `1px solid ${COLORS.line}` }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">Configurar proceso</h3>
            <p className="mt-1 text-xs" style={{ color: COLORS.muted }}>
              Ejecución one-shot: selecciona marcas/filtros, steps y modo de outputs. No hay programación recurrente.
            </p>
          </div>
          <span className="mono rounded-full px-2 py-1 text-[10px]" style={{ background: "#FAFAF8", color: COLORS.muted }}>POST /processes/*</span>
        </div>

        {actionMessage && (
          <div
            className="mb-4 flex items-start justify-between gap-3 rounded-md px-3 py-2 text-xs"
            style={{
              border: `1px solid ${actionMessage.tone === "error" ? COLORS.red : actionMessage.tone === "warning" ? COLORS.amber : COLORS.green}`,
              color: actionMessage.tone === "error" ? COLORS.red : actionMessage.tone === "warning" ? COLORS.amber : COLORS.green,
              background: "#fff",
            }}
          >
            <span>{actionMessage.text}</span>
            <button onClick={clearActionMessage} className="mono text-[10px] uppercase">cerrar</button>
          </div>
        )}

        <section className="mb-5">
          <label className="mb-2 block text-[11px]" style={{ color: COLORS.muted }}>Marcas</label>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <label className="rounded-md p-3" style={{ border: `1px solid ${scope === "selected" ? COLORS.ink : COLORS.line}` }}>
              <input type="radio" checked={scope === "selected"} onChange={() => { setScope("selected"); resetPreviewState(); }} className="mr-2" />
              Seleccionadas ({selected.size})
            </label>
            <label className="rounded-md p-3" style={{ border: `1px solid ${scope === "fit_score" ? COLORS.ink : COLORS.line}` }}>
              <input type="radio" checked={scope === "fit_score"} onChange={() => { setScope("fit_score"); resetPreviewState(); }} className="mr-2" />
              Fit score ≥
              <input type="number" value={fitScoreMin} onChange={e => { setFitScoreMin(Number(e.target.value)); resetPreviewState(); }} className="ml-2 w-14 mono rounded px-1 py-0.5" style={{ border: `1px solid ${COLORS.line}` }} />
            </label>
            <label className="rounded-md p-3" style={{ border: `1px solid ${scope === "all" ? COLORS.ink : COLORS.line}` }}>
              <input type="radio" checked={scope === "all"} onChange={() => { setScope("all"); resetPreviewState(); }} className="mr-2" />
              Todas ({brands.length})
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: COLORS.muted }}>
            <Users size={13} />
            <span>{payload.brand_ids.length} marcas incluidas en <span className="mono">brand_ids</span>; límite </span>
            <input type="number" min="1" value={limit} onChange={e => { setLimit(Number(e.target.value)); resetPreviewState(); }} className="w-20 mono rounded px-1 py-0.5 text-right" style={{ border: `1px solid ${COLORS.line}` }} />
          </div>
        </section>

        <section className="mb-5">
          <label className="mb-2 block text-[11px]" style={{ color: COLORS.muted }}>Steps y modo de outputs</label>
          <div className="space-y-2">
            {PROCESS_STEP_OPTIONS.map((option) => {
              const step = steps.find((item) => item.id === option.id);
              const enabled = Boolean(step?.enabled);
              return (
                <div key={option.id} className="rounded-md p-3" style={{ border: `1px solid ${enabled ? COLORS.ink : COLORS.line}`, background: enabled ? "#fff" : "#FAFAF8" }}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={enabled} onChange={e => updateStep(option.id, { enabled: e.target.checked })} />
                      <span>{option.label}</span>
                      <span className="mono text-[10px]" style={{ color: COLORS.muted }}>{option.id}</span>
                    </label>
                    <select disabled={!enabled} value={step?.mode || option.defaultMode} onChange={e => updateStep(option.id, { mode: e.target.value })} className="rounded px-2 py-1 text-xs mono" style={{ border: `1px solid ${COLORS.line}` }}>
                      <option value="preserve_success">preserve_success</option>
                      <option value="overwrite">overwrite</option>
                    </select>
                  </div>
                  {option.id === "email_send" && (
                    <p className="mt-2 text-[11px]" style={{ color: COLORS.amber }}>
                      Envío real: actívalo solo si quieres lanzar emails ahora. No se bloquea después de seleccionarlo explícitamente.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-5">
          <label className="mb-2 block text-[11px]" style={{ color: COLORS.muted }}>Ejecución</label>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <select value={strategy} onChange={e => { setStrategy(e.target.value); resetPreviewState(); }} className="rounded px-2 py-1.5 mono" style={{ border: `1px solid ${COLORS.line}` }}>
              <option value="serial">serial</option>
              <option value="parallel">parallel</option>
            </select>
            <label className="flex items-center gap-2">
              max_concurrency
              <input type="number" min="1" value={maxConcurrency} onChange={e => { setMaxConcurrency(Number(e.target.value)); resetPreviewState(); }} className="w-16 rounded px-1 py-1 mono text-right" style={{ border: `1px solid ${COLORS.line}` }} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={continueOnError} onChange={e => { setContinueOnError(e.target.checked); resetPreviewState(); }} />
              continue_on_error
            </label>
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={handlePreview} disabled={loadingPreview || payload.brand_ids.length === 0 || payload.steps.length === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-xs font-medium"
            style={{ background: (payload.brand_ids.length === 0 || payload.steps.length === 0) ? COLORS.line : COLORS.ink, color: "#fff" }}>
            {loadingPreview ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Preview real
          </button>
          <button onClick={handleRun} disabled={loadingRun || executingRunId || !previewIsCurrent}
            className="flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-xs font-medium"
            style={{ background: previewIsCurrent ? COLORS.green : COLORS.line, color: "#fff" }}>
            {(loadingRun || executingRunId) ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Crear + ejecutar
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-md p-4" style={{ border: `1px solid ${COLORS.line}` }}>
          <h3 className="mb-3 font-medium">Payload común</h3>
          <pre className="max-h-[360px] overflow-auto rounded-md p-3 text-[11px] mono" style={{ background: "#FAFAF8", color: COLORS.ink }}>
{JSON.stringify(payload, null, 2)}
          </pre>
        </div>

        <div className="rounded-md p-4" style={{ border: `1px solid ${COLORS.line}` }}>
          <h3 className="mb-3 font-medium">Preview backend</h3>
          {!preview && <p className="text-xs" style={{ color: COLORS.muted }}>Genera preview antes de ejecutar. El botón de ejecución usa exactamente el payload validado.</p>}
          {preview && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="marcas" value={previewBrandCount} />
                <Metric label="steps" value={selectedSteps.length} />
                <Metric label="items est." value={estimatedTotal ?? "—"} />
              </div>
              {warnings.length > 0 && (
                <div className="rounded-md p-3" style={{ border: `1px solid ${COLORS.amber}`, color: COLORS.amber }}>
                  <div className="mb-1 font-medium">Warnings backend</div>
                  <ul className="list-disc pl-4">
                    {warnings.map((warning, index) => <li key={index}>{typeof warning === "string" ? warning : JSON.stringify(warning)}</li>)}
                  </ul>
                </div>
              )}
              <pre className="max-h-[220px] overflow-auto rounded-md p-3 text-[11px] mono" style={{ background: "#FAFAF8", color: COLORS.ink }}>
{JSON.stringify(preview, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="rounded-md p-4 text-xs" style={{ border: `1px solid ${processRunDetail ? COLORS.green : COLORS.line}` }}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">Monitor persistido</h3>
              <p className="mt-1" style={{ color: COLORS.muted }}>Lee progreso real desde GET /processes/runs/{"{id}"}. El enlace con process_run_id rehidrata tras refresh.</p>
            </div>
            {loadingDetail && <Loader2 size={14} className="animate-spin" color={COLORS.muted} />}
          </div>
          <form onSubmit={handleLoadRun} className="mb-3 flex gap-2">
            <input value={processRunInput} onChange={e => setProcessRunInput(e.target.value)} placeholder="process_run_id" className="min-w-0 flex-1 rounded px-2 py-1 mono text-[11px]" style={{ border: `1px solid ${COLORS.line}` }} />
            <button type="submit" className="rounded px-2 py-1 font-medium" style={{ background: COLORS.ink, color: "#fff" }}>Cargar</button>
          </form>
          {processRunId && <p className="mb-2">process_run_id: <span className="mono break-all">{processRunId}</span></p>}
          {!processRunDetail && <p style={{ color: COLORS.muted }}>Crea un proceso o pega un process_run_id existente para ver historial/progreso.</p>}
          {processRunDetail && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="estado" value={<StatusLabel status={processRunDetail.status} />} />
                <Metric label="brand_count" value={processRunDetail.brand_count ?? "—"} />
                <Metric label="item_count" value={processRunDetail.item_count ?? processRunDetail.items?.length ?? "—"} />
              </div>
              <div className="flex flex-wrap gap-2 mono text-[10px]" style={{ color: COLORS.muted }}>
                {PROCESS_RUN_STATUSES.map((status) => (
                  <span key={status}>{status}: {status === processRunDetail.status ? 1 : 0}</span>
                ))}
                {Object.entries(itemSummary).map(([status, count]) => <span key={status}>{status}: {count}</span>)}
              </div>
              <ProcessRunMonitorTable detail={processRunDetail} brands={brands} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProcessRunMonitorTable({ detail, brands }) {
  const runBrands = processRunBrands(detail, brands);
  const runSteps = processRunSteps(detail);
  if (runBrands.length === 0 || runSteps.length === 0) {
    return <p className="text-xs" style={{ color: COLORS.muted }}>El backend todavía no devolvió items para este proceso.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${COLORS.line}` }}>
      <table className="w-full min-w-[760px] text-[11px]">
        <thead>
          <tr style={{ background: "#FAFAF8", borderBottom: `1px solid ${COLORS.line}` }}>
            <th className="px-2 py-2 text-left font-medium" style={{ color: COLORS.muted }}>Marca</th>
            {runSteps.map((stepId) => (
              <th key={stepId} className="px-2 py-2 text-left font-medium" style={{ color: COLORS.muted }}>{processStepLabel(stepId)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runBrands.map((brand) => (
            <tr key={brand.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
              <td className="px-2 py-2 align-top">
                <div className="font-medium">{brand.name}</div>
                <div className="mono text-[10px]" style={{ color: COLORS.muted }}>{brand.domain || brand.id}</div>
              </td>
              {runSteps.map((stepId) => {
                const item = findProcessRunItem(detail, brand.id, stepId);
                return (
                  <td key={`${brand.id}-${stepId}`} className="px-2 py-2 align-top">
                    {!item ? (
                      <span style={{ color: COLORS.muted }}>—</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-8"><StatusDot status={item.status} /></div>
                          <span>{StatusLabel({ status: item.status })}</span>
                        </div>
                        <div className="mono text-[10px]" style={{ color: COLORS.muted }}>mode: {item.mode}</div>
                        {item.service_run_id && <div className="mono break-all text-[10px]" style={{ color: COLORS.muted }}>service_run_id: {item.service_run_id}</div>}
                        {item.error && <div className="text-[10px]" style={{ color: COLORS.red }}>error: {item.error}</div>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md p-3" style={{ border: `1px solid ${COLORS.line}` }}>
      <div className="mono text-[10px] uppercase" style={{ color: COLORS.muted }}>{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </div>
  );
}
