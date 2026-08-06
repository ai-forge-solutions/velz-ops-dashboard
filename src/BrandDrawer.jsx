import { useEffect, useMemo, useReducer, useState } from "react";
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
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { loadBrandSource } from "./supabaseData";
import {
  approveOutreachSequence,
  editOutreachSequenceDraft,
  generateOutreachSequence,
  launchSaleshandyQaBulk,
  outreachRuntimeDiagnostics,
  probeOutreachRuntime,
  rejectOutreachSequence,
  saleshandyQaLaunchConfigured,
} from "./conductorApi";
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
import {
  createSequenceDraftForm,
  isSequenceDraftEditable,
  runSequenceDraftSave,
  sequenceDraftReducer,
  sequenceIdFor,
} from "./sequenceDraftEditor";

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

function EmptyState({ children, tone = COLORS.muted }) {
  return <div className="rounded-md p-3 text-xs" style={{ background: COLORS.wash, color: tone }}>{children}</div>;
}

function outreachTone(outreach) {
  if (!outreach) return COLORS.muted;
  if (outreach.lifecycle?.key === "suppressed" || outreach.lifecycle?.key === "failed" || outreach.readiness?.key === "blocked") return COLORS.red;
  if (outreach.readiness?.key === "pending_review" || outreach.lifecycle?.key === "import_pending") return COLORS.amber;
  if (["approved", "sent", "opened", "clicked"].includes(outreach.readiness?.key) || ["sent", "opened", "clicked"].includes(outreach.lifecycle?.key)) return COLORS.green;
  return COLORS.muted;
}

function OutreachPill({ children, tone = COLORS.muted }) {
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: tone, background: `${tone}14`, border: `1px solid ${tone}33` }}>{children || "—"}</span>;
}

function KeyValue({ label, value, href }) {
  return (
    <div>
      <dt style={{ color: COLORS.muted }}>{label}</dt>
      <dd className="mono break-all">
        {href && value ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">{value}<ExternalLink size={10} /></a> : value || "—"}
      </dd>
    </div>
  );
}

function ActionResult({ result }) {
  if (!result) return null;
  return (
    <div className="mt-3 rounded-md p-3 text-xs" style={{ background: COLORS.wash, border: `1px solid ${COLORS.line}` }}>
      <h4 className="mb-2 font-medium">Respuesta backend</h4>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words mono text-[10px]" style={{ color: COLORS.muted }}>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}

function JourneyIndicator({ steps = [] }) {
  if (!steps.length) return null;
  const toneFor = (status) => status === "done" ? COLORS.green : status === "current" ? COLORS.amber : status === "blocked" ? COLORS.red : COLORS.line;
  return (
    <div className="grid grid-cols-5 gap-1 text-[10px]">
      {steps.map((step) => (
        <div key={step.key} className="rounded-md px-2 py-2 text-center" style={{ border: `1px solid ${toneFor(step.status)}55`, background: `${toneFor(step.status)}12`, color: step.status === "pending" ? COLORS.muted : toneFor(step.status) }}>
          <div className="mono uppercase tracking-wide">{step.label}</div>
          <div className="mt-1">{step.status}</div>
        </div>
      ))}
    </div>
  );
}

function SequencePreview({ sequence, editor, dispatchEditor, editableState, onSave }) {
  if (!sequence) return <EmptyState>No hay draft de secuencia source-backed para este lead todavía.</EmptyState>;
  const followups = Array.isArray(sequence.followups) ? sequence.followups : [];
  const metadata = sequence.source_metadata || sequence.metadata || {};
  const evidence = metadata.evidence_summary || metadata.evidence_sources || sequence.source_refs || sequence.evidence_refs;
  const isEditing = editor.mode === "edit" || editor.mode === "saving";
  const isSaving = editor.mode === "saving";

  if (isEditing) {
    return (
      <div className="space-y-3">
        <div className="rounded-md p-3" style={{ background: COLORS.wash }}>
          <label className="mb-1 block text-[11px] font-medium" htmlFor="sequence-subject">Subject</label>
          <input id="sequence-subject" value={editor.form.subject} onChange={(event) => dispatchEditor({ type: "field", field: "subject", value: event.target.value })} disabled={isSaving} className="w-full rounded px-3 py-2 text-xs" style={{ border: `1px solid ${COLORS.line}` }} />
        </div>
        <div className="rounded-md p-3" style={{ background: COLORS.wash }}>
          <label className="mb-1 block text-[11px] font-medium" htmlFor="sequence-initial-email">Initial email body</label>
          <textarea id="sequence-initial-email" value={editor.form.initial_email} onChange={(event) => dispatchEditor({ type: "field", field: "initial_email", value: event.target.value })} disabled={isSaving} rows={8} className="w-full rounded px-3 py-2 text-xs leading-5" style={{ border: `1px solid ${COLORS.line}` }} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium">Followups</div>
            <button type="button" onClick={() => dispatchEditor({ type: "addFollowup" })} disabled={isSaving} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.line}` }}><Plus size={12} /> Add followup</button>
          </div>
          {editor.form.followups.length === 0 ? <EmptyState>No followups in draft. Add one if needed for this MVP edit.</EmptyState> : editor.form.followups.map((followup, index) => (
            <div key={index} className="space-y-2 rounded-md p-3" style={{ background: COLORS.wash }}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Followup {index + 1}</div>
                <button type="button" onClick={() => dispatchEditor({ type: "removeFollowup", index })} disabled={isSaving} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.red}`, color: COLORS.red }}><Trash2 size={12} /> Remove</button>
              </div>
              <input aria-label={`Followup ${index + 1} subject`} value={followup.subject || ""} onChange={(event) => dispatchEditor({ type: "followup", index, field: "subject", value: event.target.value })} disabled={isSaving} placeholder="Followup subject" className="w-full rounded px-3 py-2 text-xs" style={{ border: `1px solid ${COLORS.line}` }} />
              <textarea aria-label={`Followup ${index + 1} body`} value={followup.body || ""} onChange={(event) => dispatchEditor({ type: "followup", index, field: "body", value: event.target.value })} disabled={isSaving} rows={5} placeholder="Followup body" className="w-full rounded px-3 py-2 text-xs leading-5" style={{ border: `1px solid ${COLORS.line}` }} />
            </div>
          ))}
        </div>
        {editor.error && <EmptyState tone={COLORS.red}>Save failed: {editor.error.message}</EmptyState>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => dispatchEditor({ type: "cancel", sequence })} disabled={isSaving} className="rounded px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.line}` }}>Cancel</button>
          <button type="button" onClick={onSave} disabled={isSaving} className="inline-flex items-center gap-1 rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ background: COLORS.ink, color: "#fff" }}>{isSaving && <Loader2 size={13} className="animate-spin" />}{isSaving ? "Saving…" : "Save draft"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => dispatchEditor({ type: "edit", sequence })} disabled={!editableState.editable} title={editableState.reason || "Edit sequence draft"} className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.line}`, color: editableState.editable ? COLORS.ink : COLORS.muted }}><Pencil size={12} /> Edit draft</button>
      </div>
      {!editableState.editable && <EmptyState>{editableState.reason}</EmptyState>}
      {editor.result?.sequence?.review_status === "pending_review" && <EmptyState tone={COLORS.amber}>Saved. Review is pending again before approval/launch.</EmptyState>}
      <div className="rounded-md p-3" style={{ background: COLORS.wash }}>
        <div className="mb-1 text-[11px] font-medium">Subject</div>
        <div>{sequence.subject || "—"}</div>
      </div>
      <div className="rounded-md p-3" style={{ background: COLORS.wash }}>
        <div className="mb-1 text-[11px] font-medium">Initial email body</div>
        <p className="whitespace-pre-line leading-5">{sequence.initial_email || sequence.body || "—"}</p>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-medium">Followups</div>
        {followups.length === 0 ? <EmptyState>No hay followups en el read model.</EmptyState> : followups.map((followup, index) => (
          <div key={index} className="rounded-md p-3" style={{ background: COLORS.wash }}>
            <div className="font-medium">{followup.subject || `Followup ${followup.step || index + 1}`}</div>
            <p className="mt-1 whitespace-pre-line leading-5" style={{ color: COLORS.muted }}>{followup.body || followup.email || "—"}</p>
          </div>
        ))}
      </div>
      <div className="rounded-md p-3" style={{ background: COLORS.wash }}>
        <div className="mb-1 text-[11px] font-medium">Source-backed evidence</div>
        <p className="whitespace-pre-line mono text-[10px]" style={{ color: COLORS.muted }}>{typeof evidence === "string" ? evidence : evidence ? JSON.stringify(evidence, null, 2) : "No evidence summary exposed in current read model."}</p>
      </div>
    </div>
  );
}

function KeyValueList({ title, values }) {
  return (
    <section className="rounded-md p-3" style={{ background: COLORS.wash }}>
      <h4 className="mb-2 font-medium">{title}</h4>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{values.map(([label, value, href]) => <KeyValue key={label} label={label} value={value} href={href} />)}</dl>
    </section>
  );
}

function LaunchResult({ result }) {
  if (!result) return null;
  const sendIds = Array.isArray(result.email_send_ids) ? result.email_send_ids.join(", ") : result.email_send_ids;
  return (
    <div className="mt-3 rounded-md p-3 text-xs" style={{ background: COLORS.wash, border: `1px solid ${COLORS.line}` }}>
      <h4 className="mb-2 font-medium">Resultado launch QA</h4>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <KeyValue label="bulk_run_id" value={result.bulk_run_id} />
        <KeyValue label="email_send_ids" value={sendIds} />
        <KeyValue label="provider_sequence_id" value={result.provider_sequence_id} />
        <KeyValue label="provider_import_request_id" value={result.provider_import_request_id} />
        <KeyValue label="provider_import_status" value={result.provider_import_status} />
        <KeyValue label="tool_url" value={result.tool_url || result.public_tool_url} href={result.tool_url || result.public_tool_url} />
      </dl>
    </div>
  );
}

function OutreachDiagnostics({ diagnostics, probe, busy, onProbe }) {
  if (!diagnostics) return null;
  const keys = diagnostics.runtimeConfigKeys?.join(", ") || "—";
  return (
    <section className="rounded-md p-3" style={{ border: `1px dashed ${COLORS.amber}`, background: `${COLORS.amber}0D` }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">Outreach config diagnostics</h4>
        <button type="button" onClick={onProbe} disabled={busy} className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.line}` }}>
          {busy && <Loader2 size={12} className="animate-spin" />} Test Outreach API
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <KeyValue label="configured" value={diagnostics.configured ? "true" : "false"} />
        <KeyValue label="base URL source" value={diagnostics.baseUrlSource} />
        <KeyValue label="base URL" value={diagnostics.baseUrl || "—"} />
        <KeyValue label="editDraft path" value={diagnostics.editDraftPath || "—"} />
        <KeyValue label="editDraft configured" value={diagnostics.editDraftConfigured ? "true" : "false"} />
        <KeyValue label="runtime config present" value={diagnostics.runtimeConfigPresent ? "true" : "false"} />
        <KeyValue label="Vite has Outreach base" value={diagnostics.viteHasOutreachBase ? "true" : "false"} />
        <KeyValue label="runtime VITE keys" value={keys} />
      </dl>
      {probe && (
        <div className="mt-3 rounded p-2 mono text-[10px]" style={{ background: COLORS.paper, border: `1px solid ${probe.ok ? COLORS.green : COLORS.red}33`, color: probe.ok ? COLORS.green : COLORS.red }}>
          {JSON.stringify(probe, null, 2)}
        </div>
      )}
    </section>
  );
}

function OutreachSection({ brand, onRefresh }) {
  const outreach = brand.outreach;
  const [confirming, setConfirming] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [diagnostics, setDiagnostics] = useState(() => outreachRuntimeDiagnostics());
  const [probeResult, setProbeResult] = useState(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const configured = saleshandyQaLaunchConfigured();
  const tone = outreachTone(outreach);
  const sequence = outreach?.sequence;
  const send = outreach?.send;
  const provider = outreach?.provider || {};
  const actionConfigured = outreach?.actionConfigured || {};
  const sequenceId = sequenceIdFor(sequence);
  const [sequenceEditor, dispatchSequenceEditor] = useReducer(sequenceDraftReducer, {
    mode: "view",
    form: createSequenceDraftForm(sequence),
    error: null,
    result: null,
  });
  const events = Object.entries(outreach?.events?.counts || {}).map(([key, count]) => `${key}: ${count}`).join(" · ");
  const magnetEvents = Object.entries(outreach?.magnetEvents?.counts || {}).map(([key, count]) => `${key}: ${count}`).join(" · ");
  const canGenerate = Boolean(outreach?.readyToGenerate && actionConfigured.generate && !outreach?.blockers?.length);
  const canApprove = Boolean(outreach?.canApprove && actionConfigured.approve && sequenceId && !outreach?.blockers?.length);
  const canReject = Boolean(outreach?.canReject && actionConfigured.reject && sequenceId);
  const canLaunch = Boolean(outreach?.launchEligible && configured && sequenceId && !outreach?.blockers?.length);
  const displayedSequence = sequenceEditor.result?.sequence || sequence;
  const displayedReviewStatus = displayedSequence?.review_status || outreach?.readiness?.label;
  const editConfigured = Boolean(actionConfigured.editDraft);
  const sequenceEditable = isSequenceDraftEditable({ sequence, configured: editConfigured, lifecycleKey: outreach?.lifecycle?.key, provider });

  useEffect(() => {
    dispatchSequenceEditor({ type: "cancel", sequence });
  }, [sequenceId]);

  useEffect(() => {
    setDiagnostics(outreachRuntimeDiagnostics());
  }, [actionConfigured.editDraft, sequenceEditable.reason]);

  async function runOutreachProbe() {
    setProbeBusy(true);
    try {
      const result = await probeOutreachRuntime();
      setDiagnostics(result.diagnostics || outreachRuntimeDiagnostics());
      setProbeResult(result);
    } finally {
      setProbeBusy(false);
    }
  }

  async function saveSequenceDraft() {
    dispatchSequenceEditor({ type: "saving" });
    try {
      const result = await runSequenceDraftSave({
        sequenceId,
        form: sequenceEditor.form,
        save: editOutreachSequenceDraft,
        refresh: onRefresh,
      });
      dispatchSequenceEditor({ type: "saved", result, sequence });
      setActionResult(result || { ok: true });
      setActionError(null);
    } catch (error) {
      dispatchSequenceEditor({ type: "failed", error });
      setActionError(error);
    }
  }

  async function runAction(action, handler) {
    setBusyAction(action);
    setActionError(null);
    setActionResult(null);
    try {
      const result = await handler();
      setActionResult(result || { ok: true });
      if (action === "launch") setConfirming(false);
      await onRefresh?.();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="rounded-lg p-4" style={{ border: `1px solid ${COLORS.line}`, background: COLORS.paper }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Outreach</h3>
          <p className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>Readiness → Generate sequence → Review/Approve → Launch Saleshandy → Engagement. Generate calls backend by lead_id; approve/reject/launch call backend by sequence_id.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OutreachPill tone={tone}>{outreach?.readiness?.label || (brand.outreachLoadError ? "Read blocked" : "Not ready")}</OutreachPill>
          <OutreachPill tone={tone}>{outreach?.lifecycle?.label || "Not launched"}</OutreachPill>
        </div>
      </div>

      {brand.outreachLoadError && <EmptyState tone={COLORS.amber}>No se pudieron leer las tablas Outreach con la anon key actual: {brand.outreachLoadError.message}</EmptyState>}
      {!brand.outreachLoadError && !outreach && <EmptyState>No hay lead/outreach asociado a esta marca.</EmptyState>}

      {outreach && (
        <div className="space-y-4 text-xs">
          <JourneyIndicator steps={outreach.journey} />
          {outreach.suppression && <EmptyState tone={COLORS.red}>Suppression activa: {outreach.suppression.reason || outreach.suppression.type || "sin motivo"}. No enviar.</EmptyState>}
          {outreach.blockers?.length > 0 && <EmptyState tone={COLORS.amber}>Bloqueos/backend warnings: {outreach.blockers.join(" · ")}</EmptyState>}
          <EmptyState tone={outreach.blockers?.length ? COLORS.amber : COLORS.green}>Siguiente acción: {outreach.nextAction?.label}</EmptyState>

          <KeyValueList title="Readiness checks" values={[
            ["recipient", outreach.email],
            ["lead_id", outreach.leadId],
            ["sequence_id", sequenceId],
            ["tool_key", sequence?.tool_key || outreach.lead?.tool_key],
            ["public tool URL", outreach.toolUrl, outreach.toolUrl],
            ["ready_to_generate", outreach.readyToGenerate ? "true" : "false"],
            ["blockers", outreach.blockers?.join(" · ") || "—"],
          ]} />

          <section className="rounded-md p-3" style={{ border: `1px solid ${COLORS.line}` }}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">Generate sequence</h4>
              <button onClick={() => runAction("generate", () => generateOutreachSequence(outreach.leadId))} disabled={!canGenerate || busyAction} className="rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ background: canGenerate ? COLORS.ink : COLORS.line, color: canGenerate ? "#fff" : COLORS.muted }}>
                {busyAction === "generate" ? "Generating…" : "Generate sequence"}
              </button>
            </div>
            {!actionConfigured.generate && <EmptyState>Generate disabled: falta VITE_OUTREACH_API_BASE_URL. La ruta default real es /outreach/leads/{'{lead_id}'}/sequences/generate.</EmptyState>}
            {actionConfigured.generate && !outreach.readyToGenerate && <EmptyState>Generate hidden by backend state: lead is not ready_to_generate.</EmptyState>}
            {outreach.blockers?.length > 0 && <EmptyState tone={COLORS.amber}>Generate blocked by readiness/backend warnings: {outreach.blockers.join(" · ")}</EmptyState>}
          </section>

          <section className="rounded-md p-3" style={{ border: `1px solid ${COLORS.line}` }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="font-medium">Sequence draft / review</h4>
              <OutreachPill tone={tone}>{displayedReviewStatus}</OutreachPill>
            </div>
            <SequencePreview sequence={displayedSequence} editor={sequenceEditor} dispatchEditor={dispatchSequenceEditor} editableState={sequenceEditable} onSave={saveSequenceDraft} />
            {!sequenceEditable.editable && <div className="mt-3"><OutreachDiagnostics diagnostics={diagnostics} probe={probeResult} busy={probeBusy} onProbe={runOutreachProbe} /></div>}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="Optional reject note / requested changes" className="rounded px-3 py-2 text-xs" style={{ border: `1px solid ${COLORS.line}` }} />
              <button onClick={() => runAction("reject", () => rejectOutreachSequence(sequenceId, rejectNote))} disabled={!canReject || busyAction} className="rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ border: `1px solid ${COLORS.red}`, color: COLORS.red }}>
                {busyAction === "reject" ? "Rejecting…" : "Reject / needs changes"}
              </button>
              <button onClick={() => runAction("approve", () => approveOutreachSequence(sequenceId))} disabled={!canApprove || busyAction} className="rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ background: canApprove ? COLORS.green : COLORS.line, color: canApprove ? "#fff" : COLORS.muted }}>
                {busyAction === "approve" ? "Approving…" : "Approve sequence"}
              </button>
            </div>
            <p className="mt-2 text-[11px]" style={{ color: COLORS.muted }}>Approval only changes backend review state for sequence_id; it does not send email. Approve/reject controls stay disabled when VITE_OUTREACH_API_BASE_URL is missing, no sequence_id exists, or backend readiness blocks review.</p>
          </section>

          <KeyValueList title="Saleshandy / provider lifecycle" values={[
            ["sequence status", sequence?.status || sequence?.readiness_status],
            ["review_status", sequence?.review_status],
            ["send_status", sequence?.send_status],
            ["latest email_sends.status", send?.status || send?.send_status],
            ["send_mode", send?.send_mode],
            ["provider_sequence_id", provider.provider_sequence_id],
            ["provider_prospect_id", provider.provider_prospect_id],
            ["provider_import_request_id", provider.provider_import_request_id],
            ["provider_import_status", provider.provider_import_status],
            ["last provider sync", fmtTime(provider.last_provider_sync_at)],
            ["sent_at", fmtTime(send?.sent_at)],
          ]} />

          <div>
            <button onClick={() => setConfirming(true)} disabled={!canLaunch || busyAction} className="inline-flex items-center gap-1 rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45" style={{ background: canLaunch ? COLORS.green : COLORS.line, color: canLaunch ? "#fff" : COLORS.muted }}>
              Launch Saleshandy
            </button>
            {!configured && <p className="mt-2 text-[11px]" style={{ color: COLORS.muted }}>CTA desactivada: falta VITE_OUTREACH_API_BASE_URL. La ruta default real es /outreach/sequences/{'{sequence_id}'}/launch-saleshandy. VITE_OUTREACH_ORCHESTRATION_BASE_URL queda solo como alias legacy.</p>}
            {configured && !sequenceId && <p className="mt-2 text-[11px]" style={{ color: COLORS.muted }}>CTA desactivada: el read model aún no expone sequence_id; approve/reject/launch no usan lead_id como fallback.</p>}
            {configured && !outreach.launchEligible && <p className="mt-2 text-[11px]" style={{ color: COLORS.muted }}>CTA desactivada por el read model: launch solo aparece cuando backend marca launch-ready y no hay estado final/bloqueado.</p>}
          </div>

          <KeyValueList title="Engagement / tool activity" values={[
            ["email events", events || "sin eventos"],
            ["latest email event", fmtTime(outreach.events?.latestEvent?.event_at || outreach.events?.latestEvent?.created_at)],
            ["tool activity", magnetEvents || "sin actividad"],
            ["latest tool event", fmtTime(outreach.magnetEvents?.latestEvent?.event_at || outreach.magnetEvents?.latestEvent?.created_at)],
            ["fallback limitation", "Provider import/enrollment, sent/open/click/reply, and tool visits are separate evidence streams; absent webhook/polling events are shown as unknown, not inferred."],
          ]} />

          {actionError && <EmptyState tone={COLORS.red}>Backend action failed: {actionError.message}</EmptyState>}
          {actionResult?.bulk_run_id ? <LaunchResult result={actionResult} /> : <ActionResult result={actionResult} />}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-lg rounded-lg p-5 shadow-2xl" style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
            <h3 className="mb-2 text-base font-medium">Confirmar launch Saleshandy real</h3>
            <p className="mb-3 text-xs leading-5" style={{ color: COLORS.muted }}>Esto llama al backend de Outreach y puede crear/importar un prospect real en Saleshandy. No es una llamada browser → Saleshandy; conserva guardrails backend, QA/non-QA y idempotencia.</p>
            <dl className="mb-4 grid gap-2 text-xs">
              <KeyValue label="recipient" value={outreach?.email} />
              <KeyValue label="lead_id" value={outreach?.leadId} />
              <KeyValue label="sequence_id" value={sequenceId} />
              <KeyValue label="subject" value={sequence?.subject} />
              <KeyValue label="tool URL" value={outreach?.toolUrl} href={outreach?.toolUrl} />
              <KeyValue label="provider_sequence_id" value={provider.provider_sequence_id} />
            </dl>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded px-3 py-2 text-xs" style={{ border: `1px solid ${COLORS.line}` }}>Cancelar</button>
              <button onClick={() => runAction("launch", () => launchSaleshandyQaBulk(sequenceId, outreach.leadId))} disabled={busyAction === "launch"} className="rounded px-3 py-2 text-xs font-medium" style={{ background: COLORS.green, color: "#fff" }}>{busyAction === "launch" ? "Launching…" : "Confirmar launch"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function runElapsed(run) {
  if (!run?.started_at || run.duration_ms != null) return null;
  const started = new Date(run.started_at).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Date.now() - started);
}

function runMetaLine(run) {
  if (!run?.started_at) return "Sin ejecución registrada";
  const duration = run.duration_ms != null ? fmtDuration(run.duration_ms) : run.status === "running" ? `${fmtDuration(runElapsed(run))} transcurridos` : "—";
  return `Última ejecución ${fmtTime(run.started_at)} · ${duration}`;
}

function runSummaryChunks(run) {
  const summary = run?.response_payload?.summary;
  if (!summary || typeof summary !== "object") return [];
  return [
    summary.ad_count != null ? `ad_count: ${fmtInt(summary.ad_count)}` : null,
    summary.stop_reason ? `stop_reason: ${summary.stop_reason}` : null,
    summary.targeting?.view_all_page_id ? `view_all_page_id: ${summary.targeting.view_all_page_id}` : null,
  ].filter(Boolean);
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
            {runMetaLine(run)}
          </div>
          {run?.service_run_id && (
            <div className="mt-1 break-all mono text-[10px]" style={{ color: COLORS.muted }}>
              service_run_id: {run.service_run_id}
            </div>
          )}
          {runSummaryChunks(run).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {runSummaryChunks(run).map((chunk) => (
                <span key={chunk} className="rounded-full px-2 py-0.5 mono text-[10px]" style={{ background: COLORS.soft, color: COLORS.muted }}>
                  {chunk}
                </span>
              ))}
            </div>
          )}
        </div>
        <Badge status={status} />
      </div>

      {state.loading && <LoadingBlock label={label} />}
      {state.error && (
        <EmptyState>
          Error al cargar los datos del panel: {state.error.message}. Este fallo es de consulta/red y no cambia el estado del scraper.
        </EmptyState>
      )}
      {!state.loading && !state.error && source !== "metaAds" && status === "not_run" && (
        <EmptyState>{label} todavía no se ha ejecutado para esta marca.</EmptyState>
      )}
      {!state.loading && !state.error && source !== "metaAds" && status === "running" && (
        <EmptyState><span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> {label} sigue ejecutándose.</span></EmptyState>
      )}
      {!state.loading && !state.error && source === "metaAds" && <MetaAdsSummary ads={data || []} run={run} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "reviews" && status !== "not_run" && status !== "running" && <ReviewsSummary reviews={data || []} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "techStack" && status !== "not_run" && status !== "running" && <TechStackSummary stack={data} onOpen={onOpen} />}
      {!state.loading && !state.error && source === "context" && status !== "not_run" && status !== "running" && <ContextSummary context={data} run={run} />}
    </section>
  );
}

function MetaAdsSummary({ ads, run, onOpen }) {
  const status = run?.status || "not_run";
  const active = ads.filter((ad) => String(ad.status || "").toUpperCase() === "ACTIVE").length;

  if (ads.length === 0) {
    if (status === "error") {
      return (
        <EmptyState tone={COLORS.red}>
          <strong>Sin datos guardados; última ejecución falló.</strong>
          {run?.message ? <span className="mt-1 block">Último scrape falló: {run.message}</span> : null}
          <span className="mt-1 block" style={{ color: COLORS.muted }}>{runMetaLine(run)}</span>
        </EmptyState>
      );
    }

    if (status === "running") {
      return (
        <EmptyState>
          <span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Meta Ads sigue ejecutándose.</span>
          <span className="mt-1 block">Aún no hay anuncios guardados; refresca el panel para ver si el run termina.</span>
          <span className="mt-1 block mono">{runMetaLine(run)}</span>
        </EmptyState>
      );
    }

    if (status === "success") {
      return <EmptyState>La fuente terminó correctamente, pero no devolvió anuncios para esta marca.</EmptyState>;
    }

    if (status === "partial") {
      return <EmptyState tone={COLORS.amber}>La última ejecución quedó parcial y no dejó anuncios guardados. {run?.message || "Revisa el run antes de asumir que no hay actividad."}</EmptyState>;
    }

    return <EmptyState>Meta Ads todavía no se ha ejecutado para esta marca.</EmptyState>;
  }

  return (
    <div className="space-y-3 text-xs">
      <p><strong>{fmtInt(ads.length)}</strong> anuncios encontrados · <strong>{fmtInt(active)}</strong> activos hoy</p>
      {runSummaryChunks(run).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {runSummaryChunks(run).map((chunk) => (
            <span key={chunk} className="rounded-full px-2 py-1 mono text-[10px]" style={{ background: COLORS.soft, color: COLORS.muted }}>
              {chunk}
            </span>
          ))}
        </div>
      )}
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
        <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
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
        <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
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
      <div className={fullscreen ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]" : "space-y-3"}>
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

export default function BrandDrawer({ brand, onClose, onRefresh }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [detailSource, setDetailSource] = useState(null);
  const [sources, setSources] = useState({});

  const runnableServices = useMemo(() => VERIFICATION_SERVICES, []);

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
  const width = fullscreen ? "100vw" : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" aria-modal="true" role="dialog">
      <aside className="h-full w-full overflow-y-auto shadow-2xl transition-all sm:w-[640px]" style={{ width, maxWidth: "100vw", background: COLORS.paper, color: COLORS.ink }}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6" style={{ borderBottom: `1px solid ${COLORS.line}`, background: COLORS.paper }}>
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

        <main className="p-4 sm:p-6">
          {!detailSource && <div className="mb-4"><OutreachSection brand={brand} onRefresh={onRefresh} /></div>}
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
            <div className={fullscreen ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "space-y-4"}>
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
