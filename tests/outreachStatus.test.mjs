import assert from "node:assert/strict";
import {
  OUTREACH_DEFAULT_ACTION_PATHS,
  buildOutreachActionUrl,
} from "../src/conductorApi.js";
import {
  deriveOutreachFilters,
  deriveOutreachStatus,
  latestByTimestamp,
  summarizeEventCounts,
} from "../src/outreachStatus.js";

const qaLeadId = "4768fa1e-21f7-4ff3-a82d-639deec5c4dd";

assert.deepEqual(OUTREACH_DEFAULT_ACTION_PATHS, {
  generate: "/outreach/leads/{lead_id}/sequences/generate",
  approve: "/outreach/sequences/{sequence_id}/approve",
  reject: "/outreach/sequences/{sequence_id}/reject",
  editDraft: "/outreach/sequences/{sequence_id}/draft-fields",
  launch: "/outreach/sequences/{sequence_id}/launch-saleshandy",
});
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com/", "generate", { leadId: "lead 1" }),
  "https://outreach.example.com/outreach/leads/lead%201/sequences/generate",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "approve", { sequenceId: "seq/1" }),
  "https://outreach.example.com/outreach/sequences/seq%2F1/approve",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "reject", { sequenceId: "seq-1" }),
  "https://outreach.example.com/outreach/sequences/seq-1/reject",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "editDraft", { sequenceId: "seq-1" }),
  "https://outreach.example.com/outreach/sequences/seq-1/draft-fields",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "launch", { sequenceId: "seq-1" }),
  "https://outreach.example.com/outreach/sequences/seq-1/launch-saleshandy",
);
assert.throws(() => buildOutreachActionUrl("https://outreach.example.com", "launch", { leadId: qaLeadId }), /sequence_id/);

const baseSequence = {
  id: "seq-1",
  lead_id: qaLeadId,
  subject: "Miguel, prueba Velz",
  status: "draft",
  review_status: "pending_review",
  send_status: "dry_run",
  tool_key: "stockout_leak_score",
  metadata: {
    public_tool_url: "https://velz.io/tools/stockout-leak-score/test-ready-token",
    recipient_email: "miguelcarmonar@gmail.com",
  },
  created_at: "2026-07-29T06:23:28.968755+00:00",
};

assert.equal(latestByTimestamp([
  { id: "older", created_at: "2026-01-01T00:00:00Z" },
  { id: "newer", created_at: "2026-01-02T00:00:00Z" },
])?.id, "newer");

assert.deepEqual(summarizeEventCounts([
  { event_type: "opened", event_at: "2026-01-02T00:00:00Z" },
  { event_type: "clicked", event_at: "2026-01-03T00:00:00Z" },
  { event_type: "opened", event_at: "2026-01-04T00:00:00Z" },
]), {
  counts: { opened: 2, clicked: 1 },
  latestEvent: { event_type: "opened", event_at: "2026-01-04T00:00:00Z" },
});

const pendingDryRun = deriveOutreachStatus({
  leadId: qaLeadId,
  lead: { primary_email: "miguelcarmonar@gmail.com" },
  sequence: baseSequence,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
});
assert.equal(pendingDryRun.readiness.key, "pending_review");
assert.equal(pendingDryRun.readiness.label, "Draft pending review");
assert.equal(pendingDryRun.lifecycle.key, "not_launched");
assert.equal(pendingDryRun.lifecycle.label, "Not launched");
assert.match(pendingDryRun.nextAction.label, /review/i);

const delivered = deriveOutreachStatus({
  leadId: qaLeadId,
  lead: { primary_email: "miguelcarmonar@gmail.com" },
  sequence: baseSequence,
  send: {
    id: "send-1",
    status: "sent",
    send_mode: "live",
    provider_sequence_id: "7pzV9Yv4ab",
    provider_import_request_id: "d5275db681",
    provider_import_status: "completed",
    sent_at: "2026-07-29T08:57:51.272048+00:00",
  },
  events: [
    { event_type: "fallback-delivered", event_at: "2026-07-29T08:57:51.272048+00:00" },
    { event_type: "opened", event_at: "2026-07-29T09:00:00.000000+00:00" },
  ],
  magnetEvents: [],
  suppression: null,
});
assert.equal(delivered.lifecycle.key, "opened");
assert.equal(delivered.lifecycle.label, "Opened");
assert.equal(delivered.provider.provider_sequence_id, "7pzV9Yv4ab");
assert.deepEqual(delivered.journey.map((step) => step.key), ["readiness", "sequence", "review", "saleshandy", "engagement"]);

const readyToGenerate = deriveOutreachStatus({
  leadId: "lead-ready",
  lead: {
    primary_email: "buyer@example.com",
    ready_to_generate: true,
    outreach_blockers: [],
  },
  sequence: null,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { generate: true },
});
assert.equal(readyToGenerate.readiness.key, "ready_to_generate");
assert.equal(readyToGenerate.readiness.label, "Ready to generate");
assert.equal(readyToGenerate.nextAction.key, "generate");
assert.equal(readyToGenerate.readyToGenerate, true);

const launchReady = deriveOutreachStatus({
  leadId: qaLeadId,
  lead: { primary_email: "miguelcarmonar@gmail.com" },
  sequence: { ...baseSequence, review_status: "approved", status: "ready", launch_ready: true },
  send: { status: "planned" },
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { launch: true },
});
assert.equal(launchReady.launchEligible, true);
assert.equal(launchReady.nextAction.key, "launch");

const pendingMissingToolUrl = deriveOutreachStatus({
  leadId: "lead-with-draft",
  lead: { primary_email: "buyer@example.com" },
  sequence: { ...baseSequence, id: "seq-no-tool", metadata: { recipient_email: "buyer@example.com" } },
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { approve: true, launch: true },
});
assert.equal(pendingMissingToolUrl.readiness.key, "pending_review");
assert.equal(pendingMissingToolUrl.canApprove, true);
assert.deepEqual(pendingMissingToolUrl.blockers, []);
assert.match(pendingMissingToolUrl.warnings.join(" "), /missing tool URL/i);
assert.deepEqual(pendingMissingToolUrl.launchBlockers, ["missing tool URL"]);

const pendingBackendMissingToolUrl = deriveOutreachStatus({
  leadId: "lead-with-backend-warning",
  lead: { primary_email: "buyer@example.com", outreach_blockers: ["missing tool URL"] },
  sequence: { ...baseSequence, id: "seq-backend-no-tool", metadata: { recipient_email: "buyer@example.com" } },
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { approve: true },
});
assert.equal(pendingBackendMissingToolUrl.canApprove, true);
assert.deepEqual(pendingBackendMissingToolUrl.blockers, []);
assert.match(pendingBackendMissingToolUrl.warnings.join(" "), /missing tool URL/i);

const suppressed = deriveOutreachStatus({
  leadId: qaLeadId,
  lead: { primary_email: "miguelcarmonar@gmail.com" },
  sequence: baseSequence,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: { id: "sup-1", reason: "manual_dnc", active: true },
});
assert.equal(suppressed.readiness.key, "blocked");
assert.equal(suppressed.lifecycle.key, "suppressed");
assert.match(suppressed.blockers.join(" "), /suppression/i);

assert.deepEqual(deriveOutreachFilters(pendingDryRun), ["needs_review"]);
assert.deepEqual(deriveOutreachFilters(delivered), ["launched", "engaged"]);
assert.deepEqual(deriveOutreachFilters(suppressed), ["failed_blocked", "suppressed"]);
