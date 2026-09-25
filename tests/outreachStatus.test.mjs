import assert from "node:assert/strict";
import {
  OUTREACH_DEFAULT_ACTION_PATHS,
  buildOutreachActionUrl,
  generateOutreachSequence,
  normalizeErrorPayload,
  setBrandGroupArchived,
  setLeadArchived,
  setOutreachSequenceStatus,
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
  setSequenceStatus: "/outreach/sequences/{sequence_id}/status",
  archiveLead: "/outreach/leads/{lead_id}/archive",
  archiveBrandGroup: "/outreach/brand-groups/{group_id}/archive",
  launch: "/outreach/sequences/{sequence_id}/launch-instantly",
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
  "https://outreach.example.com/outreach/sequences/seq-1/launch-instantly",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "setSequenceStatus", { sequenceId: "seq-1" }),
  "https://outreach.example.com/outreach/sequences/seq-1/status",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "archiveLead", { leadId: "lead-1" }),
  "https://outreach.example.com/outreach/leads/lead-1/archive",
);
assert.equal(
  buildOutreachActionUrl("https://outreach.example.com", "archiveBrandGroup", { groupId: "group/1" }),
  "https://outreach.example.com/outreach/brand-groups/group%2F1/archive",
);
assert.throws(() => buildOutreachActionUrl("https://outreach.example.com", "launch", { leadId: qaLeadId }), /sequence_id/);
assert.throws(() => buildOutreachActionUrl("https://outreach.example.com", "archiveBrandGroup", {}), /group_id/);
assert.equal(normalizeErrorPayload({ detail: { blocker: "send_kill_switch_enabled" } }, "fallback"), "send_kill_switch_enabled");
assert.equal(normalizeErrorPayload({ detail: { error: "runtime_configuration_missing", message: "SUPABASE_URL missing" } }, "fallback"), "SUPABASE_URL missing");
assert.equal(normalizeErrorPayload({ detail: { code: "NO_ENVIABLE", blockers: ["missing recipient email", "active suppression"] } }, "fallback"), "NO_ENVIABLE: missing recipient email · active suppression");
assert.equal(normalizeErrorPayload({ detail: { readiness_status: "not_ready", checks: { has_primary_email: true, sequence_exists: true, not_suppressed: true } } }, "fallback"), "not_ready: sequence_exists=true");

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
assert.equal(readyToGenerate.generateEligible, true);
assert.deepEqual(readyToGenerate.generateBlockers, []);
assert.equal(deriveOutreachStatus({
  leadId: "lead-archive-action",
  lead: { primary_email: "buyer@example.com", ready_to_generate: true },
  sequence: null,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { archiveLead: true },
}).actionConfigured.archiveLead, true);

const legacyNotReadyCanGenerate = deriveOutreachStatus({
  leadId: "dfa83244-018b-4912-8a5e-ef53ad8da8e8",
  lead: {
    primary_email: "silvia@example.com",
    domain: "silvia-navarro.com",
    outreach: {
      ready_to_generate: false,
      readiness_status: "not_ready",
      blockers: ["legacy readiness not_ready"],
    },
  },
  sequence: null,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { generate: true },
});
assert.equal(legacyNotReadyCanGenerate.readiness.key, "not_ready");
assert.equal(legacyNotReadyCanGenerate.readyToGenerate, false);
assert.equal(legacyNotReadyCanGenerate.generateEligible, true);
assert.equal(legacyNotReadyCanGenerate.nextAction.key, "generate");
assert.deepEqual(legacyNotReadyCanGenerate.generateBlockers, []);
assert.match(legacyNotReadyCanGenerate.warnings.join(" "), /legacy readiness not_ready/i);

const notReadyMissingEmailCannotGenerate = deriveOutreachStatus({
  leadId: "lead-missing-email",
  lead: {
    outreach: {
      ready_to_generate: false,
      readiness_status: "not_ready",
    },
  },
  sequence: null,
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { generate: true },
});
assert.equal(notReadyMissingEmailCannotGenerate.generateEligible, false);
assert.match(notReadyMissingEmailCannotGenerate.generateBlockers.join(" "), /missing recipient email/i);

const noEnviableFailedDraft = deriveOutreachStatus({
  leadId: "lead-failed-copy",
  lead: {
    primary_email: "buyer@example.com",
    outreach_blockers: ["existing sequence"],
  },
  sequence: {
    id: "seq-no-enviable",
    lead_id: "lead-failed-copy",
    subject: "NO_ENVIABLE",
    initial_email: "NO_ENVIABLE: falla Entregable: faltan fuentes requeridas ['brand_reviews']",
    status: "draft",
    review_status: "not_ready",
    send_status: "dry_run",
    metadata: {
      no_enviable_stage: "selector",
      motivo_no_enviable: ["falla Entregable: faltan fuentes requeridas ['brand_reviews']"],
    },
  },
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { generate: true },
});
assert.equal(noEnviableFailedDraft.generateEligible, true);
assert.deepEqual(noEnviableFailedDraft.generateBlockers, []);
assert.deepEqual(noEnviableFailedDraft.blockers, []);
assert.match(noEnviableFailedDraft.warnings.join(" "), /existing sequence/i);
assert.equal(noEnviableFailedDraft.noEnviable, true);
assert.equal(noEnviableFailedDraft.canApprove, false);
assert.equal(noEnviableFailedDraft.launchEligible, false);
assert.deepEqual(noEnviableFailedDraft.noEnviableReasons, ["falla Entregable: faltan fuentes requeridas ['brand_reviews']", "stage: selector"]);
assert.equal(noEnviableFailedDraft.nextAction.key, "generate");

const archivedLead = deriveOutreachStatus({
  leadId: "lead-archived",
  lead: {
    primary_email: "archived@example.com",
    ready_to_generate: true,
    archived_at: "2026-09-23T12:00:00Z",
    archived_by: "miguel",
    archive_reason: "cleanup",
  },
  sequence: { ...baseSequence, id: "seq-archived", lead_id: "lead-archived", review_status: "pending_review", status: "draft" },
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { generate: true, approve: true, launch: true },
});
assert.equal(archivedLead.archived, true);
assert.equal(archivedLead.generateEligible, false);
assert.equal(archivedLead.generateBlockers.includes("lead archived"), true);
assert.equal(archivedLead.canApprove, false);
assert.equal(archivedLead.launchEligible, false);
assert.equal(archivedLead.archive.reason, "cleanup");

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
assert.deepEqual(pendingMissingToolUrl.warnings, []);
assert.deepEqual(pendingMissingToolUrl.launchBlockers, []);

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
assert.deepEqual(pendingBackendMissingToolUrl.warnings, []);

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

const approvedNotScheduled = deriveOutreachStatus({
  leadId: "lead-approved",
  lead: { primary_email: "buyer@example.com" },
  sequence: {
    ...baseSequence,
    id: "seq-approved-no-tool",
    lead_id: "lead-approved",
    review_status: "approved",
    send_status: "not_scheduled",
    metadata: { recipient_email: "buyer@example.com" },
  },
  send: null,
  events: [],
  magnetEvents: [],
  suppression: null,
  actionConfigured: { launch: true },
});
assert.equal(approvedNotScheduled.readiness.key, "approved");
assert.equal(approvedNotScheduled.launchEligible, true);
assert.deepEqual(deriveOutreachFilters(approvedNotScheduled), ["ready_to_launch"]);
assert.deepEqual(approvedNotScheduled.launchBlockers, []);

assert.deepEqual(deriveOutreachFilters(pendingDryRun), ["needs_review"]);
assert.deepEqual(deriveOutreachFilters(delivered), ["launched", "engaged"]);
assert.deepEqual(deriveOutreachFilters(suppressed), ["failed_blocked", "suppressed"]);

globalThis.__VELZ_RUNTIME_CONFIG__ = { VITE_OUTREACH_API_BASE_URL: "https://outreach.example.com" };
const originalFetch = globalThis.fetch;
const capturedPatchRequests = [];
globalThis.fetch = async (url, options = {}) => {
  capturedPatchRequests.push({ url: String(url), options });
  return new Response(JSON.stringify({ ok: true, affected_leads: 7 }), { status: 200, headers: { "Content-Type": "application/json" } });
};
await setOutreachSequenceStatus("seq-1", "no_enviable", "manual cleanup");
await setLeadArchived("lead-1", true, "cleanup");
await setBrandGroupArchived("group-1", true, "cleanup group");
assert.deepEqual(capturedPatchRequests.map((request) => [request.url, request.options.method, JSON.parse(request.options.body)]), [
  ["https://outreach.example.com/outreach/sequences/seq-1/status", "PATCH", { status: "no_enviable", updated_by: "miguel", notes: "manual cleanup" }],
  ["https://outreach.example.com/outreach/leads/lead-1/archive", "PATCH", { archived: true, updated_by: "miguel", reason: "cleanup" }],
  ["https://outreach.example.com/outreach/brand-groups/group-1/archive", "PATCH", { archived: true, updated_by: "miguel", reason: "cleanup group", cascade_leads: true }],
]);

let capturedGenerateUrl = null;
globalThis.fetch = async (url) => {
  capturedGenerateUrl = String(url);
  return new Response(JSON.stringify({
    sequence_exists: true,
    ready_to_review: true,
    next_action: "approve_sequence",
  }), { status: 409, headers: { "Content-Type": "application/json" } });
};
const idempotentGenerate = await generateOutreachSequence("lead-existing");
assert.equal(capturedGenerateUrl, "https://outreach.example.com/outreach/leads/lead-existing/sequences/generate");
assert.equal(idempotentGenerate.sequence_exists, true);
assert.equal(idempotentGenerate.ready_to_review, true);
assert.equal(idempotentGenerate.message, "Draft ya existe — pendiente de revisión");
globalThis.fetch = originalFetch;
delete globalThis.__VELZ_RUNTIME_CONFIG__;
