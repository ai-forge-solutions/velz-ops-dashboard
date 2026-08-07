export const QA_LEAD_ID = "4768fa1e-21f7-4ff3-a82d-639deec5c4dd";
export const QA_RECIPIENT = "miguelcarmonar@gmail.com";

const READINESS_LABELS = {
  not_ready: "Not ready",
  ready_to_generate: "Ready to generate",
  no_sequence: "Not ready",
  draft: "Draft pending review",
  pending_review: "Draft pending review",
  approved: "Approved",
  launch_ready: "Launch ready",
  blocked: "Blocked",
};

const LIFECYCLE_LABELS = {
  not_launched: "Not launched",
  planned: "Launch ready",
  submitted: "Launch submitted",
  import_pending: "Launch submitted",
  imported: "Imported/enrolled",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  failed: "Failed",
  suppressed: "Suppressed",
};

const JOURNEY_STEP_LABELS = {
  readiness: "Readiness",
  sequence: "Sequence",
  review: "Review",
  saleshandy: "Saleshandy",
  engagement: "Engagement",
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

function booleanish(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function pickMetadata(row) {
  const metadata = row?.metadata || row?.source_metadata || row?.provider_snapshot || row?.read_model || {};
  return metadata && typeof metadata === "object" ? metadata : {};
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function isMissingToolUrl(value) {
  return normalize(value).replace(/[_-]/g, " ").includes("missing tool url");
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

function readinessFrom({ lead, sequence, suppression, blockers, readModel }) {
  if (suppression) return "blocked";
  if (blockers.length > 0) return "blocked";

  const explicit = normalize(pickFirst(
    readModel?.journey_state,
    readModel?.outreach_journey_state,
    readModel?.readiness_state,
    readModel?.readiness_status,
    lead?.outreach_journey_state,
    lead?.outreach_readiness_status,
    lead?.readiness_status,
    sequence?.readiness_status,
    sequence?.status,
  ));

  if (["ready_to_generate", "ready-to-generate", "ready_generate", "generate_ready"].includes(explicit)) return "ready_to_generate";
  if (!sequence && ["ready", "approved"].includes(explicit)) return "ready_to_generate";
  if (["not_ready", "not-ready", "missing_inputs", "degraded", "needs_enrichment"].includes(explicit)) return "not_ready";
  if (["launch_ready", "ready_to_launch", "approved_ready_to_launch"].includes(explicit)) return "launch_ready";

  if (booleanish(readModel?.ready_to_generate) || booleanish(lead?.ready_to_generate)) return "ready_to_generate";
  if (!sequence) return "not_ready";

  const review = normalize(sequence.review_status || readModel?.review_status);
  if (["pending_review", "draft_pending_review", "pending", "draft"].includes(review)) return "pending_review";
  if (["approved", "reviewed", "ready_to_send"].includes(review)) return "approved";
  if (["approved", "ready"].includes(explicit)) return "approved";
  return explicit ? "draft" : "not_ready";
}

function lifecycleFrom({ sequence, send, eventsSummary, suppression, readModel }) {
  if (suppression) return "suppressed";
  if (!sequence && !readModel) return "not_launched";
  const eventTypes = new Set(Object.keys(eventsSummary.counts).map(normalize));
  if ([...eventTypes].some((type) => type.includes("reply"))) return "replied";
  if ([...eventTypes].some((type) => type.includes("click"))) return "clicked";
  if ([...eventTypes].some((type) => type.includes("open"))) return "opened";

  const sendStatus = normalize(send?.status || send?.send_status || readModel?.send_status || readModel?.saleshandy_status);
  const providerImportStatus = normalize(send?.provider_import_status || send?.import_status || readModel?.provider_import_status || readModel?.import_status);
  const sequenceSendStatus = normalize(sequence?.send_status || readModel?.sequence_send_status);
  const status = sendStatus || sequenceSendStatus;

  if ([status, providerImportStatus].some((value) => ["failed", "error", "bounced", "rejected"].includes(value))) return "failed";
  if (["replied", "reply"].includes(status)) return "replied";
  if (["clicked", "click"].includes(status)) return "clicked";
  if (["opened", "open"].includes(status)) return "opened";
  if (send?.sent_at || ["sent", "delivered", "completed"].includes(status)) return "sent";
  if (["imported", "enrolled", "completed", "success"].includes(providerImportStatus)) return "imported";
  if (["pending", "queued", "processing", "running", "in_progress", "import_requested"].includes(providerImportStatus)) return "import_pending";
  if (["submitted", "provider_started", "import_submitted", "launch_submitted"].includes(status)) return "submitted";
  if (["planned", "created", "ready", "launch_now", "launch_ready", "ready_to_launch"].includes(status)) return "planned";
  return "not_launched";
}

function actionFlags({ lead, sequence, send, readModel, launchEligible }) {
  const metadata = pickMetadata(sequence);
  return {
    readyToGenerate: booleanish(pickFirst(readModel?.ready_to_generate, lead?.ready_to_generate, metadata.ready_to_generate)),
    canApprove: booleanish(pickFirst(readModel?.can_approve, sequence?.can_approve, metadata.can_approve)),
    canReject: booleanish(pickFirst(readModel?.can_reject, sequence?.can_reject, metadata.can_reject)),
    launchReady: booleanish(pickFirst(readModel?.launch_ready, readModel?.ready_to_launch, sequence?.launch_ready, send?.launch_ready, metadata.launch_ready)) || launchEligible,
  };
}

function nextActionFrom({ readinessKey, lifecycleKey, blockers, sequence, flags, configured }) {
  if (lifecycleKey === "suppressed") return { key: "suppressed", label: "Suppressed — do not send" };
  if (blockers.length > 0) return { key: "blocked", label: `Investigate blocker: ${blockers[0]}` };
  if (flags.readyToGenerate || readinessKey === "ready_to_generate") return { key: "generate", label: configured.generate ? "Generate sequence" : "Generate endpoint not configured" };
  if (readinessKey === "pending_review") return { key: "review", label: "Review sequence before launch" };
  if (["not_ready", "no_sequence"].includes(readinessKey)) return { key: "not_ready", label: "Resolve readiness blockers before generation" };
  if (lifecycleKey === "failed") return { key: "investigate_failure", label: "Investigate provider/send failure" };
  if (["submitted", "import_pending"].includes(lifecycleKey)) return { key: "wait_provider", label: "Wait for provider sync/reconciliation" };
  if (flags.launchReady && configured.launch) return { key: "launch", label: "Launch Saleshandy" };
  if (flags.launchReady && !configured.launch) return { key: "configure_launch", label: "Configure guarded launch endpoint" };
  if (sequence) return { key: "monitor", label: "Monitor Saleshandy lifecycle and engagement" };
  return { key: "blocked", label: "Missing outreach source data" };
}

function buildJourney({ readinessKey, lifecycleKey, flags, sequence }) {
  const readinessStatus = ["blocked", "not_ready", "no_sequence"].includes(readinessKey) ? "blocked" : "done";
  const sequenceStatus = flags.readyToGenerate || readinessKey === "ready_to_generate" ? "current" : sequence ? "done" : "pending";
  const reviewStatus = readinessKey === "pending_review" ? "current" : ["approved", "launch_ready"].includes(readinessKey) ? "done" : sequence ? "pending" : "pending";
  const saleshandyStatus = ["planned", "submitted", "import_pending"].includes(lifecycleKey) ? "current" : ["imported", "sent", "opened", "clicked", "replied"].includes(lifecycleKey) ? "done" : flags.launchReady ? "current" : "pending";
  const engagementStatus = ["sent", "opened", "clicked", "replied"].includes(lifecycleKey) ? "current" : "pending";
  return [
    { key: "readiness", label: JOURNEY_STEP_LABELS.readiness, status: readinessStatus },
    { key: "sequence", label: JOURNEY_STEP_LABELS.sequence, status: sequenceStatus },
    { key: "review", label: JOURNEY_STEP_LABELS.review, status: reviewStatus },
    { key: "saleshandy", label: JOURNEY_STEP_LABELS.saleshandy, status: saleshandyStatus },
    { key: "engagement", label: JOURNEY_STEP_LABELS.engagement, status: engagementStatus },
  ];
}

export function deriveOutreachStatus({ leadId, lead, sequence, send, events = [], magnetEvents = [], suppression, launchConfigured = false, actionConfigured = {} } = {}) {
  const blockers = [];
  const warnings = [];
  const launchBlockers = [];
  const readModel = lead?.outreach || lead?.outreach_status || lead?.outreach_read_model || sequence?.read_model || {};
  const email = recipientEmail(sequence, lead);
  const toolUrl = publicToolUrl(sequence, lead);
  const activeSuppression = suppression && suppression.active !== false ? suppression : null;
  if (activeSuppression) blockers.push("active suppression");

  const backendBlockers = readModel?.blockers || lead?.outreach_blockers || sequence?.blockers || sequence?.readiness_blockers;
  if (Array.isArray(backendBlockers)) {
    for (const blocker of backendBlockers) {
      const message = typeof blocker === "string" ? blocker : blocker?.message || blocker?.reason || JSON.stringify(blocker);
      if (isMissingToolUrl(message)) warnings.push(message);
      else blockers.push(message);
    }
  }
  if (sequence && !toolUrl) {
    const message = "missing tool URL — ok for copy review; required only before launch if the Saleshandy template references it";
    warnings.push(message);
    launchBlockers.push("missing tool URL");
  }
  const sendStatus = normalize(send?.status || send?.send_status);
  const providerImportStatus = normalize(send?.provider_import_status || send?.import_status);
  if ([sendStatus, providerImportStatus].some((value) => ["failed", "error", "bounced", "rejected"].includes(value))) blockers.push("provider/send failure");

  const eventsSummary = summarizeEventCounts(events);
  const magnetSummary = summarizeEventCounts(magnetEvents);
  const readinessKey = readinessFrom({ lead, sequence, suppression: activeSuppression, blockers, readModel });
  const lifecycleKey = lifecycleFrom({ sequence, send, eventsSummary, suppression: activeSuppression, readModel });
  const qaEligible = leadId === QA_LEAD_ID && email === QA_RECIPIENT && !activeSuppression && Boolean(sequence) && Boolean(toolUrl);
  const approvedCopyReady = Boolean(sequence) && !activeSuppression && ["approved", "launch_ready"].includes(readinessKey);
  const flags = actionFlags({ lead, sequence, send, readModel, launchEligible: approvedCopyReady || (qaEligible && ["approved", "launch_ready"].includes(readinessKey)) });
  const configured = {
    generate: Boolean(actionConfigured.generate),
    approve: Boolean(actionConfigured.approve),
    reject: Boolean(actionConfigured.reject),
    launch: Boolean(actionConfigured.launch ?? launchConfigured),
  };

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
    warnings,
    launchBlockers,
    readyToGenerate: flags.readyToGenerate || readinessKey === "ready_to_generate",
    canApprove: flags.canApprove || readinessKey === "pending_review",
    canReject: flags.canReject || readinessKey === "pending_review",
    launchEligible: flags.launchReady && !["submitted", "import_pending", "imported", "sent", "opened", "clicked", "replied", "failed", "suppressed"].includes(lifecycleKey),
    actionConfigured: configured,
    journey: buildJourney({ readinessKey, lifecycleKey, flags, sequence }),
    nextAction: nextActionFrom({ readinessKey, lifecycleKey, blockers, sequence, flags, configured }),
  };
}

export function deriveOutreachFilters(outreach) {
  if (!outreach) return [];
  const filters = [];
  const launched = ["planned", "submitted", "import_pending", "imported", "sent", "opened", "clicked", "replied"].includes(outreach.lifecycle?.key);
  if (outreach.readyToGenerate) filters.push("ready_to_generate");
  if (outreach.readiness?.key === "pending_review" && !launched) filters.push("needs_review");
  if (outreach.launchEligible && ["approved", "launch_ready"].includes(outreach.readiness?.key) && !launched) filters.push("ready_to_launch");
  if (launched) filters.push("launched");
  if (["submitted", "import_pending"].includes(outreach.lifecycle?.key)) filters.push("provider_pending");
  if (["opened", "clicked", "replied"].includes(outreach.lifecycle?.key) || Object.keys(outreach.magnetEvents?.counts || {}).length > 0) filters.push("engaged");
  if (["blocked", "failed"].includes(outreach.readiness?.key) || outreach.lifecycle?.key === "failed") filters.push("failed_blocked");
  if (outreach.lifecycle?.key === "suppressed") filters.push("suppressed");
  return filters;
}
