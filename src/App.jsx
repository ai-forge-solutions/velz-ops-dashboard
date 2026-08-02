import { useState, useEffect, useRef } from "react";
import {
  Check, X, Loader2, Clock, AlertTriangle, Minus, Play, Search,
  ChevronUp, ChevronDown, Plus, Trash2, CalendarClock, Pause,
  PlayCircle, Users, ChevronRight, Info, RotateCcw
} from "lucide-react";
import { loadDashboardBrands } from "./supabaseData";
import {
  conductorServiceAvailable,
  generateOutreachSequence,
  getMetaAdLibraryRun,
  launchSaleshandyQaBulk,
  runConductorPipeline,
  runConductorService,
} from "./conductorApi";
import BrandDrawer from "./BrandDrawer";
import { CASCADE_ETL_FILTERS, normalizeCascadeStep, resolveCascadeTargets } from "./cascadeLogic";
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

const OUTREACH_CASCADE_ACTIONS = [
  { key: "generate_sequence", type: "outreach", label: "Generar email sequence", deployed: true },
  { key: "send_sequence", type: "outreach", label: "Enviar email sequence", deployed: true },
];

const CASCADE_STEP_OPTIONS = [
  ...SERVICES.filter((service) => service.deployed).map((service) => ({ ...service, type: "etl" })),
  ...OUTREACH_CASCADE_ACTIONS,
];

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

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
    error: { fill: COLORS.red, stroke: COLORS.red, icon: X },
    skipped: { fill: "none", stroke: COLORS.muted, icon: Minus },
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
    success: "Éxito", partial: "Parcial", error: "Error", skipped: "Omitido",
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
  const [cascades, setCascades] = useState([]);
  const [loadedStorage, setLoadedStorage] = useState(false);
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
    try {
      const raw = localStorage.getItem("velz:cascades");
      if (raw) setCascades(JSON.parse(raw));
    } catch (e) { /* no saved cascades yet */ }
    setLoadedStorage(true);
  }, []);

  useEffect(() => {
    if (!loadedStorage) return;
    try { localStorage.setItem("velz:cascades", JSON.stringify(cascades)); }
    catch (e) { console.error("No se pudo guardar la cascada", e); }
  }, [cascades, loadedStorage]);

  useEffect(() => {
    function onClick(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setPopover(null);
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

  async function triggerOutreachGenerate(brand) {
    const leadId = brand?.outreach?.leadId;
    if (!leadId || !brand?.outreach?.readyToGenerate) {
      setActionMessage({ tone: "warning", text: `${brand?.name || "Lead"}: no está listo para generar sequence o falta lead_id.` });
      return;
    }
    try {
      const result = await generateOutreachSequence(leadId);
      setActionMessage({ tone: "success", text: `${brand.name}: generación de email sequence solicitada${result?.id ? ` · ${result.id}` : ""}.` });
      await refreshDashboardBrands();
    } catch (error) {
      setActionMessage({ tone: "error", text: `${brand?.name || "Lead"}: no se pudo generar la sequence — ${error.message}` });
    }
  }

  async function triggerOutreachSend(brand) {
    const leadId = brand?.outreach?.leadId;
    const sequenceId = brand?.outreach?.sequence?.id;
    if (!leadId || !sequenceId || !brand?.outreach?.launchEligible) {
      setActionMessage({ tone: "warning", text: `${brand?.name || "Lead"}: no está listo para enviar o falta sequence_id/lead_id.` });
      return;
    }
    try {
      const result = await launchSaleshandyQaBulk(sequenceId, leadId);
      setActionMessage({ tone: "success", text: `${brand.name}: envío/import Saleshandy solicitado${result?.id ? ` · ${result.id}` : ""}.` });
      await refreshDashboardBrands();
    } catch (error) {
      setActionMessage({ tone: "error", text: `${brand?.name || "Lead"}: no se pudo enviar la sequence — ${error.message}` });
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
          {["runs", "outreach", "cascades"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{ background: tab === t ? COLORS.ink : "transparent", color: tab === t ? "#fff" : COLORS.ink }}>
              {t === "runs" ? "Ejecuciones" : t === "outreach" ? "Outreach" : "Cascadas"}
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
        <CascadesView
          brands={brands} selected={selected} cascades={cascades} setCascades={setCascades}
          triggerService={triggerService}
          triggerOutreachGenerate={triggerOutreachGenerate}
          triggerOutreachSend={triggerOutreachSend}
          actionMessage={actionMessage}
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
        <span>Marcas y estado leídos en vivo desde Supabase <span className="mono">velz-outreach</span>. “Ejecutar ahora”, Pipeline y cascadas llaman al conductor configurado en <span className="mono">VITE_CONDUCTOR_BASE_URL</span>; Meta Ads arranca como job async, guarda <span className="mono">service_run_id</span> y se refresca con polling corto sin mantener una request larga abierta.</span>
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
    <div className="z-30 w-full min-w-56 rounded-md p-3 text-left sm:absolute sm:left-1/2 sm:top-8 sm:w-56 sm:-translate-x-1/2"
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
function CascadesView({ brands, selected, cascades, setCascades, triggerService, triggerOutreachGenerate, triggerOutreachSend, actionMessage, clearActionMessage }) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([]); // {type, key, delay}
  const [addKey, setAddKey] = useState(CASCADE_STEP_OPTIONS[0].key);
  const [startTime, setStartTime] = useState("09:00");
  const [days, setDays] = useState([0, 1, 2, 3, 4]); // L-V by default
  const [scope, setScope] = useState("all");
  const [fitMin, setFitMin] = useState(80);
  const [etlStateFilter, setEtlStateFilter] = useState("all");

  function addStep() {
    if (steps.some(s => s.key === addKey)) return;
    const option = CASCADE_STEP_OPTIONS.find((item) => item.key === addKey);
    if (!option) return;
    setSteps([...steps, { type: option.type, key: option.key, delay: steps.length === 0 ? 0 : 15 }]);
  }
  function removeStep(i) { setSteps(steps.filter((_, idx) => idx !== i)); }
  function move(i, dir) {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  }
  function toggleDay(d) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  function save() {
    if (!name.trim() || steps.length === 0) return;
    const scopeBrandIds = scope === "selected" ? Array.from(selected) : null;
    setCascades([...cascades, {
      id: Date.now().toString(), name, steps, startTime, days: [...days],
      scope, fitMin, etlStateFilter, scopeBrandIds, enabled: true,
    }]);
    setName(""); setSteps([]);
  }

  function runCascadeStep(brand, step) {
    const normalized = normalizeCascadeStep(step);
    if (normalized.type === "outreach" && normalized.key === "generate_sequence") return triggerOutreachGenerate(brand);
    if (normalized.type === "outreach" && normalized.key === "send_sequence") return triggerOutreachSend(brand);
    return triggerService(brand.id, normalized.key);
  }

  function runNow(cascade) {
    const targets = resolveCascadeTargets({ brands, selectedIds: selected, cascade, services: SERVICES });
    let cumMs = 0;
    cascade.steps.forEach(step => {
      cumMs += (step.delay || 0) * 60 * 1000 * 0.001; // scaled down for demo (min -> ~ms)
      setTimeout(() => targets.forEach(b => runCascadeStep(b, step)), cumMs);
    });
  }

  const availableToAdd = CASCADE_STEP_OPTIONS.filter(s => !steps.some(st => st.key === s.key));

  return (
    <div className="grid grid-cols-1 gap-5 px-4 py-4 sm:grid-cols-2 sm:gap-6 sm:px-6 sm:py-5">
      {/* Builder */}
      <div className="rounded-md p-4" style={{ border: `1px solid ${COLORS.line}` }}>
        <h3 className="font-medium mb-3">Nueva cascada</h3>

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

        <label className="block text-[11px] mb-1" style={{ color: COLORS.muted }}>Nombre</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="p.ej. Ronda diaria fit≥80"
          className="w-full px-2.5 py-1.5 rounded text-xs mb-3" style={{ border: `1px solid ${COLORS.line}` }} />

        <label className="block text-[11px] mb-1" style={{ color: COLORS.muted }}>Pasos (orden + delay)</label>
        <div className="space-y-1.5 mb-2">
          {steps.map((st, i) => {
            const svc = CASCADE_STEP_OPTIONS.find(s => s.key === st.key) || normalizeCascadeStep(st);
            return (
              <div key={st.key} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: "#FAFAF8" }}>
                <span className="mono text-[10px] w-4" style={{ color: COLORS.muted }}>{i + 1}</span>
                <span className="text-xs flex-1">{svc.label || st.key}</span>
                {i > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px]" style={{ color: COLORS.muted }}>+</span>
                    <input type="number" min="0" value={st.delay}
                      onChange={e => setSteps(steps.map((s2, idx) => idx === i ? { ...s2, delay: Number(e.target.value) } : s2))}
                      className="w-12 mono text-[11px] px-1 py-0.5 rounded text-right" style={{ border: `1px solid ${COLORS.line}` }} />
                    <span className="text-[10px]" style={{ color: COLORS.muted }}>min</span>
                  </div>
                )}
                <button onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={12} color={i === 0 ? COLORS.line : COLORS.ink} /></button>
                <button onClick={() => move(i, 1)} disabled={i === steps.length - 1}><ChevronDown size={12} color={i === steps.length - 1 ? COLORS.line : COLORS.ink} /></button>
                <button onClick={() => removeStep(i)}><Trash2 size={12} color={COLORS.red} /></button>
              </div>
            );
          })}
          {steps.length === 0 && <div className="text-[11px] py-2" style={{ color: COLORS.muted }}>Añade el primer paso abajo.</div>}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <select value={addKey} onChange={e => setAddKey(e.target.value)} className="flex-1 px-2 py-1.5 rounded text-xs" style={{ border: `1px solid ${COLORS.line}` }}>
            {availableToAdd.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={addStep} disabled={availableToAdd.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-medium" style={{ border: `1px solid ${COLORS.ink}` }}>
            <Plus size={11} /> Añadir paso
          </button>
        </div>

        {/* horizon preview */}
        {steps.length > 0 && (
          <div className="mb-4 py-3">
            <svg width="100%" height="40" viewBox={`0 0 ${Math.max(steps.length * 90, 90)} 40`}>
              <line x1="10" y1="20" x2={Math.max(steps.length * 90, 90) - 10} y2="20" stroke={COLORS.line} strokeWidth="1" />
              {steps.map((st, i) => (
                <g key={st.key}>
                  <circle cx={10 + i * 90} cy="20" r="5" fill={COLORS.ink} />
                  <text x={10 + i * 90} y="34" fontSize="9" textAnchor="middle" fill={COLORS.muted} fontFamily="IBM Plex Mono">
                    {CASCADE_STEP_OPTIONS.find(s => s.key === st.key)?.label?.slice(0, 10) || st.key.slice(0, 10)}
                  </text>
                  {i > 0 && (
                    <text x={10 + (i - 0.5) * 90} y="12" fontSize="9" textAnchor="middle" fill={COLORS.muted} fontFamily="IBM Plex Mono">
                      +{st.delay}m
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}

        <label className="block text-[11px] mb-1" style={{ color: COLORS.muted }}>Programación</label>
        <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="px-2 py-1.5 rounded text-xs mono" style={{ border: `1px solid ${COLORS.line}` }} />
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d, i) => (
              <button key={i} onClick={() => toggleDay(i)}
                className="w-6 h-6 rounded-full text-[10px] font-medium"
                style={{ background: days.includes(i) ? COLORS.ink : "#fff", color: days.includes(i) ? "#fff" : COLORS.muted, border: `1px solid ${COLORS.line}` }}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <label className="block text-[11px] mb-1 mt-3" style={{ color: COLORS.muted }}>Alcance</label>
        <div className="flex flex-col gap-1.5 mb-4 text-xs">
          <label className="flex items-center gap-2"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> Todas las marcas ({brands.length})</label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === "fit_score"} onChange={() => setScope("fit_score")} />
            Fit score ≥ <input type="number" value={fitMin} onChange={e => setFitMin(Number(e.target.value))} className="w-12 mono px-1 py-0.5 rounded" style={{ border: `1px solid ${COLORS.line}` }} />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === "selected"} disabled={selected.size === 0} onChange={() => setScope("selected")} />
            Seleccionadas en la tabla ({selected.size})
          </label>
        </div>

        <label className="block text-[11px] mb-1 mt-3" style={{ color: COLORS.muted }}>Estado ETL</label>
        <select value={etlStateFilter} onChange={e => setEtlStateFilter(e.target.value)} className="mb-4 w-full px-2 py-1.5 rounded text-xs" style={{ border: `1px solid ${COLORS.line}` }}>
          {CASCADE_ETL_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>

        <div className="mb-4 flex items-start gap-1.5 text-[11px]" style={{ color: COLORS.muted }}>
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>Las cascadas pueden mezclar pasos ETL con generación y envío de email sequences. Requiere <span className="mono">VITE_OUTREACH_API_BASE_URL</span>; las rutas por defecto cubren generate y launch Saleshandy.</span>
        </div>

        <button onClick={save} disabled={!name.trim() || steps.length === 0}
          className="w-full py-2 rounded text-xs font-medium" style={{ background: (!name.trim() || steps.length === 0) ? COLORS.line : COLORS.green, color: "#fff" }}>
          Guardar cascada
        </button>
      </div>

      {/* Saved list */}
      <div>
        <h3 className="font-medium mb-3">Cascadas guardadas</h3>
        {cascades.length === 0 && (
          <div className="text-[11px] p-4 rounded-md" style={{ border: `1px dashed ${COLORS.line}`, color: COLORS.muted }}>
            Aún no has creado ninguna cascada. Móntala en el panel de la izquierda.
          </div>
        )}
        <div className="space-y-2">
          {cascades.map(c => (
            <CascadeCard key={c.id} cascade={c} onRun={() => runNow(c)}
              onToggle={() => setCascades(cascades.map(x => x.id === c.id ? { ...x, enabled: !x.enabled } : x))}
              onDelete={() => setCascades(cascades.filter(x => x.id !== c.id))} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CascadeCard({ cascade, onRun, onToggle, onDelete }) {
  const scopeLabel = cascade.scope === "all" ? "todas las marcas"
    : cascade.scope === "fit_score" ? `fit ≥ ${cascade.fitMin}`
    : `${(cascade.scopeBrandIds || []).length} seleccionadas`;
  const etlFilterLabel = CASCADE_ETL_FILTERS.find((item) => item.key === (cascade.etlStateFilter || "all"))?.label;
  return (
    <div className="rounded-md p-3" style={{ border: `1px solid ${COLORS.line}`, opacity: cascade.enabled ? 1 : 0.5 }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium text-xs">{cascade.name}</span>
        <div className="flex items-center gap-2">
          <button onClick={onRun} title="Ejecutar ahora"><PlayCircle size={14} color={COLORS.green} /></button>
          <button onClick={onToggle} title="Pausar/activar">{cascade.enabled ? <Pause size={13} /> : <PlayCircle size={13} />}</button>
          <button onClick={onDelete} title="Eliminar"><Trash2 size={13} color={COLORS.red} /></button>
        </div>
      </div>
      <div className="flex items-center gap-1 text-[11px] flex-wrap" style={{ color: COLORS.muted }}>
        {cascade.steps.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} />}
            <span className="mono">{CASCADE_STEP_OPTIONS.find(x => x.key === s.key)?.label || s.key}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] mono" style={{ color: COLORS.muted }}>
        <span className="flex items-center gap-1"><CalendarClock size={11} /> {cascade.startTime} · {cascade.days.map(d => WEEKDAYS[d]).join("")}</span>
        <span className="flex items-center gap-1"><Users size={11} /> {scopeLabel}</span>
        <span>{etlFilterLabel}</span>
      </div>
    </div>
  );
}
