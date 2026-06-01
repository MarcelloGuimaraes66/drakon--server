import test from "node:test";
import assert from "node:assert/strict";

import { buildOperationalPlan } from "../planner";
import type { OperationalPlannerContext } from "../schema";

function makeContext(): OperationalPlannerContext {
  return {
    requested_query: "me traga a lista de cameras no job Analise Acidente step All Cameras - Accident Det",
    reply_language: "pt-BR",
    scope: {
      start_at: "2026-05-12T03:00:00.000Z",
      end_at: "2026-05-13T02:59:59.999Z",
      time_window_hours: 24,
      label: "hoje",
      focus: ["cameras", "jobs"],
    },
    stats: {},
    current_state: {},
    history: {},
    comparisons: {},
    chat_discussion: {},
    resolved_entities: {
      jobs: [
        {
          id: 4,
          name: "Analise Acidente",
          label: "Analise Acidente",
        },
      ],
      steps: [
        {
          id: 12,
          name: "All Cameras - Accident Det",
          label: "All Cameras - Accident Det",
          job_id: 4,
          job_name: "Analise Acidente",
        },
      ],
      cameras: [],
      agents: [],
      is_specific: true,
    },
    details: {},
  };
}

test("buildOperationalPlan routes camera-in-step queries to the cameras source", () => {
  const plan = buildOperationalPlan({
    query: "me traga a lista de cameras no job Analise Acidente step All Cameras - Accident Det",
    replyLanguage: "pt-BR",
    timezone: "America/Sao_Paulo",
    context: makeContext(),
  });

  assert.equal(plan.intent.subject.entity, "camera");
  assert.equal(plan.execution[0]?.source, "cameras");
  assert.deepEqual(plan.intent.scope.steps, [12]);
  assert.deepEqual(plan.intent.scope.jobs, [4]);
  assert.ok(!plan.resolved.ambiguities.includes("camera_reference_unresolved"));
});
