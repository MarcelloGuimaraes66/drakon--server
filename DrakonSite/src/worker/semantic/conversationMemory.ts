import { normalizePlannerText } from "../operationalQuery/grounding";
import type { ResolvedOperationalPlan } from "../operationalQuery/schema";
import type { OperationalPlannerContext } from "../operationalQuery/schema";
import type { SemanticConversationMemory, SemanticPlan } from "./schema";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumberList(value: unknown): number[] {
  return Array.from(
    new Set(
      asArray(value)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    )
  );
}

function toStringList(value: unknown): string[] {
  return Array.from(
    new Set(
      asArray(value)
        .map((entry) => normalizePlannerText(entry, 160))
        .filter((entry) => entry.length > 0)
    )
  );
}

function normalizeMemoryMatchText(value: string): string {
  return normalizePlannerText(value, 1600)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function queryIncludesAny(query: string, needles: readonly string[]): boolean {
  const normalizedQuery = normalizeMemoryMatchText(query);
  const paddedQuery = ` ${normalizedQuery} `;
  return needles.some((needle) => {
    const normalizedNeedle = normalizeMemoryMatchText(needle).trim();
    if (!normalizedNeedle) return false;
    const needsLooseContains = /[^\x00-\x7F]/.test(normalizedNeedle);
    if (needsLooseContains) {
      return normalizedQuery.includes(normalizedNeedle);
    }
    return paddedQuery.includes(` ${normalizedNeedle} `);
  });
}

export function resolveConversationMemory(
  context: OperationalPlannerContext,
  queryInput: string
): SemanticConversationMemory {
  const chatDiscussion = asRecord(context.chat_discussion);
  const taskState = asRecord(chatDiscussion?.task_state);
  const sessionEntities = asRecord(taskState?.session_entities);
  const activeTask = asRecord(taskState?.active_task);
  const recentTurns = asArray(chatDiscussion?.recent_turns)
    .map((entry) => {
      const row = asRecord(entry);
      const role = normalizePlannerText(row?.role, 24);
      const content = normalizePlannerText(row?.content, 320);
      if (!role || !content) return null;
      return { role, content };
    })
    .filter((entry): entry is { role: string; content: string } => entry !== null)
    .slice(-6);

  return {
    active_task_type:
      normalizePlannerText(activeTask?.task_type, 80) ||
      normalizePlannerText(activeTask?.type, 80) ||
      null,
    last_camera_name: normalizePlannerText(sessionEntities?.last_camera_name, 160) || null,
    last_video_scope: asRecord(sessionEntities?.last_video_scope),
    last_semantic_plan: asRecord(sessionEntities?.last_semantic_plan),
    carry_forward_requested: queryIncludesAny(queryInput, [
      "this",
      "that",
      "these",
      "those",
      "same",
      "again",
      "now just",
      "now only",
      "same people",
      "same person",
      "same job",
      "same camera",
      "same run",
      "same execution",
      "current run",
      "agora so",
      "agora apenas",
      "dessas",
      "dessas mesmas",
      "dessas pessoas",
      "isso",
      "disso",
      "aquele",
      "aquela",
      "esses",
      "essas",
      "esse",
      "essa",
      "mesmo job",
      "mesma camera",
      "mesmo run",
      "mesma execucao",
      "run atual",
      "execucao atual",
      "ahora solo",
      "ahora solamente",
      "esto",
      "eso",
      "estas",
      "esas",
      "esas mismas",
      "esas personas",
      "mismo job",
      "misma camara",
      "mismo run",
      "misma ejecucion",
      "ejecucion actual",
      "maintenant seulement",
      "maintenant juste",
      "ceci",
      "cela",
      "ces memes",
      "ces memes personnes",
      "meme job",
      "meme camera",
      "meme execution",
      "execution actuelle",
      "jetzt nur",
      "dies",
      "diese",
      "dieses",
      "dieselben",
      "gleiche personen",
      "gleicher job",
      "gleiche kamera",
      "gleiche ausfuhrung",
      "aktuelle ausfuhrung",
      "adesso solo",
      "solo ora",
      "questo",
      "questa",
      "queste",
      "stesse persone",
      "stesso job",
      "stessa camera",
      "stessa esecuzione",
      "esecuzione attuale",
      "الآن فقط",
      "هذا",
      "هذه",
      "هؤلاء",
      "نفس الاشخاص",
      "نفس الأشخاص",
      "نفس الكاميرا",
      "نفس المهمة",
      "نفس التشغيل",
      "هذا التشغيل",
      "现在只",
      "这个",
      "这些",
      "同样的人",
      "同一个任务",
      "同一摄像头",
      "同一次运行",
      "当前运行",
    ]),
    recent_turns: recentTurns,
  };
}

function operationalScopeIsEmpty(plan: ResolvedOperationalPlan): boolean {
  return (
    plan.intent.scope.jobs.length === 0 &&
    plan.intent.scope.steps.length === 0 &&
    plan.intent.scope.agents.length === 0 &&
    plan.intent.scope.cameras.length === 0 &&
    plan.intent.scope.job_runs.length === 0 &&
    plan.intent.scope.step_runs.length === 0 &&
    plan.intent.scope.agent_runs.length === 0
  );
}

export function applyConversationMemoryToOperationalPlan(params: {
  plan: ResolvedOperationalPlan;
  memory: SemanticConversationMemory;
  query: string;
}): ResolvedOperationalPlan {
  const plan = {
    ...params.plan,
    intent: {
      ...params.plan.intent,
      scope: {
        ...params.plan.intent.scope,
        jobs: [...params.plan.intent.scope.jobs],
        steps: [...params.plan.intent.scope.steps],
        agents: [...params.plan.intent.scope.agents],
        cameras: [...params.plan.intent.scope.cameras],
        job_runs: [...params.plan.intent.scope.job_runs],
        step_runs: [...params.plan.intent.scope.step_runs],
        agent_runs: [...params.plan.intent.scope.agent_runs],
      },
    },
    resolved: {
      ...params.plan.resolved,
      ambiguities: [...params.plan.resolved.ambiguities],
    },
  } satisfies ResolvedOperationalPlan;

  const lastPlan = asRecord(params.memory.last_semantic_plan);
  const lastScope = asRecord(lastPlan?.scope);

  if (params.memory.carry_forward_requested && operationalScopeIsEmpty(plan) && lastScope) {
    plan.intent.scope.jobs = toNumberList(lastScope.jobs);
    plan.intent.scope.steps = toNumberList(lastScope.steps);
    plan.intent.scope.agents = toNumberList(lastScope.agents);
    plan.intent.scope.cameras = toNumberList(lastScope.cameras);
    plan.intent.scope.job_runs = toStringList(lastScope.job_runs);
    plan.intent.scope.step_runs = toStringList(lastScope.step_runs);
    plan.intent.scope.agent_runs = toStringList(lastScope.agent_runs);
    if (
      plan.intent.scope.jobs.length > 0 ||
      plan.intent.scope.steps.length > 0 ||
      plan.intent.scope.agents.length > 0 ||
      plan.intent.scope.cameras.length > 0 ||
      plan.intent.scope.job_runs.length > 0 ||
      plan.intent.scope.step_runs.length > 0 ||
      plan.intent.scope.agent_runs.length > 0
    ) {
      plan.confidence = Math.min(0.99, plan.confidence + 0.04);
    }
  }

  if (
    plan.intent.scope.cameras.length === 0 &&
    params.memory.last_video_scope &&
    queryIncludesAny(params.query, [
      "camera",
      "cameras",
      "clip",
      "frame",
      "video",
      "camara",
      "camaras",
      "camera",
      "caméra",
      "摄像头",
      "视频",
      "فيديو",
      "كاميرا",
    ])
  ) {
    plan.intent.scope.cameras = toNumberList(params.memory.last_video_scope.camera_ids);
  }

  return plan;
}

export function buildSemanticPlanMemoryPatch(plan: SemanticPlan): Record<string, unknown> {
  const firstStep = plan.steps[0];
  const resolvedTarget =
    firstStep && (firstStep.kind === "run_action" || firstStep.kind === "mutation")
      ? (asRecord(firstStep.canonical_arguments?.resolved_camera) ||
          asRecord(firstStep.canonical_arguments?.resolved_job) ||
          null)
      : null;
  const scope =
    firstStep && (firstStep.kind === "read_operational" || firstStep.kind === "report")
      ? {
          jobs: [...firstStep.operational_plan.intent.scope.jobs],
          steps: [...firstStep.operational_plan.intent.scope.steps],
          agents: [...firstStep.operational_plan.intent.scope.agents],
          cameras: [...firstStep.operational_plan.intent.scope.cameras],
          job_runs: [...firstStep.operational_plan.intent.scope.job_runs],
          step_runs: [...firstStep.operational_plan.intent.scope.step_runs],
          agent_runs: [...firstStep.operational_plan.intent.scope.agent_runs],
        }
      : firstStep && (firstStep.kind === "run_action" || firstStep.kind === "mutation")
      ? {
          jobs: toNumberList([firstStep.canonical_arguments?.resolved_job && asRecord(firstStep.canonical_arguments.resolved_job)?.id]),
          steps: [],
          agents: [],
          cameras: toNumberList([firstStep.canonical_arguments?.resolved_camera && asRecord(firstStep.canonical_arguments.resolved_camera)?.id]),
          job_runs: [],
          step_runs: [],
          agent_runs: [],
        }
      : {
          jobs: [],
          steps: [],
          agents: [],
          cameras: [],
          job_runs: [],
          step_runs: [],
          agent_runs: [],
        };

  return {
    last_semantic_plan: {
      plan_id: plan.plan_id,
      intent_family: plan.intent_family,
      selected_skill: plan.selected_skill,
      query: plan.query,
      created_at: new Date().toISOString(),
      step_kind: firstStep?.kind || null,
      scope,
      resolved_target: resolvedTarget,
    },
  };
}
