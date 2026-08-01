export const QA_LEAD_ID = "4768fa1e-21f7-4ff3-a82d-639deec5c4dd";
export const QA_RECIPIENT = "miguelcarmonar@gmail.com";

const READINESS_LABELS = {
  no_sequence: "No sequence",
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  blocked: "Blocked",
};

const LIFECYCLE_LABELS = {
  not_launched: "Not launched",
  planned: "Planned",
  submitted: "Submitted",
  import_pending: "Import pending",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  failed: "Failed",
  suppressed: "Suppressed",
};

function parseTime(row) {
  if (!row) return 0;
  const value = row.event_at || row.occurred_at || row.sent_at || row.last_provider_sync_at || row.updated_at || row.created_at;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function latestByTimestamp(rows = []) {
  return rows.filter(Boolean).reduce((latest, row) => {
    if (!latest) return row;
    return parseTime(row) >= parseTime(latest) ? row : latest;
  }, null);
}

export function summarizeEventCounts(rows = []) {
  const counts = {};
  for (const row of rows || []) {
    const type = row.event_type || row.type || row.event_name || "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }
  return {
    counts,
    latestEvent: latestByTimestamp(rows),
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function pickMetadata(row) {
  const metadata = row?.metadata || row?.source_metadata || row?.provider_snapshot || {};
  return metadata && typeof metadata === "object" ? metadata : {};
}

export function publicToolUrl(sequence, lead) {
  const metadata = pickMetadata(sequence);
  return (
    sequence?.public_tool_url ||
    sequence?.lead_magnet_url ||
    sequence?.tool_url ||
    metadata.public_tool_url ||
    metadata.lead_magnet_url ||
    metadata.tool_url ||
    lead?.lead_magnet_url ||
    lead?.public_url ||
    null
  );
}

export function recipientEmail(sequence, lead) {
  const metadata = pickMetadata(sequence);
  return (
    sequence?.recipient_email ||
    sequence?.email ||
    metadata.recipient_email ||
    metadata.email ||
    lead?.primary_email ||
    lead?.email ||
    null
  );
}

function readinessFrom({ sequence, suppression, blockers }) {
  if (suppression) return "blocked";
  if (!sequence) return "no_sequence";
  if (blockers.length > 0) return "blocked";
  const review = normalize(sequence.review_status);
  const status = normalize(sequence.status || sequence.readiness_status);
  if (review === "pending_review") return "pending_review";
  if (["approved", "reviewed", "ready_to_send"].includes(review)) return "approved";
  if (["draft", "not_ready", "degraded"].includes(status)) return "draft";
  if (["ready", "approved"].includes(status)) return "approved";
  return status ? "draft" : "no_sequence";
}

function lifecycleFrom({ sequence, send, eventsSummary, suppression }) {
  if (suppression) return "suppressed";
  if (!sequence) return "not_launched";
  const eventTypes = new Set(Object.keys(eventsSummary.counts).map(normalize));
  if ([...eventTypes].some((type) => type.includes("click"))) return "clicked";
  if ([...eventTypes].some((type) => type.includes("open"))) return "opened";

  const sendStatus = normalize(send?.status || send?.send_status);
  const providerImportStatus = normalize(send?.provider_import_status || send?.import_status);
  const sequenceSendStatus = normalize(sequence.send_status);
  const status = sendStatus || sequenceSendStatus;

  if ([status, providerImportStatus].some((value) => ["failed", "error", "bounced", "rejected"].includes(value))) return "failed";
  if (send?.sent_at || ["sent", "delivered", "completed"].includes(status)) return "sent";
  if (["pending", "queued", "processing", "running", "in_progress"].includes(providerImportStatus)) return "import_pending";
  if (["submitted", "provider_started", "import_submitted"].includes(status)) return "submitted";
  if (["planned", "created", "ready", "launch_now"].includes(status)) return "planned";
  return "not_launched";
}

function nextActionFrom({ readinessKey, lifecycleKey, blockers, sequence, launchEligible, launchConfigured }) {
  if (lifecycleKey === "suppressed") return { key: "suppressed", label: "Suppressed — do not send" };
  if (blockers.length > 0) return { key: "blocked", label: `Investigate blocker: ${blockers[0]}` };
  if (readinessKey === "pending_review") return { key: "review", label: "Review sequence before launch" };
  if (readinessKey === "no_sequence") return { key: "create_sequence", label: "Create sequence before outreach" };
  if (lifecycleKey === "failed") return { key: "investigate_failure", label: "Investigate provider/send failure" };
  if (["submitted", "import_pending"].includes(lifecycleKey)) return { key: "wait_provider", label: "Wait for provider sync/reconciliation" };
  if (launchEligible && launchConfigured) return { key: "launch_qa", label: "Launch QA via internal orchestration endpoint" };
  if (launchEligible && !launchConfigured) return { key: "configure_endpoint", label: "Configure outreach orchestration endpoint to enable QA launch" };
  if (sequence) return { key: "monitor", label: "Monitor Saleshandy lifecycle and engagement" };
  return { key: "blocked", label: "Missing outreach source data" };
}

export function deriveOutreachStatus({ leadId, lead, sequence, send, events = [], magnetEvents = [], suppression, launchConfigured = false } = {}) {
  const blockers = [];
  const email = recipientEmail(sequence, lead);
  const toolUrl = publicToolUrl(sequence, lead);
  const activeSuppression = suppression && suppression.active !== false ? suppression : null;
  if (activeSuppression) blockers.push("active suppression");
  if (sequence && !toolUrl) blockers.push("missing tool URL");
  const sendStatus = normalize(send?.status || send?.send_status);
  const providerImportStatus = normalize(send?.provider_import_status || send?.import_status);
  if ([sendStatus, providerImportStatus].some((value) => ["failed", "error", "bounced", "rejected"].includes(value))) blockers.push("provider/send failure");

  const eventsSummary = summarizeEventCounts(events);
  const magnetSummary = summarizeEventCounts(magnetEvents);
  const readinessKey = readinessFrom({ sequence, suppression: activeSuppression, blockers });
  const lifecycleKey = lifecycleFrom({ sequence, send, eventsSummary, suppression: activeSuppression });
  const launchEligible = leadId === QA_LEAD_ID && email === QA_RECIPIENT && !activeSuppression && Boolean(sequence) && Boolean(toolUrl);

  return {
    leadId,
    lead,
    sequence,
    send,
    email,
    toolUrl,
    readiness: { key: readinessKey, label: READINESS_LABELS[readinessKey] || readinessKey },
    lifecycle: { key: lifecycleKey, label: LIFECYCLE_LABELS[lifecycleKey] || lifecycleKey },
    provider: {
      provider_sequence_id: send?.provider_sequence_id || sequence?.provider_sequence_id || pickMetadata(send).provider_sequence_id,
      provider_prospect_id: send?.provider_prospect_id || pickMetadata(send).provider_prospect_id,
      provider_import_request_id: send?.provider_import_request_id || send?.provider_import_id || pickMetadata(send).provider_import_request_id,
      provider_import_status: send?.provider_import_status || send?.import_status || pickMetadata(send).provider_import_status,
      last_provider_sync_at: send?.last_provider_sync_at || send?.provider_synced_at || pickMetadata(send).last_provider_sync_at,
    },
    events: eventsSummary,
    magnetEvents: magnetSummary,
    suppression: activeSuppression,
    blockers,
    launchEligible,
    nextAction: nextActionFrom({ readinessKey, lifecycleKey, blockers, sequence, launchEligible, launchConfigured }),
  };
}

export function deriveOutreachFilters(outreach) {
  if (!outreach) return [];
  const filters = [];
  const launched = ["planned", "submitted", "import_pending", "sent", "opened", "clicked"].includes(outreach.lifecycle?.key);
  if (outreach.readiness?.key === "pending_review" && !launched) filters.push("needs_review");
  if (outreach.launchEligible && outreach.readiness?.key === "approved" && !launched) filters.push("ready_to_launch");
  if (launched) filters.push("launched");
  if (["submitted", "import_pending"].includes(outreach.lifecycle?.key)) filters.push("provider_pending");
  if (["opened", "clicked"].includes(outreach.lifecycle?.key) || Object.keys(outreach.magnetEvents?.counts || {}).length > 0) filters.push("engaged");
  if (["blocked", "failed"].includes(outreach.readiness?.key) || outreach.lifecycle?.key === "failed") filters.push("failed_blocked");
  if (outreach.lifecycle?.key === "suppressed") filters.push("suppressed");
  return filters;
}
