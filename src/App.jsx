import { useState, useEffect, useRef } from "react";
import {
  Check, X, Loader2, Clock, AlertTriangle, Minus, Play, Search,
  ChevronUp, ChevronDown, Plus, Trash2, CalendarClock, Pause,
  PlayCircle, Users, ChevronRight, Info, RotateCcw
} from "lucide-react";
import { loadDashboardBrands } from "./supabaseData";
import {
  conductorServiceAvailable,
  runConductorPipeline,
  runConductorService,
} from "./conductorApi";
import BrandDrawer from "./BrandDrawer";
// ---------------------------------------------------------------------------
// Pipeline definition — service_key values match the real `service_runs` table
// in the velz-outreach Supabase project. Services marked deployed:false have
// no orchestrator endpoint yet (per project notes) but are wired into the UI
// so triggering them is a no-op until the real service exists.
// ---------------------------------------------------------------------------
const SERVICES = [
  { key: "meta_ad_library_scraper", label: "Meta Ads", deployed: true },
  { key: "brand_reviews", label: "Reviews", deployed: true },
  { key: "web_stack_wappalyzer", label: "Tech Stack", deployed: true },
  { key: "shopify_signals", label: "Shopify Signals", deployed: true },
  { key: "similarweb", label: "SimilarWeb", deployed: false },
  { key: "brand_context", label: "Contexto (Triage)", deployed: true },
  { key: "drafting", label: "Drafting", deployed: false },
  { key: "export", label: "Export", deployed: false },
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
    const success = Boolean(result?.success);
    updateRun(brandId, serviceKey, {
      status: success ? "success" : "error",
      service_run_id: result?.service_run_id,
      message: result?.message || fallbackMessage,
    });
    setActionMessage({
      tone: success ? "success" : "error",
      text: `${serviceKey}: ${result?.message || fallbackMessage}`,
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
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
        <div className="flex items-center gap-3">
          <svg width="22" height="18" viewBox="0 0 22 18">
            <line x1="0" y1="12" x2="22" y2="12" stroke={COLORS.ink} strokeWidth="1.3" />
            <line x1="11" y1="0" x2="11" y2="18" stroke={COLORS.ink} strokeWidth="1.3" />
            <circle cx="11" cy="12" r="3" fill={COLORS.ink} />
          </svg>
          <span className="display text-2xl tracking-wide lowercase">velz</span>
          <span className="text-xs uppercase tracking-widest mt-1" style={{ color: COLORS.muted }}>outreach ops</span>
        </div>
        <div className="flex gap-1 rounded-full p-1" style={{ background: "#F4F3EF" }}>
          {["runs", "cascades"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{ background: tab === t ? COLORS.ink : "transparent", color: tab === t ? "#fff" : COLORS.ink }}>
              {t === "runs" ? "Ejecuciones" : "Cascadas"}
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
      ) : (
        <CascadesView
          brands={brands} selected={selected} cascades={cascades} setCascades={setCascades}
          triggerService={triggerService}
        />
      )}

      <BrandDrawer brand={drawerBrand} onClose={() => setDrawerBrand(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function RunsView({ brands, search, setSearch, loading, error, actionMessage, clearActionMessage, selected, toggleRow, triggerService, triggerPipeline, triggerBulk, popover, setPopover, popRef, openBrandDrawer }) {
  return (
    <div className="px-6 py-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md" style={{ border: `1px solid ${COLORS.line}` }}>
          <Search size={14} color={COLORS.muted} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar marca o dominio…"
            className="outline-none text-xs w-56 bg-transparent" />
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span style={{ color: COLORS.muted }}>{selected.size} seleccionadas</span>
            <BulkTrigger onTrigger={triggerBulk} />
          </div>
        )}
        <div className="flex items-center gap-3 text-xs ml-auto" style={{ color: COLORS.muted }}>
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
      <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "#FAFAF8", borderBottom: `1px solid ${COLORS.line}` }}>
              <th className="w-8 py-2.5"></th>
              <th className="text-left px-3 py-2.5 font-medium" style={{ color: COLORS.muted }}>Marca</th>
              <th className="text-right px-3 py-2.5 font-medium mono" style={{ color: COLORS.muted }}>Revenue/mes</th>
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
                <td colSpan={SERVICES.length + 4} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}>
                  <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando datos reales desde Supabase…</span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={SERVICES.length + 4} className="px-4 py-8 text-center" style={{ color: COLORS.red }}>
                  No se pudieron leer los datos reales de Supabase: {error.message}
                </td>
              </tr>
            )}
            {!loading && !error && brands.length === 0 && (
              <tr>
                <td colSpan={SERVICES.length + 4} className="px-4 py-8 text-center" style={{ color: COLORS.muted }}>
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

      <div className="mt-3 text-[11px] flex items-start gap-1.5" style={{ color: COLORS.muted }}>
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Marcas y estado leídos en vivo desde Supabase <span className="mono">velz-outreach</span>. “Ejecutar ahora”, Pipeline y cascadas llaman al conductor configurado en <span className="mono">VITE_CONDUCTOR_BASE_URL</span>; al terminar se refrescan las ejecuciones persistidas.</span>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { s: "success", l: "Éxito" }, { s: "error", l: "Error" },
    { s: "partial", l: "Parcial" }, { s: "running", l: "Ejecutando" }, { s: "not_run", l: "Sin ejecutar" },
  ];
  return (
    <div className="flex items-center gap-3">
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
    <div className="absolute z-30 top-8 left-1/2 -translate-x-1/2 w-56 rounded-md p-3 text-left"
      style={{ background: "#fff", border: `1px solid ${COLORS.line}`, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-[11px]">{service.label}</span>
        <StatusDot status={status} />
      </div>
      <div className="text-[11px] mb-2" style={{ color: COLORS.muted }}><StatusLabel status={status} /></div>
      {run?.started_at && (
        <div className="mono text-[10px] mb-1" style={{ color: COLORS.muted }}>
          Inicio: {fmtTime(run.started_at)} · Duración: {fmtDuration(run.duration_ms)}
        </div>
      )}
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
function CascadesView({ brands, selected, cascades, setCascades, triggerService }) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([]); // {key, delay}
  const [addKey, setAddKey] = useState(SERVICES[0].key);
  const [startTime, setStartTime] = useState("09:00");
  const [days, setDays] = useState([0, 1, 2, 3, 4]); // L-V by default
  const [scope, setScope] = useState("all");
  const [fitMin, setFitMin] = useState(80);

  function addStep() {
    if (steps.some(s => s.key === addKey)) return;
    setSteps([...steps, { key: addKey, delay: steps.length === 0 ? 0 : 15 }]);
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
      scope, fitMin, scopeBrandIds, enabled: true,
    }]);
    setName(""); setSteps([]);
  }

  function runNow(cascade) {
    const targets = cascade.scope === "all" ? brands
      : cascade.scope === "fit_score" ? brands.filter(b => b.fit >= cascade.fitMin)
      : brands.filter(b => (cascade.scopeBrandIds || []).includes(b.id));
    let cumMs = 0;
    cascade.steps.forEach(step => {
      cumMs += step.delay * 60 * 1000 * 0.001; // scaled down for demo (min -> ~ms)
      setTimeout(() => targets.forEach(b => triggerService(b.id, step.key)), cumMs);
    });
  }

  const availableToAdd = SERVICES.filter(s => s.deployed && !steps.some(st => st.key === s.key));

  return (
    <div className="px-6 py-5 grid grid-cols-2 gap-6">
      {/* Builder */}
      <div className="rounded-md p-4" style={{ border: `1px solid ${COLORS.line}` }}>
        <h3 className="font-medium mb-3">Nueva cascada</h3>

        <label className="block text-[11px] mb-1" style={{ color: COLORS.muted }}>Nombre</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="p.ej. Ronda diaria fit≥80"
          className="w-full px-2.5 py-1.5 rounded text-xs mb-3" style={{ border: `1px solid ${COLORS.line}` }} />

        <label className="block text-[11px] mb-1" style={{ color: COLORS.muted }}>Pasos (orden + delay)</label>
        <div className="space-y-1.5 mb-2">
          {steps.map((st, i) => {
            const svc = SERVICES.find(s => s.key === st.key);
            return (
              <div key={st.key} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: "#FAFAF8" }}>
                <span className="mono text-[10px] w-4" style={{ color: COLORS.muted }}>{i + 1}</span>
                <span className="text-xs flex-1">{svc.label}</span>
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
                    {SERVICES.find(s => s.key === st.key).label.slice(0, 10)}
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
        <div className="flex items-center gap-3 mb-2">
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="px-2 py-1.5 rounded text-xs mono" style={{ border: `1px solid ${COLORS.line}` }} />
          <div className="flex gap-1">
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
            <span className="mono">{SERVICES.find(x => x.key === s.key)?.label}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] mono" style={{ color: COLORS.muted }}>
        <span className="flex items-center gap-1"><CalendarClock size={11} /> {cascade.startTime} · {cascade.days.map(d => WEEKDAYS[d]).join("")}</span>
        <span className="flex items-center gap-1"><Users size={11} /> {scopeLabel}</span>
      </div>
    </div>
  );
}
