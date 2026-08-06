const LAUNCHED_LIFECYCLE_KEYS = new Set(["planned", "submitted", "import_pending", "imported", "sent", "opened", "clicked", "replied"]);
const LAUNCHED_SEND_STATUSES = new Set(["launch_requested", "import_requested", "imported", "import_failed", "scheduled", "sent", "submitted", "import_pending", "planned"]);

function normalizedFollowup(followup = {}, index = 0) {
  const step = Number.parseInt(followup.step ?? index + 1, 10);
  return {
    step: Number.isFinite(step) && step > 0 ? step : index + 1,
    kind: String(followup.kind || "follow_up").trim() || "follow_up",
    subject: followup.subject ? String(followup.subject).trim() : null,
    body: String(followup.body ?? followup.email ?? "").trim(),
  };
}

export function sequenceIdFor(sequence) {
  return sequence?.id || sequence?.sequence_id || sequence?.email_sequence_id || "";
}

export function createSequenceDraftForm(sequence = {}) {
  const followups = Array.isArray(sequence.followups) ? sequence.followups : [];
  return {
    subject: sequence.subject || "",
    initial_email: sequence.initial_email || sequence.body || "",
    followups: followups.map(normalizedFollowup),
  };
}

export function buildSequenceDraftPayload({ form, editedBy = "miguel", notes = "Dashboard inline draft edit" } = {}) {
  const followups = Array.isArray(form?.followups) ? form.followups : [];
  return {
    edited_by: editedBy,
    subject: String(form?.subject || "").trim(),
    initial_email: String(form?.initial_email || "").trim(),
    followups: followups.map(normalizedFollowup),
    ...(notes ? { notes } : {}),
  };
}

export function isSequenceAlreadyLaunched({ sequence, lifecycleKey, provider } = {}) {
  const sequenceStatus = String(sequence?.status || "").toLowerCase();
  const sendStatus = String(sequence?.send_status || sequence?.sequence_send_status || "").toLowerCase();
  if (LAUNCHED_LIFECYCLE_KEYS.has(String(lifecycleKey || "").toLowerCase())) return true;
  if (LAUNCHED_SEND_STATUSES.has(sequenceStatus) || LAUNCHED_SEND_STATUSES.has(sendStatus)) return true;
  return Boolean(
    sequence?.provider_import_request_id
    || sequence?.provider_import_status
    || sequence?.launch_requested_at
    || sequence?.import_requested_at
    || provider?.provider_import_request_id
    || provider?.provider_import_status,
  );
}

export function isSequenceDraftEditable({ sequence, configured, lifecycleKey, provider } = {}) {
  if (!sequenceIdFor(sequence)) return { editable: false, reason: "Edit disabled: no sequence_id is available yet." };
  if (!configured) return { editable: false, reason: "Edit disabled: falta VITE_OUTREACH_API_BASE_URL." };
  if (isSequenceAlreadyLaunched({ sequence, lifecycleKey, provider })) return { editable: false, reason: "Edit disabled: sequence already launched/imported by backend state." };
  const sendStatus = String(sequence?.send_status || sequence?.sequence_send_status || "").toLowerCase();
  if (sendStatus && sendStatus !== "not_scheduled") return { editable: false, reason: "Edit disabled: backend only allows edits while send_status is not_scheduled." };
  return { editable: true, reason: null };
}

export function sequenceDraftReducer(state, action) {
  switch (action.type) {
    case "edit":
      return { ...state, mode: "edit", form: createSequenceDraftForm(action.sequence), error: null, result: null };
    case "cancel":
      return { ...state, mode: "view", form: createSequenceDraftForm(action.sequence), error: null };
    case "field":
      return { ...state, form: { ...state.form, [action.field]: action.value } };
    case "followup": {
      const followups = [...(state.form.followups || [])];
      followups[action.index] = { ...followups[action.index], [action.field]: action.value };
      return { ...state, form: { ...state.form, followups } };
    }
    case "addFollowup": {
      const followups = [...(state.form.followups || [])];
      followups.push({ step: followups.length + 1, kind: "follow_up", subject: "", body: "" });
      return { ...state, form: { ...state.form, followups } };
    }
    case "removeFollowup": {
      const followups = (state.form.followups || [])
        .filter((_, index) => index !== action.index)
        .map((followup, index) => ({ ...followup, step: index + 1 }));
      return { ...state, form: { ...state.form, followups } };
    }
    case "saving":
      return { ...state, mode: "saving", error: null, result: null };
    case "saved":
      return { ...state, mode: "view", error: null, result: action.result, form: createSequenceDraftForm(action.result?.sequence || action.sequence) };
    case "failed":
      return { ...state, mode: "edit", error: action.error, result: null };
    default:
      return state;
  }
}

export async function runSequenceDraftSave({ sequenceId, form, save, refresh, editedBy = "miguel", notes }) {
  if (!sequenceId) throw new Error("Falta sequence_id para guardar el draft.");
  const result = await save(sequenceId, buildSequenceDraftPayload({ form, editedBy, notes }));
  await refresh?.();
  return result;
}
