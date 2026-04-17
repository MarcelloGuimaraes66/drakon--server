import { normalizePlannerLanguage, readContextArray } from "./grounding";
import type {
  OperationalExecutionResult,
  OperationalExecutionSource,
  OperationalPlannerContext,
  ResolvedOperationalPlan,
} from "./schema";

type JsonRecord = Record<string, unknown>;

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, Math.max(0, maxLength));
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

function normalizeTextArray(value: unknown, maxItems = 8): string[] {
  const rawEntries = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of rawEntries) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeText(entry, 240);
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeIdentityFeatureCandidateTexts(value: unknown, maxItems = 8): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const text = normalizeText((entry as JsonRecord).text, 160);
    if (!text) continue;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeIdentitySummary(value: unknown): string {
  const text = normalizeText(value, 320);
  if (!text) return "";
  return text
    .replace(/^identity signature\s*:\s*/i, "")
    .replace(/^assinatura de identidade\s*:\s*/i, "")
    .replace(/^assinatura visual\s*:\s*/i, "")
    .trim();
}

function isAggregateIdentityDescription(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    normalized.includes("contagem parcial") ||
    normalized.includes("total acumulado") ||
    normalized.includes("partial count") ||
    normalized.includes("total so far") ||
    normalized.includes("window") ||
    normalized.includes("segment")
  );
}

function extractIdentityTraitLines(card: JsonRecord | null): string[] {
  if (!card) return [];
  const explicitTraits = normalizeTextArray([
    ...normalizeTextArray(card.identity_signature_traits, 12),
    ...normalizeTextArray(card.key_traits, 12),
    ...normalizeTextArray(card.stable_attributes, 12),
  ], 12);
  const featureCandidateTraits = normalizeIdentityFeatureCandidateTexts(
    card.identity_feature_candidates,
    12
  );
  const summary = normalizeIdentitySummary(card.identity_signature_summary);
  const summaryTraits = summary
    ? summary
        .split(/[;,|]/)
        .map((entry) => normalizeText(entry, 120))
        .filter(Boolean)
    : [];
  const description = normalizeText(card.description, 280);
  const descriptionTraits =
    description && !isAggregateIdentityDescription(description) ? [description] : [];
  const mergedTraits = normalizeTextArray(
    [...explicitTraits, ...summaryTraits, ...featureCandidateTraits, ...descriptionTraits],
    12
  );
  if (mergedTraits.length > 0) {
    return mergedTraits.slice(0, 6);
  }

  if (summary) {
    return summaryTraits.slice(0, 6);
  }
  if (featureCandidateTraits.length > 0) {
    return featureCandidateTraits.slice(0, 6);
  }
  return [];
}

function formatPortraitKind(value: unknown, isPt: boolean): string {
  const normalized = normalizeText(value, 80).toLowerCase();
  if (!normalized) return isPt ? "nao informado" : "not specified";
  if (normalized === "face") return isPt ? "rosto" : "face";
  if (normalized === "full_object") return isPt ? "objeto inteiro" : "full object";
  return normalized;
}

function formatIdentityCardEntry(
  row: Record<string, unknown>,
  index: number,
  isPt: boolean
): string {
  const card = parseJsonRecord(row.card_json);
  const resolvedIdentity =
    parseJsonRecord(row.resolved_identity_json) || parseJsonRecord(card?.resolved_identity);
  const lastSeen = parseJsonRecord(card?.last_seen);
  const displayName =
    normalizeText(row.display_name, 120) ||
    normalizeText(card?.display_name, 120) ||
    normalizeText(row.identity_card_id, 120) ||
    (isPt ? "Identidade" : "Identity");
  const resolvedName =
    normalizeText(resolvedIdentity?.target_name, 120) ||
    normalizeText(card?.known_name, 120);
  const title = resolvedName ? `${displayName} -> ${resolvedName}` : displayName;
  const createdAt =
    formatIsoShort(row.created_at) ||
    formatIsoShort(lastSeen?.timestamp_utc_iso) ||
    (isPt ? "horario n/a" : "time n/a");
  const cameraName =
    normalizeText(row.camera_name, 120) ||
    normalizeText(lastSeen?.camera_name, 120) ||
    (isPt ? "camera n/a" : "camera n/a");
  const zone = normalizeText(lastSeen?.zone, 120);
  const hasCrop = normalizeText(row.crop_url, 240).length > 0;
  const cropText = isPt ? (hasCrop ? "sim" : "nao") : hasCrop ? "yes" : "no";
  const portraitKind = formatPortraitKind(row.portrait_kind || card?.portrait_kind, isPt);
  const traits = extractIdentityTraitLines(card);
  const description = normalizeText(card?.description, 280);
  const signatureSummary = normalizeIdentitySummary(card?.identity_signature_summary);
  const contextTraits = normalizeTextArray(card?.identity_context_traits, 4);
  const resolvedDescription = normalizeText(resolvedIdentity?.target_description, 280);

  const lines = [
    `### ${index + 1}. ${title}`,
    isPt ? `- Camera: ${cameraName}` : `- Camera: ${cameraName}`,
    isPt ? `- Horario: ${createdAt}` : `- Time: ${createdAt}`,
    zone ? (isPt ? `- Zona: ${zone}` : `- Zone: ${zone}`) : "",
    isPt ? `- Crop: ${cropText}` : `- Crop: ${cropText}`,
    isPt ? `- Retrato: ${portraitKind}` : `- Portrait: ${portraitKind}`,
    resolvedName && resolvedDescription
      ? isPt
        ? `- Perfil conhecido: ${resolvedName} | ${resolvedDescription}`
        : `- Known profile: ${resolvedName} | ${resolvedDescription}`
      : resolvedName
      ? isPt
        ? `- Identidade resolvida: ${resolvedName}`
        : `- Resolved identity: ${resolvedName}`
      : "",
    traits.length > 0
      ? isPt
        ? `- Caracteristicas: ${traits.join("; ")}`
        : `- Traits: ${traits.join("; ")}`
      : signatureSummary
      ? isPt
        ? `- Assinatura visual: ${signatureSummary}`
        : `- Visual signature: ${signatureSummary}`
      : description && !isAggregateIdentityDescription(description)
      ? isPt
        ? `- Descricao: ${description}`
        : `- Description: ${description}`
      : isPt
      ? "- Caracteristicas persistidas: nao disponiveis neste card."
      : "- Persisted traits: not available for this card.",
    contextTraits.length > 0
      ? isPt
        ? `- Contexto visual: ${contextTraits.join("; ")}`
        : `- Visual context: ${contextTraits.join("; ")}`
      : "",
  ];

  return lines.filter((entry) => entry.length > 0).join("\n");
}

function toNumberSet(values: Array<number | string>): Set<number> {
  return new Set(
    values
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
}

function filterRowsByScope(
  rows: Array<Record<string, unknown>>,
  plan: ResolvedOperationalPlan
): Array<Record<string, unknown>> {
  const cameraIds = toNumberSet(plan.intent.scope.cameras);
  const jobIds = toNumberSet(plan.intent.scope.jobs);
  const stepIds = toNumberSet(plan.intent.scope.steps);

  return rows.filter((row) => {
    const cameraId = asFiniteNumber(row.camera_id);
    const jobId = asFiniteNumber(row.job_id);
    const stepId = asFiniteNumber(row.step_id);

    if (cameraIds.size > 0 && cameraId !== null && !cameraIds.has(cameraId)) return false;
    if (jobIds.size > 0 && jobId !== null && !jobIds.has(jobId)) return false;
    if (stepIds.size > 0 && stepId !== null && !stepIds.has(stepId)) return false;
    return true;
  });
}

function trimDataset(
  rows: Array<Record<string, unknown>>,
  limit: number
): Array<Record<string, unknown>> {
  if (limit <= 0 || rows.length <= limit) return rows;
  return rows.slice(0, limit);
}

function primaryRowsForPlan(
  plan: ResolvedOperationalPlan,
  context: OperationalPlannerContext
): {
  source: OperationalExecutionSource | "none";
  rows: Array<Record<string, unknown>>;
  datasets: Partial<Record<OperationalExecutionSource, Array<Record<string, unknown>>>>;
} {
  const datasets = {
    identity_cards: readContextArray(context, ["details", "identity_cards"], ["history", "recent_identity_cards"]),
    job_runs: readContextArray(context, ["details", "job_runs"], ["history", "recent_job_runs"]),
    step_runs: readContextArray(context, ["details", "step_runs"], ["history", "recent_step_runs"]),
    agent_runs: readContextArray(context, ["details", "agent_runs"], ["history", "recent_agent_runs"]),
    alerts: readContextArray(context, ["details", "alerts"], ["history", "recent_alerts"]),
    camera_sessions: readContextArray(context, ["details", "camera_sessions"], ["history", "recent_camera_sessions"]),
    connectivity_incidents: readContextArray(
      context,
      ["details", "connectivity_incidents"],
      ["history", "recent_connectivity_incidents"]
    ),
  } satisfies Partial<Record<OperationalExecutionSource, Array<Record<string, unknown>>>>;

  const primarySource = plan.execution[0]?.source ?? "state";
  if (primarySource === "state") {
    return {
      source: "state",
      rows: [],
      datasets,
    };
  }

  const primaryRows = trimDataset(
    filterRowsByScope(datasets[primarySource] || [], plan),
    plan.intent.filters.limit
  );
  if (primarySource === "identity_cards" && !plan.intent.filters.include_crop) {
    return {
      source: primarySource,
      rows: primaryRows.map((row) => {
        const clone = { ...row };
        delete clone.crop_url;
        delete clone.crop_storage_key;
        return clone;
      }),
      datasets: {
        ...datasets,
        identity_cards: primaryRows,
      },
    };
  }

  return {
    source: primarySource,
    rows: primaryRows,
    datasets: {
      ...datasets,
      [primarySource]: primaryRows,
    },
  };
}

function formatIsoShort(value: unknown): string {
  const iso = normalizeText(value, 40);
  if (!iso) return "";
  return iso.replace("T", " ").replace(".000Z", "Z");
}

function buildCountIntro(
  isPt: boolean,
  matchedCount: number,
  requestedCount: number,
  scopeLabel: string
): string {
  if (requestedCount > 0 && matchedCount > 0 && matchedCount < requestedCount) {
    return isPt
      ? `- Encontrei ${matchedCount} registro(s) no escopo "${scopeLabel}". Voce pediu ${requestedCount}.`
      : `- I found ${matchedCount} record(s) in the "${scopeLabel}" scope. You asked for ${requestedCount}.`;
  }
  return isPt
    ? `- Encontrei ${matchedCount} registro(s) no escopo "${scopeLabel}".`
    : `- I found ${matchedCount} record(s) in the "${scopeLabel}" scope.`;
}

function buildIdentityCardsAnswer(
  rows: Array<Record<string, unknown>>,
  plan: ResolvedOperationalPlan
): string {
  const isPt = normalizePlannerLanguage(plan.intent.output.language, "en").startsWith("pt");
  if (rows.length === 0) {
    return isPt
      ? "Nao encontrei identity cards persistidos nesse recorte operacional."
      : "I did not find persisted identity cards in that operational window.";
  }

  const lines = rows
    .slice(0, plan.intent.filters.limit)
    .map((row, index) => formatIdentityCardEntry(row, index, isPt));

  const header = isPt ? "## Identity cards persistidos" : "## Persisted identity cards";
  const intro = buildCountIntro(
    isPt,
    rows.length,
    plan.intent.filters.limit,
    plan.resolved.time_window.label
  );
  return [header, "", intro, "", ...lines].join("\n");
}

function buildRunsAnswer(
  rows: Array<Record<string, unknown>>,
  plan: ResolvedOperationalPlan,
  heading: string,
  emptyPt: string,
  emptyEn: string,
  nameField: string
): string {
  const isPt = normalizePlannerLanguage(plan.intent.output.language, "en").startsWith("pt");
  if (rows.length === 0) {
    return isPt ? emptyPt : emptyEn;
  }

  const lines = rows.slice(0, plan.intent.filters.limit).map((row, index) => {
    const name =
      normalizeText(row[nameField], 120) ||
      normalizeText(row.camera_name, 120) ||
      normalizeText(row.agent_key, 120) ||
      heading;
    const status = normalizeText(row.status, 40) || "n/a";
    const when =
      formatIsoShort(row.ended_at) ||
      formatIsoShort(row.last_event_at) ||
      formatIsoShort(row.started_at) ||
      "n/a";
    return `${index + 1}. ${name} | status=${status} | ${when}`;
  });

  const intro = buildCountIntro(
    isPt,
    rows.length,
    plan.intent.filters.limit,
    plan.resolved.time_window.label
  );
  return [`## ${heading}`, "", intro, "", ...lines].join("\n");
}

function buildAlertsAnswer(rows: Array<Record<string, unknown>>, plan: ResolvedOperationalPlan): string {
  const isPt = normalizePlannerLanguage(plan.intent.output.language, "en").startsWith("pt");
  if (rows.length === 0) {
    return isPt
      ? "Nao encontrei alertas nesse recorte operacional."
      : "I did not find alerts in that operational window.";
  }
  const lines = rows.slice(0, plan.intent.filters.limit).map((row, index) => {
    const camera = normalizeText(row.camera_name, 120) || "camera";
    const priority = normalizeText(row.priority_level, 40) || "n/a";
    const createdAt = formatIsoShort(row.created_at) || "n/a";
    const message = normalizeText(row.message, 160);
    return `${index + 1}. ${camera} | prioridade=${priority} | ${createdAt}${message ? ` | ${message}` : ""}`;
  });
  const intro = buildCountIntro(
    isPt,
    rows.length,
    plan.intent.filters.limit,
    plan.resolved.time_window.label
  );
  return ["## Alerts", "", intro, "", ...lines].join("\n");
}

function buildStateAnswer(plan: ResolvedOperationalPlan, context: OperationalPlannerContext): string {
  const isPt = normalizePlannerLanguage(plan.intent.output.language, "en").startsWith("pt");
  const currentState = (context.current_state || {}) as Record<string, unknown>;
  const cameraSnapshots = Array.isArray(currentState.camera_snapshots)
    ? currentState.camera_snapshots.length
    : 0;
  const runningJobs = Array.isArray(currentState.running_jobs) ? currentState.running_jobs.length : 0;
  const activeJobRuns = Array.isArray(currentState.active_job_runs)
    ? currentState.active_job_runs.length
    : 0;
  return isPt
    ? `## Estado operacional\n\n- Janela: ${plan.resolved.time_window.label}.\n- Camera snapshots: ${cameraSnapshots}.\n- Running jobs: ${runningJobs}.\n- Active job runs: ${activeJobRuns}.`
    : `## Operational state\n\n- Window: ${plan.resolved.time_window.label}.\n- Camera snapshots: ${cameraSnapshots}.\n- Running jobs: ${runningJobs}.\n- Active job runs: ${activeJobRuns}.`;
}

function buildClarificationOptions(plan: ResolvedOperationalPlan): string[] {
  const options: string[] = [];
  if (plan.resolved.ambiguities.includes("job_reference_unresolved")) options.push("job");
  if (plan.resolved.ambiguities.includes("step_reference_unresolved")) options.push("step");
  if (plan.resolved.ambiguities.includes("agent_reference_unresolved")) options.push("agent");
  if (plan.resolved.ambiguities.includes("camera_reference_unresolved")) options.push("camera");
  if (
    plan.resolved.ambiguities.includes("job_run_reference_unresolved") ||
    plan.resolved.ambiguities.includes("job_run_reference_ambiguous")
  ) {
    options.push("job_run");
  }
  if (
    plan.resolved.ambiguities.includes("step_run_reference_unresolved") ||
    plan.resolved.ambiguities.includes("step_run_reference_ambiguous")
  ) {
    options.push("step_run");
  }
  if (
    plan.resolved.ambiguities.includes("agent_run_reference_unresolved") ||
    plan.resolved.ambiguities.includes("agent_run_reference_ambiguous")
  ) {
    options.push("agent_run");
  }
  return options;
}

function buildDraftAnswer(
  plan: ResolvedOperationalPlan,
  primarySource: OperationalExecutionSource | "none",
  rows: Array<Record<string, unknown>>,
  context: OperationalPlannerContext
): string {
  if (plan.resolved.ambiguities.length > 0 && rows.length === 0) {
    const isPt = normalizePlannerLanguage(plan.intent.output.language, "en").startsWith("pt");
    const targets = buildClarificationOptions(plan).join(", ");
    return isPt
      ? `Preciso de um pouco mais de contexto para resolver a consulta operacional. Referencias nao resolvidas: ${targets}.`
      : `I need a bit more context to resolve that operational query. Unresolved references: ${targets}.`;
  }

  switch (primarySource) {
    case "identity_cards":
      return buildIdentityCardsAnswer(rows, plan);
    case "job_runs":
      return buildRunsAnswer(
        rows,
        plan,
        "Job runs",
        "Nao encontrei job runs nesse recorte operacional.",
        "I did not find job runs in that operational window.",
        "job_name"
      );
    case "step_runs":
      return buildRunsAnswer(
        rows,
        plan,
        "Step runs",
        "Nao encontrei step runs nesse recorte operacional.",
        "I did not find step runs in that operational window.",
        "step_name"
      );
    case "agent_runs":
      return buildRunsAnswer(
        rows,
        plan,
        "Agent runs",
        "Nao encontrei agent runs nesse recorte operacional.",
        "I did not find agent runs in that operational window.",
        "agent_key"
      );
    case "alerts":
      return buildAlertsAnswer(rows, plan);
    case "camera_sessions":
      return buildRunsAnswer(
        rows,
        plan,
        "Camera sessions",
        "Nao encontrei camera sessions nesse recorte operacional.",
        "I did not find camera sessions in that operational window.",
        "camera_name"
      );
    case "connectivity_incidents":
      return buildRunsAnswer(
        rows,
        plan,
        "Connectivity incidents",
        "Nao encontrei incidentes de conectividade nesse recorte operacional.",
        "I did not find connectivity incidents in that operational window.",
        "camera_name"
      );
    default:
      return buildStateAnswer(plan, context);
  }
}

export function composeOperationalExecutionResult(params: {
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
  source: OperationalExecutionSource | "none";
  rows: Array<Record<string, unknown>>;
  datasets: Partial<Record<OperationalExecutionSource, Array<Record<string, unknown>>>>;
}): OperationalExecutionResult {
  const draftAnswer = buildDraftAnswer(params.plan, params.source, params.rows, params.context);
  const evidenceSources =
    params.source === "none" ? [] : [params.source, ...(params.plan.execution[0]?.joins ?? [])];
  return {
    ok: true,
    draft_answer: draftAnswer,
    needs_clarification: params.plan.resolved.ambiguities.length > 0 && params.rows.length === 0,
    clarification_options: buildClarificationOptions(params.plan),
    summary: {
      primary_source: params.source,
      matched_count: params.rows.length,
      scope_label: params.plan.resolved.time_window.label,
      evidence_sources: Array.from(
        new Set(evidenceSources.filter((entry) => entry.length > 0))
      ),
    },
    datasets: params.datasets,
  };
}

export function executeOperationalPlan(params: {
  plan: ResolvedOperationalPlan;
  context: OperationalPlannerContext;
}): OperationalExecutionResult {
  const { source, rows, datasets } = primaryRowsForPlan(params.plan, params.context);
  return composeOperationalExecutionResult({
    plan: params.plan,
    context: params.context,
    source,
    rows,
    datasets,
  });
}
