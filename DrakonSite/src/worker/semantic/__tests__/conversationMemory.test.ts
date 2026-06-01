import test from "node:test";
import assert from "node:assert/strict";

import {
  applyConversationMemoryToOperationalPlan,
  buildSemanticPlanMemoryPatch,
  resolveConversationMemory,
} from "../conversationMemory";
import type {
  OperationalPlannerContext,
  ResolvedOperationalPlan,
} from "../../operationalQuery/schema";
import type { SemanticPlan } from "../schema";

function makeContext(query = ""): OperationalPlannerContext {
  return {
    report_id: "r1",
    requested_query: query,
    reply_language: "en",
    scope: {
      start_at: "2026-04-13T03:00:00.000Z",
      end_at: "2026-04-14T02:59:59.999Z",
      time_window_hours: 24,
      label: "today",
      focus: [],
    },
    resolved_entities: {
      cameras: [],
      jobs: [],
      steps: [],
      agents: [],
      is_specific: false,
    },
    chat_discussion: {
      task_state: {
        session_entities: {
          last_positive_hit: null,
          last_semantic_plan: {
            scope: {
              jobs: [22],
              steps: [],
              agents: [],
              cameras: [40],
              job_runs: ["run-1"],
              step_runs: [],
              agent_runs: [],
            },
          },
        },
      },
      recent_turns: [],
    },
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
        jobs: [],
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
        source_event_refs: [],
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
      jobs: [],
      steps: [],
      agents: [],
      job_runs: [],
      step_runs: [],
      agent_runs: [],
      is_specific: false,
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
    execution: [],
    answer_plan: {
      shape: "cards",
      evidence_level: "high",
    },
    confidence: 0.8,
  };
}

test("resolveConversationMemory recognizes carry-forward in Portuguese", () => {
  const memory = resolveConversationMemory(
    makeContext("agora so dessas mesmas pessoas"),
    "agora so dessas mesmas pessoas"
  );
  assert.equal(memory.carry_forward_requested, true);
});

test("applyConversationMemoryToOperationalPlan reuses prior scope", () => {
  const memory = resolveConversationMemory(
    makeContext("now just those same people"),
    "now just those same people"
  );
  const applied = applyConversationMemoryToOperationalPlan({
    plan: makeOperationalPlan(),
    memory,
    query: "now just those same people",
  });

  assert.deepEqual(applied.intent.scope.jobs, [22]);
  assert.deepEqual(applied.intent.scope.cameras, [40]);
  assert.deepEqual(applied.intent.scope.job_runs, ["run-1"]);
});

test("applyConversationMemoryToOperationalPlan scopes identity refs to the last analyzed video", () => {
  const query = "me traga os id cards do video analisado";
  const context = makeContext(query);
  (
    (
      context.chat_discussion as Record<string, unknown>
    ).task_state as Record<string, unknown>
  ).session_entities = {
    ...((
      (
        context.chat_discussion as Record<string, unknown>
      ).task_state as Record<string, unknown>
    ).session_entities as Record<string, unknown>),
    last_positive_hit: {
      camera_id: 77,
      source_event_id: "uploaded_video:91",
      primary_identity_card_id: "identity_card:vehicle_1",
      identity_cards: [
        {
          card_id: "identity_card:vehicle_1",
          entity_id: "vehicle_1",
          display_name: "vehicle_1",
          source_event_id: "uploaded_video:91",
        },
        {
          card_id: "identity_card:person_1",
          entity_id: "person_1",
          display_name: "person_1",
          source_event_id: "uploaded_video:91",
        },
        {
          card_id: "identity_card:person_2",
          entity_id: "person_2",
          display_name: "person_2",
          source_event_id: "uploaded_video:91",
        },
      ],
    },
  };

  const memory = resolveConversationMemory(context, query);
  const applied = applyConversationMemoryToOperationalPlan({
    plan: makeOperationalPlan(),
    memory,
    query,
  });

  assert.deepEqual(applied.intent.filters.identity_refs, [
    "identity_card:vehicle_1",
    "identity_card:person_1",
    "identity_card:person_2",
  ]);
  assert.deepEqual(applied.intent.filters.source_event_refs, ["uploaded_video:91"]);
  assert.deepEqual(applied.intent.scope.cameras, [77]);
});

test("buildSemanticPlanMemoryPatch stores first-step scope", () => {
  const plan: SemanticPlan = {
    version: 1,
    plan_id: "plan-1",
    query: "show me identities",
    reply_language: "en",
    intent_family: "read_operational",
    selected_skill: "read_state",
    planner_mode: "operational_query",
    confidence: 0.9,
    needs_clarification: false,
    clarification_options: [],
    route_hints: {},
    capabilities_considered: [],
    conversation_memory: {
      active_task_type: null,
      last_camera_name: null,
      last_video_scope: null,
      last_positive_hit: null,
      last_semantic_plan: null,
      carry_forward_requested: false,
      recent_turns: [],
    },
    steps: [
      {
        step_id: "read_1",
        kind: "read_operational",
        selected_skill: "read_state",
        goal: "lookup:identity_occurrence",
        confidence: 0.9,
        requires_clarification: false,
        clarification_options: [],
        operational_plan: makeOperationalPlan(),
      },
    ],
  };

  const patch = buildSemanticPlanMemoryPatch(plan);
  assert.equal(
    (patch.last_semantic_plan as Record<string, unknown>).intent_family,
    "read_operational"
  );
});
