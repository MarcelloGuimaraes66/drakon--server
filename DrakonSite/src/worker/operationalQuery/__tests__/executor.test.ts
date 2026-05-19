import test from "node:test";
import assert from "node:assert/strict";

import { composeOperationalExecutionResult } from "../executor";
import type { OperationalPlannerContext, ResolvedOperationalPlan } from "../schema";

function makePlan(): ResolvedOperationalPlan {
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
        jobs: [4],
        steps: [],
        agents: [],
        cameras: [],
        job_runs: [],
        step_runs: [],
        agent_runs: [],
      },
      time: {
        kind: "calendar_day",
        raw_text: "hoje",
        timezone: "America/Sao_Paulo",
      },
      filters: {
        limit: 1,
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
        language: "pt-BR",
        format: "cards",
      },
    },
    resolved: {
      cameras: [],
      jobs: [
        {
          entity_type: "job",
          id: 4,
          name: "ALA A banho 2",
          label: "ALA A banho 2",
          confidence: 0.98,
        },
      ],
      steps: [],
      agents: [],
      job_runs: [],
      step_runs: [],
      agent_runs: [],
      is_specific: true,
      ambiguities: [],
      time_window: {
        kind: "calendar_day",
        timezone: "America/Sao_Paulo",
        raw_text: "hoje",
        start_at: "2026-04-13T03:00:00.000Z",
        end_at: "2026-04-14T02:59:59.999Z",
        label: "hoje",
      },
    },
    execution: [
      {
        source: "identity_cards",
        strategy: "filter_join_sort_limit",
        joins: ["job_runs"],
        order_by: "occurred_at_desc",
        limit: 1,
      },
    ],
    answer_plan: {
      shape: "cards",
      evidence_level: "high",
    },
    confidence: 0.9,
  };
}

function makeContext(): OperationalPlannerContext {
  return {
    requested_query: "me traga 1 id card do job ALA A banho 2 de hoje",
    reply_language: "pt-BR",
    scope: {
      start_at: "2026-04-13T03:00:00.000Z",
      end_at: "2026-04-14T02:59:59.999Z",
      time_window_hours: 24,
      label: "hoje",
      focus: [],
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

test("composeOperationalExecutionResult renders a rich text identity card without photo", () => {
  const result = composeOperationalExecutionResult({
    plan: makePlan(),
    context: makeContext(),
    source: "identity_cards",
    rows: [
      {
        identity_card_id: "identity_card:qualified_person_10",
        display_name: "qualified_person_10",
        camera_name: "Local Stream 40 1",
        portrait_kind: null,
        crop_url: null,
        created_at: "2026-04-14T00:51:49.107Z",
        resolved_identity_json: {
          target_name: "Pessoa conhecida",
          target_description: "cliente recorrente",
        },
        card_json: {
          card_id: "identity_card:qualified_person_10",
          entity_id: "qualified_person_10",
          display_name: "qualified_person_10",
          identity_signature_summary: "Identity signature: medium build",
          identity_feature_candidates: [
            { text: "light skin tone", category: "physical_trait" },
            { text: "short dark hair", category: "physical_trait" },
          ],
          identity_context_traits: ["saindo pela porta A"],
          last_seen: {
            timestamp_utc_iso: "2026-04-14T00:48:07",
            zone: "porta_a",
          },
          face_available: false,
        },
      },
    ],
    datasets: {
      identity_cards: [],
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.draft_answer, /## Identity cards persistidos/);
  assert.match(result.draft_answer, /### 1\. qualified_person_10 -> Pessoa conhecida/);
  assert.match(result.draft_answer, /- Caracteristicas: medium build; light skin tone; short dark hair/);
  assert.match(result.draft_answer, /- Crop: nao/);
  assert.match(result.draft_answer, /- Zona: porta_a/);
});

test("composeOperationalExecutionResult renders real step cameras instead of state snapshot counts", () => {
  const plan = makePlan();
  plan.intent.subject.entity = "camera";
  plan.intent.subject.view = "table";
  plan.intent.filters.limit = 20;
  plan.execution = [
    {
      source: "cameras",
      strategy: "filter_join_sort_limit",
      joins: ["job_runs", "step_runs"],
      order_by: "camera_name_asc",
      limit: 20,
    },
  ];
  plan.resolved.jobs = [
    {
      entity_type: "job",
      id: 4,
      name: "Analise Acidente",
      label: "Analise Acidente",
      confidence: 0.98,
    },
  ];
  plan.resolved.steps = [
    {
      entity_type: "step",
      id: 12,
      name: "All Cameras - Accident Det",
      label: "All Cameras - Accident Det",
      confidence: 0.98,
      job_id: 4,
      job_name: "Analise Acidente",
    },
  ];
  plan.intent.scope.jobs = [4];
  plan.intent.scope.steps = [12];

  const result = composeOperationalExecutionResult({
    plan,
    context: makeContext(),
    source: "cameras",
    rows: [
      {
        camera_id: 101,
        camera_name: "BV_EQT_AT_01",
        step_id: 12,
        step_name: "All Cameras - Accident Det",
        job_id: 4,
        job_name: "Analise Acidente",
        slot_key: "bv_eqt_at_01",
        input_type: "image",
      },
      {
        camera_id: 102,
        camera_name: "BV_SAT_GOI_02",
        step_id: 12,
        step_name: "All Cameras - Accident Det",
        job_id: 4,
        job_name: "Analise Acidente",
        slot_key: "bv_sat_goi_02",
        input_type: "image",
      },
    ],
    datasets: {
      cameras: [],
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.draft_answer, /## Cameras/);
  assert.match(result.draft_answer, /step "All Cameras - Accident Det"/);
  assert.match(result.draft_answer, /job "Analise Acidente"/);
  assert.match(result.draft_answer, /1\. BV_EQT_AT_01/);
  assert.match(result.draft_answer, /2\. BV_SAT_GOI_02/);
});
