import test from "node:test";
import assert from "node:assert/strict";

import { composeSemanticPlan } from "../planComposer";
import type { ResolvedOperationalPlan } from "../../operationalQuery/schema";
import type { SemanticConversationMemory } from "../schema";

function makeMemory(): SemanticConversationMemory {
  return {
    active_task_type: null,
    last_camera_name: null,
    last_video_scope: null,
    last_semantic_plan: null,
    carry_forward_requested: false,
    recent_turns: [],
  };
}

function makeOperationalPlan(): ResolvedOperationalPlan {
  return {
    version: 1,
    intent_family: "read_operational",
    planner_mode: "operational_query",
    intent: {
      version: 1,
      task: "lookup",
      subject: {
        entity: "identity_occurrence",
        view: "cards",
      },
      scope: {
        jobs: [22],
        steps: [],
        agents: [],
        cameras: [],
        job_runs: [],
        step_runs: [],
        agent_runs: [],
      },
      time: {
        kind: "calendar_day",
        raw_text: "today",
        timezone: "America/Sao_Paulo",
      },
      filters: {
        limit: 3,
        include_crop: true,
        include_media: false,
        identity_refs: [],
      },
      analysis: {
        group_by: [],
        metrics: [],
        join_targets: [],
      },
      output: {
        language: "en",
        format: "cards",
      },
    },
    resolved: {
      cameras: [],
      jobs: [
        {
          entity_type: "job",
          id: 22,
          name: "ALA A banho 2",
          label: "ALA A banho 2",
          confidence: 0.97,
        },
      ],
      steps: [],
      agents: [],
      job_runs: [],
      step_runs: [],
      agent_runs: [],
      is_specific: true,
      time_window: {
        kind: "calendar_day",
        timezone: "America/Sao_Paulo",
        raw_text: "today",
        start_at: "2026-04-13T03:00:00.000Z",
        end_at: "2026-04-14T02:59:59.999Z",
        label: "today",
      },
      ambiguities: [],
    },
    execution: [
      {
        source: "identity_cards",
        strategy: "filter_join_sort_limit",
        joins: ["job_runs"],
        order_by: "occurred_at_desc",
        limit: 3,
      },
    ],
    answer_plan: {
      shape: "cards",
      evidence_level: "high",
    },
    confidence: 0.88,
  };
}

test("composeSemanticPlan builds read plan with read_state", () => {
  const plan = composeSemanticPlan({
    query: "show me 3 identity cards from the job today",
    replyLanguage: "en",
    intentFamily: "read_operational",
    preferredSkill: "read_state",
    operationalPlan: makeOperationalPlan(),
    conversationMemory: makeMemory(),
  });

  assert.equal(plan.selected_skill, "read_state");
  assert.equal(plan.planner_mode, "operational_query");
  assert.equal(plan.steps[0]?.kind, "read_operational");
});

test("composeSemanticPlan builds report plan with generate_report", () => {
  const plan = composeSemanticPlan({
    query: "quero um relatorio da tarefa de hoje",
    replyLanguage: "pt-BR",
    intentFamily: "report",
    preferredSkill: "generate_report",
    operationalPlan: makeOperationalPlan(),
    conversationMemory: makeMemory(),
  });

  assert.equal(plan.selected_skill, "generate_report");
  assert.equal(plan.planner_mode, "operational_query");
  assert.equal(plan.steps[0]?.kind, "report");
});

test("composeSemanticPlan builds run action plan with control_job", () => {
  const plan = composeSemanticPlan({
    query: "stop job ALA A banho 2",
    replyLanguage: "en",
    intentFamily: "run_action",
    preferredSkill: "control_job",
    mutationPlan: {
      status: "resolved",
      confidence: 0.92,
      canonical_arguments: {
        resolved_job: {
          id: 22,
          name: "ALA A banho 2",
        },
      },
    },
    operationType: "control_job",
    runtimeAction: "stop",
    conversationMemory: makeMemory(),
  });

  assert.equal(plan.selected_skill, "control_job");
  assert.equal(plan.planner_mode, "mutation_grounding");
  assert.equal(plan.steps[0]?.kind, "run_action");
});
