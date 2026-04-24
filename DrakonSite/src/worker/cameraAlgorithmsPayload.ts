type PromptTemplateParts = {
  prompt_template: string;
  alert_condition: string | null;
  negative_condition: string | null;
};

type AnalysisRegionPoint = {
  x: number;
  y: number;
};

export type FrameWindowNormPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnalysisRegionPayload = {
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
  frame_window_norm: FrameWindowNormPayload | null;
};

type FaceTargetImagePayload = {
  id: number;
  image_url: string;
};

export type FaceTargetPayload = {
  id: number;
  name: string;
  description: string;
  images: FaceTargetImagePayload[];
};

export type NegativeReferenceImagePayload = {
  id: number;
  image_url: string;
};

type BuildEnabledAlgorithmsArgs = {
  db: D1Database;
  userId: string;
  cameraId: number;
  openAiApiKey?: string;
  zAiApiKey?: string;
  directCaptureOnMotionOnly?: boolean;
  onlyEnabled?: boolean;
  algorithmDescriptions?: Record<string, string>;
  algorithmDisplayNames?: Record<string, string>;
};

type CameraCustomInferenceModel = "legacy" | "pro" | "ultra" | "ultra_plus" | "light" | "core";
type CameraCustomRunEvery = 10 | 60;
type CameraCustomRunningResolution = 640 | 1024;
type CameraVideoPackagingMode = "mosaic_2x2" | "mosaic_3x3" | "frame_sequence";
type CameraCustomPriorityLevel = "CRITIC" | "HIGH" | "MEDIUM" | "LOW";

const FIXED_CAMERA_CUSTOM_INFERENCE_MODEL: CameraCustomInferenceModel = "ultra";
const DEFAULT_CAMERA_CUSTOM_RUN_EVERY = 60;
const DEFAULT_CORE_RUNNING_RESOLUTION: CameraCustomRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 5;
const ANALYSIS_REGION_MIN_POINTS = 3;
const ANALYSIS_REGION_MAX_POINTS = 20;
const ANALYSIS_REGION_MAX_PER_AGENT = 6;

const trimToNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const normalizeFrameWindowNorm = (value: unknown): FrameWindowNormPayload | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const width = clamp01(Number(row.width));
  const height = clamp01(Number(row.height));
  if (width <= 0 || height <= 0) return null;
  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);
  const normalized = {
    x: Math.min(maxX, Math.max(0, Number(row.x) || 0)),
    y: Math.min(maxY, Math.max(0, Number(row.y) || 0)),
    width,
    height,
  } satisfies FrameWindowNormPayload;
  if (
    normalized.x <= 0.001 &&
    normalized.y <= 0.001 &&
    normalized.width >= 0.999 &&
    normalized.height >= 0.999
  ) {
    return null;
  }
  return normalized;
};

const toPositiveIntOr = (value: unknown, fallback: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const normalizeBool = (value: unknown, fallback: boolean): boolean => {
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
};

const normalizeCameraAgentInputType = (value: unknown): "video" | "image" => {
  if (typeof value !== "string") return "video";
  const normalized = value.trim().toLowerCase();
  return normalized === "image" ? "image" : "video";
};

const normalizeCameraAgentPriority = (
  value: unknown,
  fallback: CameraCustomPriorityLevel = "MEDIUM"
): CameraCustomPriorityLevel => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  if (normalized === "MEDUIM") return "MEDIUM";
  if (normalized === "CRITIC" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
    return normalized;
  }
  return fallback;
};

const normalizeCameraVideoPackagingMode = (
  value: unknown,
  fallback: CameraVideoPackagingMode = "mosaic_2x2"
): CameraVideoPackagingMode => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "frame_sequence" ||
      normalized === "frame-sequence" ||
      normalized === "full_frame" ||
      normalized === "full-frame" ||
      normalized === "frames" ||
      normalized === "high_resolution" ||
      normalized === "high-resolution" ||
      normalized === "high resolution"
    ) {
      return "frame_sequence";
    }
    if (
      normalized === "mosaic_2x2" ||
      normalized === "mosaic-2x2" ||
      normalized === "2x2" ||
      normalized === "standard_resolution" ||
      normalized === "standard-resolution" ||
      normalized === "standard resolution"
    ) {
      return "mosaic_2x2";
    }
    if (
      normalized === "mosaic" ||
      normalized === "mosaic_3x3" ||
      normalized === "mosaic-3x3" ||
      normalized === "3x3" ||
      normalized === "compact_resolution" ||
      normalized === "compact-resolution" ||
      normalized === "compact resolution"
    ) {
      return "mosaic_3x3";
    }
  }
  return fallback;
};

const normalizeCameraAgentRunEvery = (
  value: unknown,
  fallback = DEFAULT_CAMERA_CUSTOM_RUN_EVERY
): CameraCustomRunEvery => {
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
  const normalizeSeconds = (candidate: unknown): CameraCustomRunEvery | null => {
    const parsed = parseSeconds(candidate);
    if (parsed === null || parsed <= 0) return null;
    return parsed <= 10 ? 10 : 60;
  };
  return normalizeSeconds(value) ?? normalizeSeconds(fallback) ?? 60;
};

const normalizeCameraAgentRunningResolution = (
  value: unknown,
  fallback: CameraCustomRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
): CameraCustomRunningResolution => {
  const parse = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalize = (candidate: unknown): CameraCustomRunningResolution | null => {
    const parsed = parse(candidate);
    if (parsed === 640 || parsed === 1024) return parsed;
    return null;
  };
  return normalize(value) ?? normalize(fallback) ?? DEFAULT_CORE_RUNNING_RESOLUTION;
};

const normalizeCameraAgentModelFps = (
  value: unknown,
  fallback = DEFAULT_ULTRA_VIDEO_MODEL_FPS
): number => {
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
  return normalizeCameraAgentModelFps(fallback, DEFAULT_ULTRA_VIDEO_MODEL_FPS);
};

const normalizeAnalysisRegionId = (value: unknown, index: number): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized.slice(0, 64);
  return `region-${index + 1}`;
};

const parsePromptTemplateParts = (
  templateRaw: unknown,
  fallbackAlertCondition?: unknown,
  fallbackNegativeCondition?: unknown
): PromptTemplateParts => {
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
      if (current.key === "alert_condition") parsedAlertCondition = value;
      else parsedNegativeCondition = value;
    }
  }

  return {
    prompt_template: promptTemplate,
    alert_condition: trimToNull(fallbackAlertCondition) ?? parsedAlertCondition,
    negative_condition: trimToNull(fallbackNegativeCondition) ?? parsedNegativeCondition,
  };
};

const toAgentFaceIdImageUrl = (imageUrl: string): string => {
  if (!imageUrl) return imageUrl;
  return imageUrl.replace("/api/faceid-images/", "/api/agent/faceid-images/");
};

const toAgentFaceTargetImageUrl = (imageUrl: string): string => {
  if (!imageUrl) return imageUrl;
  return imageUrl.replace("/api/face-target-images/", "/api/agent/face-target-images/");
};

const toAgentNegativeConditionImageUrl = (imageUrl: string): string => {
  if (!imageUrl) return imageUrl;
  return imageUrl.replace(
    "/api/negative-condition-images/",
    "/api/agent/negative-condition-images/"
  );
};

const normalizeAnalysisRegionPolygon = (value: unknown): AnalysisRegionPoint[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((point: any) => {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: clamp01(x), y: clamp01(y) } as AnalysisRegionPoint;
    })
    .filter(Boolean) as AnalysisRegionPoint[];
};

const parseStoredAnalysisRegionsForCameraAgent = (
  raw: unknown,
  defaults: {
    promptParts: PromptTemplateParts;
    faceTargetIds: number[];
    negativeImageIds: number[];
  }
): AnalysisRegionPayload[] => {
  const synthesizeDefault = (): AnalysisRegionPayload[] => [
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
      prompt_core: String(defaults.promptParts.prompt_template || "").trim(),
      alert_condition: defaults.promptParts.alert_condition,
      negative_condition: defaults.promptParts.negative_condition,
      face_target_ids: defaults.faceTargetIds,
      negative_image_ids: defaults.negativeImageIds,
      frame_window_norm: null,
    },
  ];

  if (raw === null || raw === undefined) return synthesizeDefault();

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return synthesizeDefault();
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return synthesizeDefault();
    }
  }

  if (!Array.isArray(parsed)) return synthesizeDefault();
  const parsedRows = parsed.slice(0, ANALYSIS_REGION_MAX_PER_AGENT);
  if (parsedRows.length === 0) return synthesizeDefault();

  const usedIds = new Set<string>();
  const regions: AnalysisRegionPayload[] = [];
  for (let i = 0; i < parsedRows.length; i += 1) {
    const row = parsedRows[i] as any;
    if (!row || typeof row !== "object") continue;

    const regionId = normalizeAnalysisRegionId(row?.region_id ?? row?.regionId, i);
    if (usedIds.has(regionId)) continue;
    usedIds.add(regionId);

    const fullFrame = normalizeBool(row?.full_frame ?? row?.fullFrame, false);
    const polygonNorm = normalizeAnalysisRegionPolygon(row?.polygon_norm ?? row?.polygonNorm);
    const normalizedFullFrame =
      fullFrame ||
      polygonNorm.length < ANALYSIS_REGION_MIN_POINTS ||
      polygonNorm.length > ANALYSIS_REGION_MAX_POINTS;

    const promptCoreRaw =
      typeof row?.prompt_core === "string"
        ? row.prompt_core
        : typeof row?.prompt_template === "string"
        ? row.prompt_template
        : defaults.promptParts.prompt_template;
    const alertCondition =
      trimToNull(row?.alert_condition ?? row?.alertCondition) ?? defaults.promptParts.alert_condition;
    const negativeCondition =
      trimToNull(row?.negative_condition ?? row?.negativeCondition) ??
      defaults.promptParts.negative_condition;
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

    regions.push({
      region_id: regionId,
      label:
        typeof row?.label === "string" && row.label.trim()
          ? row.label.trim()
          : `Region ${i + 1}`,
      description:
        typeof row?.description === "string" ? row.description.trim() : "",
      enabled: normalizeBool(row?.enabled, true),
      full_frame: normalizedFullFrame,
      polygon_norm: normalizedFullFrame ? [] : polygonNorm,
      draw_ref_width: toPositiveIntOr(row?.draw_ref_width ?? row?.drawRefWidth, 1920),
      draw_ref_height: toPositiveIntOr(row?.draw_ref_height ?? row?.drawRefHeight, 1080),
      context_padding_pct: 0,
      prompt_core: String(promptCoreRaw || "").trim(),
      alert_condition: alertCondition,
      negative_condition: negativeCondition,
      face_target_ids: Array.from(
        new Set<number>(
          (Array.isArray(faceTargetIdsRaw) ? faceTargetIdsRaw : [])
            .map((v: unknown) => Number(v))
            .filter((v: number) => Number.isInteger(v) && v > 0)
        )
      ),
      negative_image_ids: Array.from(
        new Set<number>(
          (Array.isArray(negativeImageIdsRaw) ? negativeImageIdsRaw : [])
            .map((v: unknown) => Number(v))
            .filter((v: number) => Number.isInteger(v) && v > 0)
        )
      ),
      frame_window_norm: normalizeFrameWindowNorm(
        row?.frame_window_norm ?? row?.frameWindowNorm
      ),
    });
  }

  return regions.length > 0 ? regions : synthesizeDefault();
};

const parseConfigJson = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, any>) };
      }
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeAlertChannelEnabled = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
};

const parseAlertChannels = (
  value: unknown
): Record<string, Record<string, unknown> & { enabled: boolean }> => {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) return {};
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const out: Record<string, Record<string, unknown> & { enabled: boolean }> = {};
  for (const [rawChannel, rawConfig] of Object.entries(parsed as Record<string, unknown>)) {
    const channel = rawChannel.trim().toLowerCase();
    if (!channel) continue;
    const normalizedConfig =
      rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
        ? { ...(rawConfig as Record<string, unknown>) }
        : {};
    const enabledSource =
      rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
        ? (rawConfig as Record<string, unknown>).enabled
        : rawConfig;
    normalizedConfig.enabled = normalizeAlertChannelEnabled(enabledSource, false);
    out[channel] = normalizedConfig as Record<string, unknown> & { enabled: boolean };
  }

  return out;
};

const normalizeInferenceModel = (value: unknown): CameraCustomInferenceModel => {
  if (typeof value !== "string") return FIXED_CAMERA_CUSTOM_INFERENCE_MODEL;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ultra+" || normalized === "ultra-plus" || normalized === "ultra_plus") {
    return "ultra_plus";
  }
  if (
    normalized === "legacy" ||
    normalized === "pro" ||
    normalized === "ultra" ||
    normalized === "ultra_plus" ||
    normalized === "light" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return FIXED_CAMERA_CUSTOM_INFERENCE_MODEL;
};

const normalizeExecutionSettings = (
  rawInputType: unknown,
  rawInferenceModel: unknown,
  rawModelFps: unknown,
  rawRunEvery: unknown,
  rawRunningResolution: unknown,
  rawVideoPackagingMode: unknown
): {
  inputType: "video" | "image";
  videoPackagingMode: CameraVideoPackagingMode;
  inferenceModel: CameraCustomInferenceModel;
  runEvery: CameraCustomRunEvery;
  runningResolution: CameraCustomRunningResolution | null;
  modelFps: number;
  modelName: string;
  validatorModelName: string;
} => {
  const inferenceModel = normalizeInferenceModel(rawInferenceModel);
  const videoPackagingMode = normalizeCameraVideoPackagingMode(rawVideoPackagingMode);
  if (inferenceModel === "core") {
    const runningResolution = normalizeCameraAgentRunningResolution(rawRunningResolution);
    return {
      inputType: "video",
      videoPackagingMode,
      inferenceModel,
      runEvery: 60,
      runningResolution,
      modelFps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
      modelName: "GLM-4.6V-Flash",
      validatorModelName: "GLM-4.6V-Flash",
    };
  }

  const inputType = normalizeCameraAgentInputType(rawInputType);
  const runEvery = normalizeCameraAgentRunEvery(rawRunEvery, DEFAULT_CAMERA_CUSTOM_RUN_EVERY);
  const modelName =
    inferenceModel === "ultra"
      ? "gpt-5.1"
      : inferenceModel === "ultra_plus"
      ? "gpt-5.4"
      : inferenceModel === "light"
      ? "gpt-5.4-mini"
      : "gpt-5-mini";
  return {
    inputType,
    videoPackagingMode,
    inferenceModel,
    runEvery,
    runningResolution: null,
    modelFps:
      (inferenceModel === "ultra" || inferenceModel === "ultra_plus") && inputType === "video"
        ? normalizeCameraAgentModelFps(rawModelFps)
        : DEFAULT_ULTRA_VIDEO_MODEL_FPS,
    modelName,
    validatorModelName: modelName,
  };
};

type FaceTargetRowsByAlgorithm = Map<
  number,
  Map<
    number,
    {
      id: number;
      name: string;
      description: string;
      images: FaceTargetImagePayload[];
    }
  >
>;

const loadCameraAlgorithmFaceTargets = async (
  db: D1Database,
  userId: string,
  algorithmIds: number[]
): Promise<FaceTargetRowsByAlgorithm> => {
  const byAlgorithm = new Map();
  const normalizedAlgorithmIds = Array.from(
    new Set(algorithmIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedAlgorithmIds.length === 0) return byAlgorithm;

  const placeholders = normalizedAlgorithmIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT
         caft.algorithm_id,
         ft.id AS target_id,
         ft.name AS target_name,
         ft.description AS target_description,
         fti.id AS image_id,
         fti.image_url AS image_url
       FROM camera_algorithm_face_targets caft
       JOIN camera_algorithms ca ON ca.id = caft.algorithm_id
       JOIN cameras c ON c.id = ca.camera_id
       JOIN face_targets ft ON ft.id = caft.face_target_id AND ft.user_id = c.user_id
       LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
       WHERE c.user_id = ?
         AND caft.algorithm_id IN (${placeholders})
       ORDER BY caft.algorithm_id ASC, ft.id ASC, fti.id ASC`
    )
    .bind(userId, ...normalizedAlgorithmIds)
    .all();

  for (const row of results || []) {
    const algorithmId = Number((row as any)?.algorithm_id);
    const targetId = Number((row as any)?.target_id);
    const targetName = String((row as any)?.target_name || "").trim();
    const targetDescription = String((row as any)?.target_description || "").trim();
    const imageId = Number((row as any)?.image_id);
    const rawImageUrl = String((row as any)?.image_url || "").trim();
    const imageUrl = rawImageUrl ? toAgentFaceTargetImageUrl(rawImageUrl) : "";

    if (!Number.isInteger(algorithmId) || algorithmId <= 0) continue;
    if (!Number.isInteger(targetId) || targetId <= 0) continue;

    if (!byAlgorithm.has(algorithmId)) byAlgorithm.set(algorithmId, new Map());
    const targetMap = byAlgorithm.get(algorithmId)!;
    if (!targetMap.has(targetId)) {
      targetMap.set(targetId, {
        id: targetId,
        name: targetName,
        description: targetDescription,
        images: [],
      });
    }
    const target = targetMap.get(targetId)!;
    if (Number.isInteger(imageId) && imageId > 0 && imageUrl) {
      target.images.push({ id: imageId, image_url: imageUrl });
    }
  }

  return byAlgorithm;
};

const loadCameraAlgorithmNegativeImages = async (
  db: D1Database,
  algorithmIds: number[]
): Promise<Map<number, NegativeReferenceImagePayload[]>> => {
  const byAlgorithmId = new Map<number, NegativeReferenceImagePayload[]>();
  const normalizedAlgorithmIds = Array.from(
    new Set(algorithmIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedAlgorithmIds.length === 0) return byAlgorithmId;

  const placeholders = normalizedAlgorithmIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT algorithm_id, id, image_url
       FROM camera_algorithm_negative_images
       WHERE algorithm_id IN (${placeholders})
       ORDER BY algorithm_id ASC, id ASC`
    )
    .bind(...normalizedAlgorithmIds)
    .all();

  for (const row of results || []) {
    const algorithmId = Number((row as any)?.algorithm_id);
    const imageId = Number((row as any)?.id);
    const imageUrlRaw = String((row as any)?.image_url || "").trim();
    if (!Number.isInteger(algorithmId) || algorithmId <= 0) continue;
    if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrlRaw) continue;
    if (!byAlgorithmId.has(algorithmId)) byAlgorithmId.set(algorithmId, []);
    byAlgorithmId.get(algorithmId)!.push({
      id: imageId,
      image_url: toAgentNegativeConditionImageUrl(imageUrlRaw),
    });
  }

  return byAlgorithmId;
};

export async function buildEnabledAlgorithmsForCamera(
  args: BuildEnabledAlgorithmsArgs
): Promise<any[]> {
  const { db, userId, cameraId, onlyEnabled = true } = args;
  const descriptions = args.algorithmDescriptions || {};
  const displayNames = args.algorithmDisplayNames || {};
  const directCaptureOnMotionOnly =
    typeof args.directCaptureOnMotionOnly === "boolean"
      ? args.directCaptureOnMotionOnly
      : false;

  let openAiApiKey = trimToNull(args.openAiApiKey) || "";
  if (!openAiApiKey) {
    try {
      const row = await db
        .prepare("SELECT api_key FROM openai_settings WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first();
      openAiApiKey = String((row as any)?.api_key || "").trim();
    } catch {
      openAiApiKey = "";
    }
  }

  let zAiApiKey = trimToNull(args.zAiApiKey) || "";
  if (!zAiApiKey) {
    try {
      const row = await db
        .prepare("SELECT api_key FROM zai_settings WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first();
      zAiApiKey = String((row as any)?.api_key || "").trim();
    } catch {
      zAiApiKey = "";
    }
  }

  const filterSql = onlyEnabled ? " AND is_enabled = 1" : "";
  const { results: algorithmRows } = await db
    .prepare(`SELECT * FROM camera_algorithms WHERE camera_id = ?${filterSql}`)
    .bind(cameraId)
    .all();
  const rows = (algorithmRows || []).map((row: any) => ({ ...row }));

  const { results: reidTargets } = await db
    .prepare("SELECT * FROM reid_targets WHERE camera_id = ? ORDER BY created_at DESC")
    .bind(cameraId)
    .all();
  const reidPrompt = (reidTargets || [])
    .map((row: any) => `${row.person_name}: ${row.person_description}`)
    .join("\n");

  const { results: faceIdTargets } = await db
    .prepare("SELECT * FROM faceid_targets WHERE camera_id = ? ORDER BY created_at DESC")
    .bind(cameraId)
    .all();

  const customAlgorithmIds = rows
    .filter((row: any) => String(row.algorithm_type || "").startsWith("custom_"))
    .map((row: any) => Number(row.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);

  const faceTargetsByAlgorithm = await loadCameraAlgorithmFaceTargets(
    db,
    userId,
    customAlgorithmIds
  );
  const negativeImagesByAlgorithm = await loadCameraAlgorithmNegativeImages(db, customAlgorithmIds);

  return rows.map((row: any) => {
    const algorithmType = String(row.algorithm_type || "").trim();
    const configJson = parseConfigJson(row.config_json);
    let llmPrompt = trimToNull(row.llm_prompt) || "";

    if (algorithmType === "reid") {
      llmPrompt = trimToNull(reidPrompt) || llmPrompt;
    }

    if (algorithmType === "faceid") {
      configJson.faceid_targets = (faceIdTargets || []).map((target: any) => ({
        id: target.id,
        person_name: target.person_name,
        person_description: target.person_description,
        image_url: toAgentFaceIdImageUrl(String(target.image_url || "")),
      }));
    }

    if (!llmPrompt && descriptions[algorithmType]) {
      llmPrompt = descriptions[algorithmType];
    }

    if (!configJson.display_name) {
      configJson.display_name = displayNames[algorithmType] || algorithmType;
    }
    const alertChannels = parseAlertChannels(row.alert_channels ?? row.alert_channels_json);

    const isCustom = algorithmType.startsWith("custom_");
    if (!isCustom) {
      return {
        algorithm_type: algorithmType,
        is_enabled: !!row.is_enabled,
        llm_prompt: llmPrompt || null,
        image_region: row.image_region || null,
        config_json: configJson,
        alert_channels: alertChannels,
        only_capture_on_motion: directCaptureOnMotionOnly,
        temporal_plan_json: row.temporal_plan_json || null,
        temporal_plan_hash: row.temporal_plan_hash || null,
        temporal_plan_version: row.temporal_plan_version || null,
        temporal_compiled_at: row.temporal_compiled_at || null,
        temporal_compile_model: row.temporal_compile_model || null,
        temporal_explain_json: row.temporal_explain_json || null,
      };
    }

    const algorithmId = Number(row.id);
    const faceTargetRows = faceTargetsByAlgorithm.get(algorithmId);
    const faceTargets = faceTargetRows
      ? Array.from(faceTargetRows.values()).map((target) => ({
          id: target.id,
          name: target.name,
          description: target.description,
          images: target.images,
        }))
      : [];
    const faceTargetIds = faceTargets.map((target) => target.id);
    const negativeReferenceImages = negativeImagesByAlgorithm.get(algorithmId) || [];
    const negativeImageIds = negativeReferenceImages.map((image) => image.id);

    const promptParts = parsePromptTemplateParts(
      row.prompt_template ?? llmPrompt,
      row.alert_condition,
      row.negative_condition
    );
    const promptTemplate =
      trimToNull(promptParts.prompt_template) ??
      trimToNull(llmPrompt) ??
      trimToNull(row.prompt_template) ??
      "";
    const alertCondition =
      trimToNull(row.alert_condition) ??
      trimToNull(promptParts.alert_condition) ??
      "Trigger an alert only when the requested event is clearly visible.";
    const negativeCondition =
      trimToNull(row.negative_condition) ?? trimToNull(promptParts.negative_condition);

    const analysisRegions = parseStoredAnalysisRegionsForCameraAgent(row.analysis_regions, {
      promptParts: {
        prompt_template: promptTemplate,
        alert_condition: alertCondition,
        negative_condition: negativeCondition,
      },
      faceTargetIds,
      negativeImageIds,
    });
    const executionSettings = normalizeExecutionSettings(
      row.input_type,
      row.inference_model ?? FIXED_CAMERA_CUSTOM_INFERENCE_MODEL,
      row.model_fps,
      row.run_every,
      row.running_resolution,
      row.video_packaging_mode
    );
    const modelApiKey =
      executionSettings.inferenceModel === "core" ? zAiApiKey : openAiApiKey;
    const validatorModelApiKey = modelApiKey;

    return {
      algorithm_id: algorithmId,
      algorithm_type: algorithmType,
      is_enabled: !!row.is_enabled,
      llm_prompt: llmPrompt || null,
      image_region: row.image_region || null,
      config_json: configJson,
      alert_channels: alertChannels,
      prompt_template: promptTemplate,
      alert_condition: alertCondition,
      negative_condition: negativeCondition,
      priority_level: normalizeCameraAgentPriority(row.priority_level),
      analysis_regions: analysisRegions,
      input_type: executionSettings.inputType,
      video_packaging_mode: executionSettings.videoPackagingMode,
      inference_model: executionSettings.inferenceModel,
      run_every: executionSettings.runEvery,
      running_resolution: executionSettings.runningResolution,
      only_capture_on_motion: directCaptureOnMotionOnly,
      model_fps: executionSettings.modelFps,
      model_name: executionSettings.modelName,
      validator_model_name: executionSettings.validatorModelName,
      model_api_key: modelApiKey,
      validator_model_api_key: validatorModelApiKey,
      face_targets: faceTargets,
      negative_reference_images: negativeReferenceImages,
      temporal_plan_json: row.temporal_plan_json || null,
      temporal_plan_hash: row.temporal_plan_hash || null,
      temporal_plan_version: row.temporal_plan_version || null,
      temporal_compiled_at: row.temporal_compiled_at || null,
      temporal_compile_model: row.temporal_compile_model || null,
      temporal_explain_json: row.temporal_explain_json || null,
    };
  });
}
