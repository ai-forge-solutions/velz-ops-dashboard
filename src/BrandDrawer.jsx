import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Star,
  X,
} from "lucide-react";
import { loadBrandSource } from "./supabaseData";
import {
  COLORS,
  VERIFICATION_SERVICES,
  fmtDate,
  fmtDuration,
  fmtInt,
  fmtTime,
  statusLabel,
  statusTone,
} from "./theme";

const SOURCE_LABELS = Object.fromEntries(VERIFICATION_SERVICES.map((service) => [service.source, service.label]));

function serviceForSource(source) {
  return VERIFICATION_SERVICES.find((service) => service.source === source);
}

function runForSource(brand, source) {
  const service = serviceForSource(source);
  return service ? brand.runs?.[service.key] : null;
}

function Badge({ status }) {
  const tone = statusTone(status);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${tone}14`, color: tone, border: `1px solid ${tone}33` }}
    >
      {statusLabel(status)}
    </span>
  );
}

function MiniStatusDot({ status }) {
  const tone = statusTone(status);
  const Icon = status === "success" ? Check : status === "error" ? X : status === "partial" ? AlertTriangle : status === "running" ? Loader2 : Minus;
  return (
    <div className="relative flex w-9 items-center justify-center">
      <span className="absolute h-px w-9" style={{ background: COLORS.line }} />
      <span
        className="relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full"
        style={{ background: status === "not_run" ? COLORS.paper : tone, border: `1.5px solid ${status === "not_run" ? COLORS.line : tone}` }}
      >
        {status !== "not_run" && <Icon size={11} color="#fff" className={status === "running" ? "animate-spin" : ""} />}
      </span>
    </div>
  );
}

function LoadingBlock({ label }) {
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: COLORS.muted }}>
      <Loader2 size={14} className="animate-spin" /> Cargando {label} desde Supabase…
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-md p-3 text-xs" style={{ background: COLORS.wash, color: COLORS.muted }}>{children}</div>;
}

function SourceCard({ brand, source, state, onOpen }) {
  const run = runForSource(brand, source);
  const status = run?.status || "not_run";
  const label = SOURCE_LABELS[source];
  const data = state.data;

  return (
    <section className="rounded-lg p-4" style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper }}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{label}</h3>
          <div className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>
            Última ejecución {fmtTime(run?.started_at)} · {fmtDuration(run?.duration_ms)}
          </div>
        </div>
        <Badge status={status} />
      </div>

      {state.loading && <LoadingBlock label={label} />}
      {state.error && (
        <EmptyState>
          Error al cargar los datos del panel: {state.error.message}. Este fallo es de consulta/red y no cambia el estado del scraper.
        </EmptyState>
      )}
      {!state.loading && !state.error && source === "metaAds" && <MetaAdsSummary ads={data || []} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "reviews" && <ReviewsSummary reviews={data || []} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "techStack" && <TechStackSummary stack={data} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "context" && <ContextSummary context={data} run={run} />}
    </section>
  );
}

function MetaAdsSummary({ ads, onOpen }) {
  const active = ads.filter((ad) => String(ad.status || "").toUpperCase() === "ACTIVE").length;
  if (ads.length === 0) {
    return <EmptyState>La fuente se ejecutó, pero no devolvió anuncios para esta marca.</EmptyState>;
  }
  return (
    <div className="space-y-3 text-xs">
      <p><strong>{fmtInt(ads.length)}</strong> anuncios encontrados · <strong>{fmtInt(active)}</strong> activos hoy</p>
      <div className="space-y-2">
        {ads.slice(0, 2).map((ad, index) => (
          <PreviewRow key={`${ad.title}-${index}`} title={ad.title || "Anuncio sin título"} meta={ad.status || "Sin estado"} body={ad.body_text} />
        ))}
      </div>
      <button onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: COLORS.green }}>
        Ver los {fmtInt(ads.length)} anuncios <ExternalLink size={11} />
      </button>
    </div>
  );
}

function ReviewsSummary({ reviews, onOpen }) {
  if (reviews.length === 0) return <EmptyState>La fuente se ejecutó, pero no devolvió reseñas para esta marca.</EmptyState>;
  const avg = reviews.reduce((sum, review) => sum + Number(review.score || 0), 0) / reviews.length;
  const sources = Array.from(new Set(reviews.map((review) => review.source).filter(Boolean))).join(", ") || "fuente no indicada";
  return (
    <div className="space-y-3 text-xs">
      <p><strong>{fmtInt(reviews.length)}</strong> reseñas · media <strong>{avg.toFixed(1)}★</strong> · {sources}</p>
      <div className="space-y-2">
        {reviews.slice(0, 2).map((review, index) => (
          <PreviewRow key={`${review.author}-${index}`} title={`${review.score || "—"}★ · ${review.author || "Autor anónimo"}`} meta={review.country_code || review.source || "—"} body={review.body} />
        ))}
      </div>
      <button onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: COLORS.green }}>
        Ver las {fmtInt(reviews.length)} reseñas <ExternalLink size={11} />
      </button>
    </div>
  );
}

function TechStackSummary({ stack, onOpen }) {
  if (!stack?.analysis) return <EmptyState>La fuente se ejecutó, pero no devolvió análisis técnico para esta marca.</EmptyState>;
  const detections = stack.detections || [];
  return (
    <div className="space-y-3 text-xs">
      <p>{stack.analysis.description || stack.analysis.title || "Sitio sin descripción detectada."}</p>
      <p className="mono text-[11px]" style={{ color: COLORS.muted }}>HTTP {stack.analysis.http_status || "—"}</p>
      {detections.length === 0 ? (
        <EmptyState>No hay tecnologías detectadas para el último análisis.</EmptyState>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {detections.slice(0, 8).map((detection, index) => (
            <span key={`${detection.technology_id}-${index}`} className="rounded-full px-2 py-1 text-[11px]" style={{ background: COLORS.soft }}>
              {detection.technology?.name || "Tecnología"} · {detection.confidence ?? "—"}%
            </span>
          ))}
        </div>
      )}
      <button onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: COLORS.green }}>
        Ver evidencia de detección <ExternalLink size={11} />
      </button>
    </div>
  );
}

function ContextSummary({ context, run }) {
  if (context?.response_markdown) {
    return <p className="whitespace-pre-line text-xs leading-5">{context.response_markdown.slice(0, 520)}{context.response_markdown.length > 520 ? "…" : ""}</p>;
  }
  if (run?.status === "error") {
    return <EmptyState>El análisis de contexto falló tras {fmtDuration(run.duration_ms)}; sin reintento automático.</EmptyState>;
  }
  return <EmptyState>No hay análisis de contexto guardado todavía. No hay más detalle que mostrar para esta fuente.</EmptyState>;
}

function PreviewRow({ title, meta, body }) {
  return (
    <div className="rounded-md p-2" style={{ background: COLORS.wash }}>
      <div className="flex items-center justify-between gap-2">
        <strong className="truncate">{title}</strong>
        <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: COLORS.muted }}>{meta}</span>
      </div>
      <p className="mt-1 line-clamp-2" style={{ color: COLORS.muted }}>{body || "Sin texto disponible."}</p>
    </div>
  );
}

function MetaAdsDetail({ ads, fullscreen }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [expandedBreakdown, setExpandedBreakdown] = useState(null);
  const activeCount = ads.filter((ad) => String(ad.status || "").toUpperCase() === "ACTIVE").length;
  const pausedCount = ads.filter((ad) => String(ad.status || "").toUpperCase() !== "ACTIVE").length;
  const maxReach = Math.max(1, ...ads.map((ad) => Number(ad.reach || 0)));
  const visible = ads
    .filter((ad) => filter === "all" || (filter === "active" ? String(ad.status || "").toUpperCase() === "ACTIVE" : String(ad.status || "").toUpperCase() !== "ACTIVE"))
    .sort((a, b) => {
      const left = new Date(a.start_date || 0).getTime();
      const right = new Date(b.start_date || 0).getTime();
      return sort === "recent" ? right - left : left - right;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Segment active={filter === "all"} onClick={() => setFilter("all")}>Todos ({ads.length})</Segment>
        <Segment active={filter === "active"} onClick={() => setFilter("active")}>Activos ({activeCount})</Segment>
        <Segment active={filter === "paused"} onClick={() => setFilter("paused")}>Pausados ({pausedCount})</Segment>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className="ml-auto rounded px-2 py-1" style={{ border: `1px solid ${COLORS.line}` }}>
          <option value="recent">Más recientes</option>
          <option value="oldest">Más antiguos</option>
        </select>
      </div>
      {visible.length === 0 ? <EmptyState>No hay anuncios para este filtro.</EmptyState> : (
        <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
          {visible.map((ad, index) => (
            <article key={`${ad.title}-${index}`} className="rounded-lg p-3 text-xs" style={{ border: `1px solid ${COLORS.line}` }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{ad.title || "Anuncio sin título"}</h3>
                <Badge status={String(ad.status || "").toUpperCase() === "ACTIVE" ? "success" : "skipped"} />
              </div>
              <p className="mt-1 mono text-[10px]" style={{ color: COLORS.muted }}>{fmtDate(ad.start_date)} — {fmtDate(ad.end_date)}</p>
              <p className="mt-3 whitespace-pre-line leading-5">{ad.body_text || "Sin texto."}</p>
              <div className="mt-3 flex flex-wrap gap-2" style={{ color: COLORS.muted }}>
                <span>CTA: {ad.cta_text || "—"}</span><span>Plataformas: {(ad.platforms || []).join(", ") || "—"}</span><span>Imágenes: {ad.image_count ?? 0}</span><span>Vídeos: {ad.video_count ?? 0}</span>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px]"><span>Alcance</span><span>{ad.reach == null ? "sin dato" : fmtInt(ad.reach)}</span></div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: COLORS.soft }}><div className="h-full" style={{ width: `${ad.reach == null ? 0 : (Number(ad.reach) / maxReach) * 100}%`, background: COLORS.green }} /></div>
              </div>
              {hasBreakdown(ad.reach_by_location_age_gender) && (
                <div className="mt-3">
                  <button onClick={() => setExpandedBreakdown(expandedBreakdown === index ? null : index)} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: COLORS.green }}>
                    <ChevronDown size={12} /> Ver desglose por país (top 5)
                  </button>
                  {expandedBreakdown === index && <CountryBreakdown data={ad.reach_by_location_age_gender} />}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function hasBreakdown(value) {
  return Array.isArray(value) ? value.length > 0 : value && typeof value === "object";
}

function CountryBreakdown({ data }) {
  const rows = aggregateReachByCountry(data);
  const max = Math.max(1, ...rows.map((row) => row.reach));
  return (
    <div className="mt-2 space-y-1.5">
      {rows.slice(0, 5).map((row) => (
        <div key={row.country} className="grid grid-cols-[72px,1fr,54px] items-center gap-2 text-[11px]">
          <span className="mono">{row.country}</span>
          <div className="h-2 rounded-full" style={{ background: COLORS.soft }}><div className="h-full rounded-full" style={{ width: `${(row.reach / max) * 100}%`, background: COLORS.green }} /></div>
          <span className="text-right mono">{row.percent.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function aggregateReachByCountry(data) {
  const entries = Array.isArray(data) ? data : Object.values(data || {}).flat();
  const totals = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const country = entry.country || entry.location || entry.country_code || entry.name;
    const reach = Number(entry.reach || entry.value || entry.count || 0);
    if (!country || !reach) continue;
    totals.set(country, (totals.get(country) || 0) + reach);
  }
  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0) || 1;
  return Array.from(totals, ([country, reach]) => ({ country, reach, percent: (reach / total) * 100 })).sort((a, b) => b.reach - a.reach);
}

function ReviewsDetail({ reviews, fullscreen }) {
  const [mode, setMode] = useState("list");
  const [score, setScore] = useState("all");
  const visible = reviews.filter((review) => score === "all" || (score === "high" ? Number(review.score) >= 4 : Number(review.score) <= 3));
  const groups = groupReviewsByCountry(visible);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Segment active={mode === "list"} onClick={() => setMode("list")}>Lista</Segment>
        <Segment active={mode === "country"} onClick={() => setMode("country")}>Agrupado por país</Segment>
        <Segment active={score === "all"} onClick={() => setScore("all")}>Todas</Segment>
        <Segment active={score === "high"} onClick={() => setScore("high")}>4-5★</Segment>
        <Segment active={score === "low"} onClick={() => setScore("low")}>1-3★</Segment>
      </div>
      {mode === "country" ? (
        <div className="space-y-3">
          {groups.map((group) => <ReviewCountryGroup key={group.country} group={group} />)}
        </div>
      ) : (
        <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
          {visible.map((review, index) => <ReviewCard key={`${review.author}-${index}`} review={review} />)}
        </div>
      )}
    </div>
  );
}

function groupReviewsByCountry(reviews) {
  const map = new Map();
  for (const review of reviews) {
    const country = review.country_code || "—";
    if (!map.has(country)) map.set(country, []);
    map.get(country).push(review);
  }
  return Array.from(map, ([country, items]) => ({
    country,
    items,
    avg: items.reduce((sum, review) => sum + Number(review.score || 0), 0) / Math.max(1, items.length),
  })).sort((a, b) => b.items.length - a.items.length);
}

function ReviewCountryGroup({ group }) {
  return (
    <section className="rounded-lg p-3" style={{ border: `1px solid ${COLORS.line}` }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{countryFlag(group.country)} {group.country}</h3>
        <span className="text-xs" style={{ color: COLORS.muted }}>{group.items.length} reseñas · {group.avg.toFixed(1)}★</span>
      </div>
      <div className="space-y-2">{group.items.slice(0, 5).map((review, index) => <ReviewCard key={`${review.author}-${index}`} review={review} />)}</div>
    </section>
  );
}

function countryFlag(code) {
  if (!code || code.length !== 2) return "🏳️";
  return code.toUpperCase().replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt()));
}

function ReviewCard({ review }) {
  return (
    <article className="rounded-md p-3 text-xs" style={{ background: COLORS.wash }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <strong>{review.author || "Autor anónimo"}</strong>
        <span className="inline-flex items-center gap-0.5">{Array.from({ length: Number(review.score || 0) }).map((_, index) => <Star key={index} size={11} fill={COLORS.amber} color={COLORS.amber} />)}</span>
      </div>
      <p className="leading-5">{review.body || "Sin texto."}</p>
      <p className="mt-2 mono text-[10px]" style={{ color: COLORS.muted }}>{review.country_code || "—"} · {review.source || "—"} · {review.published_at_text || fmtDate(review.published_at)}</p>
    </article>
  );
}

function TechStackDetail({ stack, fullscreen }) {
  const [open, setOpen] = useState(null);
  const analysis = stack?.analysis;
  const detections = stack?.detections || [];
  return (
    <div className="space-y-4 text-xs">
      <section className="rounded-lg p-3" style={{ border: `1px solid ${COLORS.line}` }}>
        <h3 className="mb-2 font-medium">Metadatos del sitio</h3>
        <dl className="grid grid-cols-2 gap-2">
          <Meta label="Canonical URL" value={analysis?.canonical_url || analysis?.final_url} />
          <Meta label="HTTP status" value={analysis?.http_status} />
          <Meta label="Idioma" value={analysis?.language} />
          <Meta label="Fecha de análisis" value={fmtTime(analysis?.analyzed_at || analysis?.created_at)} />
        </dl>
      </section>
      <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
        {detections.map((detection, index) => {
          const evidence = Array.isArray(detection.evidence) ? detection.evidence : [];
          return (
            <article key={`${detection.technology_id}-${index}`} className="rounded-lg p-3" style={{ border: `1px solid ${COLORS.line}` }}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{detection.technology?.name || "Tecnología sin nombre"}</h3>
                <span className="mono text-[11px]" style={{ color: COLORS.green }}>{detection.confidence ?? "—"}%</span>
              </div>
              <button onClick={() => setOpen(open === index ? null : index)} className="mt-2 inline-flex items-center gap-1 text-[11px]" style={{ color: COLORS.green }}>
                <ChevronDown size={12} /> Ver evidencia ({evidence.length})
              </button>
              {open === index && (
                <div className="mt-2 space-y-1.5">
                  {evidence.length === 0 && <EmptyState>No hay evidencia detallada guardada.</EmptyState>}
                  {evidence.map((item, evidenceIndex) => (
                    <div key={evidenceIndex} className="rounded p-2 mono text-[10px]" style={{ background: COLORS.wash }}>
                      <div>{item.source || "señal"} · {item.confidence ?? detection.confidence ?? "—"}%</div>
                      <div style={{ color: COLORS.muted }}>{String(item.match || item.value || "—")}</div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Meta({ label, value }) {
  return <div><dt style={{ color: COLORS.muted }}>{label}</dt><dd className="mono break-all">{value || "—"}</dd></div>;
}

function Segment({ active, onClick, children }) {
  return (
    <button onClick={onClick} className="rounded-full px-3 py-1 text-[11px] font-medium" style={{ background: active ? COLORS.ink : COLORS.soft, color: active ? "#fff" : COLORS.ink }}>
      {children}
    </button>
  );
}

function DetailPane({ brand, source, state, fullscreen, onBack }) {
  const label = SOURCE_LABELS[source];
  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.green }}>
        <ArrowLeft size={14} /> Volver al resumen
      </button>
      <h2 className="mb-4 text-lg font-medium">{label} · {brand.name}</h2>
      {state.loading && <LoadingBlock label={label} />}
      {state.error && <EmptyState>Error al cargar los datos del panel: {state.error.message}</EmptyState>}
      {!state.loading && !state.error && source === "metaAds" && <MetaAdsDetail ads={state.data || []} fullscreen={fullscreen} />}
      {!state.loading && !state.error && source === "reviews" && <ReviewsDetail reviews={state.data || []} fullscreen={fullscreen} />}
      {!state.loading && !state.error && source === "techStack" && <TechStackDetail stack={state.data} fullscreen={fullscreen} />}
    </div>
  );
}

export default function BrandDrawer({ brand, onClose }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [detailSource, setDetailSource] = useState(null);
  const [sources, setSources] = useState({});

  const runnableServices = useMemo(() => VERIFICATION_SERVICES.filter((service) => brand?.runs?.[service.key]), [brand]);

  useEffect(() => {
    if (!brand) return undefined;
    setFullscreen(false);
    setDetailSource(null);
    const services = VERIFICATION_SERVICES.filter((service) => brand.runs?.[service.key]);
    const initial = Object.fromEntries(services.map((service) => [service.source, { loading: true, data: null, error: null }]));
    setSources(initial);
    let cancelled = false;

    services.forEach((service) => {
      loadBrandSource(service.source, brand.id)
        .then((data) => {
          if (!cancelled) setSources((prev) => ({ ...prev, [service.source]: { loading: false, data, error: null } }));
        })
        .catch((error) => {
          if (!cancelled) setSources((prev) => ({ ...prev, [service.source]: { loading: false, data: null, error } }));
        });
    });

    return () => { cancelled = true; };
  }, [brand]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (fullscreen) setFullscreen(false);
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, onClose]);

  if (!brand) return null;

  const hasRuns = runnableServices.length > 0;
  const width = fullscreen ? "100vw" : 640;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" aria-modal="true" role="dialog">
      <aside className="h-full overflow-y-auto shadow-2xl transition-all" style={{ width, maxWidth: "100vw", background: COLORS.paper, color: COLORS.ink }}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-4" style={{ borderBottom: `1px solid ${COLORS.line}`, background: COLORS.paper }}>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.muted }}>Verificación de marca</p>
            <h1 className="mt-1 text-xl font-medium">{brand.name}</h1>
            <p className="mono text-[11px]" style={{ color: COLORS.muted }}>{brand.domain}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFullscreen((value) => !value)} className="rounded-full p-2" style={{ border: `1px solid ${COLORS.line}` }} title={fullscreen ? "Restaurar panel" : "Pantalla completa"}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button onClick={onClose} className="rounded-full p-2" style={{ border: `1px solid ${COLORS.line}` }} title="Cerrar">
              <X size={15} />
            </button>
          </div>
        </header>

        <main className="p-6">
          {!hasRuns ? (
            <div className="rounded-lg p-4" style={{ border: `1px solid ${COLORS.line}`, background: COLORS.wash }}>
              <p className="mb-4 text-sm">Aún no se ha ejecutado ningún servicio para esta marca. Estas fuentes siguen pendientes:</p>
              <div className="space-y-2">
                {VERIFICATION_SERVICES.map((service) => (
                  <div key={service.key} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs">
                    <span>{service.label}</span>
                    <MiniStatusDot status="not_run" />
                  </div>
                ))}
              </div>
            </div>
          ) : detailSource ? (
            <DetailPane brand={brand} source={detailSource} state={sources[detailSource] || { loading: true }} fullscreen={fullscreen} onBack={() => setDetailSource(null)} />
          ) : (
            <div className={fullscreen ? "grid grid-cols-2 gap-4" : "space-y-4"}>
              {runnableServices.map((service) => (
                <SourceCard
                  key={service.source}
                  brand={brand}
                  source={service.source}
                  state={sources[service.source] || { loading: true, data: null, error: null }}
                  onOpen={service.source === "context" ? undefined : () => setDetailSource(service.source)}
                />
              ))}
            </div>
          )}
        </main>
      </aside>
    </div>
  );
}
