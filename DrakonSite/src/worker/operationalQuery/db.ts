import { composeOperationalExecutionResult, executeOperationalPlan } from "./executor";
import { normalizePlannerText } from "./grounding";
import type {
  OperationalExecutionResult,
  OperationalExecutionSource,
  OperationalPlannerContext,
  OperationalResolvedEntity,
  ResolvedOperationalPlan,
} from "./schema";

type JsonRecord = Record<string, unknown>;

type QueryWindow = {
  startAt: string;
  endAt: string;
};

type QueryRunContext = {
  jobIds: number[];
  stepIds: number[];
  cameraIds: number[];
  stepAgentIds: number[];
  cameraAlgorithmIds: number[];
  jobRunIds: string[];
  stepRunIds: string[];
  agentRunIds: string[];
};

function normalizeQueryForMatch(value: unknown, maxLength = 2400): string {
  return normalizePlannerText(value, maxLength)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function asPositiveNumberList(values: Array<number | string>): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "number" ? value : Number(value)))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function asNonEmptyStringList(values: Array<number | string>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizePlannerText(value, 160))
        .filter((value) => value.length > 0)
    )
  );
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown, maxItems = 12): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const normalized = normalizePlannerText(entry, 240);
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeIdentityFeatureCandidateArray(value: unknown, maxItems = 12): JsonRecord[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: JsonRecord[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as JsonRecord;
    const text = normalizePlannerText(record.text, 240);
    if (!text) continue;
    const category = normalizePlannerText(record.category, 80);
    const relationToTarget = normalizePlannerText(record.relation_to_target, 80);
    const dedupeKey = `${text.toLowerCase()}|${category.toLowerCase()}|${relationToTarget.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normalized: JsonRecord = { text };
    if (category) normalized.category = category;
    if (relationToTarget) normalized.relation_to_target = relationToTarget;
    if (typeof record.confidence === "number" && Number.isFinite(record.confidence)) {
      normalized.confidence = record.confidence;
    }
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function mergeJsonRecords(primary: JsonRecord | null, fallback: JsonRecord | null): JsonRecord | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback ? { ...fallback } : null;
  if (!fallback) return primary ? { ...primary } : null;

  const merged: JsonRecord = { ...fallback, ...primary };

  for (const nestedKey of ["resolved_identity", "last_seen", "primary_portrait", "context_portrait"]) {
    const primaryNested = parseJsonRecord(primary[nestedKey]);
    const fallbackNested = parseJsonRecord(fallback[nestedKey]);
    if (primaryNested || fallbackNested) {
      merged[nestedKey] = {
        ...(fallbackNested || {}),
        ...(primaryNested || {}),
      };
    }
  }

  for (const arrayKey of [
    "identity_signature_traits",
    "key_traits",
    "stable_attributes",
    "aliases",
    "identity_context_traits",
    "reference_image_urls",
  ]) {
    const mergedArray = normalizeStringArray(
      [
        ...normalizeStringArray(primary[arrayKey]),
        ...normalizeStringArray(fallback[arrayKey]),
      ],
      arrayKey === "identity_context_traits" ? 6 : 12
    );
    if (mergedArray.length > 0) {
      merged[arrayKey] = mergedArray;
    }
  }

  const mergedFeatureCandidates = normalizeIdentityFeatureCandidateArray([
    ...normalizeIdentityFeatureCandidateArray(primary.identity_feature_candidates),
    ...normalizeIdentityFeatureCandidateArray(fallback.identity_feature_candidates),
  ]);
  if (mergedFeatureCandidates.length > 0) {
    merged.identity_feature_candidates = mergedFeatureCandidates;
  }

  return merged;
}

function computeIdentityCardRichness(row: Record<string, unknown>): number {
  const card = parseJsonRecord(row.card_json);
  const resolvedIdentity =
    parseJsonRecord(row.resolved_identity_json) || parseJsonRecord(card?.resolved_identity);
  const signatureTraits = normalizeStringArray([
    ...normalizeStringArray(card?.identity_signature_traits),
    ...normalizeStringArray(card?.key_traits),
    ...normalizeStringArray(card?.stable_attributes),
  ]);
  const contextTraits = normalizeStringArray(card?.identity_context_traits, 6);
  const featureCandidates = normalizeIdentityFeatureCandidateArray(card?.identity_feature_candidates, 8);
  let score = 0;
  if (normalizePlannerText(row.crop_url, 260)) score += 5;
  if (normalizePlannerText(row.portrait_kind, 80)) score += 2;
  if (normalizePlannerText(row.display_name, 160)) score += 1;
  if (signatureTraits.length > 0) score += signatureTraits.length * 4;
  if (normalizePlannerText(card?.identity_signature_summary, 400)) score += 5;
  if (normalizePlannerText(card?.description, 400)) score += 4;
  if (normalizePlannerText(card?.known_name, 160)) score += 2;
  if (normalizePlannerText(card?.portrait_url, 260)) score += 2;
  if (normalizePlannerText(parseJsonRecord(card?.last_seen)?.zone, 120)) score += 1;
  if (contextTraits.length > 0) score += contextTraits.length;
  if (featureCandidates.length > 0) score += featureCandidates.length * 3;
  if (resolvedIdentity) score += 4;
  if (normalizePlannerText(resolvedIdentity?.target_name, 160)) score += 2;
  if (normalizePlannerText(resolvedIdentity?.target_description, 400)) score += 2;
  return score;
}

function queryPrefersLatestIdentityCard(query: string): boolean {
  return queryIncludesAny(query, [
    " latest ",
    " most recent ",
    " recent ",
    " last ",
    " latest id ",
    " latest card ",
    " ultimo ",
    " ultima ",
    " ultimos ",
    " ultimas ",
    " mais recente ",
    " mais recentes ",
    " recente ",
    " recentes ",
    " agora ",
    " now ",
  ]);
}

function rowsHaveCompatibleIdentityCardProvenance(
  anchor: Record<string, unknown>,
  candidate: Record<string, unknown>
): boolean {
  const anchorSourceEventId = normalizePlannerText(anchor.source_event_id, 160);
  const candidateSourceEventId = normalizePlannerText(candidate.source_event_id, 160);
  if (anchorSourceEventId || candidateSourceEventId) {
    return !!anchorSourceEventId && anchorSourceEventId === candidateSourceEventId;
  }

  const anchorChatSessionId = Number(anchor.chat_session_id || 0) || 0;
  const candidateChatSessionId = Number(candidate.chat_session_id || 0) || 0;
  if (anchorChatSessionId > 0 || candidateChatSessionId > 0) {
    return anchorChatSessionId > 0 && anchorChatSessionId === candidateChatSessionId;
  }

  const anchorSourceType = normalizePlannerText(anchor.source_type, 80);
  const candidateSourceType = normalizePlannerText(candidate.source_type, 80);
  if (anchorSourceType && candidateSourceType && anchorSourceType !== candidateSourceType) {
    return false;
  }

  for (const field of ["job_run_id", "step_run_id", "agent_run_id"]) {
    const anchorValue = normalizePlannerText(anchor[field], 160);
    const candidateValue = normalizePlannerText(candidate[field], 160);
    if (anchorValue || candidateValue) {
      return !!anchorValue && anchorValue === candidateValue;
    }
  }

  const anchorCameraId = Number(anchor.camera_id || 0) || 0;
  const candidateCameraId = Number(candidate.camera_id || 0) || 0;
  if (anchorCameraId > 0 || candidateCameraId > 0) {
    return anchorCameraId > 0 && anchorCameraId === candidateCameraId;
  }

  return true;
}

function mergeIdentityCardRows(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  if (rows.length === 0) return {};
  const recentRows = sortRowsByIsoDesc(rows, "created_at");
  const anchorRow = recentRows[0];
  const compatibleRows = rows.filter((row) => rowsHaveCompatibleIdentityCardProvenance(anchorRow, row));
  const richestRows = [...compatibleRows].sort((left, right) => {
    const scoreDelta = computeIdentityCardRichness(right) - computeIdentityCardRichness(left);
    if (scoreDelta !== 0) return scoreDelta;
    return (reportPickIso(right.created_at) || "").localeCompare(reportPickIso(left.created_at) || "");
  });

  const merged = { ...anchorRow };
  let mergedCard = parseJsonRecord(merged.card_json);
  let mergedResolvedIdentity = parseJsonRecord(merged.resolved_identity_json);

  for (const row of richestRows) {
    mergedCard = mergeJsonRecords(mergedCard, parseJsonRecord(row.card_json));
    mergedResolvedIdentity = mergeJsonRecords(
      mergedResolvedIdentity,
      parseJsonRecord(row.resolved_identity_json)
    );

    if (!normalizePlannerText(merged.display_name, 160)) {
      merged.display_name = normalizePlannerText(row.display_name, 160) || null;
    }
    if (!normalizePlannerText(merged.portrait_kind, 80)) {
      merged.portrait_kind = normalizePlannerText(row.portrait_kind, 80) || null;
    }
    if (!normalizePlannerText(merged.crop_storage_key, 260)) {
      merged.crop_storage_key = normalizePlannerText(row.crop_storage_key, 260) || null;
    }
    if (!normalizePlannerText(merged.crop_url, 260)) {
      merged.crop_url = normalizePlannerText(row.crop_url, 260) || null;
    }
    if (!normalizePlannerText(merged.camera_name, 120)) {
      merged.camera_name = normalizePlannerText(row.camera_name, 120) || null;
    }
    if (
      (typeof merged.confidence !== "number" || !Number.isFinite(merged.confidence)) &&
      typeof row.confidence === "number" &&
      Number.isFinite(row.confidence)
    ) {
      merged.confidence = row.confidence;
    }
  }

  if (mergedResolvedIdentity) {
    merged.resolved_identity_json = mergedResolvedIdentity;
    mergedCard = mergeJsonRecords(
      mergedCard,
      { resolved_identity: mergedResolvedIdentity }
    );
  } else {
    merged.resolved_identity_json = null;
  }
  merged.card_json = mergedCard;
  return merged;
}

function buildNumberInClause(
  column: string,
  values: readonly number[]
): { clause: string; params: number[] } {
  const normalizedValues = Array.from(
    new Set(values.filter((entry) => Number.isInteger(entry) && entry > 0))
  );
  if (normalizedValues.length === 0) {
    return { clause: "", params: [] };
  }
  return {
    clause: ` AND ${column} IN (${normalizedValues.map(() => "?").join(", ")})`,
    params: [...normalizedValues],
  };
}

function buildTextInClause(
  column: string,
  values: readonly string[]
): { clause: string; params: string[] } {
  const normalizedValues = Array.from(
    new Set(values.map((entry) => normalizePlannerText(entry, 160)).filter((entry) => entry.length > 0))
  );
  if (normalizedValues.length === 0) {
    return { clause: "", params: [] };
  }
  return {
    clause: ` AND ${column} IN (${normalizedValues.map(() => "?").join(", ")})`,
    params: [...normalizedValues],
  };
}

function reportPickIso(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function cloneResolvedEntity(entry: OperationalResolvedEntity): OperationalResolvedEntity {
  return {
    ...entry,
    match_reason: entry.match_reason ?? null,
    camera_id: entry.camera_id ?? null,
    camera_name: entry.camera_name ?? null,
    job_id: entry.job_id ?? null,
    job_name: entry.job_name ?? null,
    step_id: entry.step_id ?? null,
    step_name: entry.step_name ?? null,
    agent_scope_type: entry.agent_scope_type ?? null,
  };
}

function clonePlan(plan: ResolvedOperationalPlan): ResolvedOperationalPlan {
  return {
    ...plan,
    intent: {
      ...plan.intent,
      subject: { ...plan.intent.subject },
      scope: {
        jobs: [...plan.intent.scope.jobs],
        steps: [...plan.intent.scope.steps],
        agents: [...plan.intent.scope.agents],
        cameras: [...plan.intent.scope.cameras],
        job_runs: [...plan.intent.scope.job_runs],
        step_runs: [...plan.intent.scope.step_runs],
        agent_runs: [...plan.intent.scope.agent_runs],
      },
      time: { ...plan.intent.time },
      filters: {
        ...plan.intent.filters,
        identity_refs: [...plan.intent.filters.identity_refs],
        source_event_refs: [...plan.intent.filters.source_event_refs],
      },
      analysis: {
        ...plan.intent.analysis,
        group_by: [...plan.intent.analysis.group_by],
        metrics: [...plan.intent.analysis.metrics],
        join_targets: [...plan.intent.analysis.join_targets],
      },
      output: { ...plan.intent.output },
    },
    resolved: {
      ...plan.resolved,
      cameras: plan.resolved.cameras.map(cloneResolvedEntity),
      jobs: plan.resolved.jobs.map(cloneResolvedEntity),
      steps: plan.resolved.steps.map(cloneResolvedEntity),
      agents: plan.resolved.agents.map(cloneResolvedEntity),
      job_runs: plan.resolved.job_runs.map(cloneResolvedEntity),
      step_runs: plan.resolved.step_runs.map(cloneResolvedEntity),
      agent_runs: plan.resolved.agent_runs.map(cloneResolvedEntity),
      ambiguities: [...plan.resolved.ambiguities],
      time_window: { ...plan.resolved.time_window },
    },
    execution: plan.execution.map((step) => ({ ...step, joins: [...step.joins] })),
    answer_plan: { ...plan.answer_plan },
  };
}

function uniqueRowsByKey<T extends Record<string, unknown>>(rows: T[], keyName: string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    const key = normalizePlannerText(row[keyName], 200);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function sortRowsByIsoDesc<T extends Record<string, unknown>>(rows: T[], ...fields: string[]): T[] {
  const rank = (row: T) => reportPickIso(...fields.map((field) => row[field])) || "";
  return [...rows].sort((left, right) => rank(right).localeCompare(rank(left)));
}

function buildRunContext(plan: ResolvedOperationalPlan): QueryRunContext {
  return {
    jobIds: asPositiveNumberList(plan.intent.scope.jobs),
    stepIds: asPositiveNumberList(plan.intent.scope.steps),
    cameraIds: asPositiveNumberList(plan.intent.scope.cameras),
    stepAgentIds: asPositiveNumberList(
      plan.resolved.agents
        .filter((entry) => entry.agent_scope_type === "job_step_agent")
        .map((entry) => entry.id)
    ),
    cameraAlgorithmIds: asPositiveNumberList(
      plan.resolved.agents
        .filter((entry) => entry.agent_scope_type === "camera_algorithm")
        .map((entry) => entry.id)
    ),
    jobRunIds: asNonEmptyStringList(plan.intent.scope.job_runs),
    stepRunIds: asNonEmptyStringList(plan.intent.scope.step_runs),
    agentRunIds: asNonEmptyStringList(plan.intent.scope.agent_runs),
  };
}

function deriveScopedStepIds(plan: ResolvedOperationalPlan): number[] {
  return asPositiveNumberList([
    ...plan.intent.scope.steps,
    ...plan.resolved.steps.map((entry) => entry.id),
    ...plan.resolved.step_runs
      .map((entry) => entry.step_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ...plan.resolved.agent_runs
      .map((entry) => entry.step_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  ]);
}

function deriveScopedJobIds(plan: ResolvedOperationalPlan): number[] {
  return asPositiveNumberList([
    ...plan.intent.scope.jobs,
    ...plan.resolved.jobs.map((entry) => entry.id),
    ...plan.resolved.job_runs
      .map((entry) => entry.job_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ...plan.resolved.step_runs
      .map((entry) => entry.job_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ...plan.resolved.agent_runs
      .map((entry) => entry.job_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  ]);
}

function buildQueryWindow(plan: ResolvedOperationalPlan, context: OperationalPlannerContext): QueryWindow {
  return {
    startAt:
      normalizePlannerText(plan.resolved.time_window.start_at, 80) ||
      normalizePlannerText(context.scope.start_at, 80),
    endAt:
      normalizePlannerText(plan.resolved.time_window.end_at, 80) ||
      normalizePlannerText(context.scope.end_at, 80),
  };
}

function queryIncludesAny(query: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle.length > 0 && query.includes(needle));
}

function queryMentionsRun(query: string): boolean {
  return queryIncludesAny(query, [
    " run ",
    " runs ",
    " execution ",
    " executions ",
    " execucao ",
    " execucoes ",
  ]);
}

function queryPrefersSingleRun(query: string): boolean {
  return queryIncludesAny(query, [
    " latest run ",
    " last run ",
    " current run ",
    " most recent run ",
    " latest execution ",
    " last execution ",
    " execucao mais recente ",
    " ultima execucao ",
    " ultimo run ",
    " run atual ",
    " execucao atual ",
    " acabou de executar ",
    " acabou de rodar ",
    " just ran ",
    " just executed ",
    " this run ",
    " essa execucao ",
    " esta execucao ",
    " este run ",
    " the only run ",
    " unica de hoje ",
    " unico de hoje ",
  ]);
}

function extractUuidLikeTokens(query: string): string[] {
  const matches = query.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
  return matches ? Array.from(new Set(matches.map((entry) => entry.toLowerCase()))) : [];
}

async function runQuery(
  db: D1Database,
  sql: string,
  bindings: Array<string | number>
): Promise<Array<Record<string, unknown>>> {
  const { results } = await db.prepare(sql).bind(...bindings).all();
  return ((results || []) as Array<Record<string, unknown>>).filter(
    (entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  );
}

async function fetchJobRunCandidates(params: {
  db: D1Database;
  userId: string;
  window: QueryWindow;
  runContext: QueryRunContext;
  explicitRunIds: string[];
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const jobFilter = buildNumberInClause("job_id", params.runContext.jobIds);
  const runFilter = buildTextInClause("job_run_id", [
    ...params.runContext.jobRunIds,
    ...params.explicitRunIds,
  ]);
  const useExplicit = runFilter.params.length > 0;
  const sql = `SELECT
      job_run_id,
      job_id,
      job_name,
      status,
      started_at_utc,
      completed_at_utc,
      stopped_at_utc,
      failed_at_utc,
      last_event_at_utc,
      created_at
    FROM job_runs
    WHERE user_id = ?${
      useExplicit
        ? `${runFilter.clause}`
        : `
      AND COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) >= ?
      AND COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) <= ?${jobFilter.clause}`
    }
    ORDER BY COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) DESC
    LIMIT ${Math.max(1, Math.min(params.limit, 40))}`;
  const bindings: Array<string | number> = useExplicit
    ? [params.userId, ...runFilter.params]
    : [params.userId, params.window.startAt, params.window.endAt, ...jobFilter.params];
  return runQuery(params.db, sql, bindings);
}

async function fetchStepRunCandidates(params: {
  db: D1Database;
  userId: string;
  window: QueryWindow;
  runContext: QueryRunContext;
  explicitRunIds: string[];
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const jobFilter = buildNumberInClause("job_id", params.runContext.jobIds);
  const stepFilter = buildNumberInClause("step_id", params.runContext.stepIds);
  const cameraFilter = buildNumberInClause("camera_id", params.runContext.cameraIds);
  const stepAgentFilter = buildNumberInClause("step_agent_id", params.runContext.stepAgentIds);
  const jobRunFilter = buildTextInClause("job_run_id", params.runContext.jobRunIds);
  const runFilter = buildTextInClause("step_run_id", [
    ...params.runContext.stepRunIds,
    ...params.explicitRunIds,
  ]);
  const useExplicit = runFilter.params.length > 0;
  const sql = `SELECT
      step_run_id,
      job_run_id,
      job_id,
      step_id,
      step_name,
      step_order,
      camera_id,
      step_agent_id,
      status,
      reason,
      started_at_utc,
      completed_at_utc,
      latest_event_at_utc,
      created_at
    FROM job_step_runs
    WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ?)${
      useExplicit
        ? `${runFilter.clause}${jobRunFilter.clause}`
        : `
      AND COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) >= ?
      AND COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) <= ?${jobFilter.clause}${stepFilter.clause}${cameraFilter.clause}${stepAgentFilter.clause}${jobRunFilter.clause}`
    }
    ORDER BY COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) DESC
    LIMIT ${Math.max(1, Math.min(params.limit, 40))}`;
  const bindings: Array<string | number> = useExplicit
    ? [params.userId, ...runFilter.params, ...jobRunFilter.params]
    : [
        params.userId,
        params.window.startAt,
        params.window.endAt,
        ...jobFilter.params,
        ...stepFilter.params,
        ...cameraFilter.params,
        ...stepAgentFilter.params,
        ...jobRunFilter.params,
      ];
  return runQuery(params.db, sql, bindings);
}

async function fetchAgentRunCandidates(params: {
  db: D1Database;
  userId: string;
  window: QueryWindow;
  runContext: QueryRunContext;
  explicitRunIds: string[];
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const jobFilter = buildNumberInClause("job_id", params.runContext.jobIds);
  const stepFilter = buildNumberInClause("step_id", params.runContext.stepIds);
  const cameraFilter = buildNumberInClause("camera_id", params.runContext.cameraIds);
  const stepAgentFilter = buildNumberInClause("step_agent_id", params.runContext.stepAgentIds);
  const cameraAlgorithmFilter = buildNumberInClause(
    "camera_algorithm_id",
    params.runContext.cameraAlgorithmIds
  );
  const jobRunFilter = buildTextInClause("job_run_id", params.runContext.jobRunIds);
  const stepRunFilter = buildTextInClause("step_run_id", params.runContext.stepRunIds);
  const runFilter = buildTextInClause("agent_run_id", [
    ...params.runContext.agentRunIds,
    ...params.explicitRunIds,
  ]);
  const useExplicit = runFilter.params.length > 0;

  const jobStepSql = `SELECT
      agent_run_id,
      'job_step_agent' AS agent_scope_type,
      job_run_id,
      step_run_id,
      job_id,
      step_id,
      step_name,
      camera_id,
      camera_name,
      step_agent_id AS agent_config_id,
      agent_key,
      status,
      provider,
      model,
      started_at_utc,
      completed_at_utc,
      last_event_at_utc,
      created_at
    FROM job_step_agent_runs
    WHERE user_id = ?${
      useExplicit
        ? `${runFilter.clause}${jobRunFilter.clause}${stepRunFilter.clause}`
        : `
      AND COALESCE(last_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) >= ?
      AND COALESCE(last_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) <= ?${jobFilter.clause}${stepFilter.clause}${cameraFilter.clause}${stepAgentFilter.clause}${jobRunFilter.clause}${stepRunFilter.clause}`
    }
    ORDER BY COALESCE(last_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) DESC
    LIMIT ${Math.max(1, Math.min(params.limit, 40))}`;
  const jobStepBindings: Array<string | number> = useExplicit
    ? [params.userId, ...runFilter.params, ...jobRunFilter.params, ...stepRunFilter.params]
    : [
        params.userId,
        params.window.startAt,
        params.window.endAt,
        ...jobFilter.params,
        ...stepFilter.params,
        ...cameraFilter.params,
        ...stepAgentFilter.params,
        ...jobRunFilter.params,
        ...stepRunFilter.params,
      ];

  const includeCameraRuns =
    params.runContext.jobIds.length === 0 &&
    params.runContext.stepIds.length === 0 &&
    (params.runContext.cameraIds.length > 0 ||
      params.runContext.cameraAlgorithmIds.length > 0 ||
      params.runContext.agentRunIds.length > 0 ||
      params.explicitRunIds.length > 0 ||
      (params.runContext.stepAgentIds.length === 0 && params.runContext.cameraIds.length === 0));

  const [jobStepRows, cameraRows] = await Promise.all([
    runQuery(params.db, jobStepSql, jobStepBindings),
    includeCameraRuns
      ? runQuery(
          params.db,
          `SELECT
             agent_run_id,
             'camera_algorithm' AS agent_scope_type,
             NULL AS job_run_id,
             NULL AS step_run_id,
             NULL AS job_id,
             NULL AS step_id,
             NULL AS step_name,
             camera_id,
             camera_name,
             camera_algorithm_id AS agent_config_id,
             algorithm_type AS agent_key,
             status,
             provider,
             model,
             started_at_utc,
             completed_at_utc,
             last_evaluated_at_utc AS last_event_at_utc,
             created_at
           FROM camera_agent_runs
           WHERE user_id = ?${
             useExplicit
               ? `${runFilter.clause}`
               : `
             AND COALESCE(last_evaluated_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) >= ?
             AND COALESCE(last_evaluated_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) <= ?${cameraFilter.clause}${cameraAlgorithmFilter.clause}`
           }
           ORDER BY COALESCE(last_evaluated_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) DESC
           LIMIT ${Math.max(1, Math.min(params.limit, 40))}`,
          useExplicit
            ? [params.userId, ...runFilter.params]
            : [
                params.userId,
                params.window.startAt,
                params.window.endAt,
                ...cameraFilter.params,
                ...cameraAlgorithmFilter.params,
              ]
        )
      : Promise.resolve([]),
  ]);

  return sortRowsByIsoDesc(
    uniqueRowsByKey([...jobStepRows, ...cameraRows], "agent_run_id"),
    "last_event_at_utc",
    "completed_at_utc",
    "started_at_utc",
    "created_at"
  ).slice(0, Math.max(1, Math.min(params.limit, 40)));
}

function mapJobRunCandidate(row: Record<string, unknown>, confidence: number): OperationalResolvedEntity | null {
  const jobRunId = normalizePlannerText(row.job_run_id, 160);
  if (!jobRunId) return null;
  const jobName = normalizePlannerText(row.job_name, 160);
  const status = normalizePlannerText(row.status, 40);
  const eventAt = reportPickIso(
    row.last_event_at_utc,
    row.failed_at_utc,
    row.completed_at_utc,
    row.stopped_at_utc,
    row.started_at_utc,
    row.created_at
  );
  return {
    entity_type: "job_run",
    id: jobRunId,
    name: jobName || `job run ${jobRunId.slice(0, 8)}`,
    label: [jobName || "job run", status, eventAt].filter((entry) => Boolean(entry)).join(" | "),
    confidence,
    match_reason: "ledger_run",
    job_id: Number(row.job_id || 0) || null,
    job_name: jobName || null,
  };
}

function mapStepRunCandidate(row: Record<string, unknown>, confidence: number): OperationalResolvedEntity | null {
  const stepRunId = normalizePlannerText(row.step_run_id, 160);
  if (!stepRunId) return null;
  const stepName = normalizePlannerText(row.step_name, 160);
  const eventAt = reportPickIso(row.latest_event_at_utc, row.completed_at_utc, row.started_at_utc, row.created_at);
  return {
    entity_type: "step_run",
    id: stepRunId,
    name: stepName || `step run ${stepRunId.slice(0, 8)}`,
    label: [stepName || "step run", eventAt].filter((entry) => Boolean(entry)).join(" | "),
    confidence,
    match_reason: "ledger_run",
    camera_id: Number(row.camera_id || 0) || null,
    job_id: Number(row.job_id || 0) || null,
    step_id: Number(row.step_id || 0) || null,
    step_name: stepName || null,
  };
}

function mapAgentRunCandidate(row: Record<string, unknown>, confidence: number): OperationalResolvedEntity | null {
  const agentRunId = normalizePlannerText(row.agent_run_id, 160);
  if (!agentRunId) return null;
  const agentKey = normalizePlannerText(row.agent_key, 160);
  const cameraName = normalizePlannerText(row.camera_name, 160);
  const stepName = normalizePlannerText(row.step_name, 160);
  const eventAt = reportPickIso(row.last_event_at_utc, row.completed_at_utc, row.started_at_utc, row.created_at);
  return {
    entity_type: "agent_run",
    id: agentRunId,
    name: agentKey || cameraName || `agent run ${agentRunId.slice(0, 8)}`,
    label: [agentKey || cameraName || "agent run", stepName, eventAt]
      .filter((entry) => Boolean(entry))
      .join(" | "),
    confidence,
    match_reason: "ledger_run",
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: cameraName || null,
    job_id: Number(row.job_id || 0) || null,
    step_id: Number(row.step_id || 0) || null,
    step_name: stepName || null,
    agent_scope_type: normalizePlannerText(row.agent_scope_type, 80) || null,
  };
}

function chooseRunCandidates(
  rows: Array<Record<string, unknown>>,
  normalizedQuery: string
): Array<Record<string, unknown>> {
  if (rows.length === 0) return rows;
  if (queryPrefersSingleRun(normalizedQuery)) {
    return rows.slice(0, 1);
  }
  if (queryMentionsRun(normalizedQuery) && rows.length === 1) {
    return rows.slice(0, 1);
  }
  return rows.slice(0, 12);
}

function upsertResolvedEntities(
  existing: OperationalResolvedEntity[],
  additions: OperationalResolvedEntity[]
): OperationalResolvedEntity[] {
  const seen = new Set<string>();
  const merged: OperationalResolvedEntity[] = [];
  for (const entry of [...existing, ...additions]) {
    const key = `${entry.entity_type}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

export async function resolveOperationalPlanAgainstDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<ResolvedOperationalPlan> {
  const plan = clonePlan(params.plan);
  const normalizedQuery = normalizeQueryForMatch(
    plan.intent.time.raw_text || params.context.requested_query,
    2400
  );
  const explicitRunIds = extractUuidLikeTokens(normalizedQuery);
  const runContext = buildRunContext(plan);
  const window = buildQueryWindow(plan, params.context);

  const hasSpecificScope =
    runContext.jobIds.length > 0 ||
    runContext.stepIds.length > 0 ||
    runContext.cameraIds.length > 0 ||
    runContext.stepAgentIds.length > 0 ||
    runContext.cameraAlgorithmIds.length > 0 ||
    runContext.jobRunIds.length > 0 ||
    runContext.stepRunIds.length > 0 ||
    runContext.agentRunIds.length > 0;

  const wantsJobRuns =
    plan.intent.subject.entity === "job_run" ||
    runContext.jobIds.length > 0 ||
    explicitRunIds.length > 0 ||
    (queryMentionsRun(normalizedQuery) && runContext.stepIds.length === 0 && runContext.stepAgentIds.length === 0);
  const wantsStepRuns =
    plan.intent.subject.entity === "step_run" ||
    runContext.stepIds.length > 0 ||
    runContext.stepAgentIds.length > 0 ||
    explicitRunIds.length > 0;
  const wantsAgentRuns =
    plan.intent.subject.entity === "agent_run" ||
    runContext.stepAgentIds.length > 0 ||
    runContext.cameraAlgorithmIds.length > 0 ||
    explicitRunIds.length > 0 ||
    (runContext.cameraIds.length > 0 && runContext.jobIds.length === 0 && runContext.stepIds.length === 0);

  const shouldResolveRuns =
    plan.intent.subject.entity === "identity_occurrence" ||
    plan.intent.subject.entity === "alert" ||
    plan.intent.subject.entity === "job_run" ||
    plan.intent.subject.entity === "step_run" ||
    plan.intent.subject.entity === "agent_run" ||
    hasSpecificScope ||
    queryMentionsRun(normalizedQuery);

  if (!shouldResolveRuns) {
    return plan;
  }

  const candidateLimit = Math.max(8, Math.min(24, plan.intent.filters.limit * 4));
  const [jobRunRows, stepRunRows, agentRunRows] = await Promise.all([
    wantsJobRuns
      ? fetchJobRunCandidates({
          db: params.db,
          userId: params.userId,
          window,
          runContext,
          explicitRunIds,
          limit: candidateLimit,
        })
      : Promise.resolve([]),
    wantsStepRuns
      ? fetchStepRunCandidates({
          db: params.db,
          userId: params.userId,
          window,
          runContext,
          explicitRunIds,
          limit: candidateLimit,
        })
      : Promise.resolve([]),
    wantsAgentRuns
      ? fetchAgentRunCandidates({
          db: params.db,
          userId: params.userId,
          window,
          runContext,
          explicitRunIds,
          limit: candidateLimit,
        })
      : Promise.resolve([]),
  ]);

  const selectedJobRuns = chooseRunCandidates(jobRunRows, normalizedQuery)
    .map((row, index) => mapJobRunCandidate(row, index === 0 ? 0.96 : 0.9))
    .filter((entry): entry is OperationalResolvedEntity => Boolean(entry));
  const selectedStepRuns = chooseRunCandidates(stepRunRows, normalizedQuery)
    .map((row, index) => mapStepRunCandidate(row, index === 0 ? 0.96 : 0.9))
    .filter((entry): entry is OperationalResolvedEntity => Boolean(entry));
  const selectedAgentRuns = chooseRunCandidates(agentRunRows, normalizedQuery)
    .map((row, index) => mapAgentRunCandidate(row, index === 0 ? 0.96 : 0.9))
    .filter((entry): entry is OperationalResolvedEntity => Boolean(entry));

  plan.resolved.job_runs = upsertResolvedEntities(plan.resolved.job_runs, selectedJobRuns);
  plan.resolved.step_runs = upsertResolvedEntities(plan.resolved.step_runs, selectedStepRuns);
  plan.resolved.agent_runs = upsertResolvedEntities(plan.resolved.agent_runs, selectedAgentRuns);
  plan.intent.scope.job_runs = plan.resolved.job_runs.map((entry) => entry.id);
  plan.intent.scope.step_runs = plan.resolved.step_runs.map((entry) => entry.id);
  plan.intent.scope.agent_runs = plan.resolved.agent_runs.map((entry) => entry.id);

  if (
    plan.resolved.job_runs.length > 0 ||
    plan.resolved.step_runs.length > 0 ||
    plan.resolved.agent_runs.length > 0
  ) {
    plan.resolved.is_specific = true;
    plan.confidence = Math.min(0.99, plan.confidence + 0.08);
  }

  if (queryMentionsRun(normalizedQuery) || queryPrefersSingleRun(normalizedQuery)) {
    if (wantsJobRuns && jobRunRows.length === 0) {
      plan.resolved.ambiguities.push("job_run_reference_unresolved");
    }
    if (wantsStepRuns && stepRunRows.length === 0) {
      plan.resolved.ambiguities.push("step_run_reference_unresolved");
    }
    if (wantsAgentRuns && agentRunRows.length === 0) {
      plan.resolved.ambiguities.push("agent_run_reference_unresolved");
    }
  }

  if (queryPrefersSingleRun(normalizedQuery)) {
    if (wantsJobRuns && jobRunRows.length > 1 && plan.resolved.job_runs.length !== 1) {
      plan.resolved.ambiguities.push("job_run_reference_ambiguous");
    }
    if (wantsStepRuns && stepRunRows.length > 1 && plan.resolved.step_runs.length !== 1) {
      plan.resolved.ambiguities.push("step_run_reference_ambiguous");
    }
    if (wantsAgentRuns && agentRunRows.length > 1 && plan.resolved.agent_runs.length !== 1) {
      plan.resolved.ambiguities.push("agent_run_reference_ambiguous");
    }
  }

  plan.resolved.ambiguities = Array.from(new Set(plan.resolved.ambiguities));
  return plan;
}

async function queryIdentityCardsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const normalizedQuery = normalizeQueryForMatch(params.context.requested_query, 800);
  const cameraFilter = buildNumberInClause("camera_id", runContext.cameraIds);
  const jobRunFilter = buildTextInClause("job_run_id", runContext.jobRunIds);
  const stepRunFilter = buildTextInClause("step_run_id", runContext.stepRunIds);
  const agentRunFilter = buildTextInClause("agent_run_id", runContext.agentRunIds);
  const identityFilter = buildTextInClause(
    "identity_card_id",
    params.plan.intent.filters.identity_refs || []
  );
  const sourceEventFilter = buildTextInClause(
    "source_event_id",
    params.plan.intent.filters.source_event_refs || []
  );

  const relationFragments: string[] = [];
  const relationBindings: Array<string | number> = [];

  if (runContext.jobIds.length > 0) {
    const jobIdFilter = buildNumberInClause("job_id", runContext.jobIds);
    relationFragments.push(
      `job_run_id IN (SELECT job_run_id FROM job_runs WHERE user_id = ?${jobIdFilter.clause})`
    );
    relationBindings.push(params.userId, ...jobIdFilter.params);
    relationFragments.push(
      `step_run_id IN (SELECT step_run_id FROM job_step_runs WHERE job_id IN (${runContext.jobIds
        .map(() => "?")
        .join(", ")}))`
    );
    relationBindings.push(...runContext.jobIds);
    relationFragments.push(
      `agent_run_id IN (SELECT agent_run_id FROM job_step_agent_runs WHERE user_id = ?${jobIdFilter.clause})`
    );
    relationBindings.push(params.userId, ...jobIdFilter.params);
  }
  if (runContext.stepIds.length > 0) {
    const stepIdFilter = buildNumberInClause("step_id", runContext.stepIds);
    relationFragments.push(
      `step_run_id IN (SELECT step_run_id FROM job_step_runs WHERE 1 = 1${stepIdFilter.clause})`
    );
    relationBindings.push(...stepIdFilter.params);
    relationFragments.push(
      `agent_run_id IN (SELECT agent_run_id FROM job_step_agent_runs WHERE user_id = ?${stepIdFilter.clause})`
    );
    relationBindings.push(params.userId, ...stepIdFilter.params);
  }
  if (runContext.stepAgentIds.length > 0) {
    const stepAgentFilter = buildNumberInClause("step_agent_id", runContext.stepAgentIds);
    relationFragments.push(
      `agent_run_id IN (SELECT agent_run_id FROM job_step_agent_runs WHERE user_id = ?${stepAgentFilter.clause})`
    );
    relationBindings.push(params.userId, ...stepAgentFilter.params);
  }
  if (runContext.cameraAlgorithmIds.length > 0) {
    const cameraAlgorithmFilter = buildNumberInClause(
      "camera_algorithm_id",
      runContext.cameraAlgorithmIds
    );
    relationFragments.push(
      `agent_run_id IN (SELECT agent_run_id FROM camera_agent_runs WHERE user_id = ?${cameraAlgorithmFilter.clause})`
    );
    relationBindings.push(params.userId, ...cameraAlgorithmFilter.params);
  }

  const relationClause =
    relationFragments.length > 0 ? ` AND (${relationFragments.join(" OR ")})` : "";

  const requestedLimit = Math.max(1, Math.min(params.plan.intent.filters.limit, 120));
  const candidateLimit = Math.max(requestedLimit, Math.min(Math.max(requestedLimit * 12, 24), 180));
  const rows = await runQuery(
    params.db,
    `SELECT
       occurrence_id,
       identity_card_id,
       chat_session_id,
       camera_id,
       camera_name,
       source_type,
       source_event_id,
       job_run_id,
       step_run_id,
       agent_run_id,
       display_name,
       confidence,
       resolved_target_id,
       portrait_kind,
       crop_storage_key,
       crop_url,
       resolved_identity_json,
       card_json,
       created_at
     FROM identity_card_occurrences
     WHERE user_id = ?
       AND created_at >= ?
       AND created_at <= ?${cameraFilter.clause}${jobRunFilter.clause}${stepRunFilter.clause}${agentRunFilter.clause}${identityFilter.clause}${sourceEventFilter.clause}${relationClause}
     ORDER BY created_at DESC
     LIMIT ${candidateLimit}`,
    [
      params.userId,
      window.startAt,
      window.endAt,
      ...cameraFilter.params,
      ...jobRunFilter.params,
      ...stepRunFilter.params,
      ...agentRunFilter.params,
      ...identityFilter.params,
      ...sourceEventFilter.params,
      ...relationBindings,
    ]
  );

  const mappedRows = rows.map((row) => ({
    occurrence_id: normalizePlannerText(row.occurrence_id, 160),
    identity_card_id: normalizePlannerText(row.identity_card_id, 160),
    chat_session_id: Number(row.chat_session_id || 0) || null,
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 120) || null,
    source_type: normalizePlannerText(row.source_type, 80) || null,
    source_event_id: normalizePlannerText(row.source_event_id, 160) || null,
    job_run_id: normalizePlannerText(row.job_run_id, 160) || null,
    step_run_id: normalizePlannerText(row.step_run_id, 160) || null,
    agent_run_id: normalizePlannerText(row.agent_run_id, 160) || null,
    resolved_target_id: Number(row.resolved_target_id || 0) || null,
    display_name: normalizePlannerText(row.display_name, 160) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence || 0) || null,
    portrait_kind: normalizePlannerText(row.portrait_kind, 80) || null,
    crop_storage_key: normalizePlannerText(row.crop_storage_key, 260) || null,
    crop_url: normalizePlannerText(row.crop_url, 260) || null,
    resolved_identity_json: parseJsonRecord(row.resolved_identity_json),
    card_json: parseJsonRecord(row.card_json),
    created_at: reportPickIso(row.created_at),
  }));

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of mappedRows) {
    const groupKey =
      normalizePlannerText(row.identity_card_id, 160) ||
      normalizePlannerText(row.occurrence_id, 160);
    if (!groupKey) continue;
    const bucket = grouped.get(groupKey) || [];
    bucket.push(row);
    grouped.set(groupKey, bucket);
  }

  const mergedRows = Array.from(grouped.values()).map((bucket) => mergeIdentityCardRows(bucket));
  const preferLatest =
    (params.plan.intent.filters.identity_refs || []).length > 0 ||
    queryPrefersLatestIdentityCard(normalizedQuery);

  return mergedRows
    .sort((left, right) => {
      if (!preferLatest) {
        const scoreDelta = computeIdentityCardRichness(right) - computeIdentityCardRichness(left);
        if (scoreDelta !== 0) return scoreDelta;
      }
      const timeDelta = (reportPickIso(right.created_at) || "").localeCompare(
        reportPickIso(left.created_at) || ""
      );
      if (timeDelta !== 0) return timeDelta;
      if (preferLatest) {
        return computeIdentityCardRichness(right) - computeIdentityCardRichness(left);
      }
      return (normalizePlannerText(right.display_name, 160) || "").localeCompare(
        normalizePlannerText(left.display_name, 160) || ""
      );
    })
    .slice(0, requestedLimit);
}

async function queryCamerasDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const requestedLimit = Math.max(1, Math.min(params.plan.intent.filters.limit, 120));
  const stepIds = deriveScopedStepIds(params.plan);
  const jobIds = deriveScopedJobIds(params.plan);
  const directStepIds = asPositiveNumberList([
    ...params.plan.intent.scope.steps,
    ...params.plan.resolved.steps.map((entry) => entry.id),
  ]);
  const directJobIds = asPositiveNumberList([
    ...params.plan.intent.scope.jobs,
    ...params.plan.resolved.jobs.map((entry) => entry.id),
  ]);
  const runDerivedCameraIds = asPositiveNumberList([
    ...params.plan.resolved.step_runs
      .map((entry) => entry.camera_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ...params.plan.resolved.agent_runs
      .map((entry) => entry.camera_id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  ]);
  const cameraIdsForScopedTargets =
    directStepIds.length > 0 || directJobIds.length > 0
      ? runContext.cameraIds
      : asPositiveNumberList([...runContext.cameraIds, ...runDerivedCameraIds]);

  if (stepIds.length > 0 || jobIds.length > 0) {
    const stepFilter = buildNumberInClause("js.id", stepIds);
    const jobFilter = buildNumberInClause("js.job_id", jobIds);
    const cameraFilter = buildNumberInClause("jst.camera_id", cameraIdsForScopedTargets);
    const totalCountRows = await runQuery(
      params.db,
      `SELECT COUNT(*) AS total_count
       FROM job_step_targets jst
       JOIN job_steps js ON js.id = jst.step_id
       JOIN jobs j ON j.id = js.job_id
       WHERE j.user_id = ?${stepFilter.clause}${jobFilter.clause}${cameraFilter.clause}`,
      [params.userId, ...stepFilter.params, ...jobFilter.params, ...cameraFilter.params]
    );
    const totalCount = Number(totalCountRows[0]?.total_count || 0) || 0;

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await runQuery(
        params.db,
        `SELECT
           jst.id AS target_id,
           jst.camera_id,
           jst.slot_key,
           jst.slot_label,
           COALESCE(c.name, jst.slot_label, '') AS camera_name,
           js.id AS step_id,
           COALESCE(js.title, '') AS step_name,
           j.id AS job_id,
           COALESCE(j.name, '') AS job_name,
           COALESCE(jsa.input_type, 'video') AS input_type
         FROM job_step_targets jst
         JOIN job_steps js ON js.id = jst.step_id
         JOIN jobs j ON j.id = js.job_id
         LEFT JOIN cameras c ON c.id = jst.camera_id
         LEFT JOIN job_step_agents jsa
           ON jsa.step_id = jst.step_id
          AND jsa.camera_id = jst.camera_id
          AND jsa.is_active = 1
         WHERE j.user_id = ?${stepFilter.clause}${jobFilter.clause}${cameraFilter.clause}
         ORDER BY COALESCE(j.name, ''), COALESCE(js.step_order, 0), jst.id ASC
         LIMIT ${requestedLimit}`,
        [params.userId, ...stepFilter.params, ...jobFilter.params, ...cameraFilter.params]
      );
    } catch {
      rows = await runQuery(
        params.db,
        `SELECT
           jst.id AS target_id,
           jst.camera_id,
           NULL AS slot_key,
           NULL AS slot_label,
           COALESCE(c.name, '') AS camera_name,
           js.id AS step_id,
           COALESCE(js.name, '') AS step_name,
           j.id AS job_id,
           COALESCE(j.name, '') AS job_name,
           COALESCE(jsa.input_type, 'video') AS input_type
         FROM job_step_targets jst
         JOIN job_steps js ON js.id = jst.step_id
         JOIN jobs j ON j.id = js.job_id
         LEFT JOIN cameras c ON c.id = jst.camera_id
         LEFT JOIN job_step_agents jsa
           ON jsa.step_id = jst.step_id
          AND jsa.camera_id = jst.camera_id
          AND jsa.is_active = 1
         WHERE j.user_id = ?${stepFilter.clause}${jobFilter.clause}${cameraFilter.clause}
         ORDER BY COALESCE(j.name, ''), COALESCE(js.step_order, 0), jst.id ASC
         LIMIT ${requestedLimit}`,
        [params.userId, ...stepFilter.params, ...jobFilter.params, ...cameraFilter.params]
      );
    }

    const seen = new Set<string>();
    const deduped: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const stepId = Number(row.step_id || 0) || 0;
      const cameraId = Number(row.camera_id || 0) || 0;
      const slotKey = normalizePlannerText(row.slot_key, 160);
      const dedupeKey = `${stepId}:${cameraId}:${slotKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push({
        target_id: Number(row.target_id || 0) || null,
        camera_id: cameraId || null,
        camera_name: normalizePlannerText(row.camera_name, 160) || null,
        slot_key: slotKey || null,
        slot_label: normalizePlannerText(row.slot_label, 160) || null,
        step_id: stepId || null,
        step_name: normalizePlannerText(row.step_name, 160) || null,
        job_id: Number(row.job_id || 0) || null,
        job_name: normalizePlannerText(row.job_name, 160) || null,
        input_type: normalizePlannerText(row.input_type, 80) || null,
        total_count: totalCount,
      });
      if (deduped.length >= requestedLimit) break;
    }
    return deduped;
  }

  const inventoryFilter = buildNumberInClause(
    "c.id",
    asPositiveNumberList([...runContext.cameraIds, ...runDerivedCameraIds])
  );
  const rows = await runQuery(
    params.db,
    `SELECT
       c.id AS camera_id,
       COALESCE(c.name, '') AS camera_name,
       NULL AS slot_key,
       NULL AS slot_label,
       NULL AS step_id,
       NULL AS step_name,
       NULL AS job_id,
       NULL AS job_name,
       NULL AS input_type
     FROM cameras c
     WHERE c.user_id = ?${inventoryFilter.clause}
     ORDER BY COALESCE(c.name, '') ASC
     LIMIT ${requestedLimit}`,
    [params.userId, ...inventoryFilter.params]
  );
  return rows.map((row) => ({
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    slot_key: null,
    slot_label: null,
    step_id: null,
    step_name: null,
    job_id: null,
    job_name: null,
    input_type: null,
  }));
}

async function queryJobRunsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const jobFilter = buildNumberInClause("job_id", runContext.jobIds);
  const runFilter = buildTextInClause("job_run_id", runContext.jobRunIds);
  const rows = await runQuery(
    params.db,
    `SELECT
       job_run_id,
       job_id,
       job_name,
       status,
       trigger_type,
       COALESCE(started_at_utc, created_at) AS started_at,
       COALESCE(completed_at_utc, failed_at_utc, stopped_at_utc, last_event_at_utc) AS ended_at,
       COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) AS last_event_at
     FROM job_runs
     WHERE user_id = ?
       AND COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) >= ?
       AND COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) <= ?${jobFilter.clause}${runFilter.clause}
     ORDER BY COALESCE(last_event_at_utc, failed_at_utc, completed_at_utc, stopped_at_utc, started_at_utc, created_at) DESC
     LIMIT ${Math.max(1, Math.min(params.plan.intent.filters.limit, 120))}`,
    [params.userId, window.startAt, window.endAt, ...jobFilter.params, ...runFilter.params]
  );
  return rows.map((row) => ({
    job_run_id: normalizePlannerText(row.job_run_id, 160),
    job_id: Number(row.job_id || 0) || null,
    job_name: normalizePlannerText(row.job_name, 160) || null,
    status: normalizePlannerText(row.status, 40) || null,
    trigger_type: normalizePlannerText(row.trigger_type, 80) || null,
    started_at: reportPickIso(row.started_at),
    ended_at: reportPickIso(row.ended_at),
    last_event_at: reportPickIso(row.last_event_at),
  }));
}

async function queryStepRunsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const jobFilter = buildNumberInClause("job_id", runContext.jobIds);
  const stepFilter = buildNumberInClause("step_id", runContext.stepIds);
  const cameraFilter = buildNumberInClause("camera_id", runContext.cameraIds);
  const stepAgentFilter = buildNumberInClause("step_agent_id", runContext.stepAgentIds);
  const jobRunFilter = buildTextInClause("job_run_id", runContext.jobRunIds);
  const runFilter = buildTextInClause("step_run_id", runContext.stepRunIds);

  const rows = await runQuery(
    params.db,
    `SELECT
       step_run_id,
       job_run_id,
       job_id,
       step_id,
       step_name,
       camera_id,
       status,
       reason,
       COALESCE(started_at_utc, created_at) AS started_at,
       COALESCE(completed_at_utc, latest_event_at_utc, updated_at, created_at) AS ended_at
     FROM job_step_runs
     WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ?)
       AND COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) >= ?
       AND COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) <= ?${jobFilter.clause}${stepFilter.clause}${cameraFilter.clause}${stepAgentFilter.clause}${jobRunFilter.clause}${runFilter.clause}
     ORDER BY COALESCE(latest_event_at_utc, completed_at_utc, started_at_utc, updated_at, created_at) DESC
     LIMIT ${Math.max(1, Math.min(params.plan.intent.filters.limit, 120))}`,
    [
      params.userId,
      window.startAt,
      window.endAt,
      ...jobFilter.params,
      ...stepFilter.params,
      ...cameraFilter.params,
      ...stepAgentFilter.params,
      ...jobRunFilter.params,
      ...runFilter.params,
    ]
  );
  return rows.map((row) => ({
    step_run_id: normalizePlannerText(row.step_run_id, 160),
    job_run_id: normalizePlannerText(row.job_run_id, 160) || null,
    job_id: Number(row.job_id || 0) || null,
    step_id: Number(row.step_id || 0) || null,
    step_name: normalizePlannerText(row.step_name, 160) || null,
    camera_id: Number(row.camera_id || 0) || null,
    status: normalizePlannerText(row.status, 40) || null,
    reason: normalizePlannerText(row.reason, 120) || null,
    started_at: reportPickIso(row.started_at),
    ended_at: reportPickIso(row.ended_at),
  }));
}

async function queryAgentRunsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const rows = await fetchAgentRunCandidates({
    db: params.db,
    userId: params.userId,
    window: buildQueryWindow(params.plan, params.context),
    runContext: buildRunContext(params.plan),
    explicitRunIds: [],
    limit: Math.max(1, Math.min(params.plan.intent.filters.limit, 120)),
  });
  return rows.map((row) => ({
    agent_run_id: normalizePlannerText(row.agent_run_id, 160),
    job_run_id: normalizePlannerText(row.job_run_id, 160) || null,
    step_run_id: normalizePlannerText(row.step_run_id, 160) || null,
    job_id: Number(row.job_id || 0) || null,
    step_id: Number(row.step_id || 0) || null,
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    agent_key: normalizePlannerText(row.agent_key, 160) || null,
    status: normalizePlannerText(row.status, 40) || null,
    provider: normalizePlannerText(row.provider, 80) || null,
    model: normalizePlannerText(row.model, 120) || null,
    started_at: reportPickIso(row.started_at_utc, row.created_at),
    ended_at: reportPickIso(row.completed_at_utc, row.last_event_at_utc),
    last_event_at: reportPickIso(row.last_event_at_utc, row.completed_at_utc, row.started_at_utc, row.created_at),
  }));
}

async function queryAlertsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const jobFilter = buildNumberInClause("job_id", runContext.jobIds);
  const stepFilter = buildNumberInClause("step_id", runContext.stepIds);
  const cameraFilter = buildNumberInClause("camera_id", runContext.cameraIds);
  const jobRunFilter = buildTextInClause("job_run_id", runContext.jobRunIds);
  const stepRunFilter = buildTextInClause("step_run_id", runContext.stepRunIds);
  const agentRunFilter = buildTextInClause("agent_run_id", runContext.agentRunIds);
  const rows = await runQuery(
    params.db,
    `SELECT
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
       message,
       COALESCE(created_at, sent_at) AS created_at
     FROM job_run_alerts
     WHERE COALESCE(created_at, sent_at) >= ?
       AND COALESCE(created_at, sent_at) <= ?${jobFilter.clause}${stepFilter.clause}${cameraFilter.clause}${jobRunFilter.clause}${stepRunFilter.clause}${agentRunFilter.clause}
     ORDER BY COALESCE(created_at, sent_at) DESC
     LIMIT ${Math.max(1, Math.min(params.plan.intent.filters.limit, 120))}`,
    [
      window.startAt,
      window.endAt,
      ...jobFilter.params,
      ...stepFilter.params,
      ...cameraFilter.params,
      ...jobRunFilter.params,
      ...stepRunFilter.params,
      ...agentRunFilter.params,
    ]
  );
  return rows.map((row) => ({
    alert_uid: normalizePlannerText(row.alert_uid, 160),
    job_run_id: normalizePlannerText(row.job_run_id, 160) || null,
    step_run_id: normalizePlannerText(row.step_run_id, 160) || null,
    agent_run_id: normalizePlannerText(row.agent_run_id, 160) || null,
    job_id: Number(row.job_id || 0) || null,
    step_id: Number(row.step_id || 0) || null,
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    priority_level: normalizePlannerText(row.priority_level, 40) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence || 0) || null,
    provider: normalizePlannerText(row.provider, 80) || null,
    model: normalizePlannerText(row.model, 120) || null,
    message: normalizePlannerText(row.message, 240) || null,
    created_at: reportPickIso(row.created_at),
  }));
}

async function queryCameraSessionsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const cameraFilter = buildNumberInClause("camera_id", runContext.cameraIds);
  const rows = await runQuery(
    params.db,
    `SELECT
       camera_session_id,
       camera_id,
       camera_name,
       status,
       COALESCE(start_requested_at, started_at, online_at, created_at) AS started_at,
       COALESCE(stopped_at, last_event_at) AS ended_at
     FROM camera_runtime_sessions
     WHERE user_id = ?
       AND COALESCE(last_event_at, stopped_at, online_at, started_at, start_requested_at, created_at) >= ?
       AND COALESCE(last_event_at, stopped_at, online_at, started_at, start_requested_at, created_at) <= ?${cameraFilter.clause}
     ORDER BY COALESCE(last_event_at, stopped_at, online_at, started_at, start_requested_at, created_at) DESC
     LIMIT ${Math.max(1, Math.min(params.plan.intent.filters.limit, 120))}`,
    [params.userId, window.startAt, window.endAt, ...cameraFilter.params]
  );
  return rows.map((row) => ({
    camera_session_id: normalizePlannerText(row.camera_session_id, 160),
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    status: normalizePlannerText(row.status, 40) || null,
    started_at: reportPickIso(row.started_at),
    ended_at: reportPickIso(row.ended_at),
  }));
}

async function queryConnectivityIncidentsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<Array<Record<string, unknown>>> {
  const runContext = buildRunContext(params.plan);
  const window = buildQueryWindow(params.plan, params.context);
  const cameraFilter = buildNumberInClause("camera_id", runContext.cameraIds);
  const rows = await runQuery(
    params.db,
    `SELECT
       incident_id,
       camera_session_id,
       camera_id,
       camera_name,
       failure_reason,
       status,
       started_at,
       recovered_at
     FROM connectivity_incidents
     WHERE user_id = ?
       AND ((started_at >= ? AND started_at <= ?) OR (recovered_at IS NOT NULL AND recovered_at >= ? AND recovered_at <= ?))${cameraFilter.clause}
     ORDER BY COALESCE(recovered_at, started_at, updated_at, created_at) DESC
     LIMIT ${Math.max(1, Math.min(params.plan.intent.filters.limit, 120))}`,
    [params.userId, window.startAt, window.endAt, window.startAt, window.endAt, ...cameraFilter.params]
  );
  return rows.map((row) => ({
    incident_id: normalizePlannerText(row.incident_id, 160),
    camera_session_id: normalizePlannerText(row.camera_session_id, 160) || null,
    camera_id: Number(row.camera_id || 0) || null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    status: normalizePlannerText(row.status, 40) || null,
    failure_reason: normalizePlannerText(row.failure_reason, 160) || null,
    started_at: reportPickIso(row.started_at),
    ended_at: reportPickIso(row.recovered_at),
  }));
}

async function queryPrimaryRowsDb(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<{
  source: OperationalExecutionSource | "none";
  rows: Array<Record<string, unknown>>;
  datasets: Partial<Record<OperationalExecutionSource, Array<Record<string, unknown>>>>;
}> {
  const source = params.plan.execution[0]?.source ?? "state";
  switch (source) {
    case "identity_cards": {
      const rows = await queryIdentityCardsDb(params);
      return { source, rows, datasets: { identity_cards: rows } };
    }
    case "cameras": {
      const rows = await queryCamerasDb(params);
      return { source, rows, datasets: { cameras: rows } };
    }
    case "job_runs": {
      const rows = await queryJobRunsDb(params);
      return { source, rows, datasets: { job_runs: rows } };
    }
    case "step_runs": {
      const rows = await queryStepRunsDb(params);
      return { source, rows, datasets: { step_runs: rows } };
    }
    case "agent_runs": {
      const rows = await queryAgentRunsDb(params);
      return { source, rows, datasets: { agent_runs: rows } };
    }
    case "alerts": {
      const rows = await queryAlertsDb(params);
      return { source, rows, datasets: { alerts: rows } };
    }
    case "camera_sessions": {
      const rows = await queryCameraSessionsDb(params);
      return { source, rows, datasets: { camera_sessions: rows } };
    }
    case "connectivity_incidents": {
      const rows = await queryConnectivityIncidentsDb(params);
      return { source, rows, datasets: { connectivity_incidents: rows } };
    }
    default:
      return { source: "state", rows: [], datasets: {} };
  }
}

export async function executeOperationalPlanDbFirst(params: {
  db: D1Database;
  userId: string;
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): Promise<OperationalExecutionResult> {
  try {
    const { source, rows, datasets } = await queryPrimaryRowsDb(params);
    return composeOperationalExecutionResult({
      plan: params.plan,
      context: params.context,
      source,
      rows,
      datasets,
    });
  } catch {
    return executeOperationalPlan({
      plan: params.plan,
      context: params.context,
    });
  }
}
