import test from "node:test";
import assert from "node:assert/strict";

import { executeOperationalPlanDbFirst } from "../db";
import type { OperationalPlannerContext, ResolvedOperationalPlan } from "../schema";

function makeCameraPlan(): ResolvedOperationalPlan {
  return {
    version: 1,
    intent_family: "read_operational",
    planner_mode: "operational_query",
    intent: {
      version: 1,
      task: "lookup",
      subject: {
        entity: "camera",
        view: "table",
      },
      scope: {
        jobs: [4],
        steps: [12],
        agents: [],
        cameras: [],
        job_runs: [],
        step_runs: [],
        agent_runs: [],
      },
      time: {
        kind: "calendar_day",
        raw_text: "me traga a lista de cameras no job Analise Acidente step All Cameras - Accident Det",
        timezone: "America/Sao_Paulo",
      },
      filters: {
        limit: 20,
        include_crop: false,
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
        language: "pt-BR",
        format: "table",
      },
    },
    resolved: {
      cameras: [],
      jobs: [
        {
          entity_type: "job",
          id: 4,
          name: "Analise Acidente",
          label: "Analise Acidente",
          confidence: 0.99,
        },
      ],
      steps: [
        {
          entity_type: "step",
          id: 12,
          name: "All Cameras - Accident Det",
          label: "All Cameras - Accident Det",
          confidence: 0.99,
          job_id: 4,
          job_name: "Analise Acidente",
        },
      ],
      agents: [],
      job_runs: [],
      step_runs: [
        {
          entity_type: "step_run",
          id: "step-run-1",
          name: "All Cameras - Accident Det",
          label: "All Cameras - Accident Det | 2026-05-12T11:47:45.323Z",
          confidence: 0.96,
          camera_id: 101,
          job_id: 4,
          step_id: 12,
          step_name: "All Cameras - Accident Det",
        },
        {
          entity_type: "step_run",
          id: "step-run-2",
          name: "All Cameras - Accident Det",
          label: "All Cameras - Accident Det | 2026-05-12T11:46:45.323Z",
          confidence: 0.94,
          camera_id: 102,
          job_id: 4,
          step_id: 12,
          step_name: "All Cameras - Accident Det",
        },
      ],
      agent_runs: [
        {
          entity_type: "agent_run",
          id: "agent-run-1",
          name: "accident-detector",
          label: "accident-detector | All Cameras - Accident Det | 2026-05-12T11:47:45.323Z",
          confidence: 0.9,
          camera_id: 103,
          job_id: 4,
          step_id: 12,
          step_name: "All Cameras - Accident Det",
          agent_scope_type: "job_step_agent",
        },
      ],
      is_specific: true,
      ambiguities: [],
      time_window: {
        kind: "calendar_day",
        timezone: "America/Sao_Paulo",
        raw_text: "hoje",
        start_at: "2026-05-12T03:00:00.000Z",
        end_at: "2026-05-13T02:59:59.999Z",
        label: "hoje",
      },
    },
    execution: [
      {
        source: "cameras",
        strategy: "filter_join_sort_limit",
        joins: ["job_runs", "step_runs", "agent_runs"],
        order_by: "camera_name_asc",
        limit: 20,
      },
    ],
    answer_plan: {
      shape: "table",
      evidence_level: "high",
    },
    confidence: 0.92,
  };
}

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
    resolved_entities: {},
    details: {},
  };
}

test("executeOperationalPlanDbFirst keeps step target counts independent from resolved run camera ids", async () => {
  const statements: Array<{ sql: string; bindings: Array<string | number> }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: Array<string | number>) {
          statements.push({ sql, bindings });
          return {
            async all() {
              const usesScopedCameraFilter = sql.includes("jst.camera_id IN");
              if (sql.includes("COUNT(*) AS total_count")) {
                return {
                  results: [{ total_count: usesScopedCameraFilter ? 6 : 40 }],
                };
              }
              if (sql.includes("jst.id AS target_id")) {
                const rowCount = usesScopedCameraFilter ? 6 : 20;
                return {
                  results: Array.from({ length: rowCount }, (_, index) => ({
                    target_id: index + 1,
                    camera_id: 100 + index + 1,
                    slot_key: `camera_${index + 1}`,
                    slot_label: `Camera ${index + 1}`,
                    camera_name: `BV_CAMERA_${index + 1}`,
                    step_id: 12,
                    step_name: "All Cameras - Accident Det",
                    job_id: 4,
                    job_name: "Analise Acidente",
                    input_type: "video",
                  })),
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  } as any;

  const result = await executeOperationalPlanDbFirst({
    db,
    userId: "user-1",
    plan: makeCameraPlan(),
    context: makeContext(),
  });

  assert.equal(result.ok, true);
  assert.match(result.draft_answer, /Encontrei 40 camera\(s\)/);
  assert.match(result.draft_answer, /Mostrando 20 nesta resposta\./);

  const targetQuery = statements.find((entry) => entry.sql.includes("jst.id AS target_id"));
  assert.ok(targetQuery);
  assert.deepEqual(targetQuery?.bindings, ["user-1", 12, 4]);
  assert.ok(!targetQuery?.sql.includes("jst.camera_id IN"));
});
