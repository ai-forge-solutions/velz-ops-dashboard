import assert from "node:assert/strict";
import {
  buildSequenceDraftPayload,
  createSequenceDraftForm,
  isSequenceDraftEditable,
  runSequenceDraftSave,
  sequenceDraftReducer,
} from "../src/sequenceDraftEditor.js";

const baseSequence = {
  id: "seq_001",
  subject: "Old subject",
  initial_email: "Old body",
  review_status: "approved",
  send_status: "not_scheduled",
  followups: [
    { step: 1, kind: "follow_up", subject: "Old f1", body: "Old b1" },
    { step: 2, kind: "follow_up", subject: "Old f2", email: "Old b2" },
  ],
};

assert.deepEqual(createSequenceDraftForm(baseSequence), {
  subject: "Old subject",
  initial_email: "Old body",
  followups: [
    { step: 1, kind: "follow_up", subject: "Old f1", body: "Old b1" },
    { step: 2, kind: "follow_up", subject: "Old f2", body: "Old b2" },
  ],
});

assert.equal(isSequenceDraftEditable({ sequence: baseSequence, configured: true, lifecycleKey: "not_launched" }).editable, true);
assert.match(isSequenceDraftEditable({ sequence: null, configured: true }).reason, /sequence_id/);
assert.match(isSequenceDraftEditable({ sequence: baseSequence, configured: false }).reason, /VITE_OUTREACH_API_BASE_URL/);
assert.match(isSequenceDraftEditable({ sequence: { ...baseSequence, send_status: "sent" }, configured: true }).reason, /already launched/i);
assert.match(isSequenceDraftEditable({ sequence: baseSequence, configured: true, lifecycleKey: "imported" }).reason, /already launched/i);

const edited = sequenceDraftReducer(
  { mode: "view", form: createSequenceDraftForm(baseSequence), error: null, result: null },
  { type: "edit", sequence: baseSequence },
);
assert.equal(edited.mode, "edit");

const changed = sequenceDraftReducer(edited, { type: "field", field: "subject", value: "New subject" });
assert.equal(changed.form.subject, "New subject");

const cancelled = sequenceDraftReducer(changed, { type: "cancel", sequence: baseSequence });
assert.equal(cancelled.mode, "view");
assert.equal(cancelled.form.subject, "Old subject");

const payload = buildSequenceDraftPayload({
  form: {
    subject: " New subject ",
    initial_email: "New body",
    followups: [
      { step: "1", kind: " follow_up ", subject: " New f1 ", body: "New b1" },
      { step: 2, kind: "follow_up", subject: "", body: "New b2" },
    ],
  },
  editedBy: "miguel",
  notes: "dashboard edit",
});
assert.deepEqual(payload, {
  edited_by: "miguel",
  subject: "New subject",
  initial_email: "New body",
  followups: [
    { step: 1, kind: "follow_up", subject: "New f1", body: "New b1" },
    { step: 2, kind: "follow_up", subject: null, body: "New b2" },
  ],
  notes: "dashboard edit",
});

let refreshCount = 0;
const saved = await runSequenceDraftSave({
  sequenceId: "seq_001",
  form: { subject: "New", initial_email: "Body", followups: [] },
  save: async (sequenceId, payload) => ({ sequence: { id: sequenceId, ...payload, review_status: "pending_review" } }),
  refresh: async () => { refreshCount += 1; },
});
assert.equal(saved.sequence.review_status, "pending_review");
assert.equal(refreshCount, 1);

await assert.rejects(
  () => runSequenceDraftSave({
    sequenceId: "seq_001",
    form: { subject: "New", initial_email: "Body", followups: [] },
    save: async () => { throw new Error("HTTP 409"); },
    refresh: async () => { throw new Error("should not refresh after failure"); },
  }),
  /HTTP 409/,
);
