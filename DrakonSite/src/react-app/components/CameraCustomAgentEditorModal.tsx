import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import {
  FACE_ID_MAX_IMAGE_SIDE_PX,
  FACE_ID_MAX_UPLOAD_BYTES,
  normalizeFaceIdImage,
} from "@/react-app/utils/faceIdImage";
import {
  emitOpenAiKeyRequiredPrompt,
  emitZAiKeyRequiredPrompt,
  isOpenAiKeyRequiredError,
  isZAiKeyRequiredError,
} from "@/react-app/utils/openAiKeyGuard";
import {
  getCoreModelNoticeCopy,
  shouldShowCoreModelNotice,
} from "@/react-app/utils/coreModelNotice";
import ModelHostingBadge from "@/react-app/components/ModelHostingBadge";

export type ToastVariant = "default" | "destructive";

export interface NegativeReferenceImage {
  id: number;
  image_url: string;
}

export interface FaceTargetImage {
  id: number;
  image_url: string;
}

export interface FaceTarget {
  id: number;
  name: string;
  description: string;
  image_count: number;
  images: FaceTargetImage[];
}

export interface AnalysisRegionPoint {
  x: number;
  y: number;
}

export interface AnalysisRegion {
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
  alert_condition: string;
  negative_condition: string;
  face_target_ids: number[];
  negative_image_ids: number[];
}

type PromptEditorFields = {
  prompt_template: string;
  alert_condition: string;
  negative_condition: string;
};

type PromptEnhanceSuggestion = PromptEditorFields & {
  model_name?: string;
  snapshot_source?: string;
};

export interface CameraCustomAgentRow {
  id: number;
  algorithm_type: string;
  is_enabled: number | boolean;
  input_type?: string | null;
  video_packaging_mode?: string | null;
  inference_model?: string | null;
  model_fps?: number | null;
  run_every?: number | null;
  running_resolution?: number | null;
  only_capture_on_motion?: number | boolean | null;
  prompt_template?: string | null;
  alert_condition?: string | null;
  negative_condition?: string | null;
  face_target_ids?: number[];
  negative_reference_images?: NegativeReferenceImage[];
  analysis_regions?: unknown;
  config_json?: unknown;
}

type OwnedAgentTemplate = CameraCustomAgentRow & {
  camera_id: number;
  camera_name: string;
  display_name: string;
  updated_at: string | null;
};

type Props = {
  open: boolean;
  cameraId: number;
  initialAgent: CameraCustomAgentRow | null;
  onClose: () => void;
  onSaved: (savedAgentId?: number | null) => Promise<void> | void;
  showToast: (title: string, description: string, variant?: ToastVariant) => void;
};

const ANALYSIS_REGION_MAX = 6;
const ANALYSIS_REGION_MIN_POINTS = 3;
const ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH = 1920;
const ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT = 1080;
const NEGATIVE_REFERENCE_MAX_IMAGES = 3;
const FACE_TARGET_MAX_IMAGES = 4;
const SNAPSHOT_REFRESH_COOLDOWN_MS = 3000;
type CameraAgentRunEverySeconds = 10 | 60;
const CAMERA_AGENT_RUN_EVERY_OPTIONS: ReadonlyArray<CameraAgentRunEverySeconds> = [60, 10];
type CameraAgentInferenceModel = "legacy" | "pro" | "ultra" | "ultra_plus" | "light" | "core";
type CameraVideoPackagingMode = "mosaic_2x2" | "mosaic_3x3" | "frame_sequence";
type CameraAgentRunningResolution = 640 | 1024;
const DEFAULT_CAMERA_AGENT_INFERENCE_MODEL: CameraAgentInferenceModel = "ultra";
const DEFAULT_CAMERA_VIDEO_PACKAGING_MODE: CameraVideoPackagingMode = "mosaic_2x2";
const DEFAULT_CORE_RUNNING_RESOLUTION: CameraAgentRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const AGENT_EDITOR_ONBOARDING_STEPS = new Set([
  "agent-model",
  "agent-input-type",
  "agent-fields",
  "agent-enhance",
  "agent-polygons",
  "agent-execution",
  "agent-save",
]);
const OPTIONAL_SUFFIX_PATTERN = /([(\uFF08][^)\uFF09]*[)\uFF09])\s*$/u;
const PROMPT_DOCUMENT_BLOCK_CLASS = "overflow-hidden rounded-xl border border-gray-700 bg-gray-800/70";
const PROMPT_DOCUMENT_SECTION_CLASS = "space-y-2 px-4 py-4";
const PROMPT_DOCUMENT_INPUT_CLASS =
  "w-full border-0 bg-transparent p-0 text-sm leading-6 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0";
const PROMPT_DOCUMENT_TEXTAREA_CLASS =
  "w-full border-0 bg-transparent p-0 text-sm leading-6 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0";

const extractOptionalSuffix = (label: string): string => {
  const match = String(label || "").match(OPTIONAL_SUFFIX_PATTERN);
  return match ? ` ${match[1].trim()}` : " (optional)";
};

const formatPromptDocumentHeading = (
  label: string,
  options?: { optional?: boolean; optionalSuffix?: string }
): string => `# ${label}${options?.optional ? options.optionalSuffix || " (optional)" : ""}`;

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const normalizeBool = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const n = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(n)) return true;
    if (["0", "false", "no", "off"].includes(n)) return false;
  }
  return fallback;
};

const normalizeRunEverySeconds = (
  value: unknown,
  fallback: CameraAgentRunEverySeconds = 60
): CameraAgentRunEverySeconds => {
  const parseValue = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.round(candidate);
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalizeValue = (candidate: unknown): CameraAgentRunEverySeconds | null => {
    const parsed = parseValue(candidate);
    if (parsed === null || parsed <= 0) return null;
    return parsed <= 10 ? 10 : 60;
  };
  return normalizeValue(value) ?? normalizeValue(fallback) ?? 60;
};

const normalizeInferenceModel = (
  value: unknown,
  fallback: CameraAgentInferenceModel = DEFAULT_CAMERA_AGENT_INFERENCE_MODEL
): CameraAgentInferenceModel => {
  if (typeof value !== "string") return fallback;
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
  return fallback;
};

const supportsAdjustableVideoFps = (model: CameraAgentInferenceModel): boolean =>
  model === "ultra" || model === "ultra_plus" || model === "light";

const normalizeRunningResolution = (
  value: unknown,
  fallback: CameraAgentRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
): CameraAgentRunningResolution => {
  const parseValue = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.round(candidate);
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const parsed = parseValue(value);
  if (parsed === 640 || parsed === 1024) return parsed;
  return fallback;
};

const normalizeModelFps = (
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
  return normalizeModelFps(fallback, DEFAULT_ULTRA_VIDEO_MODEL_FPS);
};

const normalizeVideoPackagingMode = (
  value: unknown,
  fallback: CameraVideoPackagingMode = DEFAULT_CAMERA_VIDEO_PACKAGING_MODE
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

const applyExecutionConstraints = (
  inputType: "video" | "image",
  inferenceModel: CameraAgentInferenceModel,
  runEvery: CameraAgentRunEverySeconds,
  runningResolution: CameraAgentRunningResolution,
  modelFps: number
) => {
  if (inferenceModel === "core") {
    return {
      inputType: "video" as const,
      inferenceModel,
      runEvery: 60 as CameraAgentRunEverySeconds,
      runningResolution: normalizeRunningResolution(runningResolution),
      modelFps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
    };
  }

  const normalizedInputType: "video" | "image" = inputType === "image" ? "image" : "video";
  return {
    inputType: normalizedInputType,
    inferenceModel,
    runEvery: normalizeRunEverySeconds(runEvery, 60),
    runningResolution: normalizeRunningResolution(runningResolution),
    modelFps:
      supportsAdjustableVideoFps(inferenceModel) && normalizedInputType === "video"
        ? normalizeModelFps(modelFps)
        : DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  };
};

type TutorialProviderAvailability = {
  openai: boolean;
  zai: boolean;
};

const getTutorialInferenceModel = (
  providerStatus: TutorialProviderAvailability
): CameraAgentInferenceModel => {
  if (providerStatus.openai) {
    return "ultra";
  }

  if (providerStatus.zai) {
    return "core";
  }

  return DEFAULT_CAMERA_AGENT_INFERENCE_MODEL;
};

const sanitizeRegionId = (value: unknown, idx: number): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || `region-${idx + 1}`).slice(0, 64);
};

const toSvgPoints = (points: AnalysisRegionPoint[]) =>
  points
    .map((p) => `${Math.round(clamp01(p.x) * 1000) / 10},${Math.round(clamp01(p.y) * 1000) / 10}`)
    .join(" ");

const buildRectPolygonFromPoints = (a: AnalysisRegionPoint, b: AnalysisRegionPoint): AnalysisRegionPoint[] => {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  if (Math.abs(x2 - x1) < 0.002 || Math.abs(y2 - y1) < 0.002) return [];
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
};

const pointInPolygon = (point: AnalysisRegionPoint, polygon: AnalysisRegionPoint[]): boolean => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const px = clamp01(point.x);
  const py = clamp01(point.y);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = clamp01(polygon[i].x);
    const yi = clamp01(polygon[i].y);
    const xj = clamp01(polygon[j].x);
    const yj = clamp01(polygon[j].y);
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const getPolygonCentroid = (polygon: AnalysisRegionPoint[]): AnalysisRegionPoint => {
  if (!Array.isArray(polygon) || polygon.length === 0) return { x: 0.5, y: 0.5 };
  if (polygon.length < 3) {
    const avg = polygon.reduce(
      (acc, p) => ({ x: acc.x + clamp01(p.x), y: acc.y + clamp01(p.y) }),
      { x: 0, y: 0 }
    );
    return { x: clamp01(avg.x / polygon.length), y: clamp01(avg.y / polygon.length) };
  }

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const x1 = clamp01(p1.x);
    const y1 = clamp01(p1.y);
    const x2 = clamp01(p2.x);
    const y2 = clamp01(p2.y);
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-7) {
    const avg = polygon.reduce(
      (acc, p) => ({ x: acc.x + clamp01(p.x), y: acc.y + clamp01(p.y) }),
      { x: 0, y: 0 }
    );
    return { x: clamp01(avg.x / polygon.length), y: clamp01(avg.y / polygon.length) };
  }
  return {
    x: clamp01(cx / (6 * area)),
    y: clamp01(cy / (6 * area)),
  };
};

const parsePromptTemplate = (
  template: string | null | undefined,
  fallbackAlert?: string | null,
  fallbackNegative?: string | null
): PromptEditorFields => {
  const raw = String(template || "");
  const lower = raw.toLowerCase();
  const alertIdx = lower.lastIndexOf("alert_condition:");
  const negativeIdx = lower.lastIndexOf("negative_condition:");
  if (alertIdx < 0 && negativeIdx < 0) {
    return {
      prompt_template: raw,
      alert_condition: String(fallbackAlert || "").trim(),
      negative_condition: String(fallbackNegative || "").trim(),
    };
  }
  const indexes = [
    { key: "alert" as const, idx: alertIdx, marker: "alert_condition:" },
    { key: "negative" as const, idx: negativeIdx, marker: "negative_condition:" },
  ]
    .filter((r) => r.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const parsed: PromptEditorFields = {
    prompt_template: raw.slice(0, indexes[0].idx).trimEnd(),
    alert_condition: "",
    negative_condition: "",
  };

  for (let i = 0; i < indexes.length; i += 1) {
    const start = indexes[i].idx + indexes[i].marker.length;
    const end = i + 1 < indexes.length ? indexes[i + 1].idx : raw.length;
    const value = raw.slice(start, end).trim();
    if (indexes[i].key === "alert") parsed.alert_condition = value;
    else parsed.negative_condition = value;
  }

  if (!parsed.alert_condition) parsed.alert_condition = String(fallbackAlert || "").trim();
  if (!parsed.negative_condition) parsed.negative_condition = String(fallbackNegative || "").trim();
  return parsed;
};

const normalizeFields = (f: PromptEditorFields): PromptEditorFields => ({
  prompt_template: String(f.prompt_template || "").trim(),
  alert_condition: String(f.alert_condition || "").trim(),
  negative_condition: String(f.negative_condition || "").trim(),
});

const normalizeFaceTargetIds = (values: unknown): number[] => {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)));
};

const normalizeNegativeImages = (rows: unknown): NegativeReferenceImage[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => {
      const id = Number(row?.id);
      const image_url = typeof row?.image_url === "string" ? row.image_url.trim() : "";
      if (!Number.isInteger(id) || id <= 0 || !image_url) return null;
      return { id, image_url } as NegativeReferenceImage;
    })
    .filter(Boolean) as NegativeReferenceImage[];
};

const getFaceTargetImageCount = (target: FaceTarget | null | undefined): number => {
  if (!target) return 0;
  const fromImages = Array.isArray(target.images) ? target.images.length : 0;
  const fromCounter = Number(target.image_count);
  if (Number.isFinite(fromCounter) && fromCounter >= 0) {
    return Math.max(fromImages, Math.floor(fromCounter));
  }
  return fromImages;
};

const normalizeRegionsFromApi = (
  regionsRaw: unknown,
  fields: PromptEditorFields,
  faceTargetIds: number[],
  negativeImageIds: number[]
): AnalysisRegion[] => {
  if (!Array.isArray(regionsRaw)) return [];
  const out: AnalysisRegion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < regionsRaw.length && out.length < ANALYSIS_REGION_MAX; i += 1) {
    const row = regionsRaw[i] as any;
    if (!row || typeof row !== "object") continue;
    const pointsRaw = Array.isArray(row?.polygon_norm) ? row.polygon_norm : [];
    const points = pointsRaw
      .map((p: any) => ({ x: clamp01(Number(p?.x)), y: clamp01(Number(p?.y)) }))
      .filter((p: AnalysisRegionPoint) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length < ANALYSIS_REGION_MIN_POINTS) continue;
    const region_id = sanitizeRegionId(row?.region_id, i);
    if (seen.has(region_id)) continue;
    seen.add(region_id);
    out.push({
      region_id,
      label: typeof row?.label === "string" && row.label.trim() ? row.label.trim() : `Region ${i + 1}`,
      description: typeof row?.description === "string" ? row.description.trim() : "",
      enabled: normalizeBool(row?.enabled, true),
      full_frame: false,
      polygon_norm: points,
      draw_ref_width: Math.max(1, Math.round(Number(row?.draw_ref_width ?? ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH))),
      draw_ref_height: Math.max(1, Math.round(Number(row?.draw_ref_height ?? ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT))),
      context_padding_pct: 0,
      prompt_core: fields.prompt_template,
      alert_condition: fields.alert_condition,
      negative_condition: fields.negative_condition,
      face_target_ids: faceTargetIds,
      negative_image_ids: negativeImageIds,
    });
  }
  return out;
};

const normalizeRegionsForPayload = (
  polygonRegions: AnalysisRegion[],
  fields: PromptEditorFields,
  faceTargetIds: number[],
  negativeImageIds: number[]
): AnalysisRegion[] => {
  const normalized = normalizeFields(fields);
  const cleanFaceIds = normalizeFaceTargetIds(faceTargetIds);
  const cleanNegativeIds = Array.from(new Set(negativeImageIds.filter((id) => Number.isInteger(id) && id > 0)));
  const polygons = (Array.isArray(polygonRegions) ? polygonRegions : [])
    .filter((r) => Array.isArray(r.polygon_norm) && r.polygon_norm.length >= ANALYSIS_REGION_MIN_POINTS)
    .slice(0, ANALYSIS_REGION_MAX)
    .map((r, idx) => ({
      region_id: sanitizeRegionId(r.region_id, idx),
      label: String(r.label || "").trim() || `Region ${idx + 1}`,
      description: String(r.description || "").trim(),
      enabled: r.enabled !== false,
      full_frame: false,
      polygon_norm: r.polygon_norm.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })),
      draw_ref_width: Math.max(1, Math.round(Number(r.draw_ref_width) || ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH)),
      draw_ref_height: Math.max(1, Math.round(Number(r.draw_ref_height) || ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT)),
      context_padding_pct: 0,
      prompt_core: normalized.prompt_template,
      alert_condition: normalized.alert_condition,
      negative_condition: normalized.negative_condition,
      face_target_ids: cleanFaceIds,
      negative_image_ids: cleanNegativeIds,
    }))
    .filter((r) => r.polygon_norm.length >= ANALYSIS_REGION_MIN_POINTS);

  if (polygons.length > 0) return polygons;

  return [
    {
      region_id: "full-frame",
      label: "Full frame",
      description: "",
      enabled: true,
      full_frame: true,
      polygon_norm: [],
      draw_ref_width: ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH,
      draw_ref_height: ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT,
      context_padding_pct: 0,
      prompt_core: normalized.prompt_template,
      alert_condition: normalized.alert_condition,
      negative_condition: normalized.negative_condition,
      face_target_ids: cleanFaceIds,
      negative_image_ids: cleanNegativeIds,
    },
  ];
};

const getDisplayNameFromAgent = (agent: CameraCustomAgentRow | null): string => {
  if (!agent) return "";
  if (agent.config_json && typeof agent.config_json === "object" && !Array.isArray(agent.config_json)) {
    const fromCfg = typeof (agent.config_json as any).display_name === "string"
      ? String((agent.config_json as any).display_name).trim()
      : "";
    if (fromCfg) return fromCfg;
  }
  return String(agent.algorithm_type || "").trim();
};

export default function CameraCustomAgentEditorModal({
  open,
  cameraId,
  initialAgent,
  onClose,
  onSaved,
  showToast,
}: Props) {
  const { t, i18n } = useTranslation();
  const {
    currentStepId: onboardingStepId,
    isOpen: isOnboardingOpen,
    providerStatus,
  } = useOnboarding();
  const tutorialAgentSeededRef = useRef(false);
  const localizedOptionalSuffix = extractOptionalSuffix(
    t("jobs.promptEditor.targetFacesOptionalLabel", {
      defaultValue: "Target Faces (optional)",
    })
  );
  const [displayName, setDisplayName] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [inputType, setInputType] = useState<"video" | "image">("video");
  const [videoPackagingMode, setVideoPackagingMode] = useState<CameraVideoPackagingMode>(
    DEFAULT_CAMERA_VIDEO_PACKAGING_MODE
  );
  const [inferenceModel, setInferenceModel] = useState<CameraAgentInferenceModel>(
    DEFAULT_CAMERA_AGENT_INFERENCE_MODEL
  );
  const [runEvery, setRunEvery] = useState<CameraAgentRunEverySeconds>(60);
  const [runningResolution, setRunningResolution] = useState<CameraAgentRunningResolution>(
    DEFAULT_CORE_RUNNING_RESOLUTION
  );
  const [modelFps, setModelFps] = useState<number>(DEFAULT_ULTRA_VIDEO_MODEL_FPS);
  const [onlyCaptureOnMotion, setOnlyCaptureOnMotion] = useState(true);
  const [fields, setFields] = useState<PromptEditorFields>({
    prompt_template: "",
    alert_condition: "",
    negative_condition: "",
  });
  const [algorithmId, setAlgorithmId] = useState<number | null>(null);

  const [polygonRegions, setPolygonRegions] = useState<AnalysisRegion[]>([]);
  const [polygonDrawEnabled, setPolygonDrawEnabled] = useState(false);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [pendingRegionSeed, setPendingRegionSeed] = useState<{
    start: AnalysisRegionPoint;
    label: string;
    description: string;
    draw_ref_width: number;
    draw_ref_height: number;
  } | null>(null);
  const [draftRect, setDraftRect] = useState<{ start: AnalysisRegionPoint; end: AnalysisRegionPoint } | null>(null);
  const [isSizingRect, setIsSizingRect] = useState(false);
  const [dragVertex, setDragVertex] = useState<{ regionId: string; index: number } | null>(null);
  const [showRegionDialog, setShowRegionDialog] = useState(false);
  const [regionDialogLabel, setRegionDialogLabel] = useState("");
  const [regionDialogDescription, setRegionDialogDescription] = useState("");
  const [regionDialogAnchor, setRegionDialogAnchor] = useState<{
    point: AnalysisRegionPoint;
    draw_ref_width: number;
    draw_ref_height: number;
  } | null>(null);

  const [faceTargets, setFaceTargets] = useState<FaceTarget[]>([]);
  const [faceTargetsLoading, setFaceTargetsLoading] = useState(false);
  const [selectedFaceTargetIds, setSelectedFaceTargetIds] = useState<number[]>([]);
  const [newFaceTargetName, setNewFaceTargetName] = useState("");
  const [newFaceTargetDescription, setNewFaceTargetDescription] = useState("");
  const [newFaceTargetFile, setNewFaceTargetFile] = useState<File | null>(null);
  const [targetFacesExpanded, setTargetFacesExpanded] = useState(false);
  const [creatingFaceTarget, setCreatingFaceTarget] = useState(false);
  const [faceTargetUploadingId, setFaceTargetUploadingId] = useState<number | null>(null);
  const [faceTargetDeletingImageId, setFaceTargetDeletingImageId] = useState<number | null>(null);
  const [editingFaceTargetId, setEditingFaceTargetId] = useState<number | null>(null);
  const [editingFaceTargetName, setEditingFaceTargetName] = useState("");
  const [editingFaceTargetDescription, setEditingFaceTargetDescription] = useState("");
  const [savingFaceTargetId, setSavingFaceTargetId] = useState<number | null>(null);
  const [deletingFaceTargetId, setDeletingFaceTargetId] = useState<number | null>(null);

  const [negativeImages, setNegativeImages] = useState<NegativeReferenceImage[]>([]);
  const [selectedNegativeImageIds, setSelectedNegativeImageIds] = useState<number[]>([]);
  const [uploadingNegativeImages, setUploadingNegativeImages] = useState(false);

  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [suggestion, setSuggestion] = useState<PromptEnhanceSuggestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateAgents, setTemplateAgents] = useState<OwnedAgentTemplate[]>([]);
  const [templateAgentsLoading, setTemplateAgentsLoading] = useState(false);
  const [templateAgentsError, setTemplateAgentsError] = useState<string | null>(null);
  const [selectedTemplateAgentId, setSelectedTemplateAgentId] = useState("");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<{ thumbnail_url: string | null; last_thumbnail_update: string | null }>({
    thumbnail_url: null,
    last_thumbnail_update: null,
  });
  const [snapshotNaturalSize, setSnapshotNaturalSize] = useState({ width: 0, height: 0 });
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotRequesting, setSnapshotRequesting] = useState(false);
  const [snapshotCooldownUntil, setSnapshotCooldownUntil] = useState(0);
  const snapshotRequestingRef = useRef(false);
  const snapshotCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshotUrl = snapshotMeta.thumbnail_url
    ? `/api/thumbnails/${snapshotMeta.thumbnail_url}${
        snapshotMeta.last_thumbnail_update ? `?ts=${encodeURIComponent(snapshotMeta.last_thumbnail_update)}` : ""
      }`
    : null;
  const canLoadSavedAgentTemplate = !initialAgent && !isOnboardingOpen;
  const selectedTemplateAgent = useMemo(() => {
    const templateId = Number(selectedTemplateAgentId);
    if (!Number.isInteger(templateId) || templateId <= 0) return null;
    return templateAgents.find((agent) => agent.id === templateId) || null;
  }, [selectedTemplateAgentId, templateAgents]);

  const polygonCount = polygonRegions.length;
  const snapshotRefreshBlocked =
    snapshotLoading || snapshotRequesting || snapshotRequestingRef.current || snapshotCooldownUntil > Date.now();

  const clearSnapshotCooldown = () => {
    if (snapshotCooldownTimerRef.current) {
      clearTimeout(snapshotCooldownTimerRef.current);
      snapshotCooldownTimerRef.current = null;
    }
    setSnapshotCooldownUntil(0);
  };

  const startSnapshotCooldown = () => {
    const until = Date.now() + SNAPSHOT_REFRESH_COOLDOWN_MS;
    setSnapshotCooldownUntil(until);
    if (snapshotCooldownTimerRef.current) clearTimeout(snapshotCooldownTimerRef.current);
    snapshotCooldownTimerRef.current = setTimeout(() => {
      snapshotCooldownTimerRef.current = null;
      setSnapshotCooldownUntil(0);
    }, SNAPSHOT_REFRESH_COOLDOWN_MS);
  };

  const fetchFaceTargets = async () => {
    setFaceTargetsLoading(true);
    try {
      const response = await fetch("/api/face-targets");
      if (!response.ok) throw new Error("Failed to load target faces");
      const data = await response.json().catch(() => ({}));
      const rows = Array.isArray(data?.targets) ? data.targets : [];
      const normalized: FaceTarget[] = rows
        .map((row: any) => {
          const id = Number(row?.id);
          if (!Number.isInteger(id) || id <= 0) return null;
          const imagesRaw = Array.isArray(row?.images) ? row.images : [];
          const images: FaceTargetImage[] = imagesRaw
            .map((img: any) => {
              const imageId = Number(img?.id);
              const imageUrl = typeof img?.image_url === "string" ? img.image_url.trim() : "";
              if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
              return { id: imageId, image_url: imageUrl } as FaceTargetImage;
            })
            .filter(Boolean) as FaceTargetImage[];
          return {
            id,
            name: typeof row?.name === "string" ? row.name : "",
            description: typeof row?.description === "string" ? row.description : "",
            image_count:
              Number.isFinite(Number(row?.image_count)) && Number(row?.image_count) >= 0
                ? Number(row.image_count)
                : images.length,
            images,
          } as FaceTarget;
        })
        .filter(Boolean) as FaceTarget[];
      setFaceTargets(normalized);
    } catch (error) {
      console.error("Failed to fetch face targets:", error);
      showToast("Error", "Failed to load target faces", "destructive");
    } finally {
      setFaceTargetsLoading(false);
    }
  };

  const refreshSnapshotMeta = async (): Promise<boolean> => {
    const response = await fetch(`/api/cameras/${cameraId}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Failed to load camera snapshot");
    const thumbnail_url =
      typeof data?.thumbnail_url === "string" && data.thumbnail_url.trim() ? data.thumbnail_url.trim() : null;
    const last_thumbnail_update =
      typeof data?.last_thumbnail_update === "string" && data.last_thumbnail_update.trim()
        ? data.last_thumbnail_update.trim()
        : null;
    setSnapshotMeta({ thumbnail_url, last_thumbnail_update });
    return !!thumbnail_url;
  };

  const requestSnapshotRefresh = async () => {
    if (snapshotRequestingRef.current) return;
    if (Date.now() < snapshotCooldownUntil) return;
    snapshotRequestingRef.current = true;
    setSnapshotRequesting(true);
    startSnapshotCooldown();
    try {
      const response = await fetch(`/api/cameras/${cameraId}/refresh-thumbnail`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to request preview capture");
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to capture preview", "destructive");
      setSnapshotRequesting(false);
    } finally {
      snapshotRequestingRef.current = false;
    }
  };

  const loadNegativeImages = async (id: number) => {
    if (!id) {
      setNegativeImages([]);
      setSelectedNegativeImageIds([]);
      return;
    }
    const response = await fetch(`/api/camera-algorithms/${id}/negative-images`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Failed to load negative images");
    const images = normalizeNegativeImages(data?.images);
    setNegativeImages(images);
    setSelectedNegativeImageIds(Array.from(new Set(images.map((img) => img.id))));
  };

  const initialize = async (
    agent: CameraCustomAgentRow | null,
    options?: { loadMode?: "existing" | "template" }
  ) => {
    const loadMode = options?.loadMode === "template" ? "template" : "existing";
    const parsedFields = parsePromptTemplate(agent?.prompt_template, agent?.alert_condition, agent?.negative_condition);
    const faceIds = normalizeFaceTargetIds(agent?.face_target_ids);
    const negativeImagesFromAgent =
      loadMode === "template" ? [] : normalizeNegativeImages(agent?.negative_reference_images);
    const negativeIds = Array.from(new Set(negativeImagesFromAgent.map((img) => img.id)));

    const normalizedInputType =
      String(agent?.input_type || "").trim().toLowerCase() === "image" ? "image" : "video";
    const normalizedInferenceModel = normalizeInferenceModel(agent?.inference_model);
    const execution = applyExecutionConstraints(
      normalizedInputType,
      normalizedInferenceModel,
      normalizeRunEverySeconds(agent?.run_every, 60),
      normalizeRunningResolution(agent?.running_resolution),
      normalizeModelFps(agent?.model_fps)
    );

    setDisplayName(getDisplayNameFromAgent(agent));
    setIsEnabled(normalizeBool(agent?.is_enabled, true));
    setInputType(execution.inputType);
    setVideoPackagingMode(normalizeVideoPackagingMode(agent?.video_packaging_mode));
    setInferenceModel(execution.inferenceModel);
    setRunEvery(execution.runEvery);
    setRunningResolution(execution.runningResolution);
    setModelFps(execution.modelFps);
    setOnlyCaptureOnMotion(normalizeBool(agent?.only_capture_on_motion, true));
    setFields(parsedFields);
    setSelectedFaceTargetIds(faceIds);
    setNegativeImages(negativeImagesFromAgent);
    setSelectedNegativeImageIds(negativeIds);
    setPolygonRegions(
      normalizeRegionsFromApi(agent?.analysis_regions, parsedFields, faceIds, negativeIds)
    );

    const id = Number(agent?.id);
    const safeId =
      loadMode === "existing" && Number.isInteger(id) && id > 0 ? id : null;
    setAlgorithmId(safeId);
    setPolygonDrawEnabled(false);
    setShowRegionDialog(false);
    setPendingRegionSeed(null);
    setDraftRect(null);
    setIsSizingRect(false);
    setDragVertex(null);
    setHoveredRegionId(null);
    setSuggestion(null);
    setTargetFacesExpanded(false);
    setCreatingFaceTarget(false);
    setFaceTargetUploadingId(null);
    setFaceTargetDeletingImageId(null);
    setEditingFaceTargetId(null);
    setEditingFaceTargetName("");
    setEditingFaceTargetDescription("");
    setSavingFaceTargetId(null);
    setDeletingFaceTargetId(null);

    if (safeId) {
      try {
        await loadNegativeImages(safeId);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    void initialize(initialAgent);
    void fetchFaceTargets();
    setSnapshotLoading(true);
    void refreshSnapshotMeta()
      .then((has) => {
        if (!has) void requestSnapshotRefresh();
      })
      .catch(() => {
        // ignore
      })
      .finally(() => setSnapshotLoading(false));
  }, [open, initialAgent?.id, cameraId]);

  useEffect(() => {
    if (!open || !canLoadSavedAgentTemplate) {
      setTemplateAgents([]);
      setTemplateAgentsLoading(false);
      setTemplateAgentsError(null);
      setSelectedTemplateAgentId("");
      return;
    }

    let cancelled = false;
    setTemplateAgentsLoading(true);
    setTemplateAgentsError(null);
    setSelectedTemplateAgentId("");

    void (async () => {
      try {
        const response = await fetch("/api/custom-agents/library");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to load your saved agents");
        }

        const rows = Array.isArray(data?.agents) ? data.agents : [];
        const normalized = rows
          .map((rawRow: unknown) => {
            const row =
              rawRow && typeof rawRow === "object"
                ? (rawRow as Record<string, unknown>)
                : null;
            if (!row) return null;

            const id = Number(row?.id);
            const sourceCameraId = Number(row?.camera_id);
            if (!Number.isInteger(id) || id <= 0) return null;
            if (!Number.isInteger(sourceCameraId) || sourceCameraId <= 0) return null;

            const configJson =
              row?.config_json &&
              typeof row.config_json === "object" &&
              !Array.isArray(row.config_json)
                ? row.config_json
                : {};
            const draftAgent: CameraCustomAgentRow = {
              id,
              algorithm_type: String(row?.algorithm_type || ""),
              is_enabled: normalizeBool(row?.is_enabled, true),
              input_type: String(row?.input_type || "").trim().toLowerCase() === "image" ? "image" : "video",
              video_packaging_mode: normalizeVideoPackagingMode(row?.video_packaging_mode),
              inference_model: normalizeInferenceModel(row?.inference_model),
              model_fps: Number.isFinite(Number(row?.model_fps))
                ? Number(row.model_fps)
                : DEFAULT_ULTRA_VIDEO_MODEL_FPS,
              run_every: normalizeRunEverySeconds(row?.run_every, 60),
              running_resolution: normalizeRunningResolution(row?.running_resolution),
              only_capture_on_motion: normalizeBool(row?.only_capture_on_motion, true),
              prompt_template: String(row?.prompt_template || ""),
              alert_condition: String(row?.alert_condition || ""),
              negative_condition: String(row?.negative_condition || ""),
              face_target_ids: normalizeFaceTargetIds(row?.face_target_ids),
              negative_reference_images: normalizeNegativeImages(row?.negative_reference_images),
              analysis_regions: Array.isArray(row?.analysis_regions) ? row.analysis_regions : [],
              config_json: configJson,
            };

            return {
              ...draftAgent,
              camera_id: sourceCameraId,
              camera_name:
                typeof row?.camera_name === "string" && row.camera_name.trim()
                  ? row.camera_name.trim()
                  : `Camera #${sourceCameraId}`,
              display_name: getDisplayNameFromAgent(draftAgent) || `custom_${id}`,
              updated_at:
                typeof row?.updated_at === "string" && row.updated_at.trim()
                  ? row.updated_at.trim()
                  : null,
            } as OwnedAgentTemplate;
          })
          .filter(Boolean) as OwnedAgentTemplate[];

        if (!cancelled) {
          setTemplateAgents(normalized);
        }
      } catch (error) {
        console.error("Failed to load owned custom agents:", error);
        if (!cancelled) {
          setTemplateAgents([]);
          setTemplateAgentsError(
            error instanceof Error ? error.message : "Failed to load your saved agents"
          );
        }
      } finally {
        if (!cancelled) {
          setTemplateAgentsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, canLoadSavedAgentTemplate]);

  useEffect(() => {
    if (!open) {
      tutorialAgentSeededRef.current = false;
      return;
    }

    if (
      initialAgent ||
      !isOnboardingOpen ||
      !onboardingStepId ||
      !AGENT_EDITOR_ONBOARDING_STEPS.has(onboardingStepId)
    ) {
      return;
    }

    if (!tutorialAgentSeededRef.current) {
      const preferredModel = getTutorialInferenceModel({
        openai: providerStatus.openai,
        zai: providerStatus.zai,
      });
      const execution = applyExecutionConstraints(
        "video",
        preferredModel,
        10,
        DEFAULT_CORE_RUNNING_RESOLUTION,
        DEFAULT_ULTRA_VIDEO_MODEL_FPS
      );

      setDisplayName(t("tutorial.agentPreset.name"));
      setIsEnabled(true);
      setInputType(execution.inputType);
      setVideoPackagingMode("frame_sequence");
      setInferenceModel(execution.inferenceModel);
      setRunEvery(execution.runEvery);
      setRunningResolution(execution.runningResolution);
      setModelFps(execution.modelFps);
      setOnlyCaptureOnMotion(true);
      setFields({
        prompt_template: t("tutorial.agentPreset.promptCore"),
        alert_condition: t("tutorial.agentPreset.alertCondition"),
        negative_condition: "",
      });
      tutorialAgentSeededRef.current = true;
    }
  }, [
    initialAgent,
    isOnboardingOpen,
    onboardingStepId,
    open,
    providerStatus.openai,
    providerStatus.zai,
    t,
  ]);

  useEffect(() => {
    if (!open) return;
    if (!snapshotRequesting) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      while (!cancelled && Date.now() - startedAt < 12000) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const ok = await refreshSnapshotMeta();
          if (ok) {
            if (!cancelled) setSnapshotRequesting(false);
            return;
          }
        } catch {
          // ignore while polling
        }
      }
      if (!cancelled) setSnapshotRequesting(false);
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [open, snapshotRequesting]);

  useEffect(() => {
    return () => {
      clearSnapshotCooldown();
    };
  }, []);

  useEffect(() => {
    const constrained = applyExecutionConstraints(
      inputType,
      inferenceModel,
      runEvery,
      runningResolution,
      modelFps
    );
    if (
      constrained.inputType !== inputType ||
      constrained.runEvery !== runEvery ||
      constrained.runningResolution !== runningResolution ||
      constrained.modelFps !== modelFps
    ) {
      setInputType(constrained.inputType);
      setRunEvery(constrained.runEvery);
      setRunningResolution(constrained.runningResolution);
      setModelFps(constrained.modelFps);
    }
  }, [inferenceModel, inputType, modelFps, runEvery, runningResolution]);

  const activeHoverRegion = useMemo(
    () => polygonRegions.find((region) => region.region_id === hoveredRegionId) || null,
    [polygonRegions, hoveredRegionId]
  );

  const getPointFromMouse = (clientX: number, clientY: number) => {
    const host = previewRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const naturalW = snapshotNaturalSize.width || ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH;
    const naturalH = snapshotNaturalSize.height || ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT;
    const imageAspect = naturalW / naturalH;
    const hostAspect = rect.width / rect.height;

    let renderW = rect.width;
    let renderH = rect.height;
    if (hostAspect > imageAspect) {
      renderH = rect.height;
      renderW = renderH * imageAspect;
    } else {
      renderW = rect.width;
      renderH = renderW / imageAspect;
    }

    const offsetX = (rect.width - renderW) / 2;
    const offsetY = (rect.height - renderH) / 2;
    const x = clientX - rect.left - offsetX;
    const y = clientY - rect.top - offsetY;
    if (x < 0 || y < 0 || x > renderW || y > renderH) return null;

    return {
      point: { x: clamp01(x / renderW), y: clamp01(y / renderH) },
      draw_ref_width: naturalW,
      draw_ref_height: naturalH,
    };
  };

  const onPreviewMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const pointer = getPointFromMouse(event.clientX, event.clientY);
    if (dragVertex) return;

    if (pendingRegionSeed && !isSizingRect) {
      setIsSizingRect(true);
      setDraftRect({
        start: pendingRegionSeed.start,
        end: pointer?.point ?? pendingRegionSeed.start,
      });
      return;
    }

    if (!polygonDrawEnabled || !pointer || !snapshotUrl) return;
    if (polygonCount >= ANALYSIS_REGION_MAX) {
      showToast("Validation", `Maximum ${ANALYSIS_REGION_MAX} polygons`, "destructive");
      return;
    }

    setRegionDialogLabel(`Region ${polygonCount + 1}`);
    setRegionDialogDescription("");
    setRegionDialogAnchor(pointer);
    setShowRegionDialog(true);
  };

  const onPreviewMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const pointer = getPointFromMouse(event.clientX, event.clientY);
    if (dragVertex) {
      if (!pointer) return;
      setPolygonRegions((prev) =>
        prev.map((region) => {
          if (region.region_id !== dragVertex.regionId) return region;
          if (!Array.isArray(region.polygon_norm) || dragVertex.index >= region.polygon_norm.length) {
            return region;
          }
          const next = [...region.polygon_norm];
          next[dragVertex.index] = pointer.point;
          return {
            ...region,
            polygon_norm: next,
            draw_ref_width: pointer.draw_ref_width,
            draw_ref_height: pointer.draw_ref_height,
          };
        })
      );
      return;
    }

    if (isSizingRect && pendingRegionSeed) {
      setDraftRect((prev) => ({
        start: prev?.start || pendingRegionSeed.start,
        end: pointer?.point || prev?.end || pendingRegionSeed.start,
      }));
      return;
    }

    if (!pointer) {
      setHoveredRegionId(null);
      return;
    }

    for (let idx = polygonRegions.length - 1; idx >= 0; idx -= 1) {
      const region = polygonRegions[idx];
      const poly = Array.isArray(region.polygon_norm) ? region.polygon_norm : [];
      if (poly.length >= ANALYSIS_REGION_MIN_POINTS && region.enabled && pointInPolygon(pointer.point, poly)) {
        setHoveredRegionId(region.region_id);
        return;
      }
    }
    setHoveredRegionId(null);
  };

  const onPreviewMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragVertex) {
      setDragVertex(null);
      return;
    }
    if (!isSizingRect || !pendingRegionSeed) return;

    const pointer = getPointFromMouse(event.clientX, event.clientY);
    const rectPoints = buildRectPolygonFromPoints(
      pendingRegionSeed.start,
      pointer?.point ?? draftRect?.end ?? pendingRegionSeed.start
    );
    setIsSizingRect(false);
    setDraftRect(null);

    if (rectPoints.length < ANALYSIS_REGION_MIN_POINTS) {
      setPendingRegionSeed(null);
      showToast("Validation", "Polygon area is too small", "destructive");
      return;
    }

    const baseId = sanitizeRegionId(pendingRegionSeed.label, polygonRegions.length);
    const used = new Set(polygonRegions.map((region) => region.region_id));
    let nextId = baseId;
    let suffix = 2;
    while (used.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const nextRegion: AnalysisRegion = {
      region_id: nextId,
      label: pendingRegionSeed.label.trim() || `Region ${polygonRegions.length + 1}`,
      description: pendingRegionSeed.description.trim(),
      enabled: true,
      full_frame: false,
      polygon_norm: rectPoints,
      draw_ref_width: pendingRegionSeed.draw_ref_width,
      draw_ref_height: pendingRegionSeed.draw_ref_height,
      context_padding_pct: 0,
      prompt_core: fields.prompt_template,
      alert_condition: fields.alert_condition,
      negative_condition: fields.negative_condition,
      face_target_ids: selectedFaceTargetIds,
      negative_image_ids: selectedNegativeImageIds,
    };
    setPolygonRegions((prev) => [...prev, nextRegion]);
    setHoveredRegionId(nextId);
    setPendingRegionSeed(null);
  };

  const onConfirmRegionDialog = () => {
    if (!regionDialogAnchor) return;
    setPendingRegionSeed({
      start: regionDialogAnchor.point,
      label: regionDialogLabel.trim() || `Region ${polygonCount + 1}`,
      description: regionDialogDescription.trim(),
      draw_ref_width: regionDialogAnchor.draw_ref_width,
      draw_ref_height: regionDialogAnchor.draw_ref_height,
    });
    setShowRegionDialog(false);
    setRegionDialogAnchor(null);
    showToast("Info", "Click and drag on preview to size polygon", "default");
  };

  const toggleSelectedFaceTarget = (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    setSelectedFaceTargetIds((prev) => {
      const set = new Set(prev);
      if (set.has(targetId)) set.delete(targetId);
      else set.add(targetId);
      return Array.from(set);
    });
  };

  const onCreateFaceTarget = async (
    options: { autoSelect?: boolean; silentSuccess?: boolean } = {}
  ): Promise<number | null> => {
    const name = newFaceTargetName.trim();
    if (!name || !newFaceTargetFile) {
      if (!options.silentSuccess) {
        showToast("Validation", "Target name and image are required", "destructive");
      }
      return null;
    }
    if (!String(newFaceTargetFile.type || "").toLowerCase().startsWith("image/")) {
      showToast("Validation", "Only image files are allowed", "destructive");
      return null;
    }
    if (newFaceTargetFile.size > FACE_ID_MAX_UPLOAD_BYTES) {
      showToast("Validation", "Image is too large. Maximum size is 10MB.", "destructive");
      return null;
    }

    setCreatingFaceTarget(true);
    try {
      const normalized = await normalizeFaceIdImage(newFaceTargetFile, {
        maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
      });
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", newFaceTargetDescription.trim());
      formData.append("image", normalized.file, normalized.file.name);
      const response = await fetch("/api/face-targets", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to create target");

      const targetId = Number(data?.target?.id);
      setNewFaceTargetName("");
      setNewFaceTargetDescription("");
      setNewFaceTargetFile(null);
      await fetchFaceTargets();

      if (options.autoSelect && Number.isInteger(targetId) && targetId > 0) {
        setSelectedFaceTargetIds((prev) => Array.from(new Set([...prev, targetId])));
      }
      if (!options.silentSuccess) {
        showToast("Success", "Target face created", "default");
      }
      return Number.isInteger(targetId) && targetId > 0 ? targetId : null;
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to create target", "destructive");
      return null;
    } finally {
      setCreatingFaceTarget(false);
    }
  };

  const startEditingFaceTarget = (target: FaceTarget) => {
    setEditingFaceTargetId(target.id);
    setEditingFaceTargetName(target.name || "");
    setEditingFaceTargetDescription(target.description || "");
  };

  const cancelEditingFaceTarget = () => {
    setEditingFaceTargetId(null);
    setEditingFaceTargetName("");
    setEditingFaceTargetDescription("");
    setSavingFaceTargetId(null);
  };

  const onSaveFaceTargetMeta = async (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    const nextName = editingFaceTargetName.trim();
    if (!nextName) {
      showToast("Validation", "Target name is required", "destructive");
      return;
    }
    setSavingFaceTargetId(targetId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          description: editingFaceTargetDescription.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to update target face");
      await fetchFaceTargets();
      cancelEditingFaceTarget();
      showToast("Success", "Target face updated", "default");
    } catch (error) {
      showToast(
        "Error",
        error instanceof Error ? error.message : "Failed to update target face",
        "destructive"
      );
    } finally {
      setSavingFaceTargetId(null);
    }
  };

  const onDeleteFaceTarget = async (target: FaceTarget) => {
    const targetId = Number(target?.id);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!confirm(`Delete target "${target.name || `#${targetId}`}"?`)) return;

    setDeletingFaceTargetId(targetId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to delete target face");

      await fetchFaceTargets();
      setSelectedFaceTargetIds((prev) => prev.filter((id) => id !== targetId));
      if (editingFaceTargetId === targetId) cancelEditingFaceTarget();
      showToast("Success", "Target face deleted", "default");
    } catch (error) {
      showToast(
        "Error",
        error instanceof Error ? error.message : "Failed to delete target face",
        "destructive"
      );
    } finally {
      setDeletingFaceTargetId(null);
    }
  };

  const onAddFaceTargetImages = async (targetId: number, files: File[]) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!Array.isArray(files) || files.length === 0) return;

    const target = faceTargets.find((entry) => entry.id === targetId);
    const currentCount = getFaceTargetImageCount(target);
    if (currentCount >= FACE_TARGET_MAX_IMAGES) {
      showToast("Validation", `Maximum ${FACE_TARGET_MAX_IMAGES} images per target`, "destructive");
      return;
    }

    const availableSlots = FACE_TARGET_MAX_IMAGES - currentCount;
    const candidateFiles = files.filter((file) =>
      String(file.type || "").toLowerCase().startsWith("image/")
    );
    const validSizeFiles = candidateFiles.filter((file) => file.size <= FACE_ID_MAX_UPLOAD_BYTES);
    const filesToUpload = validSizeFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) {
      showToast("Validation", `Maximum ${FACE_TARGET_MAX_IMAGES} images per target`, "destructive");
      return;
    }

    setFaceTargetUploadingId(targetId);
    try {
      for (const file of filesToUpload) {
        const normalizedUpload = await normalizeFaceIdImage(file, {
          maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
        });
        const formData = new FormData();
        formData.append("image", normalizedUpload.file, normalizedUpload.file.name);
        const response = await fetch(`/api/face-targets/${targetId}/images`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to upload face image");
      }
      await fetchFaceTargets();
      showToast("Success", "Face image(s) uploaded", "default");
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to upload face image", "destructive");
    } finally {
      setFaceTargetUploadingId(null);
    }
  };

  const onDeleteFaceTargetImage = async (targetId: number, imageId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!Number.isInteger(imageId) || imageId <= 0) return;

    setFaceTargetDeletingImageId(imageId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}/images/${imageId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to remove face image");
      await fetchFaceTargets();
      showToast("Success", "Face image removed", "default");
    } catch (error) {
      showToast(
        "Error",
        error instanceof Error ? error.message : "Failed to remove face image",
        "destructive"
      );
    } finally {
      setFaceTargetDeletingImageId(null);
    }
  };

  const onUploadNegativeImages = async (files: File[]) => {
    if (!algorithmId) {
      showToast("Validation", "Save the custom agent before uploading negative images", "destructive");
      return;
    }
    if (!Array.isArray(files) || files.length === 0) return;
    const currentCount = negativeImages.length;
    if (currentCount >= NEGATIVE_REFERENCE_MAX_IMAGES) {
      showToast("Validation", `Maximum ${NEGATIVE_REFERENCE_MAX_IMAGES} negative images`, "destructive");
      return;
    }
    const availableSlots = NEGATIVE_REFERENCE_MAX_IMAGES - currentCount;
    const toUpload = files.slice(0, availableSlots);
    setUploadingNegativeImages(true);
    try {
      for (const file of toUpload) {
        const normalized = await normalizeFaceIdImage(file, {
          maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
        });
        const formData = new FormData();
        formData.append("image", normalized.file, normalized.file.name);
        const response = await fetch(`/api/camera-algorithms/${algorithmId}/negative-images`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to upload negative image");
      }
      await loadNegativeImages(algorithmId);
      showToast("Success", "Negative reference images updated", "default");
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to upload negative image", "destructive");
    } finally {
      setUploadingNegativeImages(false);
    }
  };

  const onDeleteNegativeImage = async (imageId: number) => {
    if (!algorithmId || !imageId) return;
    try {
      const response = await fetch(`/api/camera-algorithms/${algorithmId}/negative-images/${imageId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to remove negative image");
      await loadNegativeImages(algorithmId);
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to remove negative image", "destructive");
    }
  };

  const onEnhancePrompt = async () => {
    const normalized = normalizeFields(fields);
    if (!normalized.prompt_template || !normalized.alert_condition) {
      showToast("Validation", "Prompt Core and Alert Condition are required", "destructive");
      return;
    }
    setEnhancingPrompt(true);
    setSuggestion(null);
    try {
      const response = await fetch(`/api/cameras/${cameraId}/custom-agents/enhance-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_template: normalized.prompt_template,
          alert_condition: normalized.alert_condition,
          negative_condition: normalized.negative_condition,
          analysis_regions: normalizeRegionsForPayload(
            polygonRegions,
            normalized,
            selectedFaceTargetIds,
            selectedNegativeImageIds
          ),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isOpenAiKeyRequiredError(data)) {
          emitOpenAiKeyRequiredPrompt();
        }
        throw new Error(data?.message || data?.error || "Failed to enqueue enhancement");
      }

      const commandId = Number(data?.command_id);
      if (!Number.isInteger(commandId) || commandId <= 0) {
        throw new Error("Invalid enhancement command id");
      }
      const timeoutAt = Date.now() + 120000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const pollRes = await fetch(
          `/api/cameras/${cameraId}/custom-agents/enhance-prompt/${commandId}`
        );
        const pollData = await pollRes.json().catch(() => ({}));
        if (!pollRes.ok) throw new Error(pollData?.error || "Failed to check enhancement status");
        const status = String(pollData?.status || "").trim().toLowerCase();
        if (status === "pending" || status === "sent") continue;
        if (status === "failed") throw new Error(pollData?.error || "Prompt enhancement failed");
        if (status === "completed") {
          const next = normalizeFields({
            prompt_template: String(pollData?.suggestion?.prompt_template || ""),
            alert_condition: String(pollData?.suggestion?.alert_condition || ""),
            negative_condition: String(pollData?.suggestion?.negative_condition || ""),
          });
          if (!next.prompt_template || !next.alert_condition) {
            throw new Error("Invalid suggestion received");
          }
          setSuggestion({
            ...next,
            model_name: typeof pollData?.meta?.model_name === "string" ? pollData.meta.model_name : undefined,
            snapshot_source:
              typeof pollData?.meta?.snapshot_source === "string"
                ? pollData.meta.snapshot_source
                : undefined,
          });
          return;
        }
      }
      throw new Error("Prompt enhancement timed out");
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to enhance prompt", "destructive");
    } finally {
      setEnhancingPrompt(false);
    }
  };

  const onLoadTemplateAgent = async () => {
    if (!selectedTemplateAgent) {
      showToast("Validation", "Select one of your saved agents first", "destructive");
      return;
    }

    const requestedFaceTargetIds = normalizeFaceTargetIds(selectedTemplateAgent.face_target_ids);
    const faceIds =
      faceTargets.length > 0
        ? requestedFaceTargetIds.filter((id) =>
            faceTargets.some((target) => target.id === id)
          )
        : requestedFaceTargetIds;

    await initialize(
      {
        ...selectedTemplateAgent,
        face_target_ids: faceIds,
        negative_reference_images: [],
      },
      { loadMode: "template" }
    );

    showToast(
      "Agent loaded",
      "This draft now uses your saved agent as a starting point. Negative reference images need to be uploaded again after the first save.",
      "default"
    );
  };

  const onApplyAndSave = async () => {
    const normalized = normalizeFields(fields);
    if (!displayName.trim() || !normalized.prompt_template || !normalized.alert_condition) {
      showToast("Validation", "Agent Name, Prompt Core and Alert Condition are required", "destructive");
      return;
    }
    if ((newFaceTargetName.trim().length > 0) !== !!newFaceTargetFile) {
      showToast("Validation", "Fill both target name and image, or leave both empty", "destructive");
      return;
    }

    let faceIds = [...selectedFaceTargetIds];
    if (newFaceTargetName.trim() && newFaceTargetFile) {
      const createdTargetId = await onCreateFaceTarget({
        autoSelect: true,
        silentSuccess: true,
      });
      if (typeof createdTargetId === "number" && Number.isInteger(createdTargetId) && createdTargetId > 0) {
        faceIds = normalizeFaceTargetIds([...faceIds, createdTargetId]);
      } else {
        faceIds = normalizeFaceTargetIds([...selectedFaceTargetIds]);
      }
    }

    const payload = {
      display_name: displayName.trim(),
      prompt_template: normalized.prompt_template,
      alert_condition: normalized.alert_condition,
      negative_condition: normalized.negative_condition,
      analysis_regions: normalizeRegionsForPayload(
        polygonRegions,
        normalized,
        faceIds,
        selectedNegativeImageIds
      ),
      face_target_ids: faceIds,
      is_enabled: isEnabled ? 1 : 0,
      input_type: inputType,
      video_packaging_mode: videoPackagingMode,
      inference_model: inferenceModel,
      model_fps:
        supportsAdjustableVideoFps(inferenceModel) && inputType === "video"
          ? modelFps
          : DEFAULT_ULTRA_VIDEO_MODEL_FPS,
      run_every: runEvery,
      running_resolution: inferenceModel === "core" ? runningResolution : null,
      only_capture_on_motion: onlyCaptureOnMotion,
    };
    setSaving(true);
    try {
      const endpoint = algorithmId
        ? `/api/cameras/${cameraId}/custom-agents/${algorithmId}`
        : `/api/cameras/${cameraId}/custom-agents`;
      const method = algorithmId ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isOpenAiKeyRequiredError(data)) {
          emitOpenAiKeyRequiredPrompt();
        }
        if (isZAiKeyRequiredError(data)) {
          emitZAiKeyRequiredPrompt();
        }
        throw new Error(data?.message || data?.error || "Failed to save custom agent");
      }
      const savedId = Number(data?.agent?.id ?? algorithmId);
      if (Number.isInteger(savedId) && savedId > 0) {
        setAlgorithmId(savedId);
        await loadNegativeImages(savedId);
      }
      await onSaved(savedId);
      showToast("Success", "Custom AI agent saved", "default");
      onClose();
    } catch (error) {
      showToast("Error", error instanceof Error ? error.message : "Failed to save custom agent", "destructive");
    } finally {
      setSaving(false);
    }
  };

  const getRunEveryOptionLabel = (seconds: CameraAgentRunEverySeconds): string => {
    return seconds === 10
      ? t("jobs.runEveryOption.seconds10")
      : t("jobs.runEveryOption.seconds60");
  };

  if (!open) return null;

  const draftPoints = draftRect ? buildRectPolygonFromPoints(draftRect.start, draftRect.end) : [];

  return (
    <>
      <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
        <button
          type="button"
          className="absolute inset-0 bg-black/45 backdrop-blur-md"
          onClick={() => {
            if (!saving && !enhancingPrompt) onClose();
          }}
          aria-label="Close agent editor"
        />

        <div className="relative h-[90vh] max-h-[1050px] w-[min(88vw,1320px)] max-w-[88vw] bg-gray-800 text-gray-100 rounded-md shadow-2xl border border-gray-700 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-700">
            <div className="min-w-0">
              <h4 className="text-lg font-semibold leading-tight">Agent Editor</h4>
              <p className="text-xs text-gray-400 mt-1">Define the full agent context.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canLoadSavedAgentTemplate ? (
                <div className="flex items-center gap-2 rounded border border-gray-700 bg-gray-900/80 px-2 py-1.5">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500">
                    Load
                  </span>
                  <select
                    value={selectedTemplateAgentId}
                    onChange={(e) => setSelectedTemplateAgentId(e.target.value)}
                    disabled={templateAgentsLoading || saving || enhancingPrompt}
                    title={
                      templateAgentsError ||
                      "Load one of your saved agents. Negative reference images need to be re-uploaded after the first save."
                    }
                    className="w-[200px] rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {templateAgentsLoading
                        ? "Loading saved agents..."
                        : templateAgentsError
                        ? "Failed to load agents"
                        : templateAgents.length === 0
                        ? "No saved agents"
                        : "Saved agents"}
                    </option>
                    {templateAgents.map((agent) => (
                      <option key={`saved-agent-${agent.id}`} value={agent.id}>
                        {`${agent.display_name} - ${agent.camera_name}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void onLoadTemplateAgent()}
                    disabled={!selectedTemplateAgent || templateAgentsLoading || saving || enhancingPrompt}
                    title="Load this saved agent into the current draft"
                    className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      !selectedTemplateAgent || templateAgentsLoading || saving || enhancingPrompt
                        ? "cursor-not-allowed bg-gray-700 text-gray-500"
                        : "bg-blue-600 text-white hover:bg-blue-500"
                    }`}
                  >
                    {templateAgentsLoading ? "..." : "Use"}
                  </button>
                </div>
              ) : null}
              <div
                className="flex items-center gap-2"
                data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorModel}
              >
                <select
                  value={inferenceModel}
                  onChange={(e) => {
                    const previousModel = inferenceModel;
                    const nextModel = normalizeInferenceModel(e.target.value);
                    if (shouldShowCoreModelNotice(nextModel, previousModel)) {
                      const notice = getCoreModelNoticeCopy(i18n.resolvedLanguage || i18n.language);
                      showToast(notice.title, notice.message, "default");
                    }
                    const constrained = applyExecutionConstraints(
                      inputType,
                      nextModel,
                      runEvery,
                      runningResolution,
                      modelFps
                    );
                    setInferenceModel(constrained.inferenceModel);
                    setInputType(constrained.inputType);
                    setRunEvery(constrained.runEvery);
                    setRunningResolution(constrained.runningResolution);
                    setModelFps(constrained.modelFps);
                  }}
                  disabled={saving || enhancingPrompt}
                  className="text-xs px-3 py-2 rounded border border-gray-700 bg-gray-900 text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  title={t("jobs.inferenceModel")}
                >
                  <option value="ultra_plus">{t("jobs.inferenceModelOption.ultraPlus")}</option>
                  <option value="ultra">{t("jobs.inferenceModelOption.ultra")}</option>
                  <option value="light">{t("jobs.inferenceModelOption.light")}</option>
                  <option value="core">{t("jobs.inferenceModelOption.core")}</option>
                  {inferenceModel === "pro" ? (
                    <option value="pro">{t("jobs.inferenceModelOption.pro")}</option>
                  ) : null}
                  {inferenceModel === "legacy" ? (
                    <option value="legacy">{t("jobs.inferenceModelOption.legacy")}</option>
                  ) : null}
                </select>
                <ModelHostingBadge modelTier={inferenceModel} />
              </div>
              <div data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorInputType}>
                <select
                  value={inputType}
                  onChange={(e) => {
                    const nextInputType = e.target.value === "image" ? "image" : "video";
                    const constrained = applyExecutionConstraints(
                      nextInputType,
                      inferenceModel,
                      runEvery,
                      runningResolution,
                      modelFps
                    );
                    setInputType(constrained.inputType);
                    setRunEvery(constrained.runEvery);
                    setRunningResolution(constrained.runningResolution);
                    setModelFps(constrained.modelFps);
                  }}
                  disabled={saving || enhancingPrompt || inferenceModel === "core"}
                  className="text-xs px-3 py-2 rounded border border-gray-700 bg-gray-900 text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  title={t("jobs.inputType")}
                >
                  <option value="video">{t("jobs.video")}</option>
                  {inferenceModel !== "core" && <option value="image">{t("jobs.image")}</option>}
                </select>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving || enhancingPrompt}
                className="p-2 rounded-md text-gray-500 hover:text-gray-100 hover:bg-gray-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="px-8 py-6 min-h-0 overflow-hidden">
            <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div
                className={`order-1 xl:order-1 min-h-0 grid gap-4 ${
                  targetFacesExpanded
                    ? "grid-rows-[minmax(0,0.5fr)_minmax(0,1.5fr)]"
                    : "grid-rows-[minmax(0,1.35fr)_minmax(0,0.65fr)]"
                }`}
              >
                <div
                  className="min-h-0 rounded-xl border border-gray-600/80 bg-gray-900/55 overflow-hidden flex flex-col shadow-lg shadow-black/30"
                  data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorPolygons}
                >
                  <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-300 truncate">Camera #{cameraId}</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !polygonDrawEnabled;
                          setPolygonDrawEnabled(next);
                          if (!next) {
                            setShowRegionDialog(false);
                            setPendingRegionSeed(null);
                            setDraftRect(null);
                            setIsSizingRect(false);
                          }
                        }}
                        disabled={!snapshotUrl || polygonCount >= ANALYSIS_REGION_MAX}
                        className={`text-[11px] px-2 py-1 rounded border ${
                          polygonDrawEnabled
                            ? "border-blue-500 text-blue-200 bg-blue-500/20"
                            : "border-gray-600 text-gray-300 bg-gray-800"
                        } disabled:opacity-50`}
                      >
                        {polygonDrawEnabled ? "Drawing ON" : "Draw Polygon"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void requestSnapshotRefresh()}
                        disabled={snapshotRefreshBlocked}
                        className="text-[11px] text-blue-300 hover:underline disabled:text-gray-500"
                      >
                        {snapshotLoading
                          ? "Loading..."
                          : snapshotRequesting
                          ? "Refreshing..."
                          : snapshotUrl
                          ? "Refresh preview"
                          : "Capture preview"}
                      </button>
                    </div>
                  </div>

                  <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                    {pendingRegionSeed
                      ? "Drag on image to size the new polygon."
                      : polygonDrawEnabled
                      ? "Click once on image to define polygon name and description."
                      : polygonCount > 0
                      ? `${polygonCount} polygon(s) configured.`
                      : "No polygons configured. Full frame will be used."}
                  </div>

                  <div className="relative min-h-0 flex-1 overflow-hidden p-3">
                    {snapshotUrl ? (
                      <div
                        ref={previewRef}
                        className="relative h-full w-full bg-black/55 border border-gray-700 overflow-hidden"
                        onMouseDown={onPreviewMouseDown}
                        onMouseMove={onPreviewMouseMove}
                        onMouseUp={onPreviewMouseUp}
                      >
                        <img
                          src={snapshotUrl}
                          alt="snapshot"
                          className="absolute inset-0 h-full w-full object-contain"
                          onLoad={(event) => {
                            const img = event.currentTarget;
                            setSnapshotNaturalSize({
                              width: img.naturalWidth || 0,
                              height: img.naturalHeight || 0,
                            });
                          }}
                        />
                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                          {polygonRegions.map((region) => {
                            const points = Array.isArray(region.polygon_norm) ? region.polygon_norm : [];
                            if (points.length < ANALYSIS_REGION_MIN_POINTS) return null;
                            const centroid = getPolygonCentroid(points);
                            return (
                              <g key={region.region_id}>
                                <polygon
                                  points={toSvgPoints(points)}
                                  fill={region.enabled ? "rgba(96,165,250,0.20)" : "rgba(245,158,11,0.20)"}
                                  stroke={hoveredRegionId === region.region_id ? "#60a5fa" : "#93c5fd"}
                                  strokeWidth={0.35}
                                  onMouseEnter={() => setHoveredRegionId(region.region_id)}
                                  onDoubleClick={() => {
                                    setPolygonRegions((prev) =>
                                      prev.map((r) =>
                                        r.region_id === region.region_id ? { ...r, enabled: !r.enabled } : r
                                      )
                                    );
                                  }}
                                />
                                <text
                                  x={centroid.x * 100}
                                  y={centroid.y * 100}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fill="#dbeafe"
                                  fontSize={3}
                                  fontWeight={700}
                                  style={{ pointerEvents: "none" }}
                                >
                                  {region.label}
                                </text>
                                {points.map((p, idx) => (
                                  <circle
                                    key={`${region.region_id}-${idx}`}
                                    cx={p.x * 100}
                                    cy={p.y * 100}
                                    r={0.7}
                                    fill="#93c5fd"
                                    stroke="#111827"
                                    strokeWidth={0.2}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setDragVertex({ regionId: region.region_id, index: idx });
                                    }}
                                  />
                                ))}
                              </g>
                            );
                          })}
                          {draftPoints.length >= ANALYSIS_REGION_MIN_POINTS ? (
                            <polygon
                              points={toSvgPoints(draftPoints)}
                              fill="rgba(59,130,246,0.22)"
                              stroke="rgba(96,165,250,0.95)"
                              strokeDasharray="2 1"
                              strokeWidth={0.35}
                            />
                          ) : null}
                        </svg>
                        {activeHoverRegion ? (
                          <div className="absolute top-2 left-2 z-20 rounded bg-black/70 px-2 py-1 text-[11px] text-white flex gap-2">
                            <span>{activeHoverRegion.label}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const id = activeHoverRegion.region_id;
                                setPolygonRegions((prev) => prev.filter((r) => r.region_id !== id));
                                setHoveredRegionId(null);
                              }}
                              className="text-rose-300 hover:text-rose-200"
                            >
                              X
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="h-full rounded border border-dashed border-gray-700 bg-gray-900/70 text-[13px] text-gray-500 flex items-center justify-center px-4 text-center">
                        {snapshotLoading ? "Loading snapshot..." : "No snapshot available yet."}
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-h-0 rounded-xl border border-gray-600/80 bg-gray-900/55 overflow-hidden flex flex-col shadow-lg shadow-black/30">
                  <div className="px-4 py-3 border-b border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <label className="block text-sm font-semibold text-gray-100">
                          Target Faces (optional)
                        </label>
                        <p className="text-xs text-gray-400">
                          Select faces from the library to enable hidden FaceID matching in this agent.
                        </p>
                        <p className="text-[11px] text-blue-300">
                          Selected faces are shared across all polygons in this agent.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTargetFacesExpanded((prev) => !prev)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500 hover:text-gray-100"
                        title={targetFacesExpanded ? "Collapse target faces panel" : "Expand target faces panel"}
                      >
                        {targetFacesExpanded ? (
                          <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="space-y-3">
                      <div className="rounded border border-gray-700 bg-gray-800 p-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newFaceTargetName}
                            onChange={(e) => setNewFaceTargetName(e.target.value)}
                            className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                            placeholder="Target name (required)"
                          />
                          <input
                            type="text"
                            value={newFaceTargetDescription}
                            onChange={(e) => setNewFaceTargetDescription(e.target.value)}
                            className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                            placeholder="Description (optional)"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setNewFaceTargetFile(file);
                              e.currentTarget.value = "";
                            }}
                            className="text-xs text-gray-300"
                          />
                          <button
                            type="button"
                            onClick={() => void onCreateFaceTarget({ autoSelect: true })}
                            disabled={creatingFaceTarget}
                            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs"
                          >
                            {creatingFaceTarget ? "Creating..." : "Create Target"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void fetchFaceTargets()}
                            disabled={faceTargetsLoading}
                            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-100 text-xs"
                          >
                            Refresh
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-500">
                          Tip: if name + image are filled here, `Apply & Save` will also create this target automatically.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {faceTargetsLoading ? (
                          <p className="text-xs text-gray-500">Loading target faces...</p>
                        ) : faceTargets.length === 0 ? (
                          <p className="text-xs text-gray-500">No target faces yet.</p>
                        ) : (
                          faceTargets.map((target) => {
                            const selected = selectedFaceTargetIds.includes(target.id);
                            const isEditingTarget = editingFaceTargetId === target.id;
                            const isSavingTarget = savingFaceTargetId === target.id;
                            const isDeletingTarget = deletingFaceTargetId === target.id;
                            const currentImageCount = getFaceTargetImageCount(target);
                            const maxImagesReached = currentImageCount >= FACE_TARGET_MAX_IMAGES;
                            return (
                              <div
                                key={target.id}
                                className={`rounded border p-3 ${
                                  selected
                                    ? "border-blue-500 bg-blue-500/10"
                                    : "border-gray-700 bg-gray-800"
                                } ${isDeletingTarget ? "opacity-70" : ""}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={() => toggleSelectedFaceTarget(target.id)}
                                      disabled={isDeletingTarget}
                                      className="mt-1 h-4 w-4 rounded border-gray-500"
                                    />
                                    {isEditingTarget ? (
                                      <span className="block space-y-1 min-w-[220px]">
                                        <input
                                          type="text"
                                          value={editingFaceTargetName}
                                          onChange={(e) => setEditingFaceTargetName(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                          placeholder="Target name"
                                        />
                                        <input
                                          type="text"
                                          value={editingFaceTargetDescription}
                                          onChange={(e) =>
                                            setEditingFaceTargetDescription(e.target.value)
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                          placeholder="Target description"
                                        />
                                        <span className="block text-[11px] text-gray-500 mt-0.5">
                                          {currentImageCount} image(s)
                                        </span>
                                      </span>
                                    ) : (
                                      <span>
                                        <span className="block text-sm font-semibold text-gray-100">
                                          {target.name}
                                        </span>
                                        {target.description ? (
                                          <span className="block text-xs text-gray-400">
                                            {target.description}
                                          </span>
                                        ) : null}
                                        <span className="block text-[11px] text-gray-500 mt-0.5">
                                          {currentImageCount} image(s)
                                        </span>
                                      </span>
                                    )}
                                  </label>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <label
                                      className={`text-[11px] ${
                                        maxImagesReached || isDeletingTarget
                                          ? "text-gray-500 cursor-not-allowed"
                                          : "text-blue-400 cursor-pointer hover:underline"
                                      }`}
                                    >
                                      {faceTargetUploadingId === target.id ? "Uploading" : "Add image"}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        disabled={isDeletingTarget || maxImagesReached}
                                        onChange={(e) => {
                                          const selectedFiles = Array.from(e.target.files || []);
                                          void onAddFaceTargetImages(target.id, selectedFiles);
                                          e.currentTarget.value = "";
                                        }}
                                      />
                                    </label>
                                    {isEditingTarget ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => void onSaveFaceTargetMeta(target.id)}
                                          disabled={isSavingTarget}
                                          className="text-[11px] text-emerald-400 hover:underline disabled:text-gray-500"
                                        >
                                          {isSavingTarget ? "Saving..." : "Save"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditingFaceTarget}
                                          disabled={isSavingTarget}
                                          className="text-[11px] text-gray-400 hover:underline disabled:text-gray-500"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => startEditingFaceTarget(target)}
                                          disabled={isDeletingTarget}
                                          className="text-[11px] text-gray-300 hover:underline disabled:text-gray-500"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void onDeleteFaceTarget(target)}
                                          disabled={isDeletingTarget}
                                          className="text-[11px] text-rose-400 hover:underline disabled:text-gray-500"
                                        >
                                          {isDeletingTarget ? "Deleting..." : "Delete"}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {target.images.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {target.images.map((image) => (
                                      <div
                                        key={image.id}
                                        className="relative h-14 w-14 rounded overflow-hidden border border-gray-700 bg-gray-800"
                                      >
                                        <img
                                          src={image.image_url}
                                          alt={target.name}
                                          className="h-full w-full object-cover"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void onDeleteFaceTargetImage(target.id, image.id)
                                          }
                                          disabled={
                                            faceTargetDeletingImageId === image.id || isDeletingTarget
                                          }
                                          className="absolute top-0 right-0 bg-black/60 text-white text-[10px] px-1 leading-4"
                                          title="Remove image"
                                        >
                                          x
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 text-[11px] text-amber-400">
                                    Add at least one image to improve matching.
                                  </p>
                                )}
                                {maxImagesReached ? (
                                  <p className="mt-2 text-[11px] text-amber-400">
                                    Maximum {FACE_TARGET_MAX_IMAGES} images reached for this target.
                                  </p>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative order-2 xl:order-2 min-h-0 overflow-hidden rounded-xl border border-gray-600/80 bg-gray-900/50 shadow-lg shadow-black/30">
                <div
                  className={`h-full ${
                    enhancingPrompt ? "overflow-y-hidden" : "overflow-y-auto"
                  } pr-2 pl-4 space-y-5 p-5`}
                >
                <div
                  className="space-y-5"
                  data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorExecution}
                >
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-100">{t("jobs.runEvery")}</label>
                    <select
                      value={inferenceModel === "core" ? 60 : runEvery}
                      onChange={(e) => setRunEvery(normalizeRunEverySeconds(e.target.value, 60))}
                      disabled={inferenceModel === "core"}
                      className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                  {CAMERA_AGENT_RUN_EVERY_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {getRunEveryOptionLabel(seconds)}
                    </option>
                  ))}
                    </select>
                  </div>
                  {inputType === "video" ? (
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-100">Video Packaging</label>
                      <select
                        value={videoPackagingMode}
                        onChange={(e) =>
                          setVideoPackagingMode(
                            normalizeVideoPackagingMode(e.target.value, videoPackagingMode)
                          )
                        }
                        className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm"
                      >
                        <option value="frame_sequence">{getVideoPackagingModeLabel("frame_sequence")}</option>
                        <option value="mosaic_2x2">{getVideoPackagingModeLabel("mosaic_2x2")}</option>
                        <option value="mosaic_3x3">{getVideoPackagingModeLabel("mosaic_3x3")}</option>
                      </select>
                      <p className="text-xs text-gray-400">
                        Standard Resolution uses a 2x2 mosaic. Compact Resolution uses a 3x3 mosaic and sends fewer image inputs than High Resolution.
                      </p>
                    </div>
                  ) : null}
                  {supportsAdjustableVideoFps(inferenceModel) && inputType === "video" ? (
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-100">Video FPS</label>
                      <select
                        value={modelFps}
                        onChange={(e) => setModelFps(normalizeModelFps(e.target.value, modelFps))}
                        className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm"
                      >
                        {Array.from({ length: MAX_ULTRA_VIDEO_MODEL_FPS }, (_, index) => {
                          const fps = index + 1;
                          return (
                            <option key={fps} value={fps}>
                              {`${fps} FPS`}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ) : null}
                  {inferenceModel === "core" ? (
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-100">
                        {t("jobs.runningResolution")}
                      </label>
                      <select
                        value={runningResolution}
                        onChange={(e) =>
                          setRunningResolution(normalizeRunningResolution(e.target.value))
                        }
                        className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm"
                      >
                        <option value={640}>
                          {t("jobs.runningResolutionOption.640")}
                        </option>
                        <option value={1024}>
                          {t("jobs.runningResolutionOption.1024")}
                        </option>
                      </select>
                    </div>
                  ) : null}
                </div>
                <div
                  className={PROMPT_DOCUMENT_BLOCK_CLASS}
                  data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorFields}
                >
                  <div className={PROMPT_DOCUMENT_SECTION_CLASS}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading("Agent Name")}
                      </span>
                      <span className="text-red-600">*</span>
                    </div>
                    <input
                      aria-label="Agent Name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className={PROMPT_DOCUMENT_INPUT_CLASS}
                      placeholder="Custom agent name"
                    />
                  </div>
                  <div className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading(t("jobs.promptEditor.promptCoreLabel"))}
                      </span>
                      <span className="text-red-600">*</span>
                    </div>
                    <textarea
                      aria-label={t("jobs.promptEditor.promptCoreLabel")}
                      value={fields.prompt_template}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, prompt_template: e.target.value }))
                      }
                      rows={8}
                      className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      placeholder={t("jobs.promptEditor.promptCorePlaceholder")}
                    />
                  </div>
                  <div className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading(t("jobs.promptEditor.alertConditionLabel"))}
                      </span>
                      <span className="text-red-600">*</span>
                    </div>
                    <textarea
                      aria-label={t("jobs.promptEditor.alertConditionLabel")}
                      value={fields.alert_condition}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, alert_condition: e.target.value }))
                      }
                      rows={5}
                      className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      placeholder={t("jobs.promptEditor.alertConditionPlaceholder")}
                    />
                  </div>
                  <div className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}>
                    <div className="font-mono text-[13px] font-semibold text-gray-100">
                      {formatPromptDocumentHeading(t("jobs.promptEditor.negativeConditionLabel"), {
                        optional: true,
                        optionalSuffix: localizedOptionalSuffix,
                      })}
                    </div>
                    <textarea
                      aria-label={`${t("jobs.promptEditor.negativeConditionLabel")}${localizedOptionalSuffix}`}
                      value={fields.negative_condition}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, negative_condition: e.target.value }))
                      }
                      rows={4}
                      className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      placeholder={t("jobs.promptEditor.negativeConditionPlaceholder")}
                    />
                  </div>
                </div>
                  <div className="space-y-2">
                  <label className="block font-mono text-[13px] font-semibold text-gray-100">
                    {formatPromptDocumentHeading("Negative Reference Images", {
                      optional: true,
                      optionalSuffix: localizedOptionalSuffix,
                    })}
                  </label>
                  <div className="rounded border border-gray-700 bg-gray-800 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className={`text-xs ${!algorithmId || negativeImages.length >= NEGATIVE_REFERENCE_MAX_IMAGES ? "text-gray-500 cursor-not-allowed" : "text-blue-400 cursor-pointer"}`}>
                        {uploadingNegativeImages ? "Uploading..." : "Add image(s)"}
                        <input type="file" accept="image/*" multiple className="hidden" disabled={!algorithmId || negativeImages.length >= NEGATIVE_REFERENCE_MAX_IMAGES || uploadingNegativeImages} onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          void onUploadNegativeImages(files);
                          e.currentTarget.value = "";
                        }} />
                      </label>
                      <span className="text-[11px] text-gray-500">{negativeImages.length}/{NEGATIVE_REFERENCE_MAX_IMAGES}</span>
                    </div>
                    {!algorithmId ? <p className="text-[11px] text-amber-400">Save agent first to upload images.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {negativeImages.map((img) => (
                        <div key={img.id} className={`relative h-14 w-14 rounded overflow-hidden border ${selectedNegativeImageIds.includes(img.id) ? "border-amber-400" : "border-gray-700"}`}>
                          <button type="button" className="absolute inset-0 z-10" onClick={() => {
                            setSelectedNegativeImageIds((prev) => {
                              const set = new Set(prev);
                              if (set.has(img.id)) set.delete(img.id);
                              else set.add(img.id);
                              return Array.from(set);
                            });
                          }} />
                          <img src={img.image_url} alt="negative" className="h-full w-full object-cover" />
                          <button type="button" className="absolute top-0 right-0 z-20 bg-black/70 text-white text-[10px] px-1 leading-4" onClick={() => void onDeleteNegativeImage(img.id)}>x</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                </div>
                {enhancingPrompt ? (
                  <div className="absolute -inset-px z-20 rounded-xl bg-gray-950/55 backdrop-blur-[2px] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-gray-100">
                      <div className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
                        Enhancing...
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="px-8 py-4 border-t border-gray-700 bg-gray-800/70 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={enhancingPrompt || saving} className="px-3 py-1.5 rounded bg-gray-700 text-gray-100 text-sm">Cancel</button>
            <button type="button" onClick={() => void onEnhancePrompt()} disabled={enhancingPrompt || saving} data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorEnhance} className="px-3 py-1.5 rounded bg-gray-700 border border-white/85 hover:border-white disabled:border-white/35 text-white text-sm inline-flex items-center gap-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
              <Sparkles className="w-3.5 h-3.5" />
              {enhancingPrompt ? "Enhancing..." : "Enhance Prompt with AI"}
            </button>
            <button type="button" onClick={() => void onApplyAndSave()} disabled={enhancingPrompt || saving} data-onboarding-target={ONBOARDING_TARGETS.cameraAgentEditorSave} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">
              {saving ? "Saving..." : "Apply & Save"}
            </button>
          </div>

          {suggestion ? (
            <div className="absolute inset-0 z-20 bg-gray-950/65 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="w-full max-w-3xl max-h-[85vh] bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-gray-700">
                  <h5 className="text-base font-semibold text-gray-100">AI suggestion ready</h5>
                  <p className="text-xs text-gray-400 mt-1">Review and apply suggested prompt improvements.</p>
                </div>
                <div className="px-6 py-4 overflow-y-auto">
                  <div className={PROMPT_DOCUMENT_BLOCK_CLASS}>
                    <div className={PROMPT_DOCUMENT_SECTION_CLASS}>
                      <div className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading(t("jobs.promptEditor.promptCoreLabel"))}
                      </div>
                      <textarea
                        aria-label={t("jobs.promptEditor.promptCoreLabel")}
                        value={suggestion.prompt_template}
                        readOnly
                        rows={5}
                        className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      />
                    </div>
                    <div className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}>
                      <div className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading(t("jobs.promptEditor.alertConditionLabel"))}
                      </div>
                      <textarea
                        aria-label={t("jobs.promptEditor.alertConditionLabel")}
                        value={suggestion.alert_condition}
                        readOnly
                        rows={4}
                        className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      />
                    </div>
                    <div className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}>
                      <div className="font-mono text-[13px] font-semibold text-gray-100">
                        {formatPromptDocumentHeading(t("jobs.promptEditor.negativeConditionLabel"), {
                          optional: true,
                          optionalSuffix: localizedOptionalSuffix,
                        })}
                      </div>
                      <textarea
                        aria-label={`${t("jobs.promptEditor.negativeConditionLabel")}${localizedOptionalSuffix}`}
                        value={suggestion.negative_condition}
                        readOnly
                        rows={4}
                        className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                      />
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/70 flex justify-end gap-2">
                  <button type="button" onClick={() => setSuggestion(null)} className="px-3 py-1.5 rounded bg-gray-700 text-sm">Keep current</button>
                  <button type="button" onClick={() => { setFields((prev) => ({ ...prev, ...suggestion })); setSuggestion(null); }} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">Use suggested</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showRegionDialog ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center px-4 py-6">
          <button type="button" className="absolute inset-0 bg-black/55" onClick={() => setShowRegionDialog(false)} />
          <div className="relative w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
            <h5 className="text-sm font-semibold text-gray-100 mb-3">New polygon</h5>
            <div className="space-y-2">
              <input type="text" value={regionDialogLabel} onChange={(e) => setRegionDialogLabel(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm" placeholder="Region name" />
              <textarea value={regionDialogDescription} onChange={(e) => setRegionDialogDescription(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm" rows={3} placeholder="Description (optional)" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRegionDialog(false)} className="px-3 py-1.5 rounded bg-gray-700 text-sm">Cancel</button>
              <button type="button" onClick={onConfirmRegionDialog} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">Continue</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
const getVideoPackagingModeLabel = (mode: CameraVideoPackagingMode): string => {
  if (mode === "frame_sequence") return "High Resolution";
  if (mode === "mosaic_2x2") return "Standard Resolution";
  return "Compact Resolution";
};
