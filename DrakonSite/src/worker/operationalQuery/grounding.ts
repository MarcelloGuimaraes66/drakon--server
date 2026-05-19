import type {
  OperationalPlannerContext,
  OperationalResolvedEntity,
  OperationalResolvedScope,
  OperationalSubjectEntity,
  OperationalTask,
  OperationalView,
  ResolvedTimeWindow,
} from "./schema";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizePlannerText(value: unknown, maxLength = 1800): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, Math.max(0, maxLength));
}

export function normalizePlannerLanguage(value: unknown, fallback = "en"): string {
  const normalized = normalizePlannerText(value, 24).toLowerCase();
  if (!normalized) return fallback;
  if (normalized.startsWith("pt")) return "pt-BR";
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("ar")) return "ar";
  return "en";
}

export function plannerQueryIncludesAny(query: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle.length > 0 && query.includes(needle));
}

export function plannerParseLimit(queryInput: string, fallback: number, max = 100): number {
  const query = queryInput.toLowerCase();
  const match = query.match(/\b(\d{1,3})\b/);
  if (!match) return fallback;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function mapResolvedEntity(entityType: OperationalResolvedEntity["entity_type"], value: unknown) {
  const row = asRecord(value);
  if (!row) return null;

  const idValue = row.id;
  const name = normalizePlannerText(row.name, 160);
  const label = normalizePlannerText(row.label, 200) || name;
  if (
    !(typeof idValue === "number" && Number.isFinite(idValue)) &&
    !(typeof idValue === "string" && idValue.trim().length > 0)
  ) {
    return null;
  }

  return {
    entity_type: entityType,
    id: typeof idValue === "string" ? idValue.trim() : idValue,
    name,
    label: label || name || `${entityType}`,
    confidence: 0.9,
    match_reason: normalizePlannerText(row.match_reason, 120) || null,
    camera_id:
      typeof row.camera_id === "number" && Number.isFinite(row.camera_id) ? row.camera_id : null,
    camera_name: normalizePlannerText(row.camera_name, 160) || null,
    job_id: typeof row.job_id === "number" && Number.isFinite(row.job_id) ? row.job_id : null,
    job_name: normalizePlannerText(row.job_name, 160) || null,
    step_id: typeof row.step_id === "number" && Number.isFinite(row.step_id) ? row.step_id : null,
    step_name: normalizePlannerText(row.step_name, 160) || null,
    agent_scope_type: normalizePlannerText(row.agent_scope_type, 80) || null,
  } satisfies OperationalResolvedEntity;
}

export function resolveScopeFromContext(context: OperationalPlannerContext): OperationalResolvedScope {
  const resolved = asRecord(context.resolved_entities);
  const readGroup = (
    key: "cameras" | "jobs" | "steps" | "agents",
    entityType: OperationalResolvedEntity["entity_type"]
  ) => {
    const items: OperationalResolvedEntity[] = [];
    for (const entry of asArray(resolved?.[key])) {
      const mapped = mapResolvedEntity(entityType, entry);
      if (mapped) {
        items.push(mapped);
      }
    }
    return items;
  };

  return {
    cameras: readGroup("cameras", "camera"),
    jobs: readGroup("jobs", "job"),
    steps: readGroup("steps", "step"),
    agents: readGroup("agents", "agent"),
    job_runs: [],
    step_runs: [],
    agent_runs: [],
    is_specific: resolved?.is_specific === true,
    ambiguities: [],
  };
}

export function resolveTimeWindowFromContext(
  queryInput: string,
  timezone: string,
  context: OperationalPlannerContext
): ResolvedTimeWindow {
  const query = queryInput.toLowerCase();
  const scope = asRecord(context.scope) || {};
  let kind: ResolvedTimeWindow["kind"] = "relative";
  if (plannerQueryIncludesAny(query, ["ontem", "yesterday", "today", "hoje"])) {
    kind = "calendar_day";
  } else if (plannerQueryIncludesAny(query, ["between", "entre", " from ", " ate ", " to "])) {
    kind = "absolute_range";
  } else if (plannerQueryIncludesAny(query, ["run", "execucao", "execution"])) {
    kind = "run_ref";
  }

  return {
    kind,
    timezone: normalizePlannerText(timezone, 80) || "UTC",
    raw_text: normalizePlannerText(queryInput, 200),
    start_at: normalizePlannerText(scope.start_at, 80),
    end_at: normalizePlannerText(scope.end_at, 80),
    label: normalizePlannerText(scope.label, 180) || "current operational window",
  };
}

export function detectOperationalTask(queryInput: string): OperationalTask {
  const query = queryInput.toLowerCase();
  if (plannerQueryIncludesAny(query, ["compare", "compar", " vs ", "versus"])) {
    return "compare";
  }
  if (plannerQueryIncludesAny(query, ["correl", "cruze", "cross", "relationship"])) {
    return "correlate";
  }
  if (plannerQueryIncludesAny(query, ["investigue", "investigate", "why", "por que", "porque"])) {
    return "investigate";
  }
  if (plannerQueryIncludesAny(query, ["explique", "explain", "motivo", "reason"])) {
    return "explain";
  }
  if (
    plannerQueryIncludesAny(query, [
      "count",
      "how many",
      "quantos",
      "quantas",
      "total",
      "aggregate",
      "ranking",
      "top",
    ])
  ) {
    return "aggregate";
  }
  return "lookup";
}

export function detectOperationalSubjectEntity(
  queryInput: string,
  context: OperationalPlannerContext
): OperationalSubjectEntity {
  const query = queryInput.toLowerCase();
  if (
    plannerQueryIncludesAny(query, [
      "identity card",
      "identity cards",
      "id card",
      "id cards",
      "identidade",
      "identidades",
      "person card",
      "people card",
      "person cards",
      "card de pessoa",
      "cards de pessoas",
      "pessoa",
      "pessoas",
      "person",
      "people",
    ])
  ) {
    return "identity_occurrence";
  }
  if (
    plannerQueryIncludesAny(query, [
      "step run",
      "step runs",
      "execucao do step",
      "execucoes do step",
    ])
  ) {
    return "step_run";
  }
  if (
    plannerQueryIncludesAny(query, [
      "agent run",
      "agent runs",
      "execucao do agente",
      "execucoes do agente",
    ])
  ) {
    return "agent_run";
  }
  if (
    plannerQueryIncludesAny(query, [
      "job run",
      "job runs",
      "execucao da tarefa",
      "execucoes da tarefa",
    ])
  ) {
    return "job_run";
  }
  if (plannerQueryIncludesAny(query, ["alert", "alerts", "alerta", "alertas"])) {
    return "alert";
  }
  if (
    plannerQueryIncludesAny(query, [
      "session",
      "sessions",
      "camera session",
      "camera sessions",
      "sessao",
      "sessoes",
    ])
  ) {
    return "camera_session";
  }
  if (
    plannerQueryIncludesAny(query, [
      "connectivity",
      "conectividade",
      "disconnect",
      "desconexao",
      "reconnect",
      "reconexao",
      "incident",
      "incidente",
    ])
  ) {
    return "connectivity_incident";
  }
  if (
    plannerQueryIncludesAny(query, [
      "camera",
      "cameras",
      "camara",
      "camaras",
      "câmera",
      "câmeras",
    ])
  ) {
    return "camera";
  }
  const focus = Array.isArray(context.scope?.focus) ? context.scope.focus : [];
  if (focus.includes("jobs")) return "job_run";
  if (focus.includes("agents")) return "agent_run";
  if (focus.includes("cameras")) return "camera";
  return "state";
}

export function detectOperationalView(
  queryInput: string,
  subject: OperationalSubjectEntity,
  task: OperationalTask
): OperationalView {
  const query = queryInput.toLowerCase();
  if (plannerQueryIncludesAny(query, ["timeline", "linha do tempo"])) return "timeline";
  if (plannerQueryIncludesAny(query, ["table", "tabela", "list", "lista"])) return "table";
  if (plannerQueryIncludesAny(query, ["graph", "grafico", "chart"])) return "graph";
  if (subject === "identity_occurrence") return "cards";
  if (task === "compare" || task === "correlate") return "table";
  return "summary";
}

export function buildOperationalAmbiguities(
  queryInput: string,
  resolved: OperationalResolvedScope
): string[] {
  const query = queryInput.toLowerCase();
  const ambiguities: string[] = [];
  const asksToEnumerateCameras =
    plannerQueryIncludesAny(query, ["camera", "cameras", "cam", "camara", "camaras"]) &&
    plannerQueryIncludesAny(query, [
      "list",
      "lista",
      "which",
      "quais",
      "show",
      "mostrar",
      "me traga",
      "quantos",
      "quantas",
      "how many",
      "count",
      "total",
    ]);
  if (
    plannerQueryIncludesAny(query, ["job", "jobs", "tarefa", "tarefas", "workflow"]) &&
    resolved.jobs.length === 0
  ) {
    ambiguities.push("job_reference_unresolved");
  }
  if (
    plannerQueryIncludesAny(query, ["step", "steps", "etapa", "etapas"]) &&
    resolved.steps.length === 0
  ) {
    ambiguities.push("step_reference_unresolved");
  }
  if (
    plannerQueryIncludesAny(query, ["agent", "agents", "agente", "agentes"]) &&
    resolved.agents.length === 0
  ) {
    ambiguities.push("agent_reference_unresolved");
  }
  if (
    plannerQueryIncludesAny(query, ["camera", "cameras", "cam", "camara", "camaras"]) &&
    !asksToEnumerateCameras &&
    resolved.cameras.length === 0
  ) {
    ambiguities.push("camera_reference_unresolved");
  }
  return ambiguities;
}

export function readContextArray(
  context: OperationalPlannerContext,
  pathA: [keyof OperationalPlannerContext, string],
  pathB?: [keyof OperationalPlannerContext, string]
): Array<Record<string, unknown>> {
  const read = (sourceKey: keyof OperationalPlannerContext, fieldName: string) => {
    const source = asRecord(context[sourceKey]);
    return asArray(source?.[fieldName]).filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    );
  };

  const primary = read(pathA[0], pathA[1]);
  if (primary.length > 0) return primary;
  if (!pathB) return primary;
  return read(pathB[0], pathB[1]);
}
