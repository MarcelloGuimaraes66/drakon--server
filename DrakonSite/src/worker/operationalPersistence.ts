type JsonRecord = Record<string, unknown>;

export type OperationalCorrelationIds = {
  externalEventId: string | null;
  cameraSessionId: string | null;
  jobRunId: string | null;
  stepRunId: string | null;
  agentRunId: string | null;
  identityCardId: string | null;
};

type PersistStructuredAgentEventInput = {
  db: D1Database;
  userId: string;
  eventDbId: number;
  eventType: string;
  cameraId: number | null;
  message: string;
  details: JsonRecord;
  correlationIds: OperationalCorrelationIds;
  nowIso: string;
};

type UpsertStructuredAgentErrorLogInput = {
  db: D1Database;
  userId: string;
  clientId: string;
  exeId: string;
  sourceId: string;
  level: string;
  message: string;
  flow: string | null;
  functionName: string | null;
  operation: string | null;
  contextJson: string | null;
  occurredAt: string;
  createdAt: string;
  logId?: string | null;
  cameraSessionId?: string | null;
  jobRunId?: string | null;
  stepRunId?: string | null;
  agentRunId?: string | null;
  errorKind?: string | null;
  httpStatus?: number | null;
  provider?: string | null;
  model?: string | null;
  sourceEventId?: string | null;
};

export type IdentityCardOccurrenceDraft = {
  chatSessionId: number | null;
  commandId?: number | null;
  occurrenceId?: string | null;
  identityCardId?: string | null;
  card: JsonRecord;
  sourceType?: string | null;
  sourceEventId?: string | null;
  jobRunId?: string | null;
  stepRunId?: string | null;
  agentRunId?: string | null;
  cameraId?: number | null;
  cameraName?: string | null;
  portraitDataUrl?: string | null;
  cropUrl?: string | null;
};

type PersistIdentityCardOccurrencesInput = {
  db: D1Database;
  bucket?: R2Bucket | null;
  publicBaseUrl?: string | null;
  userId: string;
  drafts: IdentityCardOccurrenceDraft[];
  nowIso?: string;
};

type EventContext = {
  sourceEventId: string;
  externalEventId: string | null;
  cameraSessionId: string | null;
  jobRunId: string | null;
  stepRunId: string | null;
  agentRunId: string | null;
  identityCardId: string | null;
  cameraAlgorithmId: number | null;
  jobId: number | null;
  jobName: string | null;
  stepId: number | null;
  stepOrder: number | null;
  stepName: string | null;
  stepTimeoutSeconds: number | null;
  stepReason: string | null;
  stepErrorMessage: string | null;
  agentDbId: number | null;
  agentKey: string | null;
  inferenceModel: string | null;
  provider: string | null;
  model: string | null;
  priorityLevel: string | null;
  confidence: number | null;
  matchedTargetId: number | null;
  mediaStorageKey: string | null;
  cameraName: string | null;
  groupId: string | null;
  groupName: string | null;
  cameraIds: number[];
  cameraScopeJson: string | null;
  alertConditionTrue: boolean | null;
  llmAlertCondition: boolean | null;
  decisionSource: string | null;
  inputType: string | null;
  videoPackagingMode: string | null;
  eventTimestampUtc: string | null;
  segmentStartUtc: string | null;
  segmentEndUtc: string | null;
  frameIndex: number | null;
  frameTimestampInSegment: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  answerText: string | null;
  outputPreview: string | null;
  resultJson: string | null;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function readNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readPositiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(numeric) && numeric > 0) {
      return Number(numeric);
    }
  }
  return null;
}

function readFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return Number(numeric);
    }
  }
  return null;
}

function readNonNegativeInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(numeric) && numeric >= 0) {
      return Number(numeric);
    }
  }
  return null;
}

function readBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    }
  }
  return null;
}

function readPositiveIntegerArray(value: unknown, maxItems = 32): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const numeric = typeof entry === "number" ? entry : Number(entry);
    if (!Number.isInteger(numeric) || numeric <= 0) continue;
    if (!out.includes(numeric)) {
      out.push(numeric);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    if (value === undefined) return null;
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && serialized.length > 0
      ? serialized
      : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value: unknown): JsonRecord | null {
  if (typeof value !== "string") return asRecord(value);
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeIsoTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value !== "string") return fallbackIso;
  const trimmed = value.trim();
  if (!trimmed) return fallbackIso;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return fallbackIso;
  return new Date(parsed).toISOString();
}

function readIsoTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) continue;
    return new Date(parsed).toISOString();
  }
  return null;
}

function truncateText(value: string | null, maxLen: number): string | null {
  if (!value) return null;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function sanitizePathSegment(value: unknown, fallback = "na"): string {
  const raw = String(value ?? fallback).trim();
  const normalized = raw || fallback;
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseDataUrl(value: unknown): { contentType: string; base64: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/i.exec(trimmed);
  if (!match) return null;
  return {
    contentType: match[1].trim().toLowerCase() || "application/octet-stream",
    base64: match[2].replace(/\s+/g, ""),
  };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function buildPublicMediaUrl(publicBaseUrl: string | null | undefined, key: string): string {
  const base = String(publicBaseUrl || "/media").replace(/\/+$/, "");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodedKey}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildDeterministicId(prefix: string, ...parts: unknown[]): string {
  const normalized = parts
    .map((part) => (typeof part === "string" ? part : safeJsonStringify(part) || String(part ?? "")))
    .join("\u001f");
  return `${prefix}_${hashString(normalized)}`;
}

function deriveProvider(
  explicitProvider: string | null,
  inferenceModel: string | null
): string | null {
  if (explicitProvider) return explicitProvider;
  const normalizedModel = String(inferenceModel || "").trim().toLowerCase();
  if (!normalizedModel) return null;
  if (normalizedModel === "core") return "zai";
  return "openai";
}

function deriveStepRunId(jobRunId: string | null, stepId: number | null): string | null {
  if (!jobRunId || !stepId) return null;
  return `${jobRunId}:step:${stepId}`;
}

function deriveAgentRunId(
  stepRunId: string | null,
  cameraId: number | null,
  agentDbId: number | null,
  agentKey: string | null,
  groupId: string | null
): string | null {
  if (!stepRunId) return null;
  const agentToken =
    groupId ||
    (agentDbId ? `agent-${agentDbId}` : null) ||
    (agentKey ? sanitizePathSegment(agentKey, "agent") : "agent");
  const cameraToken = cameraId ? `cam-${cameraId}` : "scope";
  return `${stepRunId}:${agentToken}:${cameraToken}`;
}

function deriveCameraAgentRunId(
  cameraSessionId: string | null,
  cameraAlgorithmId: number | null,
  algorithmType: string | null
): string | null {
  if (!cameraSessionId) return null;
  if (cameraAlgorithmId && cameraAlgorithmId > 0) {
    return `${cameraSessionId}:camera-agent:${cameraAlgorithmId}`;
  }
  if (algorithmType) {
    return `${cameraSessionId}:camera-agent:${sanitizePathSegment(algorithmType, "agent")}`;
  }
  return null;
}

function inferEventLogLevel(eventType: string): string {
  const normalized = eventType.trim().toLowerCase();
  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("staled")
  ) {
    return "ERROR";
  }
  if (normalized.includes("skipped") || normalized.includes("blocked")) {
    return "WARN";
  }
  return "INFO";
}

function inferJobStatusFromEvent(eventType: string): string | null {
  switch (eventType) {
    case "job_started":
      return "running";
    case "job_stop_requested":
      return "stopping";
    case "job_stopped":
      return "stopped";
    case "job_completed":
      return "completed";
    case "job_failed":
      return "failed";
    case "job_staled":
      return "staled";
    case "job_start_blocked":
      return "blocked";
    default:
      return eventType.startsWith("job_") ? "running" : null;
  }
}

function inferStepStatusFromEvent(eventType: string): string | null {
  switch (eventType) {
    case "job_step_started":
      return "running";
    case "job_step_completed":
      return "completed";
    case "job_step_skipped":
      return "skipped";
    case "job_step_failed":
      return "failed";
    default:
      if (eventType.startsWith("job_agent_") || eventType === "job_alert_triggered") {
        return "running";
      }
      return null;
  }
}

function inferAgentStatusFromEvent(eventType: string): string | null {
  switch (eventType) {
    case "job_agent_started":
      return "running";
    case "job_agent_completed":
      return "completed";
    case "job_agent_failed":
      return "failed";
    default:
      return null;
  }
}

function inferCameraSessionStatusFromEvent(eventType: string): string | null {
  switch (eventType) {
    case "camera_started":
      return "started";
    case "camera_online":
    case "camera_recovered":
      return "online";
    case "camera_stop_requested":
      return "stopping";
    case "camera_stopped":
      return "stopped";
    case "camera_connection_failed":
      return "offline";
    default:
      return null;
  }
}

export function deriveFallbackEventId(input: {
  eventType: unknown;
  cameraId?: unknown;
  message?: unknown;
  details?: unknown;
}): string {
  return buildDeterministicId(
    "evt",
    readNonEmptyString(input.eventType) || "event",
    readPositiveInteger(input.cameraId) || 0,
    readNonEmptyString(input.message) || "",
    safeJsonStringify(input.details) || ""
  );
}

export function deriveFallbackErrorLogId(input: {
  sourceId?: unknown;
  level?: unknown;
  message?: unknown;
  occurredAt?: unknown;
  contextJson?: unknown;
  clientId?: unknown;
  exeId?: unknown;
}): string {
  return buildDeterministicId(
    "elog",
    readNonEmptyString(input.clientId) || "",
    readNonEmptyString(input.exeId) || "",
    readNonEmptyString(input.sourceId) || "agent",
    readNonEmptyString(input.level) || "ERROR",
    readNonEmptyString(input.occurredAt) || "",
    readNonEmptyString(input.message) || "",
    typeof input.contextJson === "string"
      ? input.contextJson
      : safeJsonStringify(input.contextJson) || ""
  );
}

export function extractOperationalCorrelationIds(input: {
  eventId?: unknown;
  externalEventId?: unknown;
  jobRunId?: unknown;
  stepRunId?: unknown;
  agentRunId?: unknown;
  cameraSessionId?: unknown;
  identityCardId?: unknown;
  details?: unknown;
  fallbackExternalEventId?: string | null;
}): OperationalCorrelationIds {
  const details = asRecord(input.details);
  return {
    externalEventId:
      truncateText(
        readNonEmptyString(
          input.eventId,
          input.externalEventId,
          details?.event_id,
          details?.external_event_id
        ),
        160
      ) || input.fallbackExternalEventId || null,
    cameraSessionId: truncateText(
      readNonEmptyString(
        input.cameraSessionId,
        details?.camera_session_id,
        details?.cameraSessionId
      ),
      160
    ),
    jobRunId: truncateText(
      readNonEmptyString(input.jobRunId, details?.job_run_id, details?.jobRunId),
      160
    ),
    stepRunId: truncateText(
      readNonEmptyString(input.stepRunId, details?.step_run_id, details?.stepRunId),
      160
    ),
    agentRunId: truncateText(
      readNonEmptyString(input.agentRunId, details?.agent_run_id, details?.agentRunId),
      160
    ),
    identityCardId: truncateText(
      readNonEmptyString(
        input.identityCardId,
        details?.identity_card_id,
        details?.identityCardId,
        details?.primary_identity_card_id,
        details?.primaryIdentityCardId,
        details?.card_id
      ),
      160
    ),
  };
}

function extractEventContext(input: PersistStructuredAgentEventInput): EventContext {
  const details = input.details;
  const jobObject = asRecord(details.job);
  const stepObject = asRecord(details.step);
  const failureObject = asRecord(details.failure);
  const resolvedIdentity = asRecord(details.resolved_identity);
  const cameraId = input.cameraId || readPositiveInteger(details.camera_id, details.cameraId);
  const cameraIds = readPositiveIntegerArray(details.camera_ids ?? details.cameraIds);
  if (cameraId && !cameraIds.includes(cameraId)) {
    cameraIds.unshift(cameraId);
  }
  const jobId = readPositiveInteger(details.job_id, details.jobId, jobObject?.id);
  const stepId = readPositiveInteger(details.step_id, details.stepId, stepObject?.id);
  const cameraAlgorithmId = readPositiveInteger(
    details.camera_algorithm_id,
    details.cameraAlgorithmId,
    details.algorithm_id,
    details.algorithmId
  );
  const agentDbId = readPositiveInteger(
    details.agent_id,
    details.agentId,
    details.step_agent_id,
    details.stepAgentId
  );
  const jobRunId = input.correlationIds.jobRunId;
  const stepRunId = input.correlationIds.stepRunId || deriveStepRunId(jobRunId, stepId);
  const agentKey = truncateText(
    readNonEmptyString(
      details.agent_key,
      details.agentKey,
      details.algorithm_type,
      details.algorithmType
    ),
    160
  );
  const groupId = truncateText(
    readNonEmptyString(details.group_id, details.groupId),
    160
  );
  const agentRunId =
    input.correlationIds.agentRunId ||
    deriveAgentRunId(stepRunId, cameraId, agentDbId, agentKey, groupId) ||
    deriveCameraAgentRunId(input.correlationIds.cameraSessionId, cameraAlgorithmId, agentKey);
  const explicitProvider = truncateText(
    readNonEmptyString(details.provider, details.provider_name, details.providerName),
    120
  );
  const inferenceModel = truncateText(
    readNonEmptyString(details.inference_model, details.inferenceModel),
    120
  );
  const provider = deriveProvider(explicitProvider, inferenceModel);
  const model = truncateText(
    readNonEmptyString(
      details.model,
      details.model_name,
      details.modelName,
      details.inference_model,
      details.inferenceModel
    ),
    200
  );
  const answer = readNonEmptyString(details.answer);
  const decisionPreview = readNonEmptyString(
    details.temporal_decision_summary,
    details.temporalDecisionSummary,
    details.summary
  );
  const outputPreview = truncateText(
    answer || decisionPreview || readNonEmptyString(input.message),
    1000
  );
  const cameraScopeJson =
    safeJsonStringify(
      cameraIds.length > 0
        ? { camera_ids: cameraIds }
        : asRecord(details.camera_scope_json) || asRecord(details.camera_scope)
    ) || null;
  return {
    sourceEventId: input.correlationIds.externalEventId || `db_event_${input.eventDbId}`,
    externalEventId: input.correlationIds.externalEventId,
    cameraSessionId: input.correlationIds.cameraSessionId,
    jobRunId,
    stepRunId,
    agentRunId,
    identityCardId: input.correlationIds.identityCardId,
    cameraAlgorithmId,
    jobId,
    jobName: truncateText(
      readNonEmptyString(details.job_name, details.jobName, jobObject?.name),
      200
    ),
    stepId,
    stepOrder: readPositiveInteger(details.step_order, details.stepOrder, stepObject?.step_order),
    stepName: truncateText(
      readNonEmptyString(details.step_name, details.stepName, stepObject?.name),
      200
    ),
    stepTimeoutSeconds: readPositiveInteger(
      details.timeout_seconds,
      details.timeoutSeconds,
      stepObject?.timeout_seconds
    ),
    stepReason: truncateText(
      readNonEmptyString(details.reason, details.status_reason, details.statusReason),
      400
    ),
    stepErrorMessage: truncateText(
      readNonEmptyString(details.error_message, details.errorMessage, failureObject?.reason),
      2000
    ),
    agentDbId,
    agentKey,
    inferenceModel,
    provider,
    model,
    priorityLevel: truncateText(
      readNonEmptyString(details.priority_level, details.priorityLevel),
      64
    ),
    confidence: readFiniteNumber(details.confidence, details.score),
    matchedTargetId: readPositiveInteger(
      details.matched_target_id,
      details.matchedTargetId,
      resolvedIdentity?.target_id,
      details.target_id,
      details.targetId
    ),
    mediaStorageKey: truncateText(
      readNonEmptyString(
        details.media_storage_key,
        details.mediaStorageKey,
        details.video_key,
        details.videoKey,
        details.image_key,
        details.imageKey
      ),
      500
    ),
    cameraName: truncateText(
      readNonEmptyString(details.camera_name, details.cameraName),
      200
    ),
    groupId,
    groupName: truncateText(
      readNonEmptyString(details.group_name, details.groupName),
      200
    ),
    cameraIds,
    cameraScopeJson,
    alertConditionTrue: readBoolean(
      details.final_alert_condition,
      details.finalAlertCondition,
      details.alert_condition_true,
      details.alertConditionTrue,
      details.alert_condition
    ),
    llmAlertCondition: readBoolean(
      details.llm_alert_condition,
      details.llmAlertCondition
    ),
    decisionSource: truncateText(
      readNonEmptyString(
        details.decision_source,
        details.decisionSource,
        details.result_source,
        details.resultSource
      ),
      120
    ),
    inputType: truncateText(
      readNonEmptyString(details.input_type, details.inputType),
      64
    ),
    videoPackagingMode: truncateText(
      readNonEmptyString(details.video_packaging_mode, details.videoPackagingMode),
      80
    ),
    eventTimestampUtc: readIsoTimestamp(
      details.event_timestamp_utc,
      details.eventTimestampUtc,
      details.snapshot_ts_utc_iso,
      details.snapshotTsUtcIso
    ),
    segmentStartUtc: readIsoTimestamp(
      details.segment_start_utc,
      details.segmentStartUtc
    ),
    segmentEndUtc: readIsoTimestamp(
      details.segment_end_utc,
      details.segmentEndUtc
    ),
    frameIndex: readNonNegativeInteger(details.frame_index, details.frameIndex),
    frameTimestampInSegment: truncateText(
      readNonEmptyString(
        details.frame_timestamp_in_segment,
        details.frameTimestampInSegment
      ),
      80
    ),
    promptTokens: readNonNegativeInteger(details.prompt_tokens, details.promptTokens),
    outputTokens: readNonNegativeInteger(details.output_tokens, details.outputTokens),
    totalTokens: readNonNegativeInteger(details.total_tokens, details.totalTokens),
    answerText: truncateText(answer, 4000),
    outputPreview,
    resultJson: safeJsonStringify(details),
  };
}

async function ensureJobRunRow(
  db: D1Database,
  context: EventContext,
  userId: string,
  eventType: string,
  nowIso: string
) {
  if (!context.jobRunId || !context.jobId) return;
  const status = inferJobStatusFromEvent(eventType) || "running";
  await db.prepare(
    `INSERT OR IGNORE INTO job_runs (
       job_run_id,
       job_id,
       user_id,
       job_name,
       status,
       trigger_type,
       trigger_json,
       started_at_utc,
       completed_at_utc,
       stopped_at_utc,
       failed_at_utc,
       last_event_at_utc,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      context.jobRunId,
      context.jobId,
      userId,
      context.jobName,
      status,
      eventType === "job_started" ? nowIso : null,
      eventType === "job_completed" ? nowIso : null,
      eventType === "job_stopped" || eventType === "job_staled" ? nowIso : null,
      eventType === "job_failed" ? nowIso : null,
      nowIso,
      nowIso,
      nowIso
    )
    .run();

  await db.prepare(
    `UPDATE job_runs
     SET job_name = COALESCE(?, job_name),
         status = ?,
         started_at_utc = COALESCE(started_at_utc, ?),
         completed_at_utc = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at_utc END,
         stopped_at_utc = CASE WHEN ? IS NOT NULL THEN ? ELSE stopped_at_utc END,
         failed_at_utc = CASE WHEN ? IS NOT NULL THEN ? ELSE failed_at_utc END,
         last_event_at_utc = ?,
         updated_at = ?
     WHERE job_run_id = ?`
  )
    .bind(
      context.jobName,
      status,
      eventType === "job_started" ? nowIso : null,
      eventType === "job_completed" ? nowIso : null,
      eventType === "job_completed" ? nowIso : null,
      eventType === "job_stopped" || eventType === "job_staled" ? nowIso : null,
      eventType === "job_stopped" || eventType === "job_staled" ? nowIso : null,
      eventType === "job_failed" ? nowIso : null,
      eventType === "job_failed" ? nowIso : null,
      nowIso,
      nowIso,
      context.jobRunId
    )
    .run();
}

async function ensureStepRunRow(
  db: D1Database,
  context: EventContext,
  eventType: string,
  nowIso: string
) {
  if (!context.stepRunId || !context.jobId || !context.stepId) return;
  const status = inferStepStatusFromEvent(eventType) || "pending";
  const cameraId = context.cameraIds[0] || 0;
  const stepAgentId = context.agentDbId || 0;
  await db.prepare(
    `INSERT OR IGNORE INTO job_step_runs (
       job_id,
       step_id,
       camera_id,
       step_agent_id,
       status,
       created_at,
       updated_at,
       step_run_id,
       job_run_id,
       step_order,
       step_name,
       started_at_utc,
       completed_at_utc,
       latest_event_at_utc,
       reason,
       timeout_seconds,
       source_event_id,
       error_message,
       metrics_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      context.jobId,
      context.stepId,
      cameraId,
      stepAgentId,
      status,
      nowIso,
      nowIso,
      context.stepRunId,
      context.jobRunId,
      context.stepOrder,
      context.stepName,
      eventType === "job_step_started" ? nowIso : null,
      eventType === "job_step_completed" || eventType === "job_step_skipped" || eventType === "job_step_failed"
        ? nowIso
        : null,
      nowIso,
      context.stepReason,
      context.stepTimeoutSeconds,
      context.sourceEventId,
      context.stepErrorMessage,
      null
    )
    .run();

  await db.prepare(
    `UPDATE job_step_runs
     SET camera_id = CASE WHEN camera_id = 0 AND ? > 0 THEN ? ELSE camera_id END,
         step_agent_id = CASE WHEN step_agent_id = 0 AND ? > 0 THEN ? ELSE step_agent_id END,
         status = ?,
         job_run_id = COALESCE(?, job_run_id),
         step_order = COALESCE(?, step_order),
         step_name = COALESCE(?, step_name),
         started_at_utc = COALESCE(started_at_utc, ?),
         completed_at_utc = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at_utc END,
         latest_event_at_utc = ?,
         reason = COALESCE(?, reason),
         timeout_seconds = COALESCE(?, timeout_seconds),
         source_event_id = COALESCE(?, source_event_id),
         error_message = COALESCE(?, error_message),
         updated_at = ?
     WHERE step_run_id = ?`
  )
    .bind(
      cameraId,
      cameraId,
      stepAgentId,
      stepAgentId,
      status,
      context.jobRunId,
      context.stepOrder,
      context.stepName,
      eventType === "job_step_started" ? nowIso : null,
      eventType === "job_step_completed" || eventType === "job_step_skipped" || eventType === "job_step_failed"
        ? nowIso
        : null,
      eventType === "job_step_completed" || eventType === "job_step_skipped" || eventType === "job_step_failed"
        ? nowIso
        : null,
      nowIso,
      context.stepReason,
      context.stepTimeoutSeconds,
      context.sourceEventId,
      context.stepErrorMessage,
      nowIso,
      context.stepRunId
    )
    .run();
}

async function ensureAgentRunRow(
  db: D1Database,
  context: EventContext,
  userId: string,
  eventType: string,
  nowIso: string
) {
  if (!context.agentRunId || !context.jobRunId || !context.jobId || !context.stepId) return;
  const status = inferAgentStatusFromEvent(eventType) || "pending";
  const resultJson = context.resultJson;
  await db.prepare(
    `INSERT OR IGNORE INTO job_step_agent_runs (
       agent_run_id,
       job_run_id,
       step_run_id,
       user_id,
       job_id,
       step_id,
       step_order,
       step_name,
       camera_id,
       camera_name,
       camera_scope_json,
       step_agent_id,
       agent_key,
       inference_model,
       provider,
       model,
       status,
       alert_condition_true,
       confidence,
       output_preview,
       result_json,
       error_message,
       started_at_utc,
       completed_at_utc,
       last_event_at_utc,
       source_event_id,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      context.agentRunId,
      context.jobRunId,
      context.stepRunId,
      userId,
      context.jobId,
      context.stepId,
      context.stepOrder,
      context.stepName,
      context.cameraIds[0] || null,
      context.cameraName,
      context.cameraScopeJson,
      context.agentDbId,
      context.agentKey,
      context.inferenceModel,
      context.provider,
      context.model,
      status,
      context.alertConditionTrue === null ? null : (context.alertConditionTrue ? 1 : 0),
      context.confidence,
      context.outputPreview,
      resultJson,
      context.stepErrorMessage,
      eventType === "job_agent_started" ? nowIso : null,
      eventType === "job_agent_completed" || eventType === "job_agent_failed" ? nowIso : null,
      nowIso,
      context.sourceEventId,
      nowIso,
      nowIso
    )
    .run();

  const completedAt =
    eventType === "job_agent_completed" || eventType === "job_agent_failed"
      ? nowIso
      : null;
  await db.prepare(
    `UPDATE job_step_agent_runs
     SET step_run_id = COALESCE(?, step_run_id),
         step_order = COALESCE(?, step_order),
         step_name = COALESCE(?, step_name),
         camera_id = COALESCE(?, camera_id),
         camera_name = COALESCE(?, camera_name),
         camera_scope_json = COALESCE(?, camera_scope_json),
         step_agent_id = COALESCE(?, step_agent_id),
         agent_key = COALESCE(?, agent_key),
         inference_model = COALESCE(?, inference_model),
         provider = COALESCE(?, provider),
         model = COALESCE(?, model),
         status = CASE
           WHEN ? = 'pending' THEN status
           WHEN status = 'completed' AND ? != 'failed' THEN status
           ELSE ?
         END,
         alert_condition_true = COALESCE(?, alert_condition_true),
         confidence = COALESCE(?, confidence),
         output_preview = COALESCE(?, output_preview),
         result_json = COALESCE(?, result_json),
         error_message = COALESCE(?, error_message),
         started_at_utc = COALESCE(started_at_utc, ?),
         completed_at_utc = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at_utc END,
         last_event_at_utc = ?,
         source_event_id = COALESCE(?, source_event_id),
         updated_at = ?
     WHERE agent_run_id = ?`
  )
    .bind(
      context.stepRunId,
      context.stepOrder,
      context.stepName,
      context.cameraIds[0] || null,
      context.cameraName,
      context.cameraScopeJson,
      context.agentDbId,
      context.agentKey,
      context.inferenceModel,
      context.provider,
      context.model,
      status,
      status,
      status,
      context.alertConditionTrue === null ? null : (context.alertConditionTrue ? 1 : 0),
      context.confidence,
      context.outputPreview,
      resultJson,
      context.stepErrorMessage,
      eventType === "job_agent_started" ? nowIso : null,
      completedAt,
      completedAt,
      nowIso,
      context.sourceEventId,
      nowIso,
      context.agentRunId
    )
    .run();
}

async function insertStepRunLog(
  db: D1Database,
  context: EventContext,
  eventType: string,
  message: string,
  nowIso: string
) {
  if (!context.stepRunId && !context.jobRunId) return;
  const logUid = buildDeterministicId(
    "slog",
    context.sourceEventId,
    context.stepRunId || "",
    eventType
  );
  await db.prepare(
    `INSERT OR IGNORE INTO job_step_run_logs (
       run_id,
       log_level,
       message,
       created_at,
       log_uid,
       job_run_id,
       step_run_id,
       agent_run_id,
       camera_id,
       camera_name,
       log_type,
       source_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      0,
      inferEventLogLevel(eventType),
      truncateText(message || eventType, 4000),
      nowIso,
      logUid,
      context.jobRunId,
      context.stepRunId,
      context.agentRunId,
      context.cameraIds[0] || null,
      context.cameraName,
      eventType,
      context.sourceEventId
    )
    .run();
}

async function insertStepRunResult(
  db: D1Database,
  context: EventContext,
  eventType: string,
  nowIso: string
) {
  if (!context.stepRunId || !context.jobRunId) return;
  if (
    eventType !== "job_agent_completed" &&
    eventType !== "job_agent_failed" &&
    eventType !== "job_alert_triggered"
  ) {
    return;
  }
  const resultUid = buildDeterministicId(
    "sres",
    context.sourceEventId,
    eventType,
    context.agentRunId || ""
  );
  await db.prepare(
    `INSERT OR IGNORE INTO job_step_run_results (
       run_id,
       result_data,
       output_data,
       created_at,
       updated_at,
       result_uid,
       job_run_id,
       step_run_id,
       agent_run_id,
       camera_id,
       camera_name,
       alert_condition_true,
       confidence,
       provider,
       model,
       matched_target_id,
       media_storage_key,
       source_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      0,
      context.resultJson,
      context.outputPreview,
      nowIso,
      nowIso,
      resultUid,
      context.jobRunId,
      context.stepRunId,
      context.agentRunId,
      context.cameraIds[0] || null,
      context.cameraName,
      context.alertConditionTrue === null ? null : (context.alertConditionTrue ? 1 : 0),
      context.confidence,
      context.provider,
      context.model,
      context.matchedTargetId,
      context.mediaStorageKey,
      context.sourceEventId
    )
    .run();
}

async function insertJobRunAlert(
  db: D1Database,
  context: EventContext,
  message: string,
  channel: string | null,
  nowIso: string
) {
  if (!context.jobRunId || !context.jobId || !context.stepId) return;
  const alertUid = buildDeterministicId(
    "jal",
    context.sourceEventId,
    context.jobRunId,
    context.stepRunId || "",
    context.agentRunId || ""
  );
  await db.prepare(
    `INSERT OR IGNORE INTO job_run_alerts (
       run_id,
       result_id,
       alert_rule_id,
       message,
       channel,
       sent_at,
       created_at,
       alert_uid,
       job_run_id,
       step_run_id,
       agent_run_id,
       job_id,
       step_id,
       camera_id,
       camera_name,
       priority_level,
       confidence,
       provider,
       model,
       matched_target_id,
       media_storage_key,
       source_event_id,
       alert_condition_true,
       details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      0,
      null,
      readPositiveInteger(context.groupId) || 0,
      truncateText(message || "Alert triggered", 4000),
      truncateText(channel || "event", 120),
      nowIso,
      nowIso,
      alertUid,
      context.jobRunId,
      context.stepRunId,
      context.agentRunId,
      context.jobId,
      context.stepId,
      context.cameraIds[0] || null,
      context.cameraName,
      context.priorityLevel,
      context.confidence,
      context.provider,
      context.model,
      context.matchedTargetId,
      context.mediaStorageKey,
      context.sourceEventId,
      context.alertConditionTrue === null ? null : (context.alertConditionTrue ? 1 : 0),
      context.resultJson
    )
    .run();
}

async function ensureCameraAgentRunRow(
  db: D1Database,
  context: EventContext,
  userId: string,
  eventType: string,
  nowIso: string
) {
  if (eventType !== "camera_agent_result") return;
  const cameraId = context.cameraIds[0] || null;
  if (!cameraId) return;
  const cameraSessionId =
    context.cameraSessionId || (await resolveLatestOpenCameraSessionId(db, userId, cameraId));
  const agentRunId =
    context.agentRunId ||
    deriveCameraAgentRunId(cameraSessionId, context.cameraAlgorithmId, context.agentKey);
  if (!cameraSessionId || !agentRunId) return;
  const eventAt = context.eventTimestampUtc || nowIso;

  await db.prepare(
    `INSERT OR IGNORE INTO camera_agent_runs (
       agent_run_id,
       camera_session_id,
       user_id,
       camera_id,
       camera_name,
       camera_algorithm_id,
       algorithm_type,
       input_type,
       video_packaging_mode,
       inference_model,
       provider,
       model,
       status,
       last_confidence,
       last_output_preview,
       started_at_utc,
       last_evaluated_at_utc,
       source_event_id,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      agentRunId,
      cameraSessionId,
      userId,
      cameraId,
      context.cameraName,
      context.cameraAlgorithmId,
      context.agentKey,
      context.inputType,
      context.videoPackagingMode,
      context.inferenceModel,
      context.provider,
      context.model,
      "running",
      context.confidence,
      context.outputPreview,
      eventAt,
      eventAt,
      context.sourceEventId,
      nowIso,
      nowIso
    )
    .run();

  await db.prepare(
    `UPDATE camera_agent_runs
     SET camera_session_id = COALESCE(?, camera_session_id),
         camera_name = COALESCE(?, camera_name),
         camera_algorithm_id = COALESCE(?, camera_algorithm_id),
         algorithm_type = COALESCE(?, algorithm_type),
         input_type = COALESCE(?, input_type),
         video_packaging_mode = COALESCE(?, video_packaging_mode),
         inference_model = COALESCE(?, inference_model),
         provider = COALESCE(?, provider),
         model = COALESCE(?, model),
         status = CASE WHEN status = 'stopped' THEN status ELSE 'running' END,
         last_confidence = COALESCE(?, last_confidence),
         last_output_preview = COALESCE(?, last_output_preview),
         started_at_utc = COALESCE(started_at_utc, ?),
         last_evaluated_at_utc = ?,
         source_event_id = COALESCE(?, source_event_id),
         updated_at = ?
     WHERE agent_run_id = ?`
  )
    .bind(
      cameraSessionId,
      context.cameraName,
      context.cameraAlgorithmId,
      context.agentKey,
      context.inputType,
      context.videoPackagingMode,
      context.inferenceModel,
      context.provider,
      context.model,
      context.confidence,
      context.outputPreview,
      eventAt,
      eventAt,
      context.sourceEventId,
      nowIso,
      agentRunId
    )
    .run();
}

async function insertCameraAgentRunResult(
  db: D1Database,
  context: EventContext,
  userId: string,
  eventType: string,
  nowIso: string
) {
  if (eventType !== "camera_agent_result") return;
  const cameraId = context.cameraIds[0] || null;
  if (!cameraId) return;
  const cameraSessionId =
    context.cameraSessionId || (await resolveLatestOpenCameraSessionId(db, userId, cameraId));
  const agentRunId =
    context.agentRunId ||
    deriveCameraAgentRunId(cameraSessionId, context.cameraAlgorithmId, context.agentKey);
  if (!cameraSessionId || !agentRunId) return;
  const resultUid = buildDeterministicId(
    "cares",
    context.sourceEventId,
    eventType,
    agentRunId
  );

  await db.prepare(
    `INSERT OR IGNORE INTO camera_agent_run_results (
       result_uid,
       agent_run_id,
       camera_session_id,
       user_id,
       camera_id,
       camera_name,
       camera_algorithm_id,
       algorithm_type,
       input_type,
       video_packaging_mode,
       inference_model,
       provider,
       model,
       answer_text,
       output_preview,
       result_json,
       llm_alert_condition,
       final_alert_condition,
       decision_source,
       confidence,
       matched_target_id,
       media_storage_key,
       prompt_tokens,
       output_tokens,
       total_tokens,
       event_timestamp_utc,
       segment_start_utc,
       segment_end_utc,
       frame_index,
       frame_timestamp_in_segment,
       source_event_id,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      resultUid,
      agentRunId,
      cameraSessionId,
      userId,
      cameraId,
      context.cameraName,
      context.cameraAlgorithmId,
      context.agentKey,
      context.inputType,
      context.videoPackagingMode,
      context.inferenceModel,
      context.provider,
      context.model,
      context.answerText || context.outputPreview,
      context.outputPreview,
      context.resultJson,
      context.llmAlertCondition === null ? null : (context.llmAlertCondition ? 1 : 0),
      context.alertConditionTrue === null ? null : (context.alertConditionTrue ? 1 : 0),
      context.decisionSource,
      context.confidence,
      context.matchedTargetId,
      context.mediaStorageKey,
      context.promptTokens,
      context.outputTokens,
      context.totalTokens,
      context.eventTimestampUtc,
      context.segmentStartUtc,
      context.segmentEndUtc,
      context.frameIndex,
      context.frameTimestampInSegment,
      context.sourceEventId,
      nowIso,
      nowIso
    )
    .run();
}

async function finalizeCameraAgentRunsForSession(
  db: D1Database,
  context: EventContext,
  userId: string,
  eventType: string,
  nowIso: string
) {
  if (eventType !== "camera_stopped") return;
  const cameraId = context.cameraIds[0] || null;
  const cameraSessionId =
    context.cameraSessionId || (cameraId ? await resolveLatestOpenCameraSessionId(db, userId, cameraId) : null);
  if (!cameraSessionId && !cameraId) return;

  if (cameraSessionId) {
    await db.prepare(
      `UPDATE camera_agent_runs
       SET status = 'stopped',
           completed_at_utc = COALESCE(completed_at_utc, ?),
           updated_at = ?
       WHERE user_id = ?
         AND camera_session_id = ?
         AND completed_at_utc IS NULL`
    )
      .bind(nowIso, nowIso, userId, cameraSessionId)
      .run();
    return;
  }

  await db.prepare(
    `UPDATE camera_agent_runs
     SET status = 'stopped',
         completed_at_utc = COALESCE(completed_at_utc, ?),
         updated_at = ?
     WHERE user_id = ?
       AND camera_id = ?
       AND completed_at_utc IS NULL`
  )
    .bind(nowIso, nowIso, userId, cameraId)
    .run();
}

async function resolveLatestOpenCameraSessionId(
  db: D1Database,
  userId: string,
  cameraId: number
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT camera_session_id
     FROM camera_runtime_sessions
     WHERE user_id = ?
       AND camera_id = ?
       AND status != 'stopped'
     ORDER BY COALESCE(last_event_at, updated_at, created_at) DESC
     LIMIT 1`
  )
    .bind(userId, cameraId)
    .first();
  return readNonEmptyString((row as any)?.camera_session_id);
}

async function ensureCameraRuntimeSession(
  db: D1Database,
  userId: string,
  context: EventContext,
  eventType: string,
  details: JsonRecord,
  nowIso: string
) {
  const cameraId = context.cameraIds[0] || null;
  if (!cameraId) return;
  const status = inferCameraSessionStatusFromEvent(eventType);
  if (!status) return;

  const explicitSessionId = context.cameraSessionId;
  const cameraSessionId =
    explicitSessionId ||
    await resolveLatestOpenCameraSessionId(db, userId, cameraId) ||
    buildDeterministicId("camsess", userId, cameraId, eventType, nowIso);

  const startOrigin = truncateText(
    readNonEmptyString(details.start_origin, details.startOrigin),
    64
  );
  const agentsSnapshotJson =
    safeJsonStringify(details.enabled_algorithms ?? details.enabledAlgorithms) || null;
  const payloadJson = safeJsonStringify(details);

  await db.prepare(
    `INSERT OR IGNORE INTO camera_runtime_sessions (
       camera_session_id,
       user_id,
       camera_id,
       camera_name,
       start_origin,
       status,
       start_requested_at,
       started_at,
       online_at,
       stop_requested_at,
       stopped_at,
       last_event_at,
       agents_snapshot_json,
       start_payload_json,
       stop_payload_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      cameraSessionId,
      userId,
      cameraId,
      context.cameraName,
      startOrigin,
      status,
      eventType === "camera_started" ? nowIso : null,
      eventType === "camera_started" ? nowIso : null,
      eventType === "camera_online" || eventType === "camera_recovered" ? nowIso : null,
      eventType === "camera_stop_requested" ? nowIso : null,
      eventType === "camera_stopped" ? nowIso : null,
      nowIso,
      agentsSnapshotJson,
      eventType === "camera_started" ? payloadJson : null,
      eventType === "camera_stop_requested" || eventType === "camera_stopped" ? payloadJson : null,
      nowIso,
      nowIso
    )
    .run();

  await db.prepare(
    `UPDATE camera_runtime_sessions
     SET camera_name = COALESCE(?, camera_name),
         start_origin = COALESCE(?, start_origin),
         status = ?,
         start_requested_at = COALESCE(start_requested_at, ?),
         started_at = COALESCE(started_at, ?),
         online_at = CASE WHEN ? IS NOT NULL THEN COALESCE(online_at, ?) ELSE online_at END,
         stop_requested_at = CASE WHEN ? IS NOT NULL THEN COALESCE(stop_requested_at, ?) ELSE stop_requested_at END,
         stopped_at = CASE WHEN ? IS NOT NULL THEN ? ELSE stopped_at END,
         last_event_at = ?,
         recovered_count = CASE
           WHEN ? = 'camera_recovered' THEN recovered_count + 1
           ELSE recovered_count
         END,
         agents_snapshot_json = COALESCE(?, agents_snapshot_json),
         start_payload_json = CASE WHEN ? = 'camera_started' THEN COALESCE(start_payload_json, ?) ELSE start_payload_json END,
         stop_payload_json = CASE
           WHEN ? = 'camera_stop_requested' OR ? = 'camera_stopped' THEN COALESCE(?, stop_payload_json)
           ELSE stop_payload_json
         END,
         updated_at = ?
     WHERE camera_session_id = ?`
  )
    .bind(
      context.cameraName,
      startOrigin,
      status,
      eventType === "camera_started" ? nowIso : null,
      eventType === "camera_started" ? nowIso : null,
      eventType === "camera_online" || eventType === "camera_recovered" ? nowIso : null,
      eventType === "camera_online" || eventType === "camera_recovered" ? nowIso : null,
      eventType === "camera_stop_requested" ? nowIso : null,
      eventType === "camera_stop_requested" ? nowIso : null,
      eventType === "camera_stopped" ? nowIso : null,
      eventType === "camera_stopped" ? nowIso : null,
      nowIso,
      eventType,
      agentsSnapshotJson,
      eventType,
      payloadJson,
      eventType,
      eventType,
      payloadJson,
      nowIso,
      cameraSessionId
    )
    .run();

  context.cameraSessionId = cameraSessionId;
}

async function upsertConnectivityIncident(
  db: D1Database,
  userId: string,
  context: EventContext,
  eventType: string,
  details: JsonRecord,
  nowIso: string
) {
  const cameraId = context.cameraIds[0] || null;
  if (!cameraId) return;
  if (
    eventType !== "camera_connection_failed" &&
    eventType !== "camera_online" &&
    eventType !== "camera_recovered" &&
    eventType !== "camera_stopped"
  ) {
    return;
  }

  const failurePhase = truncateText(
    readNonEmptyString(details.failure_phase, asRecord(details.failure)?.phase),
    64
  );
  const failureReason = truncateText(
    readNonEmptyString(
      details.error,
      asRecord(details.failure)?.reason,
      asRecord(details.failure)?.message,
      details.message
    ),
    1000
  );

  if (eventType === "camera_connection_failed") {
    const existingOpen = await db.prepare(
      `SELECT incident_id
       FROM connectivity_incidents
       WHERE user_id = ?
         AND camera_id = ?
         AND status = 'open'
         AND (? IS NULL OR camera_session_id = ?)
       ORDER BY COALESCE(recovered_at, updated_at, created_at) DESC
       LIMIT 1`
    )
      .bind(userId, cameraId, context.cameraSessionId, context.cameraSessionId)
      .first();

    const incidentId =
      readNonEmptyString((existingOpen as any)?.incident_id) ||
      buildDeterministicId("incident", userId, cameraId, context.cameraSessionId || "", context.sourceEventId);

    await db.prepare(
      `INSERT OR IGNORE INTO connectivity_incidents (
         incident_id,
         camera_session_id,
         user_id,
         camera_id,
         camera_name,
         failure_event_id,
         failure_phase,
         failure_reason,
         started_at,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
      .bind(
        incidentId,
        context.cameraSessionId,
        userId,
        cameraId,
        context.cameraName,
        context.sourceEventId,
        failurePhase,
        failureReason,
        nowIso,
        nowIso,
        nowIso
      )
      .run();

    await db.prepare(
      `UPDATE connectivity_incidents
       SET camera_session_id = COALESCE(?, camera_session_id),
           camera_name = COALESCE(?, camera_name),
           failure_event_id = COALESCE(?, failure_event_id),
           failure_phase = COALESCE(?, failure_phase),
           failure_reason = COALESCE(?, failure_reason),
           updated_at = ?
       WHERE incident_id = ?`
    )
      .bind(
        context.cameraSessionId,
        context.cameraName,
        context.sourceEventId,
        failurePhase,
        failureReason,
        nowIso,
        incidentId
      )
      .run();

    return;
  }

  const existingOpen = await db.prepare(
    `SELECT incident_id, started_at
     FROM connectivity_incidents
     WHERE user_id = ?
       AND camera_id = ?
       AND status = 'open'
       AND (? IS NULL OR camera_session_id = ?)
     ORDER BY started_at DESC
     LIMIT 1`
  )
    .bind(userId, cameraId, context.cameraSessionId, context.cameraSessionId)
    .first();
  const incidentId = readNonEmptyString((existingOpen as any)?.incident_id);
  if (!incidentId) return;

  const startedAt = normalizeIsoTimestamp((existingOpen as any)?.started_at, nowIso);
  const durationSeconds = Math.max(0, (Date.parse(nowIso) - Date.parse(startedAt)) / 1000);
  await db.prepare(
    `UPDATE connectivity_incidents
     SET recovered_event_id = ?,
         recovered_at = ?,
         duration_seconds = ?,
         status = 'closed',
         updated_at = ?
     WHERE incident_id = ?`
  )
    .bind(context.sourceEventId, nowIso, durationSeconds, nowIso, incidentId)
    .run();
}

export async function persistStructuredAgentEvent(
  input: PersistStructuredAgentEventInput
): Promise<void> {
  const context = extractEventContext(input);
  await ensureJobRunRow(input.db, context, input.userId, input.eventType, input.nowIso);
  await ensureStepRunRow(input.db, context, input.eventType, input.nowIso);
  await ensureAgentRunRow(input.db, context, input.userId, input.eventType, input.nowIso);
  await ensureCameraAgentRunRow(input.db, context, input.userId, input.eventType, input.nowIso);
  await insertStepRunLog(input.db, context, input.eventType, input.message, input.nowIso);
  await insertStepRunResult(input.db, context, input.eventType, input.nowIso);
  await insertCameraAgentRunResult(input.db, context, input.userId, input.eventType, input.nowIso);

  if (input.eventType === "job_alert_triggered") {
    await insertJobRunAlert(
      input.db,
      context,
      input.message,
      readNonEmptyString(input.details.channel),
      input.nowIso
    );
  }

  await ensureCameraRuntimeSession(
    input.db,
    input.userId,
    context,
    input.eventType,
    input.details,
    input.nowIso
  );
  await upsertConnectivityIncident(
    input.db,
    input.userId,
    context,
    input.eventType,
    input.details,
    input.nowIso
  );
  await finalizeCameraAgentRunsForSession(
    input.db,
    context,
    input.userId,
    input.eventType,
    input.nowIso
  );
}

export async function upsertStructuredAgentErrorLog(
  input: UpsertStructuredAgentErrorLogInput
): Promise<void> {
  const parsedContext = parseJsonObject(input.contextJson);
  const correlationIds = extractOperationalCorrelationIds({
    jobRunId: input.jobRunId,
    stepRunId: input.stepRunId,
    agentRunId: input.agentRunId,
    cameraSessionId: input.cameraSessionId,
    details: parsedContext,
  });
  const httpStatus =
    input.httpStatus ??
    readPositiveInteger(
      parsedContext?.http_status,
      parsedContext?.httpStatus,
      parsedContext?.status_code,
      parsedContext?.statusCode
    );
  const provider = truncateText(
    input.provider ||
      readNonEmptyString(parsedContext?.provider, parsedContext?.provider_name, parsedContext?.source),
    120
  );
  const model = truncateText(
    input.model ||
      readNonEmptyString(parsedContext?.model, parsedContext?.model_name, parsedContext?.modelName),
    200
  );
  const errorKind = truncateText(
    input.errorKind ||
      readNonEmptyString(
        parsedContext?.error_kind,
        parsedContext?.errorKind,
        parsedContext?.stage,
        input.flow,
        input.operation
      ) ||
      "runtime_error",
    120
  );
  const sourceEventId = truncateText(
    input.sourceEventId ||
      readNonEmptyString(parsedContext?.source_event_id, parsedContext?.sourceEventId),
    160
  );
  const cameraId = readPositiveInteger(parsedContext?.camera_id, parsedContext?.cameraId);
  const cameraName = truncateText(
    readNonEmptyString(parsedContext?.camera_name, parsedContext?.cameraName),
    200
  );

  await input.db.prepare(
    `INSERT INTO agent_error_logs (
       user_id,
       client_id,
       exe_id,
       source_id,
       level,
       message,
       flow,
       function_name,
       operation,
       context_json,
       occurred_at,
       created_at,
       log_id,
       camera_session_id,
       job_run_id,
       step_run_id,
       agent_run_id,
       error_kind,
       http_status,
       provider,
       model,
       source_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(log_id) DO UPDATE SET
       level = excluded.level,
       message = excluded.message,
       flow = excluded.flow,
       function_name = excluded.function_name,
       operation = excluded.operation,
       context_json = excluded.context_json,
       occurred_at = excluded.occurred_at,
       camera_session_id = COALESCE(excluded.camera_session_id, agent_error_logs.camera_session_id),
       job_run_id = COALESCE(excluded.job_run_id, agent_error_logs.job_run_id),
       step_run_id = COALESCE(excluded.step_run_id, agent_error_logs.step_run_id),
       agent_run_id = COALESCE(excluded.agent_run_id, agent_error_logs.agent_run_id),
       error_kind = COALESCE(excluded.error_kind, agent_error_logs.error_kind),
       http_status = COALESCE(excluded.http_status, agent_error_logs.http_status),
       provider = COALESCE(excluded.provider, agent_error_logs.provider),
       model = COALESCE(excluded.model, agent_error_logs.model),
       source_event_id = COALESCE(excluded.source_event_id, agent_error_logs.source_event_id)`
  )
    .bind(
      input.userId,
      input.clientId,
      input.exeId,
      input.sourceId,
      input.level,
      truncateText(input.message, 4000),
      input.flow,
      input.functionName,
      input.operation,
      input.contextJson,
      input.occurredAt,
      input.createdAt,
      input.logId,
      correlationIds.cameraSessionId,
      correlationIds.jobRunId,
      correlationIds.stepRunId,
      correlationIds.agentRunId,
      errorKind,
      httpStatus,
      provider,
      model,
      sourceEventId
    )
    .run();

  if (correlationIds.stepRunId || correlationIds.jobRunId) {
    const logUid = buildDeterministicId("elogstep", input.logId, input.occurredAt, input.message);
    await input.db.prepare(
      `INSERT OR IGNORE INTO job_step_run_logs (
         run_id,
         log_level,
         message,
         created_at,
         log_uid,
         job_run_id,
         step_run_id,
         agent_run_id,
         camera_id,
         camera_name,
         log_type,
         source_event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        0,
        input.level,
        truncateText(input.message, 4000),
        input.occurredAt,
        logUid,
        correlationIds.jobRunId,
        correlationIds.stepRunId,
        correlationIds.agentRunId,
        cameraId,
        cameraName,
        errorKind || "error",
        sourceEventId
      )
      .run();
  }
}

export async function persistIdentityCardOccurrences(
  input: PersistIdentityCardOccurrencesInput
): Promise<void> {
  const nowIso = input.nowIso || new Date().toISOString();
  for (const [index, draft] of input.drafts.entries()) {
    const occurrenceScopeId =
      truncateText(
        draft.chatSessionId !== null && draft.chatSessionId !== undefined
          ? String(draft.chatSessionId)
          : readNonEmptyString(
              draft.sourceEventId,
              draft.agentRunId,
              draft.stepRunId,
              draft.jobRunId
            ),
        160
      ) || "operational";
    const card = draft.card;
    const primaryPortrait = asRecord(card.primary_portrait);
    const contextPortrait = asRecord(card.context_portrait);
    const resolvedIdentity = asRecord(card.resolved_identity);
    const lastSeen = asRecord(card.last_seen);
    const identityCardId =
      truncateText(
        draft.identityCardId ||
          readNonEmptyString(card.card_id, card.entity_id),
        160
      ) || buildDeterministicId("identity", draft.chatSessionId, index, nowIso);
    const occurrenceId =
      truncateText(draft.occurrenceId || null, 160) ||
      buildDeterministicId(
        "icard",
        occurrenceScopeId,
        draft.commandId || 0,
        identityCardId,
        index
      );
    let cropStorageKey: string | null = null;
    let cropUrl: string | null = truncateText(
      draft.cropUrl ||
        readNonEmptyString(
          primaryPortrait?.image_url,
          contextPortrait?.image_url,
          card.portrait_url
        ),
      800
    );

    const parsedPortrait = parseDataUrl(draft.portraitDataUrl);
    if (parsedPortrait && input.bucket) {
      const bytes = base64ToUint8Array(parsedPortrait.base64);
      if (bytes.byteLength > 0) {
        const extension = parsedPortrait.contentType.includes("png") ? ".png" : ".jpg";
        cropStorageKey =
          `identity-cards/${sanitizePathSegment(input.userId, "user")}` +
          `/sessions/${sanitizePathSegment(occurrenceScopeId, "session")}` +
          `/cards/${sanitizePathSegment(identityCardId, "card")}` +
          `/${Date.now()}_${sanitizePathSegment(index, "0")}${extension}`;
        await input.bucket.put(cropStorageKey, bytes, {
          httpMetadata: { contentType: parsedPortrait.contentType },
        });
        cropUrl = buildPublicMediaUrl(input.publicBaseUrl, cropStorageKey);
      }
    }

    const cameraId =
      draft.cameraId ||
      readPositiveInteger(primaryPortrait?.camera_id, lastSeen?.camera_id);
    const cameraName = truncateText(
      draft.cameraName ||
        readNonEmptyString(primaryPortrait?.camera_name, lastSeen?.camera_name),
      200
    );
    const displayName = truncateText(
      readNonEmptyString(card.display_name, card.known_name, resolvedIdentity?.target_name),
      200
    );
    const confidence = readFiniteNumber(card.confidence, resolvedIdentity?.confidence);
    const portraitKind = truncateText(
      readNonEmptyString(
        primaryPortrait?.portrait_kind,
        contextPortrait?.portrait_kind,
        card.portrait_kind
      ),
      120
    );
    const resolvedTargetId = readPositiveInteger(
      resolvedIdentity?.target_id,
      card.target_id
    );

    await input.db.prepare(
      `INSERT INTO identity_card_occurrences (
         occurrence_id,
         identity_card_id,
         user_id,
         chat_session_id,
         camera_id,
         camera_name,
         source_type,
         source_event_id,
         job_run_id,
         step_run_id,
         agent_run_id,
         resolved_target_id,
         display_name,
         confidence,
         portrait_kind,
         crop_storage_key,
         crop_url,
         resolved_identity_json,
         card_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(occurrence_id) DO UPDATE SET
         camera_id = COALESCE(excluded.camera_id, identity_card_occurrences.camera_id),
         camera_name = COALESCE(excluded.camera_name, identity_card_occurrences.camera_name),
         source_type = excluded.source_type,
         source_event_id = COALESCE(excluded.source_event_id, identity_card_occurrences.source_event_id),
         job_run_id = COALESCE(excluded.job_run_id, identity_card_occurrences.job_run_id),
         step_run_id = COALESCE(excluded.step_run_id, identity_card_occurrences.step_run_id),
         agent_run_id = COALESCE(excluded.agent_run_id, identity_card_occurrences.agent_run_id),
         resolved_target_id = COALESCE(excluded.resolved_target_id, identity_card_occurrences.resolved_target_id),
         display_name = COALESCE(excluded.display_name, identity_card_occurrences.display_name),
         confidence = COALESCE(excluded.confidence, identity_card_occurrences.confidence),
         portrait_kind = COALESCE(excluded.portrait_kind, identity_card_occurrences.portrait_kind),
         crop_storage_key = COALESCE(excluded.crop_storage_key, identity_card_occurrences.crop_storage_key),
         crop_url = COALESCE(excluded.crop_url, identity_card_occurrences.crop_url),
         resolved_identity_json = COALESCE(excluded.resolved_identity_json, identity_card_occurrences.resolved_identity_json),
         card_json = excluded.card_json,
         updated_at = excluded.updated_at`
    )
      .bind(
        occurrenceId,
        identityCardId,
        input.userId,
        draft.chatSessionId ?? null,
        cameraId,
        cameraName,
        truncateText(draft.sourceType || "chat_response", 64),
        truncateText(draft.sourceEventId || null, 160),
        truncateText(draft.jobRunId || null, 160),
        truncateText(draft.stepRunId || null, 160),
        truncateText(draft.agentRunId || null, 160),
        resolvedTargetId,
        displayName,
        confidence,
        portraitKind,
        cropStorageKey,
        cropUrl,
        safeJsonStringify(resolvedIdentity),
        safeJsonStringify(card) || "{}",
        nowIso,
        nowIso
      )
      .run();
  }
}
