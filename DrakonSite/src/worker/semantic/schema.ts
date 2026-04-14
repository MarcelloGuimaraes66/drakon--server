import type { ResolvedOperationalPlan } from "../operationalQuery/schema";

export type SemanticIntentFamily =
  | "read_operational"
  | "report"
  | "create_config"
  | "edit_config"
  | "run_action"
  | "search_media"
  | "answer";

export type SemanticStepKind =
  | "read_operational"
  | "report"
  | "run_action"
  | "mutation"
  | "search_media"
  | "answer";

export type SemanticCapability = {
  skill: string;
  label: string;
  intent_families: SemanticIntentFamily[];
  step_kinds: SemanticStepKind[];
  planner_mode: "none" | "operational_query" | "mutation_grounding";
  operations: string[];
  targets: string[];
  supports_multi_step: boolean;
  supports_documents: boolean;
};

export type SemanticConversationMemory = {
  active_task_type: string | null;
  last_camera_name: string | null;
  last_video_scope: Record<string, unknown> | null;
  last_semantic_plan: Record<string, unknown> | null;
  carry_forward_requested: boolean;
  recent_turns: Array<{
    role: string;
    content: string;
  }>;
};

export type SemanticReadStep = {
  step_id: string;
  kind: "read_operational";
  selected_skill: "read_state";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
  operational_plan: ResolvedOperationalPlan;
};

export type SemanticReportStep = {
  step_id: string;
  kind: "report";
  selected_skill: "generate_report";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
  operational_plan: ResolvedOperationalPlan;
};

export type SemanticRunActionStep = {
  step_id: string;
  kind: "run_action";
  selected_skill: "control_camera" | "control_job" | "scan_network";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
  operation_type: string;
  runtime_action: string | null;
  canonical_arguments: Record<string, unknown>;
  legacy_plan: Record<string, unknown>;
};

export type SemanticMutationStep = {
  step_id: string;
  kind: "mutation";
  selected_skill:
    | "create_camera"
    | "create_cameras_batch"
    | "create_job"
    | "create_camera_agent"
    | "edit_camera"
    | "edit_cameras_batch"
    | "edit_job"
    | "edit_camera_agent";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
  operation_type: string;
  runtime_action: string | null;
  canonical_arguments: Record<string, unknown>;
  legacy_plan: Record<string, unknown>;
};

export type SemanticSearchMediaStep = {
  step_id: string;
  kind: "search_media";
  selected_skill: "video_search";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
};

export type SemanticAnswerStep = {
  step_id: string;
  kind: "answer";
  selected_skill: "explain_app";
  goal: string;
  confidence: number;
  requires_clarification: boolean;
  clarification_options: string[];
};

export type SemanticPlanStep =
  | SemanticReadStep
  | SemanticReportStep
  | SemanticRunActionStep
  | SemanticMutationStep
  | SemanticSearchMediaStep
  | SemanticAnswerStep;

export type SemanticPlan = {
  version: 1;
  plan_id: string;
  query: string;
  reply_language: string;
  intent_family: SemanticIntentFamily;
  selected_skill: string;
  planner_mode: "none" | "operational_query" | "mutation_grounding";
  confidence: number;
  needs_clarification: boolean;
  clarification_options: string[];
  route_hints: Record<string, unknown>;
  capabilities_considered: SemanticCapability[];
  conversation_memory: SemanticConversationMemory;
  steps: SemanticPlanStep[];
};
