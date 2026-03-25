/**
 * Job Scheduler - runs every minute via cron to start scheduled jobs
 * 
 * Responsibilities:
 * 1. Acquire cron lock to prevent overlapping ticks
 * 2. Find jobs with status='scheduled' and matching schedule windows
 * 3. Ensure idempotency via job_schedule_fires table
 * 4. Start required cameras (enqueue start_camera commands)
 * 5. Enqueue job_start command with full payload
 */
import { buildEnabledAlgorithmsForCamera } from "./cameraAlgorithmsPayload";

function normalizeOpenAIApiKeyInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

// Helper function to get Telegram settings for a user
async function getTelegramSettingsForUser(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT enabled, chat_id, bot_token FROM telegram_settings WHERE user_id = ? LIMIT 1"
    )
    .bind(userId)
    .first();

  if (!row) {
    return { enabled: false, chat_id: "", bot_token: "" };
  }

  const r = row as any;
  return {
    enabled: !!r.enabled,
    chat_id: r.chat_id ?? "",
    bot_token: r.bot_token ?? "",
  };
}

async function getOpenAIApiKeyForUser(db: D1Database, userId: string): Promise<string> {
  try {
    const row = await db
      .prepare("SELECT api_key FROM openai_settings WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first();
    return normalizeOpenAIApiKeyInput((row as any)?.api_key);
  } catch {
    return "";
  }
}

async function getZAIApiKeyForUser(db: D1Database, userId: string): Promise<string> {
  try {
    const row = await db
      .prepare("SELECT api_key FROM zai_settings WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first();
    return normalizeOpenAIApiKeyInput((row as any)?.api_key);
  } catch {
    return "";
  }
}

// Normalize model tier
type ModelTier = "light" | "plus" | "pro";

function normalizeTier(tier: string | null | undefined): ModelTier {
  const t = (tier || "").toLowerCase();
  if (t === "pro") return "pro";
  if (t === "plus") return "plus";
  return "light";
}

type TargetInputType = "video" | "image";
type AgentInferenceModel = "legacy" | "pro" | "ultra" | "core";
const FIXED_AGENT_INFERENCE_MODEL: AgentInferenceModel = "ultra";
type AgentRunEverySeconds = 10 | 60;
const FIXED_AGENT_RUN_EVERY_SECONDS: AgentRunEverySeconds = 60;
type AgentRunningResolution = 640 | 1024;
const DEFAULT_CORE_RUNNING_RESOLUTION: AgentRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const MIN_JOB_STEP_TIMEOUT_SECONDS = 120;
const FACE_TARGET_MAX_IMAGES = 4;

type InferenceGroupPayload = {
  id: string;
  name: string;
  targetIds: number[];
  agentKey: string;
  inputType: TargetInputType;
  video_packaging_mode: "mosaic" | "frame_sequence";
  prompt_template: string;
  alert_condition: string | null;
  negative_condition: string | null;
  priority_level: string | null;
  inference_model: AgentInferenceModel;
  model_fps: number;
  run_every: AgentRunEverySeconds;
  running_resolution: AgentRunningResolution | null;
  only_capture_on_motion: boolean;
  source_target_id: number | null;
  analysis_bindings: Array<{
    target_id: number;
    region_ids: string[];
  }>;
  analysis_regions: AnalysisRegionPayload[];
  face_targets: FaceTargetPayload[];
  negative_reference_images: NegativeReferenceImagePayload[];
};

type FaceTargetImagePayload = {
  id: number;
  image_url: string;
};

type NegativeReferenceImagePayload = {
  id: number;
  image_url: string;
};

type FaceTargetPayload = {
  id: number;
  name: string;
  description: string;
  images: FaceTargetImagePayload[];
};

type AnalysisRegionPoint = {
  x: number;
  y: number;
};

type AnalysisRegionPayload = {
  region_id: string;
  label: string;
  description: string;
  enabled: boolean;
  full_frame: boolean;
  polygon_norm: AnalysisRegionPoint[];
  draw_ref_width: number;
  draw_ref_height: number;
  context_padding_pct: number;
  prompt_core: string;
  alert_condition: string | null;
  negative_condition: string | null;
  face_target_ids: number[];
  negative_image_ids: number[];
};

type ModelRuntimeConfig = {
  api_key: string;
  model_fps: number;
};

const DEFAULT_MODEL_RUNTIME_CONFIG: Record<AgentInferenceModel, ModelRuntimeConfig> = {
  legacy: {
    api_key: "",
    model_fps: 1,
  },
  pro: {
    api_key: "",
    model_fps: 1,
  },
  ultra: {
    api_key: "",
    model_fps: 1,
  },
  core: {
    api_key: "",
    model_fps: 1,
  },
};

function normalizeTargetInputType(value: unknown): TargetInputType {
  if (typeof value !== "string") return "video";
  const normalized = value.trim().toLowerCase();
  return normalized === "image" ? "image" : "video";
}

function normalizeVideoPackagingMode(value: unknown): "mosaic" | "frame_sequence" {
  if (typeof value !== "string") return "mosaic";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "frame_sequence" ||
    normalized === "frame-sequence" ||
    normalized === "full_frame" ||
    normalized === "full-frame" ||
    normalized === "frames"
  ) {
    return "frame_sequence";
  }
  return "mosaic";
}

function normalizePriorityLevel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "MEDUIM") return "MEDIUM";
  if (normalized === "CRITIC" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
    return normalized;
  }
  return null;
}

function normalizeInferenceModel(value: unknown): AgentInferenceModel {
  if (typeof value !== "string") return FIXED_AGENT_INFERENCE_MODEL;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "legacy" ||
    normalized === "pro" ||
    normalized === "ultra" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return FIXED_AGENT_INFERENCE_MODEL;
}

function normalizeModelFps(
  value: unknown,
  inferenceModel: AgentInferenceModel,
  inputType: TargetInputType,
  fallback = DEFAULT_ULTRA_VIDEO_MODEL_FPS
): number {
  void inferenceModel;
  if (inputType !== "video") {
    return DEFAULT_ULTRA_VIDEO_MODEL_FPS;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, rounded));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, parsed));
    }
  }
  return normalizeModelFps(fallback, inferenceModel, inputType, DEFAULT_ULTRA_VIDEO_MODEL_FPS);
}

function normalizeRunningResolution(
  value: unknown,
  fallback: AgentRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
): AgentRunningResolution {
  const parseResolution = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalize = (candidate: unknown): AgentRunningResolution | null => {
    const parsed = parseResolution(candidate);
    if (parsed === 640 || parsed === 1024) return parsed;
    return null;
  };
  return normalize(value) ?? normalize(fallback) ?? DEFAULT_CORE_RUNNING_RESOLUTION;
}

function normalizeAgentRunEverySeconds(
  value: unknown,
  fallback: AgentRunEverySeconds = FIXED_AGENT_RUN_EVERY_SECONDS
): AgentRunEverySeconds {
  const parseSeconds = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalizeValue = (candidate: unknown): AgentRunEverySeconds | null => {
    const parsed = parseSeconds(candidate);
    if (parsed === null || parsed <= 0) return null;
    return parsed <= 10 ? 10 : 60;
  };
  return normalizeValue(value) ?? normalizeValue(fallback) ?? FIXED_AGENT_RUN_EVERY_SECONDS;
}

function normalizeOnlyCaptureOnMotion(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
  }
  return fallback;
}

function normalizeUseTemporalContext(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
  }
  return fallback;
}

type PromptTemplateParts = {
  prompt_template: string;
  alert_condition: string | null;
  negative_condition: string | null;
};

const TEMPORAL_ENGINE_PROMPT_SUFFIX_PATTERN =
  /(?:<br\s*\/?>|\r?\n|\s)*Temporal engine:\s*[\s\S]*$/i;

const TEMPORAL_ENGINE_APPENDIX_SECTION_PATTERN =
  /(?:\r?\n){2,}\s*(?:#{1,6}\s*)?(?:identity|operators|temporal operators|temporal plan|runtime plan|plan envelope|compile status|compile confidence|missing operator types|blockers|state policy)\s*:[\s\S]*$/i;

function normalizeOptionalPromptText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stripTemporalArtifactsFromPromptText(value: unknown): string {
  if (typeof value !== "string") return "";
  let normalized = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n/g, "\n");
  normalized = normalized.replace(TEMPORAL_ENGINE_PROMPT_SUFFIX_PATTERN, "");
  normalized = normalized.replace(TEMPORAL_ENGINE_APPENDIX_SECTION_PATTERN, "");
  return normalized.trim();
}

function sanitizePromptTemplatePartsForLegacyFlow(
  parts: PromptTemplateParts
): PromptTemplateParts {
  return {
    prompt_template: stripTemporalArtifactsFromPromptText(parts.prompt_template),
    alert_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(parts.alert_condition)
    ),
    negative_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(parts.negative_condition)
    ),
  };
}

function parsePromptTemplateParts(
  templateRaw: unknown,
  fallbackAlertCondition?: unknown,
  fallbackNegativeCondition?: unknown
): PromptTemplateParts {
  const raw = typeof templateRaw === "string" ? templateRaw : "";
  const lower = raw.toLowerCase();
  const markerSpecs = [
    { key: "alert_condition" as const, marker: "alert_condition:" },
    { key: "negative_condition" as const, marker: "negative_condition:" },
  ];

  const positions = markerSpecs
    .map((spec) => ({ ...spec, index: lower.lastIndexOf(spec.marker) }))
    .filter((spec) => spec.index >= 0)
    .sort((a, b) => a.index - b.index);

  let promptTemplate = raw;
  let parsedAlertCondition: string | null = null;
  let parsedNegativeCondition: string | null = null;

  if (positions.length > 0) {
    promptTemplate = raw.slice(0, positions[0].index).trimEnd();
    for (let i = 0; i < positions.length; i += 1) {
      const current = positions[i];
      const start = current.index + current.marker.length;
      const end = i + 1 < positions.length ? positions[i + 1].index : raw.length;
      const value = raw.slice(start, end).trim();
      if (!value) continue;
      if (current.key === "alert_condition") {
        parsedAlertCondition = value;
      } else {
        parsedNegativeCondition = value;
      }
    }
  }

  return {
    prompt_template: promptTemplate,
    alert_condition:
      normalizeOptionalPromptText(fallbackAlertCondition) ?? parsedAlertCondition,
    negative_condition:
      normalizeOptionalPromptText(fallbackNegativeCondition) ?? parsedNegativeCondition,
  };
}

function parsePromptTemplatePartsForJobStepTemporalMode(
  templateRaw: unknown,
  fallbackAlertCondition: unknown,
  fallbackNegativeCondition: unknown,
  useTemporalContext: boolean
): PromptTemplateParts {
  if (useTemporalContext) {
    return parsePromptTemplateParts(
      templateRaw,
      fallbackAlertCondition,
      fallbackNegativeCondition
    );
  }

  const parts = parsePromptTemplateParts(
    stripTemporalArtifactsFromPromptText(templateRaw),
    stripTemporalArtifactsFromPromptText(fallbackAlertCondition),
    stripTemporalArtifactsFromPromptText(fallbackNegativeCondition)
  );
  return sanitizePromptTemplatePartsForLegacyFlow(parts);
}

function toAgentFaceTargetImageUrl(imageUrl: string): string {
  if (!imageUrl) return imageUrl;
  return imageUrl.replace("/api/face-target-images/", "/api/agent/face-target-images/");
}

function toAgentNegativeConditionImageUrl(imageUrl: string): string {
  if (!imageUrl) return imageUrl;
  return imageUrl.replace(
    "/api/negative-condition-images/",
    "/api/agent/negative-condition-images/"
  );
}

function parseFaceTargetsFromUnknown(value: unknown): FaceTargetPayload[] {
  if (!Array.isArray(value)) return [];
  const out: FaceTargetPayload[] = [];
  for (const row of value) {
    const target = row as any;
    const id = Number(target?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const name = typeof target?.name === "string" ? target.name.trim() : "";
    const description =
      typeof target?.description === "string" ? target.description.trim() : "";
    const imagesRaw = Array.isArray(target?.images) ? target.images : [];
    const images: FaceTargetImagePayload[] = imagesRaw
      .map((img: any) => {
        const imageId = Number(img?.id);
        const imageUrl =
          typeof img?.image_url === "string" ? img.image_url.trim() : "";
        if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
        return {
          id: imageId,
          image_url: toAgentFaceTargetImageUrl(imageUrl),
        };
      })
      .filter(Boolean) as FaceTargetImagePayload[];
    out.push({
      id,
      name,
      description,
      images,
    });
  }
  return out;
}

function parseNegativeReferenceImagesFromUnknown(
  value: unknown
): NegativeReferenceImagePayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((img: any) => {
      const imageId = Number(img?.id);
      const imageUrl =
        typeof img?.image_url === "string" ? img.image_url.trim() : "";
      if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
      return {
        id: imageId,
        image_url: toAgentNegativeConditionImageUrl(imageUrl),
      };
    })
    .filter(Boolean) as NegativeReferenceImagePayload[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeRegionId(value: unknown, index: number): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized.slice(0, 64);
  return `region-${index + 1}`;
}

function parseAnalysisRegionsFromUnknown(
  value: unknown,
  defaults: {
    promptParts: PromptTemplateParts;
    faceTargetIds: number[];
    negativeImageIds: number[];
  }
): AnalysisRegionPayload[] {
  const synthDefault = (): AnalysisRegionPayload[] => [
    {
      region_id: "full-frame",
      label: "Full frame",
      description: "",
      enabled: true,
      full_frame: true,
      polygon_norm: [],
      draw_ref_width: 1920,
      draw_ref_height: 1080,
      context_padding_pct: 0,
      prompt_core: defaults.promptParts.prompt_template,
      alert_condition: defaults.promptParts.alert_condition,
      negative_condition: defaults.promptParts.negative_condition,
      face_target_ids: defaults.faceTargetIds,
      negative_image_ids: defaults.negativeImageIds,
    },
  ];

  if (value === null || value === undefined) return synthDefault();
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return synthDefault();
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return synthDefault();
    }
  }
  if (!Array.isArray(parsed)) return synthDefault();

  const usedIds = new Set<string>();
  const regions: AnalysisRegionPayload[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i] as any;
    if (!row || typeof row !== "object") continue;

    const regionId = normalizeRegionId(row?.region_id ?? row?.regionId, i);
    if (usedIds.has(regionId)) continue;
    usedIds.add(regionId);

    const polygonRaw = Array.isArray(row?.polygon_norm)
      ? row.polygon_norm
      : Array.isArray(row?.polygonNorm)
      ? row.polygonNorm
      : [];
    const polygonNorm = polygonRaw
      .map((point: any) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: clamp01(x), y: clamp01(y) };
      })
      .filter(Boolean) as AnalysisRegionPoint[];

    const fullFrameRaw = row?.full_frame ?? row?.fullFrame;
    const fullFrame =
      typeof fullFrameRaw === "boolean"
        ? fullFrameRaw
        : typeof fullFrameRaw === "number"
        ? fullFrameRaw !== 0
        : polygonNorm.length < 3;
    const normalizedFullFrame = fullFrame || polygonNorm.length < 3;

    const faceTargetIdsRaw = Array.isArray(row?.face_target_ids)
      ? row.face_target_ids
      : Array.isArray(row?.faceTargetIds)
      ? row.faceTargetIds
      : defaults.faceTargetIds;
    const negativeImageIdsRaw = Array.isArray(row?.negative_image_ids)
      ? row.negative_image_ids
      : Array.isArray(row?.negativeImageIds)
      ? row.negativeImageIds
      : defaults.negativeImageIds;
    const faceTargetIds: number[] = Array.from(
      new Set<number>(
        faceTargetIdsRaw
          .map((v: unknown) => Number(v))
          .filter((v: number) => Number.isInteger(v) && v > 0)
      )
    );
    const negativeImageIds: number[] = Array.from(
      new Set<number>(
        negativeImageIdsRaw
          .map((v: unknown) => Number(v))
          .filter((v: number) => Number.isInteger(v) && v > 0)
      )
    );

    regions.push({
      region_id: regionId,
      label:
        typeof row?.label === "string" && row.label.trim()
          ? row.label.trim()
          : `Region ${i + 1}`,
      description:
        typeof row?.description === "string" ? row.description.trim() : "",
      enabled:
        typeof row?.enabled === "boolean"
          ? row.enabled
          : typeof row?.enabled === "number"
          ? row.enabled !== 0
          : true,
      full_frame: normalizedFullFrame,
      polygon_norm: normalizedFullFrame ? [] : polygonNorm,
      draw_ref_width: normalizePositiveInt(
        row?.draw_ref_width ?? row?.drawRefWidth,
        1920
      ),
      draw_ref_height: normalizePositiveInt(
        row?.draw_ref_height ?? row?.drawRefHeight,
        1080
      ),
      context_padding_pct: 0,
      prompt_core:
        typeof row?.prompt_core === "string"
          ? row.prompt_core.trim()
          : typeof row?.prompt_template === "string"
          ? row.prompt_template.trim()
          : defaults.promptParts.prompt_template,
      alert_condition:
        normalizeOptionalPromptText(row?.alert_condition ?? row?.alertCondition) ??
        defaults.promptParts.alert_condition,
      negative_condition:
        normalizeOptionalPromptText(
          row?.negative_condition ?? row?.negativeCondition
        ) ?? defaults.promptParts.negative_condition,
      face_target_ids: faceTargetIds,
      negative_image_ids: negativeImageIds,
    });
  }

  if (regions.length === 0) return synthDefault();
  return regions;
}

function sanitizeAnalysisRegionsForLegacyFlow(
  regions: AnalysisRegionPayload[]
): AnalysisRegionPayload[] {
  return regions.map((region) => ({
    ...region,
    prompt_core: stripTemporalArtifactsFromPromptText(region.prompt_core),
    alert_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(region.alert_condition)
    ),
    negative_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(region.negative_condition)
    ),
  }));
}

async function loadExpandedFaceTargetsByAgentIdForPayload(
  db: D1Database,
  userId: string,
  agentIds: number[]
): Promise<Map<number, FaceTargetPayload[]>> {
  const byAgentId = new Map<number, FaceTargetPayload[]>();
  const normalizedAgentIds = Array.from(
    new Set(agentIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedAgentIds.length === 0) {
    return byAgentId;
  }

  const placeholders = normalizedAgentIds.map(() => "?").join(", ");
  try {
    const { results } = await db
      .prepare(
        `SELECT jsaft.agent_id,
                ft.id AS face_target_id,
                ft.name AS face_target_name,
                ft.description AS face_target_description,
                fti.id AS image_id,
                fti.image_url AS image_url
         FROM job_step_agent_face_targets jsaft
         JOIN face_targets ft ON ft.id = jsaft.face_target_id
         LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
         WHERE jsaft.agent_id IN (${placeholders})
           AND ft.user_id = ?
         ORDER BY jsaft.agent_id ASC, ft.id ASC, fti.id ASC`
      )
      .bind(...normalizedAgentIds, userId)
      .all();

    const targetMap = new Map<string, FaceTargetPayload>();
    for (const row of results || []) {
      const data = row as any;
      const agentId = Number(data?.agent_id);
      const targetId = Number(data?.face_target_id);
      if (!Number.isInteger(agentId) || agentId <= 0) continue;
      if (!Number.isInteger(targetId) || targetId <= 0) continue;

      const key = `${agentId}:${targetId}`;
      let target = targetMap.get(key);
      if (!target) {
        target = {
          id: targetId,
          name: typeof data?.face_target_name === "string" ? data.face_target_name.trim() : "",
          description:
            typeof data?.face_target_description === "string"
              ? data.face_target_description.trim()
              : "",
          images: [],
        };
        targetMap.set(key, target);
        if (!byAgentId.has(agentId)) byAgentId.set(agentId, []);
        byAgentId.get(agentId)!.push(target);
      }

      const imageId = Number(data?.image_id);
      const imageUrl =
        typeof data?.image_url === "string" ? data.image_url.trim() : "";
      if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) continue;
      if (target.images.length >= FACE_TARGET_MAX_IMAGES) continue;
      target.images.push({
        id: imageId,
        image_url: toAgentFaceTargetImageUrl(imageUrl),
      });
    }
  } catch (error) {
    console.log("[JOB SCHEDULER] Warning: Failed to load face targets for agents", error);
  }

  return byAgentId;
}

async function loadNegativeReferenceImagesByAgentIdForPayload(
  db: D1Database,
  agentIds: number[]
): Promise<Map<number, NegativeReferenceImagePayload[]>> {
  const byAgentId = new Map<number, NegativeReferenceImagePayload[]>();
  const normalizedAgentIds = Array.from(
    new Set(agentIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedAgentIds.length === 0) {
    return byAgentId;
  }

  const placeholders = normalizedAgentIds.map(() => "?").join(", ");
  try {
    const { results } = await db
      .prepare(
        `SELECT agent_id, id, image_url
         FROM job_step_agent_negative_images
         WHERE agent_id IN (${placeholders})
         ORDER BY agent_id ASC, id ASC`
      )
      .bind(...normalizedAgentIds)
      .all();

    for (const row of results || []) {
      const data = row as any;
      const agentId = Number(data?.agent_id);
      const imageId = Number(data?.id);
      const imageUrl =
        typeof data?.image_url === "string" ? data.image_url.trim() : "";
      if (!Number.isInteger(agentId) || agentId <= 0) continue;
      if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) continue;
      if (!byAgentId.has(agentId)) byAgentId.set(agentId, []);
      byAgentId.get(agentId)!.push({
        id: imageId,
        image_url: toAgentNegativeConditionImageUrl(imageUrl),
      });
    }
  } catch (error) {
    console.log(
      "[JOB SCHEDULER] Warning: Failed to load negative condition images for agents",
      error
    );
  }

  return byAgentId;
}

async function loadModelRuntimeConfigForPayload(
  db: D1Database,
  openAiApiKey = "",
  zAiApiKey = ""
): Promise<Record<AgentInferenceModel, ModelRuntimeConfig>> {
  const modelRuntimeConfig: Record<AgentInferenceModel, ModelRuntimeConfig> = {
    legacy: { ...DEFAULT_MODEL_RUNTIME_CONFIG.legacy },
    pro: { ...DEFAULT_MODEL_RUNTIME_CONFIG.pro },
    ultra: { ...DEFAULT_MODEL_RUNTIME_CONFIG.ultra },
    core: { ...DEFAULT_MODEL_RUNTIME_CONFIG.core },
  };

  try {
    const { results } = await db
      .prepare(
        "SELECT id, model_name, api_key, default_fps FROM model_api_keys WHERE is_active = 1 ORDER BY updated_at DESC, id DESC"
      )
      .all();

    const seenModels = new Set<AgentInferenceModel>();
    for (const row of results || []) {
      const model = normalizeInferenceModel((row as any)?.model_name);
      if (seenModels.has(model)) continue;
      const current = modelRuntimeConfig[model];
      const modelFps = normalizeModelFps(
        (row as any)?.default_fps,
        model,
        model === "core" ? "video" : "video",
        current.model_fps
      );
      modelRuntimeConfig[model] = {
        api_key: current.api_key,
        model_fps: modelFps,
      };
      seenModels.add(model);
    }
  } catch (error) {
    console.log("[JOB SCHEDULER] Warning: Failed to load model runtime config from DB, using defaults", error);
  }

  const normalizedOpenAiApiKey = normalizeOpenAIApiKeyInput(openAiApiKey);
  if (normalizedOpenAiApiKey) {
    modelRuntimeConfig.legacy.api_key = normalizedOpenAiApiKey;
    modelRuntimeConfig.pro.api_key = normalizedOpenAiApiKey;
    modelRuntimeConfig.ultra.api_key = normalizedOpenAiApiKey;
  }
  const normalizedZAiApiKey = normalizeOpenAIApiKeyInput(zAiApiKey);
  if (normalizedZAiApiKey) {
    modelRuntimeConfig.core.api_key = normalizedZAiApiKey;
  }

  return modelRuntimeConfig;
}

function parseInferenceGroupsForPayload(raw: unknown): InferenceGroupPayload[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const groups: InferenceGroupPayload[] = [];
  for (const item of parsed) {
    const row = item as any;
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const agentKey = typeof row?.agentKey === "string" ? row.agentKey.trim() : "";
    const promptTemplate =
      typeof row?.prompt_template === "string"
        ? row.prompt_template
        : typeof row?.promptTemplate === "string"
        ? row.promptTemplate
        : "";
    const alertCondition =
      typeof row?.alert_condition === "string"
        ? row.alert_condition
        : typeof row?.alertCondition === "string"
        ? row.alertCondition
        : null;
    const negativeCondition =
      typeof row?.negative_condition === "string"
        ? row.negative_condition
        : typeof row?.negativeCondition === "string"
        ? row.negativeCondition
        : null;
    const promptParts = parsePromptTemplateParts(
      promptTemplate,
      alertCondition,
      negativeCondition
    );
    const videoPackagingMode = normalizeVideoPackagingMode(
      row?.video_packaging_mode ?? row?.videoPackagingMode
    );
    const priorityLevel = normalizePriorityLevel(
      typeof row?.priority_level === "string" ? row.priority_level : row?.priorityLevel
    );
    const inferenceModel = normalizeInferenceModel(
      typeof row?.inference_model === "string"
        ? row.inference_model
        : row?.inferenceModel
    );
    const modelFps = normalizeModelFps(
      typeof row?.model_fps === "number" ? row.model_fps : row?.modelFps,
      inferenceModel,
      inferenceModel === "core" ? "video" : normalizeTargetInputType(row?.inputType),
      DEFAULT_ULTRA_VIDEO_MODEL_FPS
    );
    const runEvery = normalizeAgentRunEverySeconds(
      row?.run_every ?? row?.runEvery,
      FIXED_AGENT_RUN_EVERY_SECONDS
    );
    const runningResolution = normalizeRunningResolution(
      row?.running_resolution ?? row?.runningResolution,
      DEFAULT_CORE_RUNNING_RESOLUTION
    );
    const onlyCaptureOnMotion = normalizeOnlyCaptureOnMotion(
      row?.only_capture_on_motion ?? row?.onlyCaptureOnMotion,
      true
    );
    const sourceTargetIdRaw = row?.source_target_id ?? row?.sourceTargetId;
    const sourceTargetIdNumeric = Number(sourceTargetIdRaw);
    const sourceTargetId =
      Number.isInteger(sourceTargetIdNumeric) && sourceTargetIdNumeric > 0
        ? sourceTargetIdNumeric
        : null;
    const targetIdsRaw = Array.isArray(row?.targetIds) ? row.targetIds : [];
    const targetIds = Array.from(
      new Set<number>(
        targetIdsRaw
          .map((v: unknown) => Number(v))
          .filter((v: number) => Number.isInteger(v) && v > 0)
      )
    );
    const analysisBindingsRaw = Array.isArray(row?.analysis_bindings)
      ? row.analysis_bindings
      : Array.isArray(row?.analysisBindings)
      ? row.analysisBindings
      : [];
    const analysisBindings = analysisBindingsRaw
      .map((binding: any) => {
        const targetId = Number(binding?.target_id ?? binding?.targetId);
        if (!Number.isInteger(targetId) || targetId <= 0) return null;
        const regionIdsRaw = Array.isArray(binding?.region_ids)
          ? binding.region_ids
          : Array.isArray(binding?.regionIds)
          ? binding.regionIds
          : [];
        const regionIds = Array.from(
          new Set(
            regionIdsRaw
              .map((v: unknown) => String(v ?? "").trim())
              .filter((v: string) => v.length > 0)
          )
        );
        if (regionIds.length === 0) return null;
        return {
          target_id: targetId,
          region_ids: regionIds,
        };
      })
      .filter(Boolean) as Array<{ target_id: number; region_ids: string[] }>;
    if (!id || !agentKey || targetIds.length === 0) continue;
    const inputType = inferenceModel === "core" ? "video" : normalizeTargetInputType(row?.inputType);
    groups.push({
      id,
      name: name || `Group ${groups.length + 1}`,
      targetIds,
      agentKey,
      inputType,
      video_packaging_mode: videoPackagingMode,
      prompt_template: promptParts.prompt_template,
      alert_condition: promptParts.alert_condition,
      negative_condition: promptParts.negative_condition,
      priority_level: priorityLevel,
      inference_model: inferenceModel,
      model_fps: normalizeModelFps(modelFps, inferenceModel, inputType),
      run_every: inferenceModel === "core" ? 60 : runEvery,
      running_resolution: inferenceModel === "core" ? runningResolution : null,
      only_capture_on_motion: onlyCaptureOnMotion,
      source_target_id: sourceTargetId,
      analysis_bindings: analysisBindings,
      analysis_regions: parseAnalysisRegionsFromUnknown(row?.analysis_regions, {
        promptParts,
        faceTargetIds: [],
        negativeImageIds: [],
      }),
      face_targets: parseFaceTargetsFromUnknown(row?.face_targets),
      negative_reference_images: parseNegativeReferenceImagesFromUnknown(
        row?.negative_reference_images
      ),
    });
  }

  return groups;
}

type JobInferenceProviderRequirements = {
  requiresOpenAi: boolean;
  requiresZAi: boolean;
};

export async function loadJobInferenceProviderRequirements(
  db: D1Database,
  jobId: number
): Promise<JobInferenceProviderRequirements> {
  const requirements: JobInferenceProviderRequirements = {
    requiresOpenAi: false,
    requiresZAi: false,
  };

  if (!Number.isInteger(jobId) || jobId <= 0) {
    return requirements;
  }

  const markByModel = (modelRaw: unknown) => {
    const model = normalizeInferenceModel(modelRaw);
    if (model === "core") {
      requirements.requiresZAi = true;
    } else {
      requirements.requiresOpenAi = true;
    }
  };

  try {
    const { results: stepRows } = await db
      .prepare(
        `SELECT id, inference_groups
         FROM job_steps
         WHERE job_id = ?`
      )
      .bind(jobId)
      .all();

    for (const row of stepRows || []) {
      const step = row as any;
      const inferenceGroups = parseInferenceGroupsForPayload(step?.inference_groups);
      for (const group of inferenceGroups) {
        markByModel(group.inference_model);
      }
    }
  } catch (error) {
    console.log(
      `[JOB SCHEDULER] Warning: failed to inspect inference_groups for job ${jobId}`,
      error
    );
  }

  try {
    const { results: agentRows } = await db
      .prepare(
        `SELECT a.inference_model
         FROM job_step_agents a
         JOIN job_steps s ON s.id = a.step_id
         WHERE s.job_id = ?
           AND a.is_active = 1`
      )
      .bind(jobId)
      .all();

    for (const row of agentRows || []) {
      const agent = row as any;
      markByModel(agent?.inference_model);
    }
  } catch (error) {
    console.log(
      `[JOB SCHEDULER] Warning: failed to inspect job_step_agents for job ${jobId}`,
      error
    );
  }

  return requirements;
}

// AI agent descriptions
const ALGORITHM_DESCRIPTIONS: Record<string, string> = {
  weapon: "Detect firearms, knives, and other weapons",
  intruder: "Detect unauthorized persons in restricted areas",
  masked: "Detect people wearing masks or face coverings",
  robbery: "Detect potential robbery situations with raised hands",
  fallen: "Detect people who have fallen or collapsed",
  crowd: "Detect unusual crowd formations or gatherings",
  abandoned: "Detect unattended bags or objects",
  reid: "Identify specific people across camera feeds",
};

const ALGORITHM_DISPLAY_NAMES: Record<string, string> = {
  faceid: "FaceID (Face Search)",
  weapon: "Weapon Detection",
  intruder: "Intruder Detection",
  masked: "Masked Person Detection",
  robbery: "Robbery Detection (Hands Raised)",
  fallen: "Person Fallen",
  crowd: "Crowd Detection",
  abandoned: "Abandoned Object/Bag",
  reid: "ReID (Person Identification)",
};

type LocalTimeParts = {
  localDate: string;      // YYYY-MM-DD
  dayOfWeek: number;      // 0=Sunday, 6=Saturday
  dayOfMonth: number;     // 1-31
  monthOfYear: number;    // 1-12
  localTimeHHMM: string;  // HH:MM
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function isValidIanaTimezoneForScheduler(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimezoneForScheduler(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^utc$/i.test(raw)) return "UTC";
  if (isValidIanaTimezoneForScheduler(raw)) return raw;

  const offsetPattern = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;
  const match = offsetPattern.exec(raw);
  if (!match) return null;

  const sign = match[1];
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 14 || minutes < 0 || minutes > 59) return null;

  if (hours === 0 && minutes === 0) {
    return "UTC";
  }

  if (minutes === 0) {
    const etcSign = sign === "+" ? "-" : "+";
    return `Etc/GMT${etcSign}${hours}`;
  }

  return null;
}

function getLocalDateTimePartsInTimezone(timezone: string, atDate: Date): LocalDateTimeParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = fmt.formatToParts(atDate);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

    const year = Number.parseInt(get("year"), 10);
    const month = Number.parseInt(get("month"), 10);
    const day = Number.parseInt(get("day"), 10);
    const hour = Number.parseInt(get("hour"), 10);
    const minute = Number.parseInt(get("minute"), 10);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    ) {
      return null;
    }

    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
}

function parseIsoLocalDateParts(localDate: string): Omit<LocalDateTimeParts, "hour" | "minute"> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim());
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  return { year, month, day };
}

function parseHHMMParts(value: string): Pick<LocalDateTimeParts, "hour" | "minute"> | null {
  const match = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  return { hour, minute };
}

function wallClockUtcMillis(parts: LocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
}

function localDateTimeInTimezoneToUtcIso(
  localDate: string,
  hhmm: string,
  timezone: string
): string | null {
  const dateParts = parseIsoLocalDateParts(localDate);
  const timeParts = parseHHMMParts(hhmm);
  const normalizedTimezone = normalizeTimezoneForScheduler(timezone) || "UTC";
  if (!dateParts || !timeParts) return null;

  const target: LocalDateTimeParts = { ...dateParts, ...timeParts };
  let guess = new Date(
    Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0, 0)
  );

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = getLocalDateTimePartsInTimezone(normalizedTimezone, guess);
    if (!observed) return null;

    const deltaMs = wallClockUtcMillis(observed) - wallClockUtcMillis(target);
    if (deltaMs === 0) {
      guess.setUTCSeconds(0, 0);
      return guess.toISOString();
    }

    guess = new Date(guess.getTime() - deltaMs);
  }

  const observed = getLocalDateTimePartsInTimezone(normalizedTimezone, guess);
  if (
    observed &&
    observed.year === target.year &&
    observed.month === target.month &&
    observed.day === target.day &&
    observed.hour === target.hour &&
    observed.minute === target.minute
  ) {
    guess.setUTCSeconds(0, 0);
    return guess.toISOString();
  }

  return null;
}

async function resolveSchedulerTimezoneForUser(
  db: D1Database,
  userId: string,
  fallbackTimezone: string | null | undefined
): Promise<string> {
  try {
    const pairingRow = await db.prepare(
      `SELECT timezone_iana
       FROM exe_pairings
       WHERE user_id = ?
         AND status = 'connected'
       ORDER BY COALESCE(timezone_updated_at, last_seen_at, paired_at) DESC
       LIMIT 1`
    )
      .bind(userId)
      .first();

    const pairingTimezone = normalizeTimezoneForScheduler((pairingRow as any)?.timezone_iana);
    if (pairingTimezone) return pairingTimezone;
  } catch (error) {
    console.log("[JOB SCHEDULER] Could not read EXE timezone, falling back:", error);
  }

  try {
    const userRow = await db.prepare(
      "SELECT timezone_iana FROM app_users WHERE id = ? LIMIT 1"
    )
      .bind(userId)
      .first();

    const userTimezone = normalizeTimezoneForScheduler((userRow as any)?.timezone_iana);
    if (userTimezone) return userTimezone;
  } catch (error) {
    console.log("[JOB SCHEDULER] Could not read app_users timezone, falling back:", error);
  }

  return normalizeTimezoneForScheduler(fallbackTimezone) || "UTC";
}

/**
 * Compute local date/time components from a timezone using Intl.DateTimeFormat
 */
function getLocalTimeInTimezone(timezone: string, atDate: Date = new Date()): LocalTimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = fmt.formatToParts(atDate);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const weekdayStr = get("weekday"); // "Sun", "Mon", etc.

  // Map weekday string to number
  const weekdayMap: Record<string, number> = {
    "Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;

  return {
    localDate: `${year}-${month}-${day}`,
    dayOfWeek,
    dayOfMonth: parseInt(day, 10),
    monthOfYear: parseInt(month, 10),
    localTimeHHMM: `${hour}:${minute}`,
  };
}

function normalizeDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoPrefixMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefixMatch) {
    return isoPrefixMatch[1];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildSchedulerTickSlots(timezone: string): LocalTimeParts[] {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);

  const candidates = [
    getLocalTimeInTimezone(timezone, oneMinuteAgo),
    getLocalTimeInTimezone(timezone, now),
  ];

  const seen = new Set<string>();
  const uniqueSlots: LocalTimeParts[] = [];
  for (const slot of candidates) {
    const key = `${slot.localDate}|${slot.localTimeHHMM}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSlots.push(slot);
  }

  return uniqueSlots;
}

/**
 * Try to acquire cron lock. Returns true if lock acquired, false if another tick is running.
 */
async function acquireCronLock(db: D1Database, lockName: string, durationSeconds: number): Promise<boolean> {
  const nowUtc = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();

  // Try to insert or update the lock
  const existing = await db.prepare(
    "SELECT locked_until_utc FROM cron_locks WHERE name = ?"
  ).bind(lockName).first();

  if (existing) {
    const existingLock = existing as any;
    // If lock is still valid (in the future), skip
    if (existingLock.locked_until_utc > nowUtc) {
      console.log(`[JOB SCHEDULER] Lock "${lockName}" held until ${existingLock.locked_until_utc}, skipping`);
      return false;
    }
    // Lock expired, update it
    await db.prepare(
      "UPDATE cron_locks SET locked_until_utc = ?, updated_at = ? WHERE name = ?"
    ).bind(lockedUntil, nowUtc, lockName).run();
  } else {
    // Insert new lock
    await db.prepare(
      "INSERT INTO cron_locks (name, locked_until_utc, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(lockName, lockedUntil, nowUtc, nowUtc).run();
  }

  return true;
}

/**
 * Build start_camera payload WITHOUT side effects (no commands, no camera status updates)
 * Used by scheduler to build job_start payload without actually starting cameras
 * Returns { ok: boolean; payload: any | null }
 */
async function buildStartCameraPayloadForScheduler(
  env: Env,
  userId: string,
  cameraId: number
): Promise<{ ok: boolean; payload: any | null }> {
  try {
    const camera = await env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    ).bind(cameraId, userId).first();

    if (!camera) {
      console.log(`[JOB SCHEDULER] Camera ${cameraId} not found for user ${userId}`);
      return { ok: false, payload: null };
    }

    const cam = camera as any;

    // Fetch active subscription
    const activeSubscription = await env.DB.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
    ).bind(userId).first();
    const userOpenAiApiKey = await getOpenAIApiKeyForUser(env.DB, userId);
    const descriptionModelApiKey = userOpenAiApiKey;

    const enabledAlgorithms = await buildEnabledAlgorithmsForCamera({
      db: env.DB,
      userId,
      cameraId,
      openAiApiKey: userOpenAiApiKey,
      onlyEnabled: true,
      algorithmDescriptions: ALGORITHM_DESCRIPTIONS,
      algorithmDisplayNames: ALGORITHM_DISPLAY_NAMES,
    });

    // Fetch frame rate
    const frameRateData = await env.DB.prepare(
      "SELECT frame_rate FROM user_frame_rate WHERE user_id = ?"
    ).bind(userId).first();
    const frameRate = frameRateData ? (frameRateData as any).frame_rate : 12;

    // Get subscription values
    const subscriptionModelTier = activeSubscription
      ? normalizeTier((activeSubscription as any).model_tier ?? "light")
      : "light";
    const subscriptionSecondsPerFrame = activeSubscription
      ? Number((activeSubscription as any).seconds_per_frame ?? 3)
      : 3;

    // Fetch Telegram settings
    const telegram = await getTelegramSettingsForUser(env.DB, userId);

    const payload = {
      camera_id: cam.id,
      name: cam.name,
      ip: cam.ip_address,
      port: cam.rtsp_port,
      username: cam.username,
      password: cam.password,
      channel: cam.channel,
      subtype: cam.subtype,
      manufacturer: cam.manufacturer,
      connection_method: cam.connection_method,
      start_origin: "job",
      enabled_algorithms: enabledAlgorithms,
      store_frames: cam.store_frames === 1,
      retention_days: cam.retention_days,
      frame_rate: frameRate,
      webcam_index: cam.webcam_index,
      analysis_speed: subscriptionSecondsPerFrame,
      model_tier: subscriptionModelTier,
      telegram_enabled: telegram.enabled,
      telegram_chat_id: telegram.chat_id,
      telegram_bot_token: telegram.bot_token,
      description_model_name: "gpt-5.1",
      description_model_api_key: descriptionModelApiKey,
    };

    return { ok: true, payload };
  } catch (error) {
    console.error(`[JOB SCHEDULER] Error building payload for camera ${cameraId}:`, error);
    return { ok: false, payload: null };
  }
}

/**
 * Build the job_start payload with full job definition and runtime context
 */
async function buildJobStartPayload(
  env: Env,
  job: any,
  scheduleDay: any,
  window: any,
  localTime: { localDate: string; localTimeHHMM: string },
  effectiveTimezone: string
): Promise<any> {
  const triggeredAtUtc = new Date().toISOString();
  const windowStartUtc =
    typeof window?.start_time === "string"
      ? localDateTimeInTimezoneToUtcIso(localTime.localDate, window.start_time, effectiveTimezone)
      : null;
  const windowEndUtc =
    typeof window?.end_time === "string"
      ? localDateTimeInTimezoneToUtcIso(localTime.localDate, window.end_time, effectiveTimezone)
      : null;
  const parseTimeToMinutes = (value: string): number | null => {
    const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours * 60 + minutes;
  };

  // Fetch Telegram settings once for the job user
  const telegramSettings = await getTelegramSettingsForUser(env.DB, job.user_id);
  const userOpenAiApiKey = await getOpenAIApiKeyForUser(env.DB, job.user_id);
  const userZAiApiKey = await getZAIApiKeyForUser(env.DB, job.user_id);
  const modelRuntimeConfig = await loadModelRuntimeConfigForPayload(
    env.DB,
    userOpenAiApiKey,
    userZAiApiKey
  );

  // Fetch all steps ordered by step_order
  const { results: steps } = await env.DB.prepare(
    `SELECT * FROM job_steps WHERE job_id = ? ORDER BY step_order ASC`
  ).bind(job.id).all();
  const stepOrderToId = new Map<number, number>();
  for (const s of steps || []) {
    const sAny = s as any;
    if (typeof sAny.step_order === "number") {
      stepOrderToId.set(sAny.step_order, sAny.id);
    }
  }

  const getPreviousStepId = (currentOrder: number): number | null => {
    let prevOrder = -1;
    let prevId: number | null = null;
    for (const [order, id] of stepOrderToId.entries()) {
      if (order < currentOrder && order > prevOrder) {
        prevOrder = order;
        prevId = id;
      }
    }
    return prevId;
  };

  // Build steps array with targets, agent, and alerts
  const stepsWithDetails = await Promise.all(
    (steps || []).map(async (step: any) => {
      // Fetch targets with camera names
      const { results: targets } = await env.DB.prepare(
        `SELECT jst.*, c.name as camera_name
         FROM job_step_targets jst
         LEFT JOIN cameras c ON jst.camera_id = c.id
         WHERE jst.step_id = ?`
      ).bind(step.id).all();

      // Fetch ALL active agents (per-camera + legacy default)
      const { results: agentsResults } = await env.DB.prepare(
        "SELECT * FROM job_step_agents WHERE step_id = ? AND is_active = 1 ORDER BY camera_id IS NULL DESC, created_at DESC"
      ).bind(step.id).all();
      const activeAgentRows = (agentsResults || []).map((row: any) => ({ ...row }));
      const activeAgentIds = activeAgentRows
        .map((row: any) => Number(row?.id))
        .filter((id: number) => Number.isInteger(id) && id > 0);
      const faceTargetsByAgentId = await loadExpandedFaceTargetsByAgentIdForPayload(
        env.DB,
        job.user_id,
        activeAgentIds
      );
      const negativeImagesByAgentId = await loadNegativeReferenceImagesByAgentIdForPayload(
        env.DB,
        activeAgentIds
      );

      const agents = activeAgentRows.map((a: any) => {
        const inferenceModel = normalizeInferenceModel(a.inference_model);
        const modelConfig = modelRuntimeConfig[inferenceModel] || DEFAULT_MODEL_RUNTIME_CONFIG[inferenceModel];
        const agentId = Number(a?.id);
        const faceTargets =
          Number.isInteger(agentId) && agentId > 0
            ? faceTargetsByAgentId.get(agentId) || []
            : [];
        const negativeReferenceImages =
          Number.isInteger(agentId) && agentId > 0
            ? negativeImagesByAgentId.get(agentId) || []
            : [];
        const normalizedAgentKey = String(a?.agent_key || "").trim().toLowerCase();
        if (
          (normalizedAgentKey === "faceid" ||
            normalizedAgentKey === "face_id" ||
            normalizedAgentKey === "face-id") &&
          faceTargets.length === 0
        ) {
          console.log(
            `[JOB SCHEDULER] Warning: FaceID agent id=${agentId} step_id=${step.id} has no selected face targets; hidden FaceID prompt will be skipped.`
          );
        }
        const runEvery = normalizeAgentRunEverySeconds(
          a.run_every,
          FIXED_AGENT_RUN_EVERY_SECONDS
        );
        const runningResolution = normalizeRunningResolution(
          a.running_resolution,
          DEFAULT_CORE_RUNNING_RESOLUTION
        );
        const useTemporalContext = normalizeUseTemporalContext(
          a.use_temporal_context,
          true
        );
        const promptParts = parsePromptTemplatePartsForJobStepTemporalMode(
          a.prompt_template,
          a.alert_condition,
          a.negative_condition,
          useTemporalContext
        );
        const analysisRegionsRaw = parseAnalysisRegionsFromUnknown(a.analysis_regions, {
          promptParts,
          faceTargetIds: faceTargets
            .map((target) => Number(target?.id))
            .filter((id) => Number.isInteger(id) && id > 0),
          negativeImageIds: negativeReferenceImages
            .map((img) => Number(img?.id))
            .filter((id) => Number.isInteger(id) && id > 0),
        });
        const analysisRegions = useTemporalContext
          ? analysisRegionsRaw
          : sanitizeAnalysisRegionsForLegacyFlow(analysisRegionsRaw);
        return {
          id: a.id,
          agent_key: a.agent_key,
          prompt_template: promptParts.prompt_template,
          params: a.params,
          input_schema: a.input_schema,
          camera_id: a.camera_id,
          input_type:
            inferenceModel === "core"
              ? "video"
              : normalizeTargetInputType(a.input_type),
          alert_condition: promptParts.alert_condition,
          negative_condition: promptParts.negative_condition,
          priority_level: normalizePriorityLevel(a.priority_level),
          inference_model: inferenceModel,
          api_key: modelConfig?.api_key || null,
          model_fps: normalizeModelFps(
            a.model_fps ?? modelConfig?.model_fps,
            inferenceModel,
            inferenceModel === "core" ? "video" : normalizeTargetInputType(a.input_type),
            DEFAULT_ULTRA_VIDEO_MODEL_FPS
          ),
          run_every: inferenceModel === "core" ? 60 : runEvery,
          running_resolution: inferenceModel === "core" ? runningResolution : null,
          only_capture_on_motion: normalizeOnlyCaptureOnMotion(a.only_capture_on_motion, true),
          use_temporal_context: useTemporalContext,
          analysis_regions: analysisRegions,
          face_targets: faceTargets,
          negative_reference_images: negativeReferenceImages,
          temporal_plan_json: useTemporalContext ? a.temporal_plan_json ?? null : null,
          temporal_plan_hash: useTemporalContext ? a.temporal_plan_hash ?? null : null,
          temporal_plan_version: useTemporalContext ? a.temporal_plan_version ?? null : null,
          temporal_compiled_at: useTemporalContext ? a.temporal_compiled_at ?? null : null,
          temporal_compile_model: useTemporalContext ? a.temporal_compile_model ?? null : null,
          temporal_explain_json: useTemporalContext ? a.temporal_explain_json ?? null : null,
        };
      });

      // Fetch alert rules
      const { results: alerts } = await env.DB.prepare(
        "SELECT * FROM job_step_alert_rules WHERE step_id = ?"
      ).bind(step.id).all();

      // Derive start_condition from new columns with legacy fallback
      let start_condition: any;
      
      // Check for new start_condition column first
      if (step.start_condition !== null && step.start_condition !== undefined) {
        // New format: start_condition is stored in dedicated column
        const conditionStr = step.start_condition;
        const fromStepId = step.start_condition_from_step_id ?? null;
        
        // Parse start_condition string to determine mode
        // Format examples: "start:positive:result:XYZ", "start:time:13:56"
        if (conditionStr.startsWith("start:")) {
          const parts = conditionStr.split(":");
          const modeType = parts[1] || "sequential";
          
          if (modeType === "time") {
            const timeStr = parts.slice(2).join(":");
            const targetMinutes = parseTimeToMinutes(timeStr || "");
            const windowStartMinutes = parseTimeToMinutes(window?.start_time || "");
            let offsetSeconds = 0;
            if (targetMinutes !== null && windowStartMinutes !== null) {
              const delta = targetMinutes - windowStartMinutes;
              offsetSeconds = delta > 0 ? delta * 60 : 0;
            }
            start_condition = {
              mode: "time",
              from_step_id: null,
              camera_id: null,
              extract: null,
              pattern: null,
              time_offset_sec: offsetSeconds,
              time_hhmm: timeStr || null,
            };
          } else if (modeType === "custom") {
            const answerKey = parts[2] || "result";
            start_condition = {
              mode: "custom",
              from_step_id: fromStepId,
              camera_id: null,
              extract: answerKey,
              pattern: parts[3] || null,
              time_offset_sec: null,
            };
          } else {
            // positive, negative, sequential
            start_condition = {
              mode: modeType,
              from_step_id: fromStepId,
              camera_id: null,
              extract: parts[2] || "result",
              pattern: parts[3] || null,
              time_offset_sec: null,
            };
          }
        } else {
          // Unrecognized format, default to sequential if from_step_id exists
          start_condition = {
            mode: fromStepId ? "sequential" : "time",
            from_step_id: fromStepId,
            camera_id: null,
            extract: fromStepId ? "result" : null,
            pattern: null,
            time_offset_sec: fromStepId ? null : 0,
          };
        }
      } else if (step.input_inject_key && typeof step.input_inject_key === "string" && step.input_inject_key.startsWith("start:")) {
        // Legacy fallback: start condition encoded in input_inject_key
        const conditionStr = step.input_inject_key;
        const fromStepId = step.input_from_step_id ?? null;
        
        const parts = conditionStr.split(":");
        const modeType = parts[1] || "sequential";
        
        if (modeType === "time") {
          const timeStr = parts.slice(2).join(":");
          const targetMinutes = parseTimeToMinutes(timeStr || "");
          const windowStartMinutes = parseTimeToMinutes(window?.start_time || "");
          let offsetSeconds = 0;
          if (targetMinutes !== null && windowStartMinutes !== null) {
            const delta = targetMinutes - windowStartMinutes;
            offsetSeconds = delta > 0 ? delta * 60 : 0;
          }
          start_condition = {
            mode: "time",
            from_step_id: null,
            camera_id: null,
            extract: null,
            pattern: null,
            time_offset_sec: offsetSeconds,
            time_hhmm: timeStr || null,
          };
        } else {
          start_condition = {
            mode: modeType,
            from_step_id: fromStepId,
            camera_id: null,
            extract: parts[2] || "result",
            pattern: parts[3] || null,
            time_offset_sec: null,
          };
        }
      } else {
        // No start condition specified, derive default based on step order
        if (step.step_order === 1) {
          start_condition = {
            mode: "time",
            from_step_id: null,
            camera_id: null,
            extract: null,
            pattern: null,
            time_offset_sec: 0,
          };
        } else {
          const prevId = getPreviousStepId(step.step_order);
          start_condition = {
            mode: prevId ? "sequential" : "time",
            from_step_id: prevId,
            camera_id: null,
            extract: prevId ? "result" : null,
            pattern: null,
            time_offset_sec: prevId ? null : 0,
          };
        }
      }

      // Derive pipeline(s) from dedicated columns or JSON config
      // Pipeline should be null if start_condition was in input_inject_key (legacy misuse)
      let pipeline: any = null;
      let pipelines: any[] = [];
      const isLegacyStartCondition = step.start_condition === null && 
                                      step.input_inject_key && 
                                      typeof step.input_inject_key === "string" && 
                                      step.input_inject_key.startsWith("start:");

      // Build map from targets (camera_name -> camera_id)
      const cameraNameToId = new Map<string, number>();
      for (const t of targets || []) {
        const target = t as any;
        if (target.camera_name && target.camera_id) {
          cameraNameToId.set(target.camera_name, target.camera_id);
        }
      }

      const resolveCameraIdForKey = async (injectKey: string): Promise<number | null> => {
        if (cameraNameToId.has(injectKey)) {
          return cameraNameToId.get(injectKey)!;
        }
        const cameraRow = await env.DB.prepare(
          "SELECT id FROM cameras WHERE user_id = ? AND name = ? LIMIT 1"
        ).bind(job.user_id, injectKey).first();
        if (cameraRow) {
          return (cameraRow as any).id;
        }
        const match = /^Camera\s+(\d+)$/.exec(injectKey);
        if (match) {
          return parseInt(match[1], 10);
        }
        return null;
      };

      const parsePipelinesFromInputKey = (): Array<{ input_from_step_id: number; input_inject_keys: string[]; target_camera_id?: number | null }> => {
        if (!step.input_inject_key || typeof step.input_inject_key !== "string") return [];
        const raw = step.input_inject_key.trim();
        if (!raw || raw.startsWith("start:")) return [];
        if (!(raw.startsWith("{") || raw.startsWith("["))) return [];
        try {
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : parsed?.pipelines;
          if (!Array.isArray(arr)) return [];
          const normalized = arr
            .map((p: any) => {
              const fromStepId = Number(p?.input_from_step_id);
              if (!Number.isFinite(fromStepId)) return null;
              const keys = Array.isArray(p?.input_inject_keys)
                ? p.input_inject_keys
                : p?.input_inject_key
                ? [p.input_inject_key]
                : [];
              const cleaned = keys
                .map((k: any) => (k == null ? "" : String(k)).trim())
                .filter((k: string) => k.length > 0);
              if (!cleaned.length) return null;
              const targetCameraIdRaw = p?.target_camera_id;
              const targetCameraId = targetCameraIdRaw === null || targetCameraIdRaw === undefined || targetCameraIdRaw === ""
                ? null
                : Number(targetCameraIdRaw);
              return {
                input_from_step_id: fromStepId,
                input_inject_keys: Array.from(new Set(cleaned)),
                target_camera_id: Number.isFinite(targetCameraId) ? targetCameraId : null,
              };
            })
            .filter(Boolean) as Array<{ input_from_step_id: number; input_inject_keys: string[]; target_camera_id?: number | null }>;
          return normalized;
        } catch {
          return [];
        }
      };
      
      if (!isLegacyStartCondition) {
        const parsedPipelines = parsePipelinesFromInputKey();

        if (parsedPipelines.length > 0) {
          for (const p of parsedPipelines) {
            const inputs = [];
            for (const key of p.input_inject_keys) {
              const cameraId = await resolveCameraIdForKey(key);
              if (cameraId == null) {
                console.log(`[JOB SCHEDULER] Warning: Could not resolve camera_id for inject_key "${key}" in step ${step.id}`);
              }
              inputs.push({ input_inject_key: key, camera_id: cameraId });
            }
            pipelines.push({
              input_from_step_id: p.input_from_step_id,
              target_camera_id: p.target_camera_id ?? null,
              inputs,
            });
          }
        } else if (step.input_from_step_id != null && step.input_inject_key && String(step.input_inject_key).trim() !== '') {
          const pipelineCameraId = await resolveCameraIdForKey(step.input_inject_key);
          if (pipelineCameraId == null) {
            console.log(`[JOB SCHEDULER] Warning: Could not resolve camera_id for inject_key "${step.input_inject_key}" in step ${step.id}`);
          }
          pipeline = {
            input_from_step_id: step.input_from_step_id,
            input_inject_key: step.input_inject_key,
            camera_id: pipelineCameraId,
          };
          pipelines = [
            {
              input_from_step_id: step.input_from_step_id,
              target_camera_id: null,
              inputs: [{ input_inject_key: step.input_inject_key, camera_id: pipelineCameraId }],
            },
          ];
        }
      }

      const rawInferenceGroups = parseInferenceGroupsForPayload(step.inference_groups);
      const targetIdToCameraId = new Map<number, number>();
      for (const t of targets || []) {
        const targetId = Number((t as any)?.id);
        const cameraId = Number((t as any)?.camera_id);
        if (Number.isInteger(targetId) && targetId > 0 && Number.isInteger(cameraId) && cameraId > 0) {
          targetIdToCameraId.set(targetId, cameraId);
        }
      }

      const inferenceGroups = rawInferenceGroups.map((group) => {
        const groupCameraIds = new Set<number>();
        for (const targetId of group.targetIds) {
          const cameraId = targetIdToCameraId.get(targetId);
          if (cameraId) {
            groupCameraIds.add(cameraId);
          }
        }
        const sourceCameraId =
          group.source_target_id !== null
            ? targetIdToCameraId.get(group.source_target_id) ?? null
            : null;
        const matchingAgents = agents.filter((a: any) => String(a?.agent_key || "").trim() === group.agentKey);
        const sourceCameraSpecificAgent =
          sourceCameraId !== null
            ? matchingAgents.find((a: any) => {
                const cameraId = Number(a?.camera_id);
                return Number.isInteger(cameraId) && cameraId === sourceCameraId;
              })
            : null;
        const cameraSpecificAgent = matchingAgents.find((a: any) => {
          const cameraId = Number(a?.camera_id);
          return Number.isInteger(cameraId) && groupCameraIds.has(cameraId);
        });
        const defaultAgent = matchingAgents.find((a: any) => a?.camera_id === null || a?.camera_id === undefined);
        const resolvedAgent =
          sourceCameraSpecificAgent || cameraSpecificAgent || defaultAgent || matchingAgents[0] || null;

        const resolvedPromptParts = parsePromptTemplateParts(
          (resolvedAgent as any)?.prompt_template,
          (resolvedAgent as any)?.alert_condition,
          (resolvedAgent as any)?.negative_condition
        );
        const groupPromptParts = parsePromptTemplateParts(
          group.prompt_template,
          group.alert_condition,
          group.negative_condition
        );
        const promptTemplate = groupPromptParts.prompt_template?.trim()
          ? groupPromptParts.prompt_template
          : resolvedPromptParts.prompt_template;
        const alertCondition =
          groupPromptParts.alert_condition !== null &&
          groupPromptParts.alert_condition !== undefined
            ? groupPromptParts.alert_condition
            : resolvedPromptParts.alert_condition;
        const negativeCondition =
          groupPromptParts.negative_condition !== null &&
          groupPromptParts.negative_condition !== undefined
            ? groupPromptParts.negative_condition
            : resolvedPromptParts.negative_condition;
        const priorityLevel =
          normalizePriorityLevel((resolvedAgent as any)?.priority_level) ??
          normalizePriorityLevel(group.priority_level);
        const inferenceModel = normalizeInferenceModel(
          (resolvedAgent as any)?.inference_model ?? group.inference_model
        );
        const inputType =
          inferenceModel === "core"
            ? "video"
            : normalizeTargetInputType(
                (resolvedAgent as any)?.input_type ??
                  (group as any)?.input_type ??
                  group.inputType
              );
        const modelConfig = modelRuntimeConfig[inferenceModel] || DEFAULT_MODEL_RUNTIME_CONFIG[inferenceModel];
        const apiKey = modelConfig?.api_key || null;
        const modelFps = normalizeModelFps(
          (resolvedAgent as any)?.model_fps ?? modelConfig?.model_fps ?? group.model_fps,
          inferenceModel,
          inputType,
          DEFAULT_ULTRA_VIDEO_MODEL_FPS
        );
        const runEvery = normalizeAgentRunEverySeconds(
          (resolvedAgent as any)?.run_every ?? group.run_every,
          10
        );
        const videoPackagingMode = normalizeVideoPackagingMode(
          (resolvedAgent as any)?.video_packaging_mode ??
            (resolvedAgent as any)?.videoPackagingMode ??
            group.video_packaging_mode
        );
        const runningResolution = normalizeRunningResolution(
          (resolvedAgent as any)?.running_resolution ?? group.running_resolution,
          DEFAULT_CORE_RUNNING_RESOLUTION
        );
        const onlyCaptureOnMotion = normalizeOnlyCaptureOnMotion(
          (resolvedAgent as any)?.only_capture_on_motion ??
            group.only_capture_on_motion,
          true
        );
        const resolvedFaceTargets =
          parseFaceTargetsFromUnknown((resolvedAgent as any)?.face_targets).length > 0
            ? parseFaceTargetsFromUnknown((resolvedAgent as any)?.face_targets)
            : parseFaceTargetsFromUnknown(group.face_targets);
        const resolvedNegativeReferenceImages =
          parseNegativeReferenceImagesFromUnknown(
            (resolvedAgent as any)?.negative_reference_images
          ).length > 0
            ? parseNegativeReferenceImagesFromUnknown(
                (resolvedAgent as any)?.negative_reference_images
              )
            : parseNegativeReferenceImagesFromUnknown(
                (group as any)?.negative_reference_images
              );
        const resolvedAnalysisRegions = parseAnalysisRegionsFromUnknown(
          (resolvedAgent as any)?.analysis_regions ?? (group as any)?.analysis_regions,
          {
            promptParts: {
              prompt_template: promptTemplate,
              alert_condition: alertCondition,
              negative_condition: negativeCondition,
            },
            faceTargetIds: resolvedFaceTargets
              .map((target) => Number(target?.id))
              .filter((id) => Number.isInteger(id) && id > 0),
            negativeImageIds: resolvedNegativeReferenceImages
              .map((img) => Number(img?.id))
              .filter((id) => Number.isInteger(id) && id > 0),
          }
        );

        return {
          ...group,
          prompt_template: promptTemplate,
          alert_condition: alertCondition,
          negative_condition: negativeCondition,
          priority_level: priorityLevel,
          inference_model: inferenceModel,
          api_key: apiKey,
          model_fps: modelFps,
          run_every: inferenceModel === "core" ? 60 : runEvery,
          video_packaging_mode: videoPackagingMode,
          running_resolution: inferenceModel === "core" ? runningResolution : null,
          only_capture_on_motion: onlyCaptureOnMotion,
          analysis_regions: resolvedAnalysisRegions,
          face_targets: resolvedFaceTargets,
          negative_reference_images: resolvedNegativeReferenceImages,
        };
      });

      // Build step object - exclude input_from_step_id and input_inject_key when pipeline is defined
      const stepObj: any = {
        id: step.id,
        step_order: step.step_order,
        name: step.name,
        timeout_seconds: Math.max(
          MIN_JOB_STEP_TIMEOUT_SECONDS,
          Number.isFinite(Number(step.timeout_seconds))
            ? Math.round(Number(step.timeout_seconds))
            : MIN_JOB_STEP_TIMEOUT_SECONDS
        ),
        on_missing_input: step.on_missing_input,
        start_condition,
        pipeline: pipeline,
        inference_groups: inferenceGroups,
      };
      
      if (pipelines.length > 0) {
        stepObj.pipelines = pipelines;
      }

      if (
        pipeline === null &&
        pipelines.length === 1 &&
        pipelines[0].inputs &&
        pipelines[0].inputs.length === 1
      ) {
        const first = pipelines[0];
        pipeline = {
          input_from_step_id: first.input_from_step_id,
          input_inject_key: first.inputs[0].input_inject_key,
          camera_id: first.inputs[0].camera_id ?? null,
        };
        stepObj.pipeline = pipeline;
      }

      // Only include input_from_step_id and input_inject_key if no pipelines are defined
      if (pipeline === null && pipelines.length === 0) {
        stepObj.input_from_step_id = step.input_from_step_id;
        stepObj.input_inject_key = step.input_inject_key;
      }

      return {
        step: stepObj,
        targets: (targets || []).map((t: any) => ({
          id: t.id,
          camera_id: t.camera_id,
          camera_name: t.camera_name,
        })),
        agents: agents,
        alerts: (alerts || []).map((a: any) => {
          const baseAlert: any = {
            id: a.id,
            condition_expr: a.condition_expr,
            channel: a.channel,
            channel_params: a.channel_params,
            message_template: a.message_template,
          };

          // Augment Telegram alerts with credentials
          if (a.channel === "telegram") {
            // Try to parse channel_params for per-alert overrides
            let channelParams: any = {};
            try {
              channelParams = typeof a.channel_params === "string" 
                ? JSON.parse(a.channel_params) 
                : a.channel_params || {};
            } catch {
              channelParams = {};
            }

            // Use per-alert overrides if present, otherwise fall back to user settings
            const botToken = channelParams.bot_token || telegramSettings.bot_token;
            const chatId = channelParams.chat_id || telegramSettings.chat_id;

            baseAlert.telegram_bot_token = botToken;
            baseAlert.telegram_chat_id = chatId;

            // Log warning if credentials are missing
            if (!botToken || !chatId) {
              console.log(
                `[JOB SCHEDULER] Warning: Telegram alert ${a.id} for step ${step.id} ` +
                `missing credentials (bot_token: ${!!botToken}, chat_id: ${!!chatId})`
              );
            }
          }

          return baseAlert;
        }),
      };
    })
  );

  // Collect all unique camera IDs across all steps
  const allCameraIds = [...new Set(
    stepsWithDetails.flatMap((s: any) => s.targets.map((t: any) => t.camera_id))
  )];

  return {
    version: 1,
    job: {
      id: job.id,
      user_id: job.user_id,
      name: job.name,
      description: job.description,
      status: job.status,
      timezone: effectiveTimezone,
      schedule_mode: job.schedule_mode,
      active_from: job.active_from,
      active_until: job.active_until,
    },
    trigger: {
      trigger_type: "schedule",
      timezone: effectiveTimezone,
      local_date: localTime.localDate,
      local_time: localTime.localTimeHHMM,
      schedule_mode: job.schedule_mode,
      schedule_day: {
        id: scheduleDay.id,
        day_name: scheduleDay.day_name,
        day_of_week: scheduleDay.day_of_week,
        day_of_month: scheduleDay.day_of_month,
        month_of_year: scheduleDay.month_of_year,
      },
      window: {
        id: window.id,
        start_time: window.start_time,
        end_time: window.end_time,
        start_utc: windowStartUtc,
        end_utc: windowEndUtc,
      },
      triggered_at_utc: triggeredAtUtc,
    },
    steps: stepsWithDetails,
    all_camera_ids: allCameraIds,
  };
}

export async function enqueueManualJobStart(
  env: Env,
  job: any
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nowUtc = new Date().toISOString();
  const fallbackTimezone = normalizeTimezoneForScheduler(job?.timezone) || "UTC";
  const timezone = await resolveSchedulerTimezoneForUser(
    env.DB,
    String(job?.user_id || ""),
    fallbackTimezone
  );
  const localTime = getLocalTimeInTimezone(timezone);
  const manualScheduleDay = {
    id: null,
    day_name: "Manual",
    day_of_week: localTime.dayOfWeek,
    day_of_month: localTime.dayOfMonth,
    month_of_year: localTime.monthOfYear,
  };
  const manualWindow = {
    id: null,
    start_time: localTime.localTimeHHMM,
    end_time: localTime.localTimeHHMM,
  };

  try {
    let jobStartPayload = await buildJobStartPayload(
      env,
      job,
      manualScheduleDay,
      manualWindow,
      localTime,
      timezone
    );

    const startCameraPayloads: Record<string, any> = {};
    for (const cameraId of jobStartPayload.all_camera_ids) {
      const res = await buildStartCameraPayloadForScheduler(env, job.user_id, cameraId);
      if (res.ok && res.payload) {
        startCameraPayloads[String(cameraId)] = {
          ...res.payload,
          enabled_algorithms: [],
        };
      } else {
        startCameraPayloads[String(cameraId)] = null;
      }
    }

    jobStartPayload = {
      ...jobStartPayload,
      trigger: {
        trigger_type: "manual",
        timezone,
        local_date: localTime.localDate,
        local_time: localTime.localTimeHHMM,
        triggered_at_utc: nowUtc,
      },
      start_camera_payloads: startCameraPayloads,
    };

    await env.DB.prepare(
      `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
       VALUES (?, NULL, 'job_start', ?, 'pending', ?, ?)`
    )
      .bind(
        job.user_id,
        JSON.stringify(jobStartPayload),
        nowUtc,
        nowUtc
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, started_at_utc, last_event_at_utc, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         status = 'running',
         started_at_utc = ?,
         last_event_at_utc = ?,
         updated_at = ?`
    )
      .bind(
        job.id,
        job.user_id,
        job.name,
        nowUtc,
        nowUtc,
        nowUtc,
        nowUtc,
        nowUtc,
        nowUtc,
        nowUtc
      )
      .run();

    const startedMessage = `Job "${job.name}" started successfully.`;
    const startedDetails = JSON.stringify({
      reason: "manual_start",
      job_id: job.id,
      job_name: job.name,
      local_date: localTime.localDate,
      local_time: localTime.localTimeHHMM,
      timezone,
    });

    try {
      await env.DB.prepare(
        `INSERT INTO events (user_id, camera_id, event_type, message, details_json, is_unread, created_at, updated_at)
         VALUES (?, NULL, 'job_started', ?, ?, 1, ?, ?)`
      )
        .bind(
          job.user_id,
          startedMessage,
          startedDetails,
          nowUtc,
          nowUtc
        )
        .run();
    } catch (richInsertError) {
      await env.DB.prepare(
        `INSERT INTO events (user_id, camera_id, event_type, message, created_at, updated_at)
         VALUES (?, NULL, 'job_started', ?, ?, ?)`
      )
        .bind(
          job.user_id,
          startedMessage,
          nowUtc,
          nowUtc
        )
        .run();
      console.warn(
        `[JOB SCHEDULER] job_started fallback insert used for manual start job ${job.id}:`,
        richInsertError
      );
    }

    console.log(`[JOB SCHEDULER] Enqueued manual job_start for job ${job.id} (${job.name})`);
    return { ok: true };
  } catch (error) {
    console.error(`[JOB SCHEDULER] Failed manual start for job ${job?.id}:`, error);
    return { ok: false, error: "Failed to start job" };
  }
}

/**
 * Main scheduler tick function - called every minute by cron
 */
export async function runJobSchedulerTick(env: Env): Promise<void> {
  console.log("[JOB SCHEDULER] Starting scheduler tick");

  // Acquire lock (55 seconds to avoid overlap)
  const lockAcquired = await acquireCronLock(env.DB, "job_scheduler", 55);
  if (!lockAcquired) {
    console.log("[JOB SCHEDULER] Could not acquire lock, skipping tick");
    return;
  }

  const nowUtc = new Date().toISOString();
  try {
    // Query eligible jobs:
    // - status = 'scheduled'
    // - schedule_mode in (weekly, monthly, yearly)
    const { results: jobs } = await env.DB.prepare(
      `SELECT * FROM jobs
       WHERE status = 'scheduled'
         AND schedule_mode IN ('weekly', 'monthly', 'yearly')`
    ).all();

    console.log(`[JOB SCHEDULER] Found ${(jobs || []).length} eligible jobs`);
    const openAiKeyByUser = new Map<string, string>();
    const zAiKeyByUser = new Map<string, string>();
    const timezoneByUser = new Map<string, string>();
    const requirementsByJobId = new Map<number, JobInferenceProviderRequirements>();

    for (const job of (jobs || [])) {
      const j = job as any;
      const userId = String(j.user_id || "");
      let timezone = timezoneByUser.get(userId);
      if (!timezone) {
        timezone = await resolveSchedulerTimezoneForUser(
          env.DB,
          userId,
          j.timezone || "UTC"
        );
        timezoneByUser.set(userId, timezone);
      }

      let currentLocalTime: LocalTimeParts;
      let tickSlots: LocalTimeParts[];
      try {
        currentLocalTime = getLocalTimeInTimezone(timezone);
        tickSlots = buildSchedulerTickSlots(timezone);
      } catch (err) {
        console.error(`[JOB SCHEDULER] Invalid timezone "${timezone}" for job ${j.id}, using UTC`);
        currentLocalTime = getLocalTimeInTimezone("UTC");
        tickSlots = buildSchedulerTickSlots("UTC");
      }

      console.log(
        `[JOB SCHEDULER] Job ${j.id} (${j.name}): timezone=${timezone}, localDate=${currentLocalTime.localDate}, localTime=${currentLocalTime.localTimeHHMM}, dow=${currentLocalTime.dayOfWeek}`
      );

      const activeFromDate = normalizeDateOnly(j.active_from);
      const activeUntilDate = normalizeDateOnly(j.active_until);
      const jobId = Number(j.id);

      let requirements = requirementsByJobId.get(jobId);
      if (!requirements) {
        requirements = await loadJobInferenceProviderRequirements(env.DB, jobId);
        requirementsByJobId.set(jobId, requirements);
      }

      let userOpenAiApiKey = openAiKeyByUser.get(userId);
      if (userOpenAiApiKey === undefined) {
        userOpenAiApiKey = userId ? await getOpenAIApiKeyForUser(env.DB, userId) : "";
        openAiKeyByUser.set(userId, userOpenAiApiKey);
      }
      const hasUserOpenAiApiKey = !!userOpenAiApiKey;
      let userZAiApiKey = zAiKeyByUser.get(userId);
      if (userZAiApiKey === undefined) {
        userZAiApiKey = userId ? await getZAIApiKeyForUser(env.DB, userId) : "";
        zAiKeyByUser.set(userId, userZAiApiKey);
      }
      const hasUserZAiApiKey = !!userZAiApiKey;

      for (const localTime of tickSlots) {
        if (activeFromDate && localTime.localDate < activeFromDate) {
          continue;
        }
        if (activeUntilDate && localTime.localDate > activeUntilDate) {
          continue;
        }

        // Find matching schedule days based on mode
        let scheduleDayQuery: string;
        let scheduleDayBindings: any[];

        switch (j.schedule_mode) {
          case "weekly":
            scheduleDayQuery = `SELECT * FROM job_schedule_days WHERE job_id = ? AND day_of_week = ?`;
            scheduleDayBindings = [j.id, localTime.dayOfWeek];
            break;
          case "monthly":
            scheduleDayQuery = `SELECT * FROM job_schedule_days WHERE job_id = ? AND day_of_month = ?`;
            scheduleDayBindings = [j.id, localTime.dayOfMonth];
            break;
          case "yearly":
            scheduleDayQuery = `SELECT * FROM job_schedule_days WHERE job_id = ? AND month_of_year = ? AND day_of_month = ?`;
            scheduleDayBindings = [j.id, localTime.monthOfYear, localTime.dayOfMonth];
            break;
          default:
            console.log(`[JOB SCHEDULER] Unknown schedule_mode "${j.schedule_mode}" for job ${j.id}`);
            continue;
        }

        const { results: matchingDays } = await env.DB.prepare(scheduleDayQuery)
          .bind(...scheduleDayBindings)
          .all();

        if (!matchingDays || matchingDays.length === 0) {
          continue;
        }

        for (const day of matchingDays) {
          const d = day as any;

          // --- START windows (optional) ---
          const { results: startingWindows } = await env.DB.prepare(
            `SELECT * FROM job_schedule_windows
             WHERE schedule_day_id = ? AND start_time = ? AND is_enabled = 1`
          ).bind(d.id, localTime.localTimeHHMM).all();

          if (startingWindows && startingWindows.length > 0) {
            for (const window of startingWindows) {
              const w = window as any;

              const runtimeState = await env.DB.prepare(
                `SELECT status FROM job_runtime_states WHERE job_id = ? LIMIT 1`
              ).bind(j.id).first();
              const runtimeStatus = typeof (runtimeState as any)?.status === "string"
                ? String((runtimeState as any).status).toLowerCase()
                : "";
              if (runtimeStatus === "running" || runtimeStatus === "stopping") {
                console.log(
                  `[JOB SCHEDULER] Job ${j.id} already ${runtimeStatus}, skipping scheduled start at ${localTime.localTimeHHMM}`
                );
                continue;
              }

              const missingOpenAi = requirements.requiresOpenAi && !hasUserOpenAiApiKey;
              const missingZAi = requirements.requiresZAi && !hasUserZAiApiKey;
              if (missingOpenAi || missingZAi) {
                const missingProviders: string[] = [];
                if (missingOpenAi) missingProviders.push("OpenAI");
                if (missingZAi) missingProviders.push("Z.ai");

                const reason =
                  missingOpenAi && missingZAi
                    ? "missing_model_api_keys"
                    : missingZAi
                    ? "missing_zai_api_key"
                    : "missing_openai_api_key";
                const blockedMessage =
                  missingProviders.length > 1
                    ? `Job "${j.name}" was not started because API keys are missing in Settings (${missingProviders.join(" + ")}).`
                    : `Job "${j.name}" was not started because ${missingProviders[0]} API key is not configured in Settings.`;

                console.log(
                  `[JOB SCHEDULER] Skipping job ${j.id} start at ${localTime.localTimeHHMM}: missing ${missingProviders.join(" + ")} API key`
                );
                try {
                  const blockedDetails = JSON.stringify({
                    reason,
                    missing_providers: missingProviders,
                    requires_openai: requirements.requiresOpenAi,
                    requires_zai: requirements.requiresZAi,
                    job_id: j.id,
                    job_name: j.name,
                    schedule_day_id: d.id,
                    schedule_window_id: w.id,
                    local_date: localTime.localDate,
                    local_time: localTime.localTimeHHMM,
                    timezone,
                  });

                  try {
                    await env.DB.prepare(
                      `INSERT INTO events (user_id, camera_id, event_type, message, details_json, is_unread, created_at, updated_at)
                       VALUES (?, NULL, 'job_start_blocked', ?, ?, 1, ?, ?)`
                    )
                      .bind(
                        j.user_id,
                        blockedMessage,
                        blockedDetails,
                        nowUtc,
                        nowUtc
                      )
                      .run();
                  } catch (richInsertError) {
                    // Fallback for legacy schemas where details_json/is_unread might be absent.
                    await env.DB.prepare(
                      `INSERT INTO events (user_id, camera_id, event_type, message, created_at, updated_at)
                       VALUES (?, NULL, 'job_start_blocked', ?, ?, ?)`
                    )
                      .bind(
                        j.user_id,
                        blockedMessage,
                        nowUtc,
                        nowUtc
                      )
                      .run();
                    console.warn(
                      `[JOB SCHEDULER] job_start_blocked fallback insert used for job ${j.id}:`,
                      richInsertError
                    );
                  }
                } catch (eventError) {
                  console.error(
                    `[JOB SCHEDULER] Failed to insert job_start_blocked event for job ${j.id}:`,
                    eventError
                  );
                }
                continue;
              }

              const fireKey = `${j.id}:${localTime.localDate}:${d.id}:${localTime.localTimeHHMM}`;
              console.log(`[JOB SCHEDULER] Attempting to fire job ${j.id} with key ${fireKey}`);

              try {
                const ins = await env.DB.prepare(
                  `INSERT INTO job_schedule_fires (fire_key, job_id, schedule_day_id, window_id, local_date, start_time, triggered_at_utc, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(fire_key) DO NOTHING`
                ).bind(
                  fireKey,
                  j.id,
                  d.id,
                  w.id,
                  localTime.localDate,
                  localTime.localTimeHHMM,
                  nowUtc,
                  nowUtc,
                  nowUtc
                ).run();

                // If already fired, skip
                if (!ins.meta || ins.meta.changes === 0) {
                  console.log(`[JOB SCHEDULER] Fire key ${fireKey} already exists, skipping`);
                  continue;
                }

                console.log(`[JOB SCHEDULER] Fire key ${fireKey} inserted, proceeding with job start`);

                let jobStartPayload = await buildJobStartPayload(env, j, d, w, localTime, timezone);

                // Build start_camera_payloads map WITHOUT enqueueing cameras or updating status
                const startCameraPayloads: Record<string, any> = {};
                for (const cameraId of jobStartPayload.all_camera_ids) {
                  const res = await buildStartCameraPayloadForScheduler(env, j.user_id, cameraId);
                  if (res.ok && res.payload) {
                    // Always clear enabled_algorithms in job_start payloads
                    startCameraPayloads[String(cameraId)] = {
                      ...res.payload,
                      enabled_algorithms: [],
                    };
                  } else {
                    startCameraPayloads[String(cameraId)] = null;
                  }
                }

                // Enrich job_start payload with start_camera_payloads
                jobStartPayload = { ...jobStartPayload, start_camera_payloads: startCameraPayloads };

                await env.DB.prepare(
                  `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
                   VALUES (?, NULL, 'job_start', ?, 'pending', ?, ?)`
                ).bind(
                  j.user_id,
                  JSON.stringify(jobStartPayload),
                  nowUtc,
                  nowUtc
                ).run();

                await env.DB.prepare(
                  `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, started_at_utc, last_event_at_utc, created_at, updated_at)
                   VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
                   ON CONFLICT(job_id) DO UPDATE SET
                     status = 'running',
                     started_at_utc = ?,
                     last_event_at_utc = ?,
                     updated_at = ?`
                ).bind(
                  j.id,
                  j.user_id,
                  j.name,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc
                ).run();

                try {
                  const startedMessage = `Job "${j.name}" started successfully.`;
                  const startedDetails = JSON.stringify({
                    reason: "schedule_window_start",
                    job_id: j.id,
                    job_name: j.name,
                    schedule_day_id: d.id,
                    schedule_window_id: w.id,
                    local_date: localTime.localDate,
                    local_time: localTime.localTimeHHMM,
                    timezone,
                  });

                  try {
                    await env.DB.prepare(
                      `INSERT INTO events (user_id, camera_id, event_type, message, details_json, is_unread, created_at, updated_at)
                       VALUES (?, NULL, 'job_started', ?, ?, 1, ?, ?)`
                    )
                      .bind(
                        j.user_id,
                        startedMessage,
                        startedDetails,
                        nowUtc,
                        nowUtc
                      )
                      .run();
                  } catch (richInsertError) {
                    // Fallback for legacy schemas where details_json/is_unread might be absent.
                    await env.DB.prepare(
                      `INSERT INTO events (user_id, camera_id, event_type, message, created_at, updated_at)
                       VALUES (?, NULL, 'job_started', ?, ?, ?)`
                    )
                      .bind(
                        j.user_id,
                        startedMessage,
                        nowUtc,
                        nowUtc
                      )
                      .run();
                    console.warn(
                      `[JOB SCHEDULER] job_started fallback insert used for job ${j.id}:`,
                      richInsertError
                    );
                  }
                } catch (eventError) {
                  console.error(
                    `[JOB SCHEDULER] Failed to insert job_started event for job ${j.id}:`,
                    eventError
                  );
                }

                console.log(`[JOB SCHEDULER] Enqueued job_start for job ${j.id} (${j.name}) and updated runtime state`);
              } catch (err) {
                console.error(`[JOB SCHEDULER] Error firing job ${j.id}:`, err);
              }
            }
          } else {
            console.log(`[JOB SCHEDULER] No start windows for job ${j.id} at ${localTime.localTimeHHMM} (still checking stops)`);
          }

          // --- STOP windows (always check) ---
          const { results: endingWindows } = await env.DB.prepare(
            `SELECT * FROM job_schedule_windows
             WHERE schedule_day_id = ? AND end_time = ? AND is_enabled = 1`
          ).bind(d.id, localTime.localTimeHHMM).all();

          if (endingWindows && endingWindows.length > 0) {
            for (const window of endingWindows) {
              const w = window as any;

              const stopKey = `${j.id}:${localTime.localDate}:${d.id}:${localTime.localTimeHHMM}:stop`;
              console.log(`[JOB SCHEDULER] Attempting to stop job ${j.id} with key ${stopKey}`);

              try {
                const insStop = await env.DB.prepare(
                  `INSERT INTO job_schedule_stops (stop_key, job_id, schedule_day_id, window_id, local_date, end_time, triggered_at_utc, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(stop_key) DO NOTHING`
                ).bind(
                  stopKey,
                  j.id,
                  d.id,
                  w.id,
                  localTime.localDate,
                  localTime.localTimeHHMM,
                  nowUtc,
                  nowUtc,
                  nowUtc
                ).run();

                if (!insStop.meta || insStop.meta.changes === 0) {
                  console.log(`[JOB SCHEDULER] Stop key ${stopKey} already exists, skipping`);
                  continue;
                }

                console.log(`[JOB SCHEDULER] Stop key ${stopKey} inserted, proceeding with job stop`);

                // Check if job is actually running
                const runtimeState = await env.DB.prepare(
                  `SELECT status FROM job_runtime_states WHERE job_id = ? LIMIT 1`
                ).bind(j.id).first();

                if (!runtimeState) {
                  console.log(`[JOB SCHEDULER] Job ${j.id} has no runtime state, skipping stop`);
                  continue;
                }

                const status = (runtimeState as any).status;
                if (status !== "running" && status !== "stopping") {
                  console.log(`[JOB SCHEDULER] Job ${j.id} is not running (status=${status}), skipping stop`);
                  continue;
                }

                // Get all distinct camera IDs from job step targets
                const { results: targetRows } = await env.DB.prepare(
                  `SELECT DISTINCT jst.camera_id
                   FROM job_step_targets jst
                   JOIN job_steps js ON jst.step_id = js.id
                   WHERE js.job_id = ?`
                ).bind(j.id).all();

                const allCameraIds = (targetRows || []).map((row: any) => row.camera_id);
                let filteredCameraIds: number[] = [];

                if (allCameraIds.length > 0) {
                  // Filter to running cameras only
                  const placeholders = allCameraIds.map(() => "?").join(", ");
                  const { results: runningCameras } = await env.DB.prepare(
                    `SELECT id FROM cameras 
                     WHERE user_id = ? AND id IN (${placeholders}) AND is_service_running = 1`
                  ).bind(j.user_id, ...allCameraIds).all();

                  const runningCameraIds = (runningCameras || []).map((row: any) => row.id);

                  if (runningCameraIds.length > 0) {
                    // Exclude cameras with enabled AI agents
                    const runningPlaceholders = runningCameraIds.map(() => "?").join(", ");
                    const { results: agentCameras } = await env.DB.prepare(
                      `SELECT DISTINCT camera_id FROM camera_algorithms
                       WHERE camera_id IN (${runningPlaceholders}) AND is_enabled = 1`
                    ).bind(...runningCameraIds).all();

                    const camerasWithAgents = new Set((agentCameras || []).map((row: any) => row.camera_id));
                    filteredCameraIds = runningCameraIds.filter((cameraId: number) => !camerasWithAgents.has(cameraId));
                  }
                }

                // Build job_stop payload
                const jobStopPayload = {
                  job: { id: j.id, name: j.name },
                  requested_at_utc: nowUtc,
                  reason: "schedule_window_end",
                  camera_ids: filteredCameraIds,
                };

                // Enqueue job_stop command
                await env.DB.prepare(
                  `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
                   VALUES (?, NULL, 'job_stop', ?, 'pending', ?, ?)`
                ).bind(
                  j.user_id,
                  JSON.stringify(jobStopPayload),
                  nowUtc,
                  nowUtc
                ).run();

                // Update cameras table for filtered cameras
                if (filteredCameraIds.length > 0) {
                  const cameraPlaceholders = filteredCameraIds.map(() => "?").join(", ");
                  await env.DB.prepare(
                    `UPDATE cameras 
                     SET is_service_running = 0, is_online = 0, updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = ? AND id IN (${cameraPlaceholders})`
                  ).bind(j.user_id, ...filteredCameraIds).run();
                }

                // Upsert job_runtime_states to 'stopping'
                await env.DB.prepare(
                  `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, last_event_at_utc, created_at, updated_at)
                   VALUES (?, ?, ?, 'stopping', ?, ?, ?)
                   ON CONFLICT(job_id) DO UPDATE SET
                     status = 'stopping',
                     last_event_at_utc = ?,
                     updated_at = ?`
                ).bind(
                  j.id,
                  j.user_id,
                  j.name,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc,
                  nowUtc
                ).run();

                console.log(`[JOB SCHEDULER] Enqueued job_stop for job ${j.id} (${j.name}), stopped ${filteredCameraIds.length} cameras`);

              } catch (err) {
                console.error(`[JOB SCHEDULER] Error stopping job ${j.id}:`, err);
              }
            }
          }
        }
      }
    }
    console.log("[JOB SCHEDULER] Scheduler tick completed");
  } catch (error) {
    console.error("[JOB SCHEDULER] Error in scheduler tick:", error);
  }
}

