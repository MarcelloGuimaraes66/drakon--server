import { getSkillCapability, listCapabilitiesForIntentFamily } from "./capabilityRegistry";
import type { ResolvedOperationalPlan } from "../operationalQuery/schema";
import type {
  SemanticConversationMemory,
  SemanticIntentFamily,
  SemanticPlan,
  SemanticPlanStep,
} from "./schema";

function normalizeText(value: unknown, maxLength = 240): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function selectedSkillForMutationOperation(operationType: string): SemanticPlan["selected_skill"] {
  if (operationType === "control_camera") return "control_camera";
  if (operationType === "control_job") return "control_job";
  if (operationType === "create_camera") return "create_camera";
  if (operationType === "create_cameras_batch") return "create_cameras_batch";
  if (operationType === "edit_camera") return "edit_camera";
  if (operationType === "edit_cameras_batch") return "edit_cameras_batch";
  if (operationType === "create_job") return "create_job";
  if (operationType === "edit_job") return "edit_job";
  if (operationType === "create_camera_agent") return "create_camera_agent";
  if (operationType === "edit_camera_agent") return "edit_camera_agent";
  return "explain_app";
}

function routeHintsForFamily(intentFamily: SemanticIntentFamily): Record<string, unknown> {
  return {
    needs_entity_grounding:
      intentFamily === "read_operational" ||
      intentFamily === "report" ||
      intentFamily === "run_action" ||
      intentFamily === "create_config" ||
      intentFamily === "edit_config",
    needs_time_grounding: intentFamily === "read_operational" || intentFamily === "report",
    wants_document: intentFamily === "report",
  };
}

function buildReadLikeStep(
  kind: "read_operational" | "report",
  plan: ResolvedOperationalPlan
): SemanticPlanStep {
  const isReport = kind === "report";
  return {
    step_id: `${kind}_1`,
    kind,
    selected_skill: isReport ? "generate_report" : "read_state",
    goal: `${plan.intent.task}:${plan.intent.subject.entity}`,
    confidence: plan.confidence,
    requires_clarification: plan.resolved.ambiguities.length > 0,
    clarification_options: [...plan.resolved.ambiguities],
    operational_plan: plan,
  } as SemanticPlanStep;
}

function buildMutationLikeStep(params: {
  kind: "run_action" | "mutation";
  operationType: string;
  runtimeAction: string | null;
  legacyPlan: Record<string, unknown>;
}): SemanticPlanStep {
  const selectedSkill = selectedSkillForMutationOperation(params.operationType);
  const canonicalArguments =
    params.legacyPlan.canonical_arguments &&
    typeof params.legacyPlan.canonical_arguments === "object" &&
    !Array.isArray(params.legacyPlan.canonical_arguments)
      ? (params.legacyPlan.canonical_arguments as Record<string, unknown>)
      : {};
  const status = normalizeText(params.legacyPlan.status, 80) || "planned";
  const clarificationOptions = Array.isArray(params.legacyPlan.candidate_targets)
    ? (params.legacyPlan.candidate_targets as Array<Record<string, unknown>>)
        .map((entry) => normalizeText(entry?.name, 160))
        .filter((entry) => entry.length > 0)
    : [];
  const base = {
    step_id: `${params.kind}_1`,
    kind: params.kind,
    selected_skill: selectedSkill as SemanticPlan["selected_skill"],
    goal: params.operationType,
    confidence:
      typeof params.legacyPlan.confidence === "number"
        ? params.legacyPlan.confidence
        : Number(params.legacyPlan.confidence || 0) || 0,
    requires_clarification: status === "missing_target" || status === "ambiguous",
    clarification_options: clarificationOptions,
    operation_type: params.operationType,
    runtime_action: params.runtimeAction,
    canonical_arguments: canonicalArguments,
    legacy_plan: params.legacyPlan,
  };
  return base as SemanticPlanStep;
}

export function composeSemanticPlan(params: {
  query: string;
  replyLanguage: string;
  intentFamily: SemanticIntentFamily;
  preferredSkill?: string;
  operationalPlan?: ResolvedOperationalPlan | null;
  mutationPlan?: Record<string, unknown> | null;
  operationType?: string;
  runtimeAction?: string | null;
  conversationMemory: SemanticConversationMemory;
}): SemanticPlan {
  const capabilities = listCapabilitiesForIntentFamily(params.intentFamily);
  const preferredCapability = params.preferredSkill ? getSkillCapability(params.preferredSkill) : null;

  let selectedSkill =
    preferredCapability && preferredCapability.intent_families.includes(params.intentFamily)
      ? preferredCapability.skill
      : capabilities[0]?.skill || "explain_app";
  let plannerMode =
    preferredCapability && preferredCapability.intent_families.includes(params.intentFamily)
      ? preferredCapability.planner_mode
      : capabilities[0]?.planner_mode || "none";

  const steps: SemanticPlanStep[] = [];
  if (
    (params.intentFamily === "read_operational" || params.intentFamily === "report") &&
    params.operationalPlan
  ) {
    steps.push(buildReadLikeStep(params.intentFamily === "report" ? "report" : "read_operational", params.operationalPlan));
    selectedSkill = params.intentFamily === "report" ? "generate_report" : "read_state";
    plannerMode = "operational_query";
  } else if (
    (params.intentFamily === "run_action" ||
      params.intentFamily === "create_config" ||
      params.intentFamily === "edit_config") &&
    params.mutationPlan
  ) {
    const kind = params.intentFamily === "run_action" ? "run_action" : "mutation";
    steps.push(
      buildMutationLikeStep({
        kind,
        operationType: normalizeText(params.operationType, 120),
        runtimeAction: params.runtimeAction || null,
        legacyPlan: params.mutationPlan,
      })
    );
    const mutationSkill = selectedSkillForMutationOperation(normalizeText(params.operationType, 120));
    if (mutationSkill !== "explain_app") {
      selectedSkill = mutationSkill;
    }
    plannerMode = "mutation_grounding";
  } else if (params.intentFamily === "search_media") {
    steps.push({
      step_id: "search_media_1",
      kind: "search_media",
      selected_skill: "video_search",
      goal: "search_media",
      confidence: 0.6,
      requires_clarification: false,
      clarification_options: [],
    });
    selectedSkill = "video_search";
  } else {
    steps.push({
      step_id: "answer_1",
      kind: "answer",
      selected_skill: "explain_app",
      goal: "answer",
      confidence: 0.45,
      requires_clarification: false,
      clarification_options: [],
    });
    selectedSkill = "explain_app";
  }

  const needsClarification = steps.some((step) => step.requires_clarification);
  const clarificationOptions = Array.from(
    new Set(steps.flatMap((step) => step.clarification_options))
  );
  const confidence =
    steps.length > 0
      ? Math.max(
          0,
          Math.min(
            0.99,
            steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length
          )
        )
      : 0.4;

  return {
    version: 1,
    plan_id: crypto.randomUUID(),
    query: normalizeText(params.query, 1800),
    reply_language: normalizeText(params.replyLanguage, 24) || "en",
    intent_family: params.intentFamily,
    selected_skill: selectedSkill,
    planner_mode: plannerMode,
    confidence,
    needs_clarification: needsClarification,
    clarification_options: clarificationOptions,
    route_hints: routeHintsForFamily(params.intentFamily),
    capabilities_considered: capabilities,
    conversation_memory: params.conversationMemory,
    steps,
  };
}
