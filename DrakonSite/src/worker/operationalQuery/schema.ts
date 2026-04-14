export type IntentFamily =
  | "read_operational"
  | "search_media"
  | "create_config"
  | "edit_config"
  | "run_action"
  | "report"
  | "answer";

export type PlannerMode = "none" | "operational_query" | "mutation_grounding";

export type OperationalTask =
  | "lookup"
  | "aggregate"
  | "compare"
  | "correlate"
  | "explain"
  | "investigate";

export type OperationalSubjectEntity =
  | "identity_occurrence"
  | "identity"
  | "person"
  | "object"
  | "job_run"
  | "step_run"
  | "agent_run"
  | "event"
  | "alert"
  | "camera"
  | "camera_session"
  | "connectivity_incident"
  | "media"
  | "state";

export type OperationalView = "cards" | "table" | "timeline" | "summary" | "graph";

export type OperationalResolvedEntityType =
  | "camera"
  | "job"
  | "step"
  | "agent"
  | "job_run"
  | "step_run"
  | "agent_run";

export type OperationalResolvedEntity = {
  entity_type: OperationalResolvedEntityType;
  id: number | string;
  name: string;
  label: string;
  confidence: number;
  match_reason?: string | null;
  camera_id?: number | null;
  camera_name?: string | null;
  job_id?: number | null;
  job_name?: string | null;
  step_id?: number | null;
  step_name?: string | null;
  agent_scope_type?: string | null;
};

export type OperationalResolvedScope = {
  cameras: OperationalResolvedEntity[];
  jobs: OperationalResolvedEntity[];
  steps: OperationalResolvedEntity[];
  agents: OperationalResolvedEntity[];
  job_runs: OperationalResolvedEntity[];
  step_runs: OperationalResolvedEntity[];
  agent_runs: OperationalResolvedEntity[];
  is_specific: boolean;
  ambiguities: string[];
};

export type OperationalIntent = {
  version: 1;
  task: OperationalTask;
  subject: {
    entity: OperationalSubjectEntity;
    view: OperationalView;
  };
  scope: {
    jobs: Array<number | string>;
    steps: Array<number | string>;
    agents: Array<number | string>;
    cameras: Array<number | string>;
    job_runs: Array<number | string>;
    step_runs: Array<number | string>;
    agent_runs: Array<number | string>;
  };
  time: {
    kind: "relative" | "calendar_day" | "absolute_range" | "run_ref";
    raw_text: string;
    timezone: string;
  };
  filters: {
    limit: number;
    include_crop: boolean;
    include_media: boolean;
    identity_refs: string[];
  };
  analysis: {
    group_by: string[];
    metrics: string[];
    join_targets: string[];
  };
  output: {
    language: string;
    format: OperationalView;
  };
};

export type OperationalExecutionSource =
  | "identity_cards"
  | "job_runs"
  | "step_runs"
  | "agent_runs"
  | "alerts"
  | "camera_sessions"
  | "connectivity_incidents"
  | "state";

export type OperationalExecutionStep = {
  source: OperationalExecutionSource;
  strategy: "filter_join_sort_limit" | "summarize";
  joins: string[];
  order_by: string;
  limit: number;
};

export type ResolvedTimeWindow = {
  kind: "relative" | "calendar_day" | "absolute_range" | "run_ref";
  timezone: string;
  raw_text: string;
  start_at: string;
  end_at: string;
  label: string;
};

export type ResolvedOperationalPlan = {
  version: 1;
  intent_family: IntentFamily;
  planner_mode: PlannerMode;
  intent: OperationalIntent;
  resolved: OperationalResolvedScope & {
    time_window: ResolvedTimeWindow;
  };
  execution: OperationalExecutionStep[];
  answer_plan: {
    shape: OperationalView;
    evidence_level: "low" | "medium" | "high";
  };
  confidence: number;
};

export type OperationalPlannerContext = {
  report_id?: string;
  requested_query: string;
  reply_language: string;
  scope: {
    start_at: string;
    end_at: string;
    time_window_hours: number;
    label: string;
    focus: string[];
  };
  stats?: Record<string, unknown>;
  current_state?: Record<string, unknown>;
  history?: Record<string, unknown>;
  comparisons?: Record<string, unknown>;
  chat_discussion?: Record<string, unknown>;
  resolved_entities?: Record<string, unknown>;
  details?: Record<string, unknown>;
};

export type OperationalExecutionResult = {
  ok: boolean;
  draft_answer: string;
  needs_clarification: boolean;
  clarification_options: string[];
  summary: {
    primary_source: OperationalExecutionSource | "none";
    matched_count: number;
    scope_label: string;
    evidence_sources: string[];
  };
  datasets: Partial<Record<OperationalExecutionSource, Array<Record<string, unknown>>>>;
};
