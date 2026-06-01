import { getSkillCapability, listCapabilitiesForIntentFamily } from "./capabilityRegistry";
import type { SemanticIntentFamily, SemanticPlan } from "./schema";

export function buildSemanticShadow(params: {
  intentFamily: SemanticIntentFamily;
  preferredSkill?: string;
  plan: SemanticPlan;
  source: "query_plan" | "query_execute" | "mutation_resolve";
}): Record<string, unknown> {
  const capabilitiesForFamily = listCapabilitiesForIntentFamily(params.intentFamily);
  const preferredCapability = params.preferredSkill
    ? getSkillCapability(params.preferredSkill)
    : null;
  const selectedCapability = getSkillCapability(params.plan.selected_skill);

  const preferredSkillAligned = params.preferredSkill
    ? Boolean(
        preferredCapability &&
          preferredCapability.intent_families.includes(params.intentFamily)
      )
    : true;
  const selectedSkillAligned = Boolean(
    selectedCapability &&
      selectedCapability.intent_families.includes(params.intentFamily)
  );
  const plannerModeAligned = Boolean(
    !selectedCapability || selectedCapability.planner_mode === params.plan.planner_mode
  );

  const mismatchReasons: string[] = [];
  if (!preferredSkillAligned && params.preferredSkill) {
    mismatchReasons.push("preferred_skill_not_registered_for_intent_family");
  }
  if (!selectedSkillAligned) {
    mismatchReasons.push("selected_skill_not_registered_for_intent_family");
  }
  if (!plannerModeAligned) {
    mismatchReasons.push("planner_mode_mismatch_for_selected_skill");
  }

  return {
    version: 1,
    source: params.source,
    enabled: true,
    intent_family: params.intentFamily,
    preferred_skill: params.preferredSkill || null,
    selected_skill: params.plan.selected_skill,
    selected_planner_mode: params.plan.planner_mode,
    available_skills: capabilitiesForFamily.map((entry) => entry.skill),
    preferred_skill_aligned: preferredSkillAligned,
    selected_skill_aligned: selectedSkillAligned,
    planner_mode_aligned: plannerModeAligned,
    mismatch_reasons: mismatchReasons,
    created_at: new Date().toISOString(),
  };
}
