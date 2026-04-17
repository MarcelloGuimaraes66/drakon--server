import {
  buildOperationalAmbiguities,
  detectOperationalSubjectEntity,
  detectOperationalTask,
  detectOperationalView,
  normalizePlannerLanguage,
  normalizePlannerText,
  plannerParseLimit,
  plannerQueryIncludesAny,
  resolveScopeFromContext,
  resolveTimeWindowFromContext,
} from "./grounding";
import type {
  OperationalExecutionStep,
  OperationalIntent,
  OperationalPlannerContext,
  ResolvedOperationalPlan,
} from "./schema";

function buildExecutionSteps(intent: OperationalIntent): OperationalExecutionStep[] {
  const baseLimit = intent.filters.limit;
  switch (intent.subject.entity) {
    case "identity_occurrence":
    case "identity":
    case "person":
    case "object":
      return [
        {
          source: "identity_cards",
          strategy: "filter_join_sort_limit",
          joins: ["job_runs", "step_runs", "agent_runs"],
          order_by: "created_at_desc",
          limit: baseLimit,
        },
      ];
    case "job_run":
      return [
        {
          source: "job_runs",
          strategy: "filter_join_sort_limit",
          joins: ["step_runs", "agent_runs", "alerts", "identity_cards"],
          order_by: "last_event_at_desc",
          limit: baseLimit,
        },
      ];
    case "step_run":
      return [
        {
          source: "step_runs",
          strategy: "filter_join_sort_limit",
          joins: ["agent_runs", "alerts", "identity_cards"],
          order_by: "ended_at_desc",
          limit: baseLimit,
        },
      ];
    case "agent_run":
      return [
        {
          source: "agent_runs",
          strategy: "filter_join_sort_limit",
          joins: ["alerts"],
          order_by: "ended_at_desc",
          limit: baseLimit,
        },
      ];
    case "alert":
      return [
        {
          source: "alerts",
          strategy: "filter_join_sort_limit",
          joins: ["job_runs", "step_runs", "agent_runs"],
          order_by: "created_at_desc",
          limit: baseLimit,
        },
      ];
    case "camera_session":
      return [
        {
          source: "camera_sessions",
          strategy: "filter_join_sort_limit",
          joins: ["identity_cards", "alerts", "connectivity_incidents"],
          order_by: "started_at_desc",
          limit: baseLimit,
        },
      ];
    case "connectivity_incident":
      return [
        {
          source: "connectivity_incidents",
          strategy: "filter_join_sort_limit",
          joins: ["camera_sessions"],
          order_by: "started_at_desc",
          limit: baseLimit,
        },
      ];
    default:
      return [
        {
          source: "state",
          strategy: "summarize",
          joins: [],
          order_by: "none",
          limit: baseLimit,
        },
      ];
  }
}

export function buildOperationalPlan(params: {
  query: string;
  replyLanguage: string;
  timezone: string;
  context: OperationalPlannerContext;
}): ResolvedOperationalPlan {
  const query = normalizePlannerText(params.query, 1800);
  const replyLanguage = normalizePlannerLanguage(
    params.replyLanguage || params.context.reply_language,
    "en"
  );
  const resolved = resolveScopeFromContext(params.context);
  const task = detectOperationalTask(query);
  const subjectEntity = detectOperationalSubjectEntity(query, params.context);
  const view = detectOperationalView(query, subjectEntity, task);
  const limit = plannerParseLimit(query, subjectEntity === "identity_occurrence" ? 3 : 20, 120);
  const includeCrop =
    subjectEntity === "identity_occurrence" ||
    plannerQueryIncludesAny(query.toLowerCase(), ["crop", "portrait", "rosto", "face"]);
  const includeMedia = plannerQueryIncludesAny(query.toLowerCase(), [
    "video",
    "frame",
    "clip",
    "midia",
    "media",
  ]);
  const timeWindow = resolveTimeWindowFromContext(query, params.timezone, params.context);
  resolved.ambiguities = buildOperationalAmbiguities(query, resolved);

  const execution = buildExecutionSteps({
    version: 1,
    task,
    subject: {
      entity: subjectEntity,
      view,
    },
    scope: {
      jobs: [],
      steps: [],
      agents: [],
      cameras: [],
      job_runs: [],
      step_runs: [],
      agent_runs: [],
    },
    time: {
      kind: timeWindow.kind,
      raw_text: query,
      timezone: timeWindow.timezone,
    },
    filters: {
      limit,
      include_crop: includeCrop,
      include_media: includeMedia,
      identity_refs: [],
      source_event_refs: [],
    },
    analysis: {
      group_by: [],
      metrics: [],
      join_targets: [],
    },
    output: {
      language: replyLanguage,
      format: view,
    },
  });

  const intent: OperationalIntent = {
    version: 1,
    task,
    subject: {
      entity: subjectEntity,
      view,
    },
    scope: {
      jobs: resolved.jobs.map((entry) => entry.id),
      steps: resolved.steps.map((entry) => entry.id),
      agents: resolved.agents.map((entry) => entry.id),
      cameras: resolved.cameras.map((entry) => entry.id),
      job_runs: resolved.job_runs.map((entry) => entry.id),
      step_runs: resolved.step_runs.map((entry) => entry.id),
      agent_runs: resolved.agent_runs.map((entry) => entry.id),
    },
    time: {
      kind: timeWindow.kind,
      raw_text: query,
      timezone: timeWindow.timezone,
    },
    filters: {
      limit,
      include_crop: includeCrop,
      include_media: includeMedia,
      identity_refs: [],
      source_event_refs: [],
    },
    analysis: {
      group_by: task === "aggregate" ? ["time"] : [],
      metrics: task === "aggregate" ? ["count"] : [],
      join_targets: execution.flatMap((step) => step.joins),
    },
    output: {
      language: replyLanguage,
      format: view,
    },
  };

  const evidenceLevel =
    subjectEntity === "identity_occurrence" ||
    subjectEntity === "job_run" ||
    subjectEntity === "step_run" ||
    subjectEntity === "agent_run"
      ? "high"
      : "medium";
  const confidenceBase = 0.58;
  const confidenceResolvedBoost =
    resolved.jobs.length +
    resolved.steps.length +
    resolved.agents.length +
    resolved.cameras.length >
    0
      ? 0.18
      : 0;
  const confidenceAmbiguityPenalty = resolved.ambiguities.length > 0 ? 0.12 : 0;

  return {
    version: 1,
    intent_family: "read_operational",
    planner_mode: "operational_query",
    intent,
    resolved: {
      ...resolved,
      time_window: timeWindow,
    },
    execution,
    answer_plan: {
      shape: view,
      evidence_level: evidenceLevel,
    },
    confidence: Math.max(
      0,
      Math.min(0.98, confidenceBase + confidenceResolvedBoost - confidenceAmbiguityPenalty)
    ),
  };
}
