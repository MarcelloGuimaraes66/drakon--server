import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import Toast from "@/react-app/components/Toast";
import ConfirmDialog from "@/react-app/components/ConfirmDialog";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import { useCameraEvents } from "@/react-app/hooks/useCameraEvents";
import ScheduleBuilder from "@/react-app/components/ScheduleBuilder";
import {
  parseScheduleFromDescription,
  formatDateTimeLocal,
  ScheduleMode,
  ScheduleDay,
  getDefaultScheduleDays,
  validateScheduleConfig,
} from "@/react-app/utils/scheduleUtils";
import {
  Plus,
  Calendar,
  Clock,
  ChevronDown,
  ChevronRight,
  Camera,
  LayoutGrid,
  Users,
  Trash2,
  Check,
  AlertCircle,
  X,
  Edit2,
  Save,
  Search,
  Repeat,
  Copy,
  Sparkles,
  Maximize2,
  Minimize2,
  Play,
  StopCircle,
} from "lucide-react";
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
import { brand } from "@/shared/brand";

interface Job {
  id: number;
  name: string;
  description: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  created_at: string;
  schedule_mode?: string;
  timezone?: string;
  active_from?: string | null;
  active_until?: string | null;
  schedule_days?: ScheduleDay[];
  schedule_summary?: string;
  runtime_status?: 'running' | 'stopping' | 'stopped' | 'failed' | 'completed' | 'staled' | null;
  runtime_started_at_utc?: string | null;
  runtime_updated_at?: string | null;
}

interface Step {
  id: number;
  job_id: number;
  step_order: number;
  name: string;
  timeout_seconds: number;
  status: string;
  input_from_step_id: number | null;
  input_inject_key: string | null;
  on_missing_input: string;
  start_condition: string | null;
  start_condition_from_step_id: number | null;
  inference_groups?: string | InferenceGroup[] | null;
}

interface StepPipelineConfig {
  input_from_step_id: number;
  input_inject_keys: string[];
  target_camera_id?: number | null;
  target_camera_name?: string | null;
}

interface PipelineFormRow {
  id: string;
  input_from_step_id: string;
  input_inject_keys: string[];
  target_camera_id: string;
}

type PromptEditorFields = {
  prompt_template: string;
  alert_condition: string;
  negative_condition: string;
};

type PromptEnhanceSuggestion = PromptEditorFields & {
  model_name?: string;
  snapshot_source?: string;
  snapshot_ts_utc_iso?: string;
};

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

const parsePromptTemplate = (
  template: string,
  fallbackAlertCondition?: string | null
): PromptEditorFields => {
  const raw = String(template || "");
  const lower = raw.toLowerCase();

  const markerSpecs = [
    { key: "alert_condition" as const, marker: "alert_condition:" },
    { key: "negative_condition" as const, marker: "negative_condition:" },
  ];

  const positions = markerSpecs
    .map((spec) => ({ ...spec, index: lower.lastIndexOf(spec.marker) }))
    .filter((spec) => spec.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (positions.length === 0) {
    return {
      prompt_template: raw,
      alert_condition: String(fallbackAlertCondition || "").trim(),
      negative_condition: "",
    };
  }

  const parsed: PromptEditorFields = {
    prompt_template: raw.slice(0, positions[0].index).trimEnd(),
    alert_condition: "",
    negative_condition: "",
  };

  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const start = current.index + current.marker.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : raw.length;
    const value = raw.slice(start, end).trim();
    if (current.key === "alert_condition") {
      parsed.alert_condition = value;
    } else {
      parsed.negative_condition = value;
    }
  }

  if (!parsed.alert_condition && fallbackAlertCondition) {
    parsed.alert_condition = String(fallbackAlertCondition).trim();
  }

  return parsed;
};

const buildPromptTemplate = (fields: PromptEditorFields): string => {
  const core = String(fields.prompt_template || "").trim();
  const alertCondition = String(fields.alert_condition || "").trim();
  const negativeCondition = String(fields.negative_condition || "").trim();

  const chunks: string[] = [];
  if (core) chunks.push(core);
  if (alertCondition) chunks.push(`alert_condition: ${alertCondition}`);
  if (negativeCondition) chunks.push(`negative_condition: ${negativeCondition}`);

  return chunks.join("\n\n").trim();
};

const readApiResponseBody = async (response: Response): Promise<Record<string, any> | null> => {
  try {
    const raw = (await response.text()).trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, any>;
      }
      return { message: String(parsed) };
    } catch {
      return { message: raw };
    }
  } catch {
    return null;
  }
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const sanitizeRegionId = (value: unknown, fallbackIndex: number): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized.slice(0, 64);
  return `region-${fallbackIndex + 1}`;
};

const hasPolygonPoints = (region: AnalysisRegion | null | undefined): boolean =>
  !!region &&
  region.full_frame !== true &&
  Array.isArray(region.polygon_norm) &&
  region.polygon_norm.length >= ANALYSIS_REGION_MIN_POINTS;

const toSvgPoints = (points: AnalysisRegionPoint[]): string =>
  points
    .map(
      (point) =>
        `${Math.round(clamp01(point.x) * 1000) / 10},${Math.round(clamp01(point.y) * 1000) / 10}`
    )
    .join(" ");

const buildRectPolygonFromPoints = (
  start: AnalysisRegionPoint,
  end: AnalysisRegionPoint
): AnalysisRegionPoint[] => {
  const x1 = clamp01(Math.min(start.x, end.x));
  const y1 = clamp01(Math.min(start.y, end.y));
  const x2 = clamp01(Math.max(start.x, end.x));
  const y2 = clamp01(Math.max(start.y, end.y));
  if (Math.abs(x2 - x1) < 0.002 || Math.abs(y2 - y1) < 0.002) return [];
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
};

const pointInPolygon = (point: AnalysisRegionPoint, polygon: AnalysisRegionPoint[]): boolean => {
  if (!Array.isArray(polygon) || polygon.length < ANALYSIS_REGION_MIN_POINTS) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = clamp01(polygon[i].x);
    const yi = clamp01(polygon[i].y);
    const xj = clamp01(polygon[j].x);
    const yj = clamp01(polygon[j].y);
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 0.000001) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const getPolygonCentroid = (polygon: AnalysisRegionPoint[]): AnalysisRegionPoint => {
  if (!Array.isArray(polygon) || polygon.length === 0) return { x: 0.5, y: 0.5 };
  const acc = polygon.reduce(
    (sum, pt) => ({
      x: sum.x + clamp01(pt.x),
      y: sum.y + clamp01(pt.y),
    }),
    { x: 0, y: 0 }
  );
  return {
    x: clamp01(acc.x / polygon.length),
    y: clamp01(acc.y / polygon.length),
  };
};

const buildDefaultAnalysisRegion = (
  fields: PromptEditorFields,
  faceTargetIds: number[],
  negativeImageIds: number[],
  index = 0
): AnalysisRegion => ({
  region_id: index === 0 ? "full-frame" : `region-${index + 1}`,
  label: index === 0 ? "Full frame" : `Region ${index + 1}`,
  description: "",
  enabled: true,
  full_frame: true,
  polygon_norm: [],
  draw_ref_width: ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH,
  draw_ref_height: ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT,
  context_padding_pct: 0,
  prompt_core: String(fields.prompt_template || "").trim(),
  alert_condition: String(fields.alert_condition || "").trim(),
  negative_condition: String(fields.negative_condition || "").trim(),
  face_target_ids: Array.from(new Set(faceTargetIds.filter((id) => Number.isInteger(id) && id > 0))),
  negative_image_ids: Array.from(
    new Set(negativeImageIds.filter((id) => Number.isInteger(id) && id > 0))
  ),
});

const normalizeAnalysisRegionsForForm = (
  regionsRaw: unknown,
  fallbackFields: PromptEditorFields,
  faceTargetIds: number[],
  negativeImageIds: number[]
): AnalysisRegion[] => {
  if (!Array.isArray(regionsRaw) || regionsRaw.length === 0) {
    return [buildDefaultAnalysisRegion(fallbackFields, faceTargetIds, negativeImageIds, 0)];
  }
  const regions: AnalysisRegion[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < regionsRaw.length && regions.length < ANALYSIS_REGION_MAX; i += 1) {
    const row = regionsRaw[i] as any;
    if (!row || typeof row !== "object") continue;
    const regionId = sanitizeRegionId(row?.region_id ?? row?.regionId, i);
    if (seenIds.has(regionId)) continue;
    seenIds.add(regionId);
    const pointsRaw = Array.isArray(row?.polygon_norm)
      ? row.polygon_norm
      : Array.isArray(row?.polygonNorm)
      ? row.polygonNorm
      : [];
    const points = pointsRaw
      .map((point: any) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          x: clamp01(x),
          y: clamp01(y),
        } as AnalysisRegionPoint;
      })
      .filter(Boolean) as AnalysisRegionPoint[];
    const boundedPoints =
      points.length > ANALYSIS_REGION_MAX_POINTS
        ? points.slice(0, ANALYSIS_REGION_MAX_POINTS)
        : points;
    const fullFrameRaw = row?.full_frame ?? row?.fullFrame;
    const fullFrame =
      typeof fullFrameRaw === "boolean"
        ? fullFrameRaw
        : typeof fullFrameRaw === "number"
        ? fullFrameRaw !== 0
        : boundedPoints.length < ANALYSIS_REGION_MIN_POINTS;

    const regionFaceTargetIdsRaw = row?.face_target_ids ?? row?.faceTargetIds;
    const regionFaceTargetIds = Array.isArray(regionFaceTargetIdsRaw)
      ? Array.from(
          new Set(
            regionFaceTargetIdsRaw
              .map((v: unknown) => Number(v))
              .filter((v: number) => Number.isInteger(v) && v > 0)
          )
        )
      : faceTargetIds;
    const regionNegativeImageIdsRaw = row?.negative_image_ids ?? row?.negativeImageIds;
    const regionNegativeImageIds = Array.isArray(regionNegativeImageIdsRaw)
      ? Array.from(
          new Set(
            regionNegativeImageIdsRaw
              .map((v: unknown) => Number(v))
              .filter((v: number) => Number.isInteger(v) && v > 0)
          )
        )
      : negativeImageIds;
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
      full_frame: fullFrame || boundedPoints.length < ANALYSIS_REGION_MIN_POINTS,
      polygon_norm:
        fullFrame || boundedPoints.length < ANALYSIS_REGION_MIN_POINTS ? [] : boundedPoints,
      draw_ref_width: Math.max(
        1,
        Math.round(Number(row?.draw_ref_width ?? row?.drawRefWidth ?? 1920))
      ),
      draw_ref_height: Math.max(
        1,
        Math.round(Number(row?.draw_ref_height ?? row?.drawRefHeight ?? 1080))
      ),
      context_padding_pct: 0,
      prompt_core:
        typeof row?.prompt_core === "string"
          ? row.prompt_core
          : typeof row?.prompt_template === "string"
          ? row.prompt_template
          : fallbackFields.prompt_template,
      alert_condition:
        typeof row?.alert_condition === "string"
          ? row.alert_condition
          : typeof row?.alertCondition === "string"
          ? row.alertCondition
          : fallbackFields.alert_condition,
      negative_condition:
        typeof row?.negative_condition === "string"
          ? row.negative_condition
          : typeof row?.negativeCondition === "string"
          ? row.negativeCondition
          : fallbackFields.negative_condition,
      face_target_ids: regionFaceTargetIds,
      negative_image_ids: regionNegativeImageIds,
    });
  }
  if (regions.length === 0) {
    return [buildDefaultAnalysisRegion(fallbackFields, faceTargetIds, negativeImageIds, 0)];
  }
  return regions;
};

const extractNegativeImageIdsFromImages = (images: NegativeReferenceImage[] | null | undefined): number[] => {
  if (!Array.isArray(images)) return [];
  return Array.from(
    new Set(
      images
        .map((img) => Number(img?.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
};

const normalizeAnalysisRegionsForPayload = (
  regionsRaw: unknown,
  fallbackFields: PromptEditorFields,
  faceTargetIds: number[],
  negativeImageIds: number[]
): AnalysisRegion[] => {
  const normalized = normalizeAnalysisRegionsForForm(
    regionsRaw,
    fallbackFields,
    faceTargetIds,
    negativeImageIds
  );

  return normalized.map((region, index) => {
    const regionId = sanitizeRegionId(region.region_id, index);
    const points = (Array.isArray(region.polygon_norm) ? region.polygon_norm : [])
      .map((point) => ({
        x: clamp01(Number(point?.x)),
        y: clamp01(Number(point?.y)),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .slice(0, ANALYSIS_REGION_MAX_POINTS);
    const fullFrame = Boolean(region.full_frame) || points.length < ANALYSIS_REGION_MIN_POINTS;
    return {
      region_id: regionId,
      label: String(region.label || "").trim() || `Region ${index + 1}`,
      description: String(region.description || "").trim(),
      enabled: region.enabled !== false,
      full_frame: fullFrame,
      polygon_norm: fullFrame ? [] : points,
      draw_ref_width: Math.max(1, Math.round(Number(region.draw_ref_width) || ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH)),
      draw_ref_height: Math.max(1, Math.round(Number(region.draw_ref_height) || ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT)),
      context_padding_pct: 0,
      prompt_core: String(region.prompt_core || "").trim(),
      alert_condition: String(region.alert_condition || "").trim(),
      negative_condition: String(region.negative_condition || "").trim(),
      face_target_ids: Array.from(
        new Set(
          (Array.isArray(region.face_target_ids) ? region.face_target_ids : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      ),
      negative_image_ids: Array.from(
        new Set(
          (Array.isArray(region.negative_image_ids) ? region.negative_image_ids : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      ),
    };
  });
};

const collectFaceTargetIdsFromRegions = (regions: AnalysisRegion[]): number[] => {
  return Array.from(
    new Set(
      regions.flatMap((region) =>
        (Array.isArray(region.face_target_ids) ? region.face_target_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    )
  );
};

const normalizePipelineKeys = (keys: any[]): string[] => {
  const normalized = keys
    .map((k) => (k == null ? "" : String(k)).trim())
    .filter((k) => k.length > 0);
  return Array.from(new Set(normalized));
};

const normalizeTargetInputType = (value: unknown): TargetInputType => {
  if (typeof value !== "string") return "video";
  const normalized = value.trim().toLowerCase();
  return normalized === "image" ? "image" : "video";
};

const FIXED_AGENT_INFERENCE_MODEL = "ultra" as const;

const normalizeAgentInferenceModel = (value: unknown): AgentInferenceModel => {
  if (typeof value !== "string") return FIXED_AGENT_INFERENCE_MODEL;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "legacy" ||
    normalized === "pro" ||
    normalized === "light" ||
    normalized === "ultra" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return FIXED_AGENT_INFERENCE_MODEL;
};

const normalizeAgentRunningResolution = (
  value: unknown,
  fallback: AgentRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
): AgentRunningResolution => {
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

const normalizeAgentOnlyCaptureOnMotion = (value: unknown): boolean => {
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
  return true;
};

const normalizeAgentUseTemporalContext = (value: unknown): boolean => {
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
  return true;
};

const JOBS_TEMPORAL_CONTEXT_TOGGLE_ENABLED = brand.id === "drakon";
const DEFAULT_AGENT_USE_TEMPORAL_CONTEXT = true;

const parseInferenceGroups = (raw: unknown): InferenceGroup[] => {
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

  const groups: InferenceGroup[] = [];
  for (const item of parsed) {
    const row = item as any;
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const agentKey = typeof row?.agentKey === "string" ? row.agentKey.trim() : "";
    const targetIdsRaw = Array.isArray(row?.targetIds) ? row.targetIds : [];
    const targetIds = Array.from(
      new Set<number>(
        targetIdsRaw
          .map((v: unknown) => Number(v))
          .filter((v: number) => Number.isInteger(v) && v > 0)
      )
    );
    const inputType = normalizeTargetInputType(row?.inputType);
    const priorityLevel = normalizeAgentPriority(
      typeof row?.priority_level === "string" ? row.priority_level : row?.priorityLevel
    );
    const inferenceModel = normalizeAgentInferenceModel(
      typeof row?.inference_model === "string" ? row.inference_model : row?.inferenceModel
    );
    const requestedModelFps = normalizeAgentModelFps(
      typeof row?.model_fps === "number" ? row.model_fps : row?.modelFps
    );
    const requestedRunEvery = normalizeAgentRunEverySeconds(
      row?.run_every ?? row?.runEvery,
      FIXED_AGENT_RUN_EVERY_SECONDS
    );
    const requestedRunningResolution =
      normalizeAgentInferenceModel(
        typeof row?.inference_model === "string" ? row.inference_model : row?.inferenceModel
      ) === "core"
        ? normalizeAgentRunningResolution(
            row?.running_resolution ?? row?.runningResolution,
            DEFAULT_CORE_RUNNING_RESOLUTION
          )
        : null;
    const execution = applyAgentExecutionConstraints(
      inputType,
      inferenceModel,
      requestedRunEvery,
      requestedRunningResolution,
      requestedModelFps
    );
    const onlyCaptureOnMotion = normalizeAgentOnlyCaptureOnMotion(
      row?.only_capture_on_motion ?? row?.onlyCaptureOnMotion
    );
    const videoPackagingMode = normalizeAgentVideoPackagingMode(
      row?.video_packaging_mode ?? row?.videoPackagingMode
    );
    if (!id || !agentKey || targetIds.length === 0) continue;
    const sourceTargetIdRaw = row?.source_target_id ?? row?.sourceTargetId;
    const sourceTargetId = Number(sourceTargetIdRaw);
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
              .map((regionId: unknown) => sanitizeRegionId(regionId, 0))
              .filter((regionId: string) => regionId.length > 0)
          )
        );
        return {
          target_id: targetId,
          region_ids: regionIds,
        };
      })
      .filter(Boolean) as Array<{ target_id: number; region_ids: string[] }>;
    const analysisRegions = normalizeAnalysisRegionsForForm(
      row?.analysis_regions ?? row?.analysisRegions,
      {
        prompt_template: "",
        alert_condition: "",
        negative_condition: "",
      },
      [],
      []
    );
    groups.push({
      id,
      name: name || `Group ${groups.length + 1}`,
      targetIds,
      agentKey,
      inputType: execution.inputType,
      video_packaging_mode: videoPackagingMode,
      priority_level: priorityLevel,
      inference_model: execution.inferenceModel,
      model_fps: execution.modelFps,
      run_every: execution.runEvery,
      running_resolution: execution.runningResolution,
      only_capture_on_motion: onlyCaptureOnMotion,
      source_target_id: Number.isInteger(sourceTargetId) && sourceTargetId > 0 ? sourceTargetId : null,
      analysis_bindings: analysisBindings,
      analysis_regions: analysisRegions,
    });
  }
  return groups;
};

const parsePipelinesFromStep = (step: Step): StepPipelineConfig[] => {
  const raw = step.input_inject_key;
  if (raw && typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("start:") && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : parsed?.pipelines;
        if (Array.isArray(arr)) {
          const pipelines = arr
            .map((p) => {
              const fromStepId = Number(p?.input_from_step_id);
              if (!Number.isFinite(fromStepId)) return null;
              const keys = normalizePipelineKeys(
                Array.isArray(p?.input_inject_keys)
                  ? p.input_inject_keys
                  : p?.input_inject_key
                  ? [p.input_inject_key]
                  : []
              );
              if (keys.length === 0) return null;
              const targetCameraIdRaw = p?.target_camera_id;
              const targetCameraId =
                targetCameraIdRaw === null || targetCameraIdRaw === undefined || targetCameraIdRaw === ""
                  ? null
                  : Number(targetCameraIdRaw);
              const targetCameraNameRaw = p?.target_camera_name;
              const targetCameraName =
                typeof targetCameraNameRaw === "string" ? targetCameraNameRaw.trim() : null;
              return {
                input_from_step_id: fromStepId,
                input_inject_keys: keys,
                target_camera_id: Number.isFinite(targetCameraId) ? targetCameraId : null,
                target_camera_name: targetCameraName || null,
              };
            })
            .filter(Boolean) as StepPipelineConfig[];
          if (pipelines.length > 0) return pipelines;
        }
      } catch {
        // Ignore JSON parse errors, fall back to legacy fields
      }
    }
  }

  if (
    step.input_from_step_id != null &&
    step.input_inject_key &&
    typeof step.input_inject_key === "string" &&
    step.input_inject_key.trim() !== "" &&
    !step.input_inject_key.startsWith("start:")
  ) {
    return [
      {
        input_from_step_id: step.input_from_step_id,
        input_inject_keys: [step.input_inject_key],
        target_camera_id: null,
      },
    ];
  }

  return [];
};

const buildPipelineFormRows = (pipelines: StepPipelineConfig[], stepId: number): PipelineFormRow[] => {
  if (!pipelines.length) {
    return [
      {
        id: `pipeline-${stepId}-0`,
        input_from_step_id: "",
        input_inject_keys: [],
        target_camera_id: "",
      },
    ];
  }
  return pipelines.map((p, idx) => ({
    id: `pipeline-${stepId}-${idx}-${p.input_from_step_id}`,
    input_from_step_id: String(p.input_from_step_id),
    input_inject_keys: [...p.input_inject_keys],
    target_camera_id: p.target_camera_id != null ? String(p.target_camera_id) : "",
  }));
};

interface Target {
  id: number;
  step_id: number;
  camera_id: number;
  camera_name?: string;
  input_type?: string | null;
}

type TargetInputType = "video" | "image";
type AgentInferenceModel = "legacy" | "pro" | "ultra" | "light" | "core";
type AgentRunEverySeconds = 10 | 60;
type AgentRunningResolution = 640 | 1024;
type AgentVideoPackagingMode = "mosaic_2x2" | "mosaic_3x3" | "frame_sequence";
const FIXED_AGENT_RUN_EVERY_SECONDS: AgentRunEverySeconds = 60;
const DEFAULT_CORE_RUNNING_RESOLUTION: AgentRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const MIN_STEP_TIMEOUT_SECONDS = 120;
const DEFAULT_AGENT_VIDEO_PACKAGING_MODE: AgentVideoPackagingMode = "mosaic_2x2";

interface InferenceGroup {
  id: string;
  name: string;
  targetIds: number[];
  agentKey: string;
  inputType: TargetInputType;
  video_packaging_mode: AgentVideoPackagingMode;
  priority_level?: AgentPriority | null;
  inference_model?: AgentInferenceModel;
  model_fps?: number;
  run_every: AgentRunEverySeconds;
  running_resolution?: AgentRunningResolution | null;
  only_capture_on_motion?: boolean;
  source_target_id?: number | null;
  analysis_bindings?: Array<{
    target_id: number;
    region_ids: string[];
  }>;
  analysis_regions?: AnalysisRegion[];
}

type AgentPriority = "CRITIC" | "HIGH" | "MEDIUM" | "LOW";

interface GroupAgentSourceOption {
  targetId: number;
  cameraId: number;
  cameraLabel: string;
  agentKey: string;
  label: string;
  inputType: TargetInputType;
  priorityLevel: AgentPriority;
  inferenceModel: AgentInferenceModel;
  modelFps: number;
  runEvery: AgentRunEverySeconds;
  runningResolution: AgentRunningResolution | null;
  onlyCaptureOnMotion: boolean;
  videoPackagingMode: AgentVideoPackagingMode;
}

const AGENT_RUN_EVERY_OPTIONS: ReadonlyArray<AgentRunEverySeconds> = [60, 10];

const normalizeAgentRunEverySeconds = (
  value: unknown,
  fallback: AgentRunEverySeconds = FIXED_AGENT_RUN_EVERY_SECONDS
): AgentRunEverySeconds => {
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
  const normalizeSeconds = (candidate: unknown): AgentRunEverySeconds | null => {
    const parsed = parseSeconds(candidate);
    if (parsed === null || parsed <= 0) return null;
    return parsed <= 10 ? 10 : 60;
  };
  return normalizeSeconds(value) ?? normalizeSeconds(fallback) ?? FIXED_AGENT_RUN_EVERY_SECONDS;
};

const normalizeAgentModelFps = (
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
  return normalizeAgentModelFps(fallback, DEFAULT_ULTRA_VIDEO_MODEL_FPS);
};

const normalizeAgentVideoPackagingMode = (
  value: unknown,
  fallback: AgentVideoPackagingMode = DEFAULT_AGENT_VIDEO_PACKAGING_MODE
): AgentVideoPackagingMode => {
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

const getAgentVideoPackagingModeLabel = (mode: AgentVideoPackagingMode): string => {
  if (mode === "frame_sequence") return "High Resolution";
  if (mode === "mosaic_2x2") return "Standard Resolution";
  return "Compact Resolution";
};

const supportsAdjustableAgentVideoFps = (inferenceModel: AgentInferenceModel): boolean =>
  inferenceModel === "ultra" || inferenceModel === "light";

const applyAgentExecutionConstraints = (
  inputType: TargetInputType,
  inferenceModel: AgentInferenceModel,
  runEvery: AgentRunEverySeconds,
  runningResolution: AgentRunningResolution | null | undefined,
  modelFps: number | null | undefined
): {
  inputType: TargetInputType;
  inferenceModel: AgentInferenceModel;
  runEvery: AgentRunEverySeconds;
  runningResolution: AgentRunningResolution | null;
  modelFps: number;
} => {
  if (inferenceModel === "core") {
    return {
      inputType: "video",
      inferenceModel,
      runEvery: 60,
      runningResolution: normalizeAgentRunningResolution(
        runningResolution,
        DEFAULT_CORE_RUNNING_RESOLUTION
      ),
      modelFps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
    };
  }

  const normalizedInputType = inputType === "image" ? "image" : "video";
    return {
      inputType: normalizedInputType,
      inferenceModel,
      runEvery: normalizeAgentRunEverySeconds(runEvery, FIXED_AGENT_RUN_EVERY_SECONDS),
      runningResolution: null,
      modelFps:
      supportsAdjustableAgentVideoFps(inferenceModel) && normalizedInputType === "video"
        ? normalizeAgentModelFps(modelFps)
        : DEFAULT_ULTRA_VIDEO_MODEL_FPS,
    };
};

const normalizeAgentPriority = (value: unknown): AgentPriority => {
  if (typeof value !== "string") return "MEDIUM";
  const normalized = value.trim().toUpperCase();
  if (normalized === "MEDUIM") return "MEDIUM";
  if (normalized === "CRITIC" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
    return normalized;
  }
  return "MEDIUM";
};

const parseHHMMToMinutes = (value: string): number | null => {
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec((value || "").trim());
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
};

const getScheduleWindowDurationSeconds = (start: string, end: string): number | null => {
  const startMinutes = parseHHMMToMinutes(start);
  const endMinutes = parseHHMMToMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;
  return (endMinutes - startMinutes) * 60;
};

const getJobMaxStepTimeoutSeconds = (job: Job | null): number | null => {
  if (!job) return null;

  const scheduleDays = Array.isArray(job.schedule_days) ? job.schedule_days : [];
  const recurringDurations = scheduleDays.flatMap((day) =>
    (day?.windows || [])
      .map((window) =>
        getScheduleWindowDurationSeconds(window.start_time, window.end_time)
      )
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0
      )
  );

  if (recurringDurations.length > 0) {
    // Use shortest enabled window to guarantee every run can respect the timeout.
    return Math.min(...recurringDurations);
  }

  if (job.start_at && job.end_at) {
    const startMs = Date.parse(job.start_at);
    const endMs = Date.parse(job.end_at);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return Math.floor((endMs - startMs) / 1000);
    }
  }

  return null;
};

const normalizeTimeoutForHourMinuteUi = (timeoutSeconds: number): number => {
  const numeric = Number(timeoutSeconds);
  if (!Number.isFinite(numeric)) return MIN_STEP_TIMEOUT_SECONDS;
  return Math.max(
    MIN_STEP_TIMEOUT_SECONDS,
    Math.ceil(Math.max(0, numeric) / 60) * 60
  );
};

const timeoutSecondsToHourMinuteParts = (timeoutSeconds: number): { hours: number; minutes: number } => {
  const normalizedSeconds = normalizeTimeoutForHourMinuteUi(timeoutSeconds);
  const totalMinutes = Math.floor(normalizedSeconds / 60);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
};

const hourMinutePartsToTimeoutSeconds = (hours: number, minutes: number): number => {
  const safeHours = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const safeMinutesRaw = Number.isFinite(minutes) ? Math.floor(minutes) : 0;
  const safeMinutes = Math.min(59, Math.max(0, safeMinutesRaw));
  return Math.max(MIN_STEP_TIMEOUT_SECONDS, (safeHours * 60 + safeMinutes) * 60);
};

const parseNonNegativeIntegerInput = (value: string): number => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const formatStepTimeoutHuman = (timeoutSeconds: number): string => {
  const normalizedSeconds = normalizeTimeoutForHourMinuteUi(timeoutSeconds);
  const totalMinutes = Math.floor(normalizedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

interface Agent {
  id: number;
  step_id: number;
  agent_key: string;
  prompt_template: string;
  alert_condition?: string | null;
  params: string;
  input_schema: string;
  is_active: number;
  camera_id?: number | null;
  priority_level?: AgentPriority;
  inference_model?: AgentInferenceModel;
  model_fps?: number;
  run_every?: AgentRunEverySeconds;
  running_resolution?: AgentRunningResolution | null;
  video_packaging_mode?: AgentVideoPackagingMode | string | null;
  only_capture_on_motion?: boolean;
  use_temporal_context?: boolean;
  face_target_ids?: number[];
  negative_reference_images?: NegativeReferenceImage[];
  analysis_regions?: AnalysisRegion[];
}

interface CloneCandidate {
  cameraId: number;
  cameraName: string;
  agent: Agent;
}

interface AlertRule {
  id: number;
  step_id: number;
  condition_expr: string;
  channel: string;
  channel_params: string;
  message_template: string;
}

interface Camera {
  id: number;
  name: string;
  thumbnail_url?: string | null;
  last_thumbnail_update?: string | null;
  is_service_running?: number;
}

interface FaceTargetImage {
  id: number;
  image_url: string;
}

interface NegativeReferenceImage {
  id: number;
  image_url: string;
}

interface AnalysisRegionPoint {
  x: number;
  y: number;
}

interface AnalysisRegion {
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

interface FaceTarget {
  id: number;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  image_count: number;
  images: FaceTargetImage[];
}

interface AgentFormState {
  agent_key: string;
  prompt_template: string;
  alert_condition: string;
  negative_condition: string;
  params: string;
  input_schema: string;
  priority_level: AgentPriority;
  inference_model: AgentInferenceModel;
  model_fps: number;
  run_every: AgentRunEverySeconds;
  running_resolution: AgentRunningResolution | null;
  video_packaging_mode: AgentVideoPackagingMode;
  only_capture_on_motion: boolean;
  use_temporal_context: boolean;
  face_target_ids: number[];
  negative_reference_images: NegativeReferenceImage[];
  analysis_regions: AnalysisRegion[];
}

const FACE_TARGET_MAX_IMAGES = 4;
const NEGATIVE_REFERENCE_MAX_IMAGES = 3;
const ANALYSIS_REGION_MAX = 6;
const ANALYSIS_REGION_MIN_POINTS = 3;
const ANALYSIS_REGION_MAX_POINTS = 20;
const ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH = 1920;
const ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT = 1080;
const PROMPT_EDITOR_SNAPSHOT_REFRESH_COOLDOWN_MS = 3000;

const buildEmptyAgentForm = (): AgentFormState => ({
  agent_key: "",
  prompt_template: "",
  alert_condition: "",
  negative_condition: "",
  params: "{}",
  input_schema: "{}",
  priority_level: "MEDIUM",
  inference_model: FIXED_AGENT_INFERENCE_MODEL,
  model_fps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  run_every: FIXED_AGENT_RUN_EVERY_SECONDS,
  running_resolution: null,
  video_packaging_mode: DEFAULT_AGENT_VIDEO_PACKAGING_MODE,
  only_capture_on_motion: false,
  use_temporal_context: DEFAULT_AGENT_USE_TEMPORAL_CONTEXT,
  face_target_ids: [],
  negative_reference_images: [],
  analysis_regions: [
    buildDefaultAnalysisRegion(
      { prompt_template: "", alert_condition: "", negative_condition: "" },
      [],
      [],
      0
    ),
  ],
});

const getFaceTargetImageCount = (target: FaceTarget | null | undefined): number => {
  if (!target) return 0;
  const dbCount = Number.isFinite(Number(target.image_count)) ? Number(target.image_count) : 0;
  const localCount = Array.isArray(target.images) ? target.images.length : 0;
  return Math.max(0, Math.max(dbCount, localCount));
};

const getNegativeReferenceImageCount = (
  images: NegativeReferenceImage[] | null | undefined
): number => {
  if (!Array.isArray(images)) return 0;
  return images.filter((img) => Number.isInteger(Number(img?.id)) && String(img?.image_url || "").trim()).length;
};

export default function JobsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [_scheduleMode, _setScheduleMode] = useState<"recurring">("recurring");
  const [recurringMode, setRecurringMode] = useState<ScheduleMode>("weekly");
  const [newJob, setNewJob] = useState({
    name: "",
    description: "",
  });
  const [isCreateScheduleVisible, setIsCreateScheduleVisible] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>(getDefaultScheduleDays("weekly"));
  const [activeFrom, setActiveFrom] = useState("");
  const [activeUntil, setActiveUntil] = useState("");
  const [showNewStepForm, setShowNewStepForm] = useState(false);
  const [newStep, setNewStep] = useState({
    name: "",
    step_order: 1,
    timeout_seconds: 300,
  });
  const [editingJob, setEditingJob] = useState(false);
  const [editJobForm, setEditJobForm] = useState({
    start_at: "",
    end_at: "",
  });
  const [editScheduleMode, setEditScheduleMode] = useState<"one-time" | "recurring">("recurring");
  const [editRecurringMode, setEditRecurringMode] = useState<ScheduleMode>("weekly");
  const [editScheduleDays, setEditScheduleDays] = useState<ScheduleDay[]>([]);
  const [editActiveFrom, setEditActiveFrom] = useState("");
  const [editActiveUntil, setEditActiveUntil] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalTimezone, setGlobalTimezone] = useState<string>("UTC");
  const [startingJobIds, setStartingJobIds] = useState<Set<number>>(new Set());
  const [stoppingJobIds, setStoppingJobIds] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "warning" | "info" } | null>(null);
  const { toasts: cameraEventToasts, dismissToast: dismissCameraEventToast } = useCameraEvents(cameras);
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; jobId: number | null }>({
    isOpen: false,
    jobId: null,
  });
  const [confirmDeleteStep, setConfirmDeleteStep] = useState<{ isOpen: boolean; stepId: number | null }>({
    isOpen: false,
    stepId: null,
  });
  const selectedJobMaxTimeoutSeconds = useMemo(
    () => getJobMaxStepTimeoutSeconds(selectedJob),
    [selectedJob]
  );
  const locale = useMemo(
    () => (i18n.resolvedLanguage || i18n.language || "en").replace("_", "-"),
    [i18n.resolvedLanguage, i18n.language]
  );
  const createScheduleCopy = useMemo(() => {
    if (locale.startsWith("pt")) {
      return {
        show: "Abrir agendamento",
        hide: "Ocultar agendamento",
        hiddenHint: "O agendamento começa oculto. Digite o nome da tarefa ou abra aqui.",
      };
    }
    if (locale.startsWith("es")) {
      return {
        show: "Abrir horario",
        hide: "Ocultar horario",
        hiddenHint: "El horario empieza oculto. Escribe un nombre para la tarea o abrelo aqui.",
      };
    }
    if (locale.startsWith("fr")) {
      return {
        show: "Ouvrir le planning",
        hide: "Masquer le planning",
        hiddenHint: "Le planning commence masque. Saisissez le nom de la tache ou ouvrez-le ici.",
      };
    }
    return {
      show: "Open schedule",
      hide: "Hide schedule",
      hiddenHint: "Schedule starts hidden. Type a job name or open it here.",
    };
  }, [locale]);
  const listActionCopy = useMemo(() => {
    if (locale.startsWith("pt")) {
      return {
        start: "Iniciar",
        starting: "Iniciando",
        startedMessage: "Job iniciado com sucesso.",
        alreadyRunningMessage: "Job ja esta rodando.",
        failedMessage: "Falha ao iniciar job",
        unavailableMessage: "O backend precisa ser reiniciado para habilitar este Start.",
      };
    }
    if (locale.startsWith("es")) {
      return {
        start: "Iniciar",
        starting: "Iniciando",
        startedMessage: "Trabajo iniciado correctamente.",
        alreadyRunningMessage: "El trabajo ya esta en ejecucion.",
        failedMessage: "No se pudo iniciar el trabajo",
        unavailableMessage: "El backend debe reiniciarse para habilitar este inicio manual.",
      };
    }
    if (locale.startsWith("fr")) {
      return {
        start: "Demarrer",
        starting: "Demarrage",
        startedMessage: "Job demarre avec succes.",
        alreadyRunningMessage: "Le job est deja en cours.",
        failedMessage: "Impossible de demarrer le job",
        unavailableMessage: "Le backend doit etre redemarre pour activer ce demarrage manuel.",
      };
    }
    return {
      start: "Start",
      starting: "Starting",
      startedMessage: "Job started successfully.",
      alreadyRunningMessage: "Job is already running.",
      failedMessage: "Failed to start job",
      unavailableMessage: "The backend needs to be restarted to enable this Start action.",
    };
  }, [locale]);
  useEffect(() => {
    const trimmedName = newJob.name.trim();
    if (trimmedName) {
      setIsCreateScheduleVisible(true);
    } else {
      setIsCreateScheduleVisible(false);
    }
  }, [newJob.name]);

  const setSelectedJobSearchParam = (jobId: number | null) => {
    const currentValue = searchParams.get("job");
    const nextValue = jobId && Number.isInteger(jobId) && jobId > 0 ? String(jobId) : null;

    if (currentValue === nextValue || (!currentValue && !nextValue)) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (nextValue) {
      nextParams.set("job", nextValue);
    } else {
      nextParams.delete("job");
    }
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    fetchJobs();
    fetchCameras();
    fetchGlobalTimezone();
  }, []);

  const fetchJobs = async () => {
    try {
      const response = await fetch("/api/jobs");
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCameras = async () => {
    try {
      const response = await fetch("/api/cameras");
      if (response.ok) {
        const data = await response.json();
        setCameras(data || []);
      }
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    }
  };

  const fetchGlobalTimezone = async () => {
    try {
      const response = await fetch("/api/pairing/status");
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data?.timezone_iana === "string" && data.timezone_iana.trim().length > 0) {
        setGlobalTimezone(data.timezone_iana);
      }
    } catch (error) {
      console.error("Failed to fetch global timezone:", error);
    }
  };

  const fetchSteps = async (jobId: number): Promise<Step[]> => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/steps`);
      if (response.ok) {
        const data = await response.json();
        const nextSteps = data.steps || [];
        setSteps(nextSteps);
        return nextSteps;
      }
    } catch (error) {
      console.error("Failed to fetch steps:", error);
    }
    return [];
  };

  const handleOpenJob = async (job: Job) => {
    setSelectedJobSearchParam(job.id);
    setSelectedJob(job);
    await fetchSteps(job.id);
    setShowNewStepForm(false);
    
    // Initialize edit form with current job data
    if (job.schedule_mode === "weekly" || job.schedule_mode === "monthly" || job.schedule_mode === "yearly") {
      // Load from database schedule_days
      setEditScheduleMode("recurring");
      setEditRecurringMode(job.schedule_mode as ScheduleMode);
      setEditScheduleDays(job.schedule_days || []);
      setEditJobForm({ start_at: "", end_at: "" });
    } else if (job.schedule_mode === "one_shot") {
      // Legacy one-time job (view only, can switch to recurring)
      setEditScheduleMode("one-time");
      setEditJobForm({
        start_at: job.start_at ? formatDateTimeLocal(new Date(job.start_at)) : "",
        end_at: job.end_at ? formatDateTimeLocal(new Date(job.end_at)) : "",
      });
      setEditRecurringMode("weekly");
      setEditScheduleDays([]);
    } else {
      // Legacy job without schedule_mode - check description
      const { schedule } = parseScheduleFromDescription(job.description || "");
      if (schedule) {
        setEditScheduleMode("recurring");
        setEditRecurringMode("weekly");
        setEditScheduleDays([]);
      } else {
        setEditScheduleMode("one-time");
        setEditJobForm({
          start_at: job.start_at ? formatDateTimeLocal(new Date(job.start_at)) : "",
          end_at: job.end_at ? formatDateTimeLocal(new Date(job.end_at)) : "",
        });
      }
    }
    // Load active date range
    setEditActiveFrom(job.active_from || "");
    setEditActiveUntil(job.active_until || "");
    setEditingJob(false);
  };

  useEffect(() => {
    if (loading) return;

    const rawJobId = searchParams.get("job");

    // If URL has no selected job, force list view.
    if (!rawJobId) {
      if (selectedJob) {
        setSelectedJob(null);
        setSteps([]);
        setExpandedSteps(new Set());
        setEditingJob(false);
        setShowNewStepForm(false);
      }
      return;
    }

    const jobId = Number(rawJobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      setSelectedJobSearchParam(null);
      return;
    }

    // Keep current detail view in sync with refreshed jobs data.
    if (selectedJob?.id === jobId) {
      const refreshedJob = jobs.find((item) => item.id === jobId);
      if (refreshedJob && refreshedJob !== selectedJob) {
        setSelectedJob(refreshedJob);
      }
      return;
    }

    const job = jobs.find((item) => item.id === jobId);
    if (job) {
      void handleOpenJob(job);
    } else if (jobs.length > 0) {
      setSelectedJobSearchParam(null);
    }
  }, [loading, selectedJob, jobs, searchParams]);

  const handleCreateJob = async () => {
    if (!newJob.name) {
      alert(t("jobs.validation.nameRequired"));
      return;
    }

    // Validate recurring schedule
    const scheduleError = validateScheduleConfig({
      schedule_mode: recurringMode,
      schedule_days: scheduleDays,
    });
    if (scheduleError) {
      alert(`Schedule validation error: ${scheduleError}`);
      return;
    }

    const payload: any = {
      name: newJob.name,
      description: newJob.description,
      status: "draft",
      schedule_mode: recurringMode,
      schedule_days: scheduleDays,
      active_from: activeFrom || null,
      active_until: activeUntil || null,
    };

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        // Clear the form
        setNewJob({
          name: "",
          description: "",
        });
        setIsCreateScheduleVisible(false);
        setScheduleDays(getDefaultScheduleDays("weekly"));
        setRecurringMode("weekly");
        setActiveFrom("");
        setActiveUntil("");
        // Refresh jobs list
        await fetchJobs();
        // Optionally open the newly created job
        await handleOpenJob(data.job);
      } else {
        const error = await response.json();
        alert(error.error || "Failed to create job");
      }
    } catch (error) {
      console.error("Failed to create job:", error);
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    setConfirmDelete({ isOpen: true, jobId });
  };

  const confirmDeleteJob = async () => {
    const jobId = confirmDelete.jobId;
    setConfirmDelete({ isOpen: false, jobId: null });
    
    if (!jobId) return;

    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Remove from local state immediately
        setJobs(jobs.filter(j => j.id !== jobId));
        if (selectedJob?.id === jobId) {
          setSelectedJobSearchParam(null);
          setSelectedJob(null);
        }
      }
    } catch (error) {
      console.error("Failed to delete job:", error);
    }
  };

  const deleteStepById = async (stepId: number) => {
    try {
      const response = await fetch(`/api/job-steps/${stepId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setToast({ message: "Step deleted successfully", type: "success" });
        if (selectedJob) {
          fetchSteps(selectedJob.id);
        }
      } else {
        setToast({ message: "Failed to delete step", type: "error" });
      }
    } catch (error) {
      console.error("Failed to delete step:", error);
      setToast({ message: "Failed to delete step", type: "error" });
    }
  };

  const handleAddStep = async () => {
    if (!selectedJob) return;
    const timeoutSeconds = Math.round(Number(newStep.timeout_seconds));
    if (!newStep.name || !Number.isFinite(timeoutSeconds) || timeoutSeconds < MIN_STEP_TIMEOUT_SECONDS) {
      alert(`Please provide valid step name and timeout (minimum ${MIN_STEP_TIMEOUT_SECONDS / 60} minutes)`);
      return;
    }
    if (
      selectedJobMaxTimeoutSeconds !== null &&
      timeoutSeconds > selectedJobMaxTimeoutSeconds
    ) {
      alert(
        `Step timeout cannot exceed job limit (${formatStepTimeoutHuman(
          selectedJobMaxTimeoutSeconds
        )}).`
      );
      return;
    }

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newStep,
          timeout_seconds: timeoutSeconds,
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const createdStepId = Number((data as { step?: Step })?.step?.id);
        const refreshedSteps = await fetchSteps(selectedJob.id);
        if (Number.isInteger(createdStepId) && createdStepId > 0) {
          setExpandedSteps((prev) => {
            const next = new Set(prev);
            next.add(createdStepId);
            return next;
          });
        }
        setShowNewStepForm(false);
        setNewStep({
          name: "",
          step_order: refreshedSteps.length + 1,
          timeout_seconds: 300,
        });
      }
    } catch (error) {
      console.error("Failed to add step:", error);
    }
  };

  const handleUpdateJobSchedule = async () => {
    if (!selectedJob) return;

    // Parse the current description to extract human text (for legacy cleanup)
    const { humanText } = parseScheduleFromDescription(selectedJob.description || "");

    let payload: any = {
      description: humanText || selectedJob.description,
    };

    if (editScheduleMode === "recurring") {
      const scheduleError = validateScheduleConfig({
        schedule_mode: editRecurringMode,
        schedule_days: editScheduleDays,
      });
      if (scheduleError) {
        alert(`Schedule validation error: ${scheduleError}`);
        return;
      }

      payload.schedule_mode = editRecurringMode;
      payload.schedule_days = editScheduleDays;
      payload.active_from = editActiveFrom || null;
      payload.active_until = editActiveUntil || null;
    } else {
      // One-time mode (legacy view only)
      if (editJobForm.start_at && editJobForm.end_at) {
        if (new Date(editJobForm.start_at) >= new Date(editJobForm.end_at)) {
          alert(t("jobs.validation.invalidTimeWindow"));
          return;
        }
      }

      payload.schedule_mode = "one_shot";
      payload.start_at = editJobForm.start_at || null;
      payload.end_at = editJobForm.end_at || null;
    }

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedJob(data.job);
        setEditingJob(false);
        await fetchJobs();
      } else {
        const error = await response.json();
        alert(error.error || "Failed to update job schedule");
      }
    } catch (error) {
      console.error("Failed to update job schedule:", error);
    }
  };

  const handleScheduleJob = async () => {
    if (!selectedJob) return;

    // Validate job
    if (steps.length === 0) {
      alert(t("jobs.validation.noSteps"));
      return;
    }

    // Check if all steps are ready
    const allReady = await validateAllStepsReady();
    if (!allReady) {
      alert(t("jobs.validation.stepNotReady"));
      return;
    }

    try {
      let requiresOpenAi = false;
      let requiresZAi = false;
      for (const step of steps) {
        const groups = parseInferenceGroups(step.inference_groups);
        for (const group of groups) {
          const model = normalizeAgentInferenceModel(group.inference_model);
          if (model === "core") {
            requiresZAi = true;
          } else {
            requiresOpenAi = true;
          }
        }
      }

      if (!requiresOpenAi && !requiresZAi) {
        requiresOpenAi = true;
      }

      const checks: Array<Promise<Response>> = [];
      if (requiresOpenAi) checks.push(fetch("/api/openai-settings"));
      if (requiresZAi) checks.push(fetch("/api/zai-settings"));

      if (checks.length > 0) {
        const responses = await Promise.all(checks);
        let missingOpenAi = false;
        let missingZAi = false;
        for (const res of responses) {
          if (!res.ok) continue;
          const data = await res.json().catch(() => ({}));
          const hasKey = Boolean((data as any)?.has_key);
          if (String(res.url).includes("/api/openai-settings")) {
            missingOpenAi = missingOpenAi || !hasKey;
          } else if (String(res.url).includes("/api/zai-settings")) {
            missingZAi = missingZAi || !hasKey;
          }
        }
        if (missingZAi) {
          emitZAiKeyRequiredPrompt();
          setToast({
            message: "Job cannot be started because Z.ai API key is not configured in Settings.",
            type: "warning",
          });
          return;
        }
        if (missingOpenAi) {
          emitOpenAiKeyRequiredPrompt();
          setToast({
            message: "Job cannot be started because OpenAI API key is not configured in Settings.",
            type: "warning",
          });
          return;
        }
      }
    } catch {
      // Ignore transient check failure here; backend will still enforce key requirement.
    }

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled" }),
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedJob(data.job);
        await fetchJobs();
      } else {
        const error = await response.json().catch(() => ({}));
        if (isZAiKeyRequiredError(error)) {
          emitZAiKeyRequiredPrompt();
          setToast({
            message: "Job cannot be started because Z.ai API key is not configured in Settings.",
            type: "warning",
          });
          return;
        }
        if (isOpenAiKeyRequiredError(error)) {
          emitOpenAiKeyRequiredPrompt();
          setToast({
            message: "Job cannot be started because OpenAI API key is not configured in Settings.",
            type: "warning",
          });
          return;
        }
        setToast({
          message: error?.message || error?.error || "Failed to schedule job",
          type: "error",
        });
      }
    } catch (error) {
      console.error("Failed to schedule job:", error);
      setToast({ message: "Failed to schedule job", type: "error" });
    }
  };

  const handleStartJobFromRow = async (job: Job) => {
    setStartingJobIds((current) => {
      const next = new Set(current);
      next.add(job.id);
      return next;
    });

    try {
      const response = await fetch(`/api/jobs/${job.id}/start`, {
        method: "POST",
      });

      if (response.ok) {
        const data = (await readApiResponseBody(response)) || {};
        if ((data as any)?.already_running) {
          setToast({ message: listActionCopy.alreadyRunningMessage, type: "warning" });
        } else {
          setToast({ message: listActionCopy.startedMessage, type: "success" });
        }
        await fetchJobs();
        return;
      }

      const error = (await readApiResponseBody(response)) || {};
      const errorMessage = String(error?.error || error?.message || "").trim();
      if (isZAiKeyRequiredError(error)) {
        emitZAiKeyRequiredPrompt();
        setToast({
          message: "Job cannot be started because Z.ai API key is not configured in Settings.",
          type: "warning",
        });
        return;
      }
      if (isOpenAiKeyRequiredError(error)) {
        emitOpenAiKeyRequiredPrompt();
        setToast({
          message: "Job cannot be started because OpenAI API key is not configured in Settings.",
          type: "warning",
        });
        return;
      }
      if (
        response.status === 404 &&
        (!errorMessage || errorMessage === "404 Not Found" || errorMessage === "Not Found")
      ) {
        setToast({ message: listActionCopy.unavailableMessage, type: "warning" });
        return;
      }

      setToast({
        message: errorMessage || listActionCopy.failedMessage,
        type: "error",
      });
    } catch (error) {
      console.error("Failed to start job:", error);
      setToast({ message: listActionCopy.failedMessage, type: "error" });
    } finally {
      setStartingJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleStopJobFromRow = async (job: Job) => {
    setStoppingJobIds((current) => {
      const next = new Set(current);
      next.add(job.id);
      return next;
    });

    try {
      const response = await fetch(`/api/jobs/${job.id}/stop`, {
        method: "POST",
      });

      if (response.ok) {
        setToast({ message: t("dashboard.stopJobRequested", { jobName: job.name }), type: "success" });
        await fetchJobs();

        // Fast follow refreshes keep the list in sync even when backend status takes a moment to settle.
        setTimeout(() => {
          void fetchJobs();
        }, 1500);
        setTimeout(() => {
          void fetchJobs();
        }, 3500);
        return;
      }

      const error = (await readApiResponseBody(response)) || {};
      setToast({
        message: String(error.error || error.message || t("dashboard.stopJobFailed")),
        type: "error",
      });
    } catch (error) {
      console.error("Failed to stop job:", error);
      setToast({ message: t("dashboard.stopJobFailed"), type: "error" });
    } finally {
      setStoppingJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  };

  const validateAllStepsReady = async (): Promise<boolean> => {
    for (const step of steps) {
      try {
        const [targetsRes, agentsRes] = await Promise.all([
          fetch(`/api/job-steps/${step.id}/targets`),
          fetch(`/api/job-steps/${step.id}/agents`),
        ]);

        if (targetsRes.ok && agentsRes.ok) {
          const targetsData = await targetsRes.json();
          const agentsData = await agentsRes.json();

          const targets = targetsData.targets || [];
          const agents = agentsData.agents || [];
          
          // Check if each target has an agent OR if there's a default agent as fallback
          const defaultAgent = agents.find((a: Agent) => a.is_active === 1 && a.camera_id === null);
          const allTargetsHaveAgents = targets.every((t: Target) =>
            agents.some((a: Agent) => a.is_active === 1 && a.camera_id === t.camera_id) || !!defaultAgent
          );

          if (targets.length === 0 || !allTargetsHaveAgents) {
            return false;
          }
        }
      } catch (error) {
        return false;
      }
    }
    return true;
  };

  const toggleStep = (stepId: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "draft":
        return "bg-gray-500/20 text-gray-400";
      case "scheduled":
        return "bg-blue-500/20 text-blue-400";
      case "running":
        return "bg-green-500/20 text-green-400";
      case "stopping":
        return "bg-yellow-500/20 text-yellow-400";
      case "paused":
        return "bg-yellow-500/20 text-yellow-400";
      case "completed":
        return "bg-purple-500/20 text-purple-400";
      case "failed":
        return "bg-red-500/20 text-red-400";
      case "staled":
        return "bg-orange-500/20 text-orange-300";
      case "stopped":
        return "bg-gray-500/20 text-gray-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  const getDisplayStatus = (job: Job): string => {
    // Runtime status takes precedence for active states only
    if (job.runtime_status === "running") return "running";
    if (job.runtime_status === "stopping") return "stopping";
    if (job.runtime_status === "failed") return "failed";
    if (job.runtime_status === "completed") return "completed";
    if (job.runtime_status === "staled") return "staled";
    
    // When stopped, revert to job configuration status (e.g., "scheduled")
    // Fall back to job configuration status for all other cases
    return job.status;
  };

  const formatWeekdayLabel = (dayOfWeek: number): string => {
    const baseDate = new Date(Date.UTC(2024, 0, 7 + dayOfWeek));
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(baseDate);
    } catch {
      return new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(baseDate);
    }
  };

  const formatMonthDayLabel = (month: number, day: number): string => {
    const date = new Date(Date.UTC(2024, Math.max(0, month - 1), Math.max(1, day)));
    try {
      return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
    } catch {
      return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
    }
  };

  const formatWindowsLabel = (windows: Array<{ start_time: string; end_time: string }>): string => {
    const visible = windows
      .filter((w) => typeof w?.start_time === "string" && typeof w?.end_time === "string")
      .map((w) => `${w.start_time}-${w.end_time}`);
    return visible.join(", ");
  };

  const localizeRawScheduleSummary = (summary: string): string => {
    if (!summary) return "";
    let localized = summary;
    const modeReplacements: Array<[RegExp, string]> = [
      [/\bWeekly\b/gi, t("jobs.weekly")],
      [/\bMonthly\b/gi, t("jobs.monthly")],
      [/\bYearly\b/gi, t("jobs.yearly")],
      [/\bOne-time\b/gi, t("jobs.oneTime")],
    ];
    for (const [pattern, replacement] of modeReplacements) {
      localized = localized.replace(pattern, replacement);
    }

    const weekdayReplacements: Array<[RegExp, number]> = [
      [/\bSunday\b/g, 0],
      [/\bMonday\b/g, 1],
      [/\bTuesday\b/g, 2],
      [/\bWednesday\b/g, 3],
      [/\bThursday\b/g, 4],
      [/\bFriday\b/g, 5],
      [/\bSaturday\b/g, 6],
    ];
    for (const [pattern, dayOfWeek] of weekdayReplacements) {
      localized = localized.replace(pattern, formatWeekdayLabel(dayOfWeek));
    }
    return localized;
  };

  const buildRecurringScheduleLabel = (job: Job): string | null => {
    const mode = job.schedule_mode;
    if (mode !== "weekly" && mode !== "monthly" && mode !== "yearly") return null;
    if (!Array.isArray(job.schedule_days) || job.schedule_days.length === 0) return null;

    const modeLabel =
      mode === "weekly" ? t("jobs.weekly") : mode === "monthly" ? t("jobs.monthly") : t("jobs.yearly");

    if (mode === "weekly") {
      const orderMap = new Map<number, number>([
        [1, 0],
        [2, 1],
        [3, 2],
        [4, 3],
        [5, 4],
        [6, 5],
        [0, 6],
      ]);
      const labels = job.schedule_days
        .filter((d) => typeof d.day_of_week === "number")
        .sort((a, b) => (orderMap.get(a.day_of_week as number) ?? 999) - (orderMap.get(b.day_of_week as number) ?? 999))
        .map((d) => {
          const dayLabel = formatWeekdayLabel(d.day_of_week as number);
          const windowsLabel = formatWindowsLabel(Array.isArray(d.windows) ? d.windows : []);
          return windowsLabel ? `${dayLabel} ${windowsLabel}` : dayLabel;
        });
      return labels.length > 0 ? `${modeLabel}: ${labels.join("; ")}` : modeLabel;
    }

    if (mode === "monthly") {
      const labels = job.schedule_days
        .filter((d) => typeof d.day_of_month === "number")
        .sort((a, b) => (a.day_of_month ?? 0) - (b.day_of_month ?? 0))
        .map((d) => {
          const dayLabel = t("jobs.scheduleBuilder.dayLabel", { day: d.day_of_month });
          const windowsLabel = formatWindowsLabel(Array.isArray(d.windows) ? d.windows : []);
          return windowsLabel ? `${dayLabel} ${windowsLabel}` : dayLabel;
        });
      return labels.length > 0 ? `${modeLabel}: ${labels.join("; ")}` : modeLabel;
    }

    const yearlyLabels = job.schedule_days
      .filter((d) => typeof d.month_of_year === "number" && typeof d.day_of_month === "number")
      .sort((a, b) => {
        const monthDiff = (a.month_of_year ?? 0) - (b.month_of_year ?? 0);
        if (monthDiff !== 0) return monthDiff;
        return (a.day_of_month ?? 0) - (b.day_of_month ?? 0);
      })
      .map((d) => {
        const dayLabel = formatMonthDayLabel(d.month_of_year as number, d.day_of_month as number);
        const windowsLabel = formatWindowsLabel(Array.isArray(d.windows) ? d.windows : []);
        return windowsLabel ? `${dayLabel} ${windowsLabel}` : dayLabel;
      });
    return yearlyLabels.length > 0 ? `${modeLabel}: ${yearlyLabels.join("; ")}` : modeLabel;
  };

  const getDisplayStatusLabel = (job: Job): string => {
    const status = getDisplayStatus(job);
    switch (status) {
      case "draft": return t("jobs.draft");
      case "scheduled": return t("jobs.scheduled");
      case "running": return t("jobs.running");
      case "stopping": return t("jobs.stopping", { defaultValue: "Stopping" });
      case "paused": return t("jobs.paused");
      case "completed": return t("jobs.completed");
      case "failed": return t("jobs.failed");
      case "staled": return t("jobs.staled", { defaultValue: "Staled" });
      case "stopped": return t("jobs.stopped", { defaultValue: "Stopped" });
      default: return status;
    }
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getScheduleContextForTimezone = (timezoneValue?: string | null) => {
    const candidate = typeof timezoneValue === "string" && timezoneValue.trim() ? timezoneValue.trim() : globalTimezone;
    const formatterFor = (timezone: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      });
    const parseFor = (timezone: string) => {
      try {
        const parts = formatterFor(timezone).formatToParts(new Date());
        const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
        const year = get("year");
        const month = get("month");
        const day = get("day");
        const weekday = get("weekday");
        const weekdayMap: Record<string, number> = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        return {
          timezone,
          localDate: `${year}-${month}-${day}`,
          dayOfWeek: weekdayMap[weekday] ?? 0,
          dayOfMonth: Number.parseInt(day, 10),
          monthOfYear: Number.parseInt(month, 10),
        };
      } catch {
        return null;
      }
    };

    return parseFor(candidate) || (candidate !== "UTC" ? parseFor("UTC") : null);
  };

  const getRecurringWindowsForCurrentDay = (job: Job): Array<{ start_time: string; end_time: string }> => {
    if (!Array.isArray(job.schedule_days) || job.schedule_days.length === 0) return [];
    if (
      job.schedule_mode !== "weekly" &&
      job.schedule_mode !== "monthly" &&
      job.schedule_mode !== "yearly"
    ) {
      return [];
    }

    const scheduleContext = getScheduleContextForTimezone(job.timezone || globalTimezone);
    if (!scheduleContext) return [];
    if (job.active_from && scheduleContext.localDate < job.active_from) return [];
    if (job.active_until && scheduleContext.localDate > job.active_until) return [];

    const matchingDays = job.schedule_days.filter((day) => {
      if (job.schedule_mode === "weekly") {
        return day.day_of_week === scheduleContext.dayOfWeek;
      }
      if (job.schedule_mode === "monthly") {
        return day.day_of_month === scheduleContext.dayOfMonth;
      }
      return (
        day.day_of_month === scheduleContext.dayOfMonth &&
        day.month_of_year === scheduleContext.monthOfYear
      );
    });

    return matchingDays
      .flatMap((day) => (Array.isArray(day.windows) ? day.windows : []))
      .filter(
        (window) =>
          typeof window?.start_time === "string" &&
          typeof window?.end_time === "string" &&
          parseHHMMToMinutes(window.start_time) !== null &&
          parseHHMMToMinutes(window.end_time) !== null
      )
      .sort((a, b) => {
        const startDiff =
          (parseHHMMToMinutes(a.start_time) ?? 0) - (parseHHMMToMinutes(b.start_time) ?? 0);
        if (startDiff !== 0) return startDiff;
        return (parseHHMMToMinutes(a.end_time) ?? 0) - (parseHHMMToMinutes(b.end_time) ?? 0);
      });
  };

  const getJobListTimeRange = (job: Job): { start: string | null; end: string | null } => {
    if (job.schedule_mode === "weekly" || job.schedule_mode === "monthly" || job.schedule_mode === "yearly") {
      const windows = getRecurringWindowsForCurrentDay(job);
      if (windows.length === 0) {
        return { start: null, end: null };
      }
      return {
        start: windows[0]?.start_time || null,
        end: windows[windows.length - 1]?.end_time || null,
      };
    }

    return {
      start: job.start_at ? formatDateTime(job.start_at) : null,
      end: job.end_at ? formatDateTime(job.end_at) : null,
    };
  };

  const canStartJobFromList = (job: Job): boolean => {
    const displayStatus = getDisplayStatus(job);
    return displayStatus !== "running" && displayStatus !== "stopping";
  };

  const getJobScheduleType = (job: Job): "one-time" | "recurring" => {
    if (job.schedule_mode === "weekly" || job.schedule_mode === "monthly" || job.schedule_mode === "yearly") {
      return "recurring";
    } else if (job.schedule_mode === "one_shot") {
      return "one-time";
    } else {
      // Legacy: check description
      const { schedule } = parseScheduleFromDescription(job.description || "");
      return schedule ? "recurring" : "one-time";
    }
  };

  const getJobScheduleBadge = (job: Job): string => {
    if (job.schedule_mode === "weekly" || job.schedule_mode === "monthly" || job.schedule_mode === "yearly") {
      const recurringLabel = buildRecurringScheduleLabel(job);
      if (recurringLabel) return recurringLabel;
      if (job.schedule_summary) return localizeRawScheduleSummary(job.schedule_summary);
      return job.schedule_mode === "weekly"
        ? t("jobs.weekly")
        : job.schedule_mode === "monthly"
        ? t("jobs.monthly")
        : t("jobs.yearly");
    } else if (job.schedule_mode === "one_shot") {
      return t("jobs.oneTime");
    } else {
      if (job.schedule_summary) return localizeRawScheduleSummary(job.schedule_summary);
      return t("jobs.oneTime");
    }
  };

  // Filter jobs based on search query
  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = job.name.toLowerCase().includes(query);
    const startMatch = job.start_at && formatDateTime(job.start_at).toLowerCase().includes(query);
    const endMatch = job.end_at && formatDateTime(job.end_at).toLowerCase().includes(query);
    return nameMatch || startMatch || endMatch;
  });
  const newStepTimeoutParts = timeoutSecondsToHourMinuteParts(newStep.timeout_seconds);

  if (loading) {
    return (
      <Layout>
        <CameraEventToast toasts={cameraEventToasts} onDismiss={dismissCameraEventToast} />
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-400">{t("common.loading")}</div>
        </div>
      </Layout>
    );
  }

  // If a job is selected, show the job editor (steps configuration)
  if (selectedJob) {
    // Extract human text from description (legacy cleanup)
    const { humanText } = parseScheduleFromDescription(selectedJob.description || "");
    const selectedJobScheduleBadge = getJobScheduleBadge(selectedJob);
    
    return (
      <Layout>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        <CameraEventToast toasts={cameraEventToasts} onDismiss={dismissCameraEventToast} />
        <ConfirmDialog
          isOpen={confirmDeleteStep.isOpen}
          title="Delete Step"
          message="Are you sure you want to delete this step? This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => {
            const stepId = confirmDeleteStep.stepId;
            setConfirmDeleteStep({ isOpen: false, stepId: null });
            if (stepId) {
              // Call the actual delete function
              deleteStepById(stepId);
            }
          }}
          onCancel={() => setConfirmDeleteStep({ isOpen: false, stepId: null })}
        />
        <div className="space-y-6">
          {/* Job Header */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-100">
                  {selectedJob.name}
                </h2>
                {humanText && (
                  <p className="text-gray-400 mt-1">{humanText}</p>
                )}
                {selectedJobScheduleBadge && !editingJob && (
                  <div className="mt-2 flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-blue-400">
                      {selectedJobScheduleBadge}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${getStatusColor(
                    selectedJob.status
                  )}`}
                >
                  {t(`jobs.${selectedJob.status}`)}
                </span>
                {!editingJob && (
                  <button
                    onClick={() => setEditingJob(true)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    {t("jobs.editSchedule")}
                  </button>
                )}
                {selectedJob.status === "draft" && (
                  <button
                    onClick={handleScheduleJob}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                  >
                    {t("jobs.schedule")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedJobSearchParam(null);
                    setSelectedJob(null);
                    setSteps([]);
                    setExpandedSteps(new Set());
                    setEditingJob(false);
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors"
                >
                  {t("jobs.back")}
                </button>
              </div>
            </div>

            {/* Edit Schedule Form */}
            {editingJob && (
              <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100 mb-4">{t("jobs.editSchedule")}</h3>
                <div className="space-y-4">
                  {/* Schedule Mode Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t("jobs.scheduleMode")}
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="editScheduleMode"
                          value="one-time"
                          checked={editScheduleMode === "one-time"}
                          onChange={() => setEditScheduleMode("one-time")}
                          className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-300">{t("jobs.oneTime")}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="editScheduleMode"
                          value="recurring"
                          checked={editScheduleMode === "recurring"}
                          onChange={() => setEditScheduleMode("recurring")}
                          className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-300">{t("jobs.recurringWeekly")}</span>
                      </label>
                    </div>
                  </div>

                  {/* One-time Schedule */}
                  {editScheduleMode === "one-time" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t("jobs.startTime")}
                        </label>
                        <input
                          type="datetime-local"
                          value={editJobForm.start_at}
                          onChange={(e) =>
                            setEditJobForm({ ...editJobForm, start_at: e.target.value })
                          }
                          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t("jobs.endTime")}
                        </label>
                        <input
                          type="datetime-local"
                          value={editJobForm.end_at}
                          onChange={(e) =>
                            setEditJobForm({ ...editJobForm, end_at: e.target.value })
                          }
                          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Recurring Schedule Builder */}
                  {editScheduleMode === "recurring" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-3">
                        {t("jobs.scheduleConfiguration")}
                      </label>
                      <ScheduleBuilder
                        mode={editRecurringMode}
                        scheduleDays={editScheduleDays}
                        onModeChange={(mode) => {
                          setEditRecurringMode(mode);
                          setEditScheduleDays(getDefaultScheduleDays(mode));
                        }}
                        onScheduleDaysChange={setEditScheduleDays}
                        activeFrom={editActiveFrom}
                        activeUntil={editActiveUntil}
                        onActiveFromChange={setEditActiveFrom}
                        onActiveUntilChange={setEditActiveUntil}
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleUpdateJobSchedule}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      <Save className="w-4 h-4 inline mr-2" />
                      Save Schedule
                    </button>
                    <button
                      onClick={() => setEditingJob(false)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Steps Section */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-100">
                {t("jobs.steps")}
              </h3>
              <button
                onClick={() => {
                  setShowNewStepForm(true);
                  setNewStep({
                    name: "",
                    step_order: steps.length + 1,
                    timeout_seconds: 300,
                  });
                }}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                {t("jobs.addStep")}
              </button>
            </div>

            {/* New Step Form */}
            {showNewStepForm && (
              <div className="mb-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {t("jobs.stepName")}
                    </label>
                    <input
                      type="text"
                      value={newStep.name}
                      onChange={(e) =>
                        setNewStep({ ...newStep, name: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Step name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {t("jobs.stepOrder")}
                    </label>
                    <input
                      type="number"
                      value={newStep.step_order}
                      onChange={(e) =>
                        setNewStep({
                          ...newStep,
                          step_order: parseInt(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Max time to run step (hours/minutes)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="relative">
                        <input
                          type="number"
                          value={newStepTimeoutParts.hours}
                          onChange={(e) => {
                            const hours = parseNonNegativeIntegerInput(e.target.value);
                            setNewStep({
                              ...newStep,
                              timeout_seconds: hourMinutePartsToTimeoutSeconds(
                                hours,
                                newStepTimeoutParts.minutes
                              ),
                            });
                          }}
                          className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                          min="0"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                          h
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          value={newStepTimeoutParts.minutes}
                          onChange={(e) => {
                            const minutes = Math.min(59, parseNonNegativeIntegerInput(e.target.value));
                            setNewStep({
                              ...newStep,
                              timeout_seconds: hourMinutePartsToTimeoutSeconds(
                                newStepTimeoutParts.hours,
                                minutes
                              ),
                            });
                          }}
                          className="w-full px-3 py-2 pr-8 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                          min="0"
                          max="59"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                          m
                        </span>
                      </div>
                    </div>
                    {selectedJobMaxTimeoutSeconds !== null && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Max for this job: {formatStepTimeoutHuman(selectedJobMaxTimeoutSeconds)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddStep}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    <Save className="w-3.5 h-3.5 inline mr-1" />
                    Save
                  </button>
                  <button
                    onClick={() => setShowNewStepForm(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {steps.length === 0 && !showNewStepForm ? (
              <div className="text-center py-8 text-gray-500">
                No steps yet. Add your first step to begin.
              </div>
            ) : (
              <div className="space-y-3">
                {steps.map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    steps={steps}
                    expanded={expandedSteps.has(step.id)}
                    onToggle={() => toggleStep(step.id)}
                    cameras={cameras}
                    scheduleDays={selectedJob.schedule_days || []}
                    jobMaxTimeoutSeconds={selectedJobMaxTimeoutSeconds}
                    onStepUpdated={() => fetchSteps(selectedJob.id)}
                    onShowToast={(message, type) => setToast({ message, type })}
                    onRequestDeleteStep={(stepId) => setConfirmDeleteStep({ isOpen: true, stepId })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  // Default view: New Job form at top + Jobs table below
  return (
    <Layout>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <CameraEventToast toasts={cameraEventToasts} onDismiss={dismissCameraEventToast} />
      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        title={t("jobs.deleteJobTitle")}
        message={t("jobs.deleteJobMessage")}
        confirmLabel={t("jobs.delete")}
        cancelLabel={t("jobs.cancel")}
        variant="danger"
        onConfirm={confirmDeleteJob}
        onCancel={() => setConfirmDelete({ isOpen: false, jobId: null })}
      />
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-100">{t("jobs.title")}</h1>
          <p className="text-gray-400 mt-1">{t("jobs.subtitle")}</p>
          <p className="text-xs text-gray-500 mt-2">
            {t("jobs.timezoneGlobal")}: <span className="font-mono text-gray-300">{globalTimezone}</span>
          </p>
        </div>

        {/* New Job Form (Always visible at top) */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">
            {t("jobs.newJob")}
          </h2>
          <div className="space-y-4">
            {/* Job Name and Description */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("jobs.jobName")}
                </label>
                <input
                  type="text"
                  value={newJob.name}
                  onChange={(e) =>
                    setNewJob({ ...newJob, name: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder={t("jobs.jobNamePlaceholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("jobs.description")}
                </label>
                <input
                  type="text"
                  value={newJob.description}
                  onChange={(e) =>
                    setNewJob({ ...newJob, description: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder={t("jobs.descriptionPlaceholder")}
                />
              </div>
            </div>

            {/* Schedule Configuration */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="block text-sm font-medium text-gray-300">
                  {t("jobs.scheduleConfiguration")}
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreateScheduleVisible((current) => !current)}
                  aria-expanded={isCreateScheduleVisible}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all ${
                    isCreateScheduleVisible
                      ? "border-blue-400/30 bg-blue-500/10 text-blue-100 hover:border-blue-300/50 hover:bg-blue-500/14"
                      : "border-blue-500/35 bg-blue-500/14 text-blue-100 hover:border-blue-400/55 hover:bg-blue-500/18"
                  }`}
                >
                  {isCreateScheduleVisible ? (
                    <ChevronDown className="h-3.5 w-3.5 text-blue-200" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-blue-200" />
                  )}
                  {isCreateScheduleVisible
                    ? t("jobs.hideSchedule", { defaultValue: createScheduleCopy.hide })
                    : t("jobs.showSchedule", { defaultValue: createScheduleCopy.show })}
                </button>
              </div>
              {isCreateScheduleVisible ? (
                <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
                  <ScheduleBuilder
                    mode={recurringMode}
                    scheduleDays={scheduleDays}
                    onModeChange={(mode) => {
                      setRecurringMode(mode);
                      setScheduleDays(getDefaultScheduleDays(mode));
                    }}
                    onScheduleDaysChange={setScheduleDays}
                    activeFrom={activeFrom}
                    activeUntil={activeUntil}
                    onActiveFromChange={setActiveFrom}
                    onActiveUntilChange={setActiveUntil}
                  />
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  {t("jobs.scheduleHiddenHint", {
                    defaultValue: createScheduleCopy.hiddenHint,
                  })}
                </p>
              )}
            </div>

            <div>
              <button
                onClick={handleCreateJob}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t("jobs.createJob")}
              </button>
            </div>
          </div>
        </div>

        {/* Jobs List Section */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-100">
              {t("jobs.jobsList")}
            </h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("jobs.searchJobs")}
                className="pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500 w-64"
              />
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? t("jobs.noJobsFound") : t("jobs.noJobsDesc")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      {t("jobs.name")}
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      {t("jobs.schedule")}
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      {t("jobs.start")}
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                      {t("jobs.end")}
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">
                      {t("jobs.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const jobTimeRange = getJobListTimeRange(job);
                    const displayStatus = getDisplayStatus(job);
                    const isStarting = startingJobIds.has(job.id);
                    const isStopping = displayStatus === "stopping" || stoppingJobIds.has(job.id);
                    const showStopAction = displayStatus === "running" || isStopping;
                    const canStart = canStartJobFromList(job);

                    return (
                      <tr
                        key={job.id}
                        className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-200 font-medium">{job.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(displayStatus)}`}
                            >
                              {getDisplayStatusLabel(job)}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">
                          <div className="flex items-center gap-1">
                            {getJobScheduleType(job) === "recurring" ? (
                              <>
                                <Repeat className="w-3.5 h-3.5" />
                                <span className="text-xs">{getJobScheduleBadge(job)}</span>
                              </>
                            ) : (
                              <span className="text-xs">{t("jobs.oneTime")}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">
                          {jobTimeRange.start ? (
                            <div className="flex items-center gap-1">
                              {getJobScheduleType(job) === "recurring" ? (
                                <Clock className="w-3.5 h-3.5" />
                              ) : (
                                <Calendar className="w-3.5 h-3.5" />
                              )}
                              {jobTimeRange.start}
                            </div>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">
                          {jobTimeRange.end ? (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {jobTimeRange.end}
                            </div>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-2">
                            {showStopAction ? (
                              <button
                                type="button"
                                onClick={() => handleStopJobFromRow(job)}
                                disabled={isStopping}
                                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
                                  isStopping
                                    ? "cursor-not-allowed bg-gray-800 text-gray-500"
                                    : "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                                }`}
                              >
                                <StopCircle className="w-3.5 h-3.5" />
                                {t("dashboard.stop")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartJobFromRow(job)}
                                disabled={!canStart || isStarting}
                                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
                                  !canStart || isStarting
                                    ? "cursor-not-allowed bg-gray-800 text-gray-500"
                                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                                }`}
                              >
                                <Play className="w-3.5 h-3.5" />
                                {isStarting ? listActionCopy.starting : listActionCopy.start}
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenJob(job)}
                              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-sm transition-colors"
                            >
                              {t("jobs.open")}
                            </button>
                            <button
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

interface StepCardProps {
  step: Step;
  steps: Step[];
  expanded: boolean;
  onToggle: () => void;
  cameras: Camera[];
  scheduleDays: ScheduleDay[];
  jobMaxTimeoutSeconds: number | null;
  onStepUpdated: () => void;
  onShowToast: (message: string, type: "success" | "error" | "warning" | "info") => void;
  onRequestDeleteStep: (stepId: number) => void;
}

function StepCard({
  step,
  steps,
  expanded,
  onToggle,
  cameras,
  scheduleDays,
  jobMaxTimeoutSeconds,
  onStepUpdated,
  onShowToast,
  onRequestDeleteStep,
}: StepCardProps) {
  const { t, i18n } = useTranslation();
  const stepLocale = (i18n.resolvedLanguage || i18n.language || "en").replace("_", "-");
  const localizedOptionalSuffix = extractOptionalSuffix(
    t("jobs.promptEditor.targetFacesOptionalLabel", {
      defaultValue: "Target Faces (optional)",
    })
  );
  const [targets, setTargets] = useState<Target[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [pipelineTargetsByStepId, setPipelineTargetsByStepId] = useState<Record<string, Target[]>>({});
  const [startConditionStepTargets, setStartConditionStepTargets] = useState<Target[]>([]);
  const [showTargetSelect, setShowTargetSelect] = useState(false);
  const [isTargetMultiSelect, setIsTargetMultiSelect] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<number>>(new Set());
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupAgentKey, setGroupAgentKey] = useState("");
  const [groupAgentSourceTargetId, setGroupAgentSourceTargetId] = useState<number | null>(null);
  const [inferenceGroups, setInferenceGroups] = useState<InferenceGroup[]>([]);
  const [savingInferenceGroups, setSavingInferenceGroups] = useState(false);
  const groupedTargetIds = new Set(inferenceGroups.flatMap((group) => group.targetIds));
  const [targetInputTypes, setTargetInputTypes] = useState<Record<number, TargetInputType>>({});
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentFormCameraId, setAgentFormCameraId] = useState<number | null>(null);
  const [showPipelineForm, setShowPipelineForm] = useState(false);
  const [showStartConditionForm, setShowStartConditionForm] = useState(false);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [editTimeoutSeconds, setEditTimeoutSeconds] = useState(
    normalizeTimeoutForHourMinuteUi(step.timeout_seconds)
  );
  const [isEditingTimeout, setIsEditingTimeout] = useState(false);
  const [agentPriorities, setAgentPriorities] = useState<Record<number, AgentPriority>>({});
  const [savingPriorities, setSavingPriorities] = useState<Set<number>>(new Set());
  const [agentInferenceModels, setAgentInferenceModels] = useState<Record<number, AgentInferenceModel>>({});
  const [agentRunEvery, setAgentRunEvery] = useState<Record<number, AgentRunEverySeconds>>({});
  const [agentOnlyCaptureOnMotion, setAgentOnlyCaptureOnMotion] = useState<Record<number, boolean>>({});
  const [savingOnlyCaptureOnMotion, setSavingOnlyCaptureOnMotion] = useState<Set<number>>(new Set());
  const [clonePickerTargetId, setClonePickerTargetId] = useState<number | null>(null);
  const [cloneSourceByTarget, setCloneSourceByTarget] = useState<Record<number, number>>({});
  const [cloningTargets, setCloningTargets] = useState<Set<number>>(new Set());
  const [confirmCloneAgent, setConfirmCloneAgent] = useState<{
    isOpen: boolean;
    targetId: number | null;
    sourceCameraId: number | null;
  }>({
    isOpen: false,
    targetId: null,
    sourceCameraId: null,
  });
  const agentFormRef = useRef<HTMLDivElement | null>(null);
  const [highlightAgentForm, setHighlightAgentForm] = useState(false);
  const agentFormHighlightTimerRef = useRef<number | null>(null);
  const [highlightAgentCreationTargetId, setHighlightAgentCreationTargetId] = useState<number | null>(null);
  const agentCreationHighlightTimerRef = useRef<number | null>(null);
  const hasShownAgentCreationHighlightRef = useRef(false);

  const handleModelApiKeyRequired = (errorPayload: unknown): boolean => {
    if (isOpenAiKeyRequiredError(errorPayload)) {
      emitOpenAiKeyRequiredPrompt();
      onShowToast("OpenAI API key is required in Settings.", "warning");
      return true;
    }
    if (isZAiKeyRequiredError(errorPayload)) {
      emitZAiKeyRequiredPrompt();
      onShowToast("Z.ai API key is required in Settings.", "warning");
      return true;
    }
    return false;
  };

  const activeAgentByCameraId = useMemo(() => {
    const map = new Map<number, Agent>();
    agents.forEach((agent) => {
      if (agent.is_active !== 1 || agent.camera_id == null) return;
      if (!map.has(agent.camera_id)) {
        map.set(agent.camera_id, agent);
      }
    });
    return map;
  }, [agents]);

  const cloneCandidatesByTargetId = useMemo(() => {
    const next: Record<number, CloneCandidate[]> = {};
    targets.forEach((target) => {
      const candidates: CloneCandidate[] = [];
      targets.forEach((otherTarget) => {
        if (otherTarget.id === target.id) return;
        const otherAgent = activeAgentByCameraId.get(otherTarget.camera_id);
        if (!otherAgent) return;
        candidates.push({
          cameraId: otherTarget.camera_id,
          cameraName: otherTarget.camera_name || `Camera ${otherTarget.camera_id}`,
          agent: otherAgent,
        });
      });
      next[target.id] = candidates;
    });
    return next;
  }, [targets, activeAgentByCameraId]);

  const toggleTargetMultiSelect = () => {
    setIsTargetMultiSelect((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedTargetIds(new Set());
      }
      return next;
    });
  };

  const handleSelectAllTargets = () => {
    setIsTargetMultiSelect(true);
    const selectableTargets = targets.filter((target) => !groupedTargetIds.has(target.id));
    setSelectedTargetIds(new Set(selectableTargets.map((target) => target.id)));
  };

  const handleClearTargetSelection = () => {
    setSelectedTargetIds(new Set());
  };

  const toggleTargetSelection = (targetId: number) => {
    if (groupedTargetIds.has(targetId)) return;
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      return next;
    });
  };

  const persistInferenceGroups = async (nextGroups: InferenceGroup[]): Promise<boolean> => {
    if (savingInferenceGroups) return false;
    setSavingInferenceGroups(true);
    try {
      const response = await fetch(`/api/job-steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inference_groups: nextGroups }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        onShowToast(error.message || error.error || "Failed to save inference groups", "error");
        return false;
      }

      await onStepUpdated();
      return true;
    } catch (error) {
      console.error("Failed to save inference groups:", error);
      onShowToast("Failed to save inference groups", "error");
      return false;
    } finally {
      setSavingInferenceGroups(false);
    }
  };

  const closeGroupModal = () => {
    setShowGroupModal(false);
    setEditingGroupId(null);
    setGroupName("");
    setGroupAgentKey("");
    setGroupAgentSourceTargetId(null);
  };

  const openGroupModal = () => {
    if (selectedTargetIds.size < 2) return;
    const selectedTargets = targets.filter((target) => selectedTargetIds.has(target.id));
    const selectedAgentKeys = new Set(
      selectedTargets
        .map((target) => {
          const targetAgent = agents.find(
            (agent) => agent.is_active === 1 && agent.camera_id === target.camera_id
          );
          const effectiveAgent = targetAgent || defaultAgent;
          return effectiveAgent?.agent_key || "";
        })
        .filter((key) => key)
    );
    const preselectedAgentKey = selectedAgentKeys.size === 1 ? Array.from(selectedAgentKeys)[0] : "";
    const preselectedSourceTargetId = preselectedAgentKey
      ? selectedTargets.find((target) => {
          const targetAgent = agents.find(
            (agent) => agent.is_active === 1 && agent.camera_id === target.camera_id
          );
          const effectiveAgent = targetAgent || defaultAgent;
          return effectiveAgent?.agent_key === preselectedAgentKey;
        })?.id ?? null
      : null;
    setGroupName("");
    setGroupAgentKey(preselectedAgentKey);
    setGroupAgentSourceTargetId(preselectedSourceTargetId);
    setEditingGroupId(null);
    setShowGroupModal(true);
  };

  const handleSaveGroup = async () => {
    if (!selectedGroupSourceOption) return;
    const selectedSource = selectedGroupSourceOption;
    const sourceExecution = applyAgentExecutionConstraints(
      selectedSource.inferenceModel === "core" ? "video" : "image",
      selectedSource.inferenceModel,
      selectedSource.runEvery,
      selectedSource.runningResolution,
      selectedSource.modelFps
    );
    const lockedGroupInputType: TargetInputType = sourceExecution.inputType;
    const videoPackagingMode = normalizeAgentVideoPackagingMode(
      selectedSource.videoPackagingMode
    );

    if (editingGroupId) {
      const nextGroups = inferenceGroups.map((group) =>
        group.id === editingGroupId
          ? {
              ...group,
              name: groupName.trim() || group.name,
              agentKey: selectedSource.agentKey,
              inputType: lockedGroupInputType,
              priority_level: selectedSource.priorityLevel,
              inference_model: sourceExecution.inferenceModel,
              model_fps: sourceExecution.modelFps,
              run_every: sourceExecution.runEvery,
              running_resolution: sourceExecution.runningResolution,
              video_packaging_mode: videoPackagingMode,
              only_capture_on_motion: selectedSource.onlyCaptureOnMotion,
              source_target_id: selectedSource.targetId,
            }
          : group
      );
      const saved = await persistInferenceGroups(nextGroups);
      if (!saved) return;
      setInferenceGroups(nextGroups);
      closeGroupModal();
      return;
    }

    if (selectedTargetIds.size < 2) return;
    const selectedTargets = targets.filter((target) => selectedTargetIds.has(target.id));
    const cameraNames = selectedTargets.map(
      (target) => target.camera_name || `Camera ${target.camera_id}`
    );
    const groupId = `group-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nameValue = groupName.trim() || `Group: ${cameraNames.join(" + ")}`;

    const nextGroups = [
      ...inferenceGroups,
      {
        id: groupId,
        name: nameValue,
        targetIds: selectedTargets.map((t) => t.id),
        agentKey: selectedSource.agentKey,
        inputType: lockedGroupInputType,
        priority_level: selectedSource.priorityLevel,
        inference_model: sourceExecution.inferenceModel,
        model_fps: sourceExecution.modelFps,
        run_every: sourceExecution.runEvery,
        running_resolution: sourceExecution.runningResolution,
        video_packaging_mode: videoPackagingMode,
        only_capture_on_motion: selectedSource.onlyCaptureOnMotion,
        source_target_id: selectedSource.targetId,
      },
    ];
    const saved = await persistInferenceGroups(nextGroups);
    if (!saved) return;
    setInferenceGroups(nextGroups);
    closeGroupModal();
    setIsTargetMultiSelect(false);
    setSelectedTargetIds(new Set());
  };

  const handleRemoveGroup = async (groupId: string) => {
    const nextGroups = inferenceGroups.filter((group) => group.id !== groupId);
    const saved = await persistInferenceGroups(nextGroups);
    if (!saved) return;
    setInferenceGroups(nextGroups);
  };
  
  const [agentForm, setAgentForm] = useState<AgentFormState>(buildEmptyAgentForm);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptEditorInputTypeDraft, setPromptEditorInputTypeDraft] =
    useState<TargetInputType>("video");
  const [promptEditorDraft, setPromptEditorDraft] = useState<PromptEditorFields>({
    prompt_template: "",
    alert_condition: "",
    negative_condition: "",
  });
  const [promptEditorRegions, setPromptEditorRegions] = useState<AnalysisRegion[]>([
    buildDefaultAnalysisRegion(
      { prompt_template: "", alert_condition: "", negative_condition: "" },
      [],
      [],
      0
    ),
  ]);
  const [activePromptRegionId, setActivePromptRegionId] = useState("full-frame");
  const [polygonDrawEnabled, setPolygonDrawEnabled] = useState(false);
  const [hoveredPromptRegionId, setHoveredPromptRegionId] = useState<string | null>(null);
  const [regionActionRegionId, setRegionActionRegionId] = useState<string | null>(null);
  const [isRegionActionHovered, setIsRegionActionHovered] = useState(false);
  const [draggingPromptVertex, setDraggingPromptVertex] = useState<{
    region_id: string;
    vertex_index: number;
  } | null>(null);
  const [pendingPolygonSeed, setPendingPolygonSeed] = useState<{
    start: AnalysisRegionPoint;
    label: string;
    description: string;
  } | null>(null);
  const [isSizingPendingPolygon, setIsSizingPendingPolygon] = useState(false);
  const [draftPolygonRect, setDraftPolygonRect] = useState<{
    start: AnalysisRegionPoint;
    end: AnalysisRegionPoint;
  } | null>(null);
  const [showNewRegionDialog, setShowNewRegionDialog] = useState(false);
  const [newRegionDialogLabel, setNewRegionDialogLabel] = useState("");
  const [newRegionDialogDescription, setNewRegionDialogDescription] = useState("");
  const [newRegionDialogAnchor, setNewRegionDialogAnchor] = useState<AnalysisRegionPoint | null>(null);
  const [analysisRegionsPanelOpen, setAnalysisRegionsPanelOpen] = useState(false);
  const [promptEditorTargetFacesExpanded, setPromptEditorTargetFacesExpanded] = useState(false);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const [promptEditorSnapshotMeta, setPromptEditorSnapshotMeta] = useState<{
    thumbnail_url: string | null;
    last_thumbnail_update: string | null;
  }>({
    thumbnail_url: null,
    last_thumbnail_update: null,
  });
  const [promptEditorSnapshotLoading, setPromptEditorSnapshotLoading] = useState(false);
  const [promptEditorSnapshotRequesting, setPromptEditorSnapshotRequesting] = useState(false);
  const [promptEditorSnapshotError, setPromptEditorSnapshotError] = useState<string | null>(
    null
  );
  const [promptEditorSnapshotRefreshCooldownUntil, setPromptEditorSnapshotRefreshCooldownUntil] =
    useState(0);
  const promptEditorSnapshotRefreshInFlightRef = useRef(false);
  const promptEditorSnapshotRetryInFlightRef = useRef(false);
  const promptEditorSnapshotRefreshCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [faceTargetsLibrary, setFaceTargetsLibrary] = useState<FaceTarget[]>([]);
  const [faceTargetsLoading, setFaceTargetsLoading] = useState(false);
  const [creatingFaceTarget, setCreatingFaceTarget] = useState(false);
  const [newFaceTargetName, setNewFaceTargetName] = useState("");
  const [newFaceTargetDescription, setNewFaceTargetDescription] = useState("");
  const [newFaceTargetFile, setNewFaceTargetFile] = useState<File | null>(null);
  const [faceTargetUploadingId, setFaceTargetUploadingId] = useState<number | null>(null);
  const [faceTargetDeletingImageId, setFaceTargetDeletingImageId] = useState<number | null>(null);
  const [editingFaceTargetId, setEditingFaceTargetId] = useState<number | null>(null);
  const [editingFaceTargetName, setEditingFaceTargetName] = useState("");
  const [editingFaceTargetDescription, setEditingFaceTargetDescription] = useState("");
  const [savingFaceTargetId, setSavingFaceTargetId] = useState<number | null>(null);
  const [deletingFaceTargetId, setDeletingFaceTargetId] = useState<number | null>(null);
  const [uploadingNegativeReferenceImages, setUploadingNegativeReferenceImages] = useState(false);
  const [deletingNegativeReferenceImageId, setDeletingNegativeReferenceImageId] = useState<number | null>(null);
  const [confirmDeleteFaceTarget, setConfirmDeleteFaceTarget] = useState<{
    isOpen: boolean;
    targetId: number | null;
    targetLabel: string;
  }>({
    isOpen: false,
    targetId: null,
    targetLabel: "",
  });
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanceSuggestion, setPromptEnhanceSuggestion] =
    useState<PromptEnhanceSuggestion | null>(null);

  const [pipelineForm, setPipelineForm] = useState({
    pipelines: buildPipelineFormRows(parsePipelinesFromStep(step), step.id),
    on_missing_input: step.on_missing_input || "skip",
  });

  const [startConditionForm, setStartConditionForm] = useState({
    mode: "sequential" as "sequential" | "positive" | "negative" | "custom" | "time",
    step_id: "",
    answer_key: "",
    target_key: "",
    custom_type: "positive" as "positive" | "negative",
    time: "",
    on_fail: "skip" as "skip" | "fail",
  });

  const [alertForm, setAlertForm] = useState({
    channel: "telegram",
    channel_params: "{}",
    message_template: "",
    webhook_url: "",
    webhook_inject: "",
  });

  const isTimeWithinScheduleWindows = (timeHHMM: string): boolean => {
    if (!scheduleDays || scheduleDays.length === 0) return true;
    const targetMinutes = parseHHMMToMinutes(timeHHMM);
    if (targetMinutes === null) return true;
    const windows = scheduleDays.flatMap((d) => d.windows || []);
    if (windows.length === 0) return true;
    return windows.some((w) => {
      const start = parseHHMMToMinutes(w.start_time);
      const end = parseHHMMToMinutes(w.end_time);
      if (start === null || end === null) return false;
      return targetMinutes >= start && targetMinutes <= end;
    });
  };

  useEffect(() => {
    if (expanded) {
      fetchStepData();
      fetchFaceTargetsLibraryData();
      // Parse start condition from existing data
      parseStartCondition();
    }
  }, [expanded]);

  useEffect(() => {
    if (clonePickerTargetId === null) return;
    const stillExists = targets.some((target) => target.id === clonePickerTargetId);
    if (!stillExists) {
      setClonePickerTargetId(null);
    }
  }, [clonePickerTargetId, targets]);

  useEffect(() => {
    if (highlightAgentCreationTargetId === null) return;
    const stillExists = targets.some((target) => target.id === highlightAgentCreationTargetId);
    if (!stillExists) {
      setHighlightAgentCreationTargetId(null);
    }
  }, [highlightAgentCreationTargetId, targets]);

  useEffect(() => {
    hasShownAgentCreationHighlightRef.current = false;
    setHighlightAgentCreationTargetId(null);
    if (agentCreationHighlightTimerRef.current) {
      window.clearTimeout(agentCreationHighlightTimerRef.current);
      agentCreationHighlightTimerRef.current = null;
    }
  }, [step.id]);

  useEffect(() => {
    setEditTimeoutSeconds(normalizeTimeoutForHourMinuteUi(step.timeout_seconds));
  }, [step.id, step.timeout_seconds]);

  useEffect(() => {
    setInferenceGroups(parseInferenceGroups(step.inference_groups));
  }, [step.id, step.inference_groups]);

  useEffect(() => {
    const pipelines = parsePipelinesFromStep(step);
    setPipelineForm({
      pipelines: buildPipelineFormRows(pipelines, step.id),
      on_missing_input: step.on_missing_input || "skip",
    });
  }, [step.id, step.input_from_step_id, step.input_inject_key, step.on_missing_input]);

  const parseStartCondition = () => {
    // Check new columns first (start_condition, start_condition_from_step_id)
    const startCondition = step.start_condition || "";
    const startConditionFromStepId = step.start_condition_from_step_id;
    
    // Legacy fallback: check input_inject_key for old format
    const legacyInjectKey = step.input_inject_key || "";
    const legacyFromStepId = step.input_from_step_id;
    
    // Determine which source to use
    const conditionStr = startCondition || (legacyInjectKey.startsWith("start:") ? legacyInjectKey : "");
    const fromStepId = startConditionFromStepId || (legacyInjectKey.startsWith("start:") ? legacyFromStepId : null);
    
    if (!conditionStr || !conditionStr.startsWith("start:")) {
      // Sequential (default)
      setStartConditionForm({
        mode: "sequential",
        step_id: "",
        answer_key: "",
        target_key: "",
        custom_type: "positive",
        time: "",
        on_fail: "skip",
      });
      return;
    }

    // Parse "start:positive:<key>", "start:negative:<key>", or "start:time:<HH:MM>"
    const parts = conditionStr.split(":");
    if (parts.length < 3) {
      setStartConditionForm({
        mode: "sequential",
        step_id: "",
        answer_key: "",
        target_key: "",
        custom_type: "positive",
        time: "",
        on_fail: "skip",
      });
      return;
    }

    const mode = parts[1] as "positive" | "negative" | "time" | "custom";
    const remainingParts = parts.slice(2); // All parts after mode

    if (mode === "custom") {
      // Parse: start:custom:<answerKey>:<targetKey?>
      const answerKey = remainingParts[0] || "";
      const targetKey = remainingParts[1] || "";
      setStartConditionForm({
        mode: "custom",
        step_id: fromStepId ? String(fromStepId) : "",
        answer_key: answerKey,
        target_key: targetKey,
        custom_type: "positive",
        time: "",
        on_fail: step.on_missing_input === "fail" ? "fail" : "skip",
      });
      return;
    }

    if (mode === "positive" || mode === "negative") {
      // Parse: start:positive:sourceKey or start:positive:sourceKey:targetKey
      const sourceKey = remainingParts[0] || "";
      const targetKey = remainingParts[1] || "";
      
      // Check if this is using the default "result" key (standard mode) or a custom key
      const isCustomKey = sourceKey !== "result";
      setStartConditionForm({
        mode: isCustomKey ? "custom" : mode,
        step_id: fromStepId ? String(fromStepId) : "",
        answer_key: isCustomKey ? sourceKey : "",
        target_key: targetKey,
        custom_type: mode,
        time: "",
        on_fail: step.on_missing_input === "fail" ? "fail" : "skip",
      });
    } else if (mode === "time") {
      setStartConditionForm({
        mode: "time",
        step_id: "",
        answer_key: "",
        target_key: "",
        custom_type: "positive",
        time: remainingParts.join(":"),
        on_fail: "skip",
      });
    }
  };

  useEffect(() => {
    for (const row of pipelineForm.pipelines) {
      if (row.input_from_step_id) {
        const stepId = parseInt(row.input_from_step_id, 10);
        if (!Number.isNaN(stepId) && !pipelineTargetsByStepId[String(stepId)]) {
          fetchPipelineTargets(stepId);
        }
      }
    }
  }, [pipelineForm.pipelines, pipelineTargetsByStepId]);

  useEffect(() => {
    if (startConditionForm.step_id) {
      fetchStartConditionStepTargets(parseInt(startConditionForm.step_id));
    } else {
      setStartConditionStepTargets([]);
    }
  }, [startConditionForm.step_id]);

  const activePromptRegion = useMemo(() => {
    if (!Array.isArray(promptEditorRegions) || promptEditorRegions.length === 0) return null;
    return (
      promptEditorRegions.find((region) => region.region_id === activePromptRegionId) ||
      promptEditorRegions[0]
    );
  }, [promptEditorRegions, activePromptRegionId]);

  useEffect(() => {
    if (!Array.isArray(promptEditorRegions) || promptEditorRegions.length === 0) {
      setActivePromptRegionId("full-frame");
      return;
    }
    if (!promptEditorRegions.some((region) => region.region_id === activePromptRegionId)) {
      setActivePromptRegionId(promptEditorRegions[0].region_id);
    }
  }, [promptEditorRegions, activePromptRegionId]);

  useEffect(() => {
    if (!regionActionRegionId) return;
    if (!promptEditorRegions.some((region) => region.region_id === regionActionRegionId)) {
      setRegionActionRegionId(null);
      setIsRegionActionHovered(false);
    }
  }, [promptEditorRegions, regionActionRegionId]);

  const updatePromptRegionById = (
    regionId: string,
    updater: (region: AnalysisRegion) => AnalysisRegion
  ) => {
    if (!regionId) return;
    setPromptEditorRegions((prev) =>
      prev.map((region) => (region.region_id === regionId ? updater(region) : region))
    );
  };

  useEffect(() => {
    setAgentForm((prev) => ({
      ...prev,
      analysis_regions: promptEditorRegions,
      face_target_ids: collectFaceTargetIdsFromRegions(promptEditorRegions),
    }));
  }, [promptEditorRegions]);

  const fetchFaceTargetsLibraryData = async () => {
    if (!expanded) return;
    setFaceTargetsLoading(true);
    try {
      const response = await fetch("/api/face-targets");
      if (!response.ok) {
        throw new Error(t("jobs.promptEditor.errorFetchFaceTargets"));
      }
      const data = await response.json().catch(() => ({}));
      const targets = Array.isArray(data?.targets) ? data.targets : [];
      const normalizedTargets: FaceTarget[] = targets
        .map((row: any) => {
          const id = Number(row?.id);
          if (!Number.isInteger(id) || id <= 0) return null;
          const imagesRaw = Array.isArray(row?.images) ? row.images : [];
          const images: FaceTargetImage[] = imagesRaw
            .map((img: any) => {
              const imageId = Number(img?.id);
              const imageUrl =
                typeof img?.image_url === "string" ? img.image_url.trim() : "";
              if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
              return {
                id: imageId,
                image_url: imageUrl,
              };
            })
            .filter(Boolean) as FaceTargetImage[];
          return {
            id,
            user_id: typeof row?.user_id === "string" ? row.user_id : "",
            name: typeof row?.name === "string" ? row.name : "",
            description: typeof row?.description === "string" ? row.description : "",
            created_at: typeof row?.created_at === "string" ? row.created_at : "",
            updated_at: typeof row?.updated_at === "string" ? row.updated_at : "",
            image_count:
              Number.isFinite(Number(row?.image_count)) && Number(row?.image_count) >= 0
                ? Number(row.image_count)
                : images.length,
            images,
          };
        })
        .filter(Boolean) as FaceTarget[];

      setFaceTargetsLibrary(normalizedTargets);
    } catch (error) {
      console.error("Failed to fetch face target library:", error);
      onShowToast(t("jobs.promptEditor.toastFailedLoadTargetFaces"), "error");
    } finally {
      setFaceTargetsLoading(false);
    }
  };

  const toggleAgentFaceTarget = (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    setPromptEditorRegions((prev) =>
      prev.map((region) => {
        const current = Array.isArray(region.face_target_ids) ? region.face_target_ids : [];
        const set = new Set(current);
        if (set.has(targetId)) {
          set.delete(targetId);
        } else {
          set.add(targetId);
        }
        return {
          ...region,
          face_target_ids: Array.from(set),
        };
      })
    );
  };

  const createFaceTargetFromDraft = async (
    opts: {
      autoSelect?: boolean;
      silentSuccess?: boolean;
    } = {}
  ): Promise<number | null> => {
    const normalizedName = newFaceTargetName.trim();
    if (!normalizedName || !newFaceTargetFile) {
      return null;
    }
    if (!String(newFaceTargetFile.type || "").toLowerCase().startsWith("image/")) {
      onShowToast(t("jobs.promptEditor.errorUploadFaceImage"), "error");
      return null;
    }
    if (newFaceTargetFile.size > FACE_ID_MAX_UPLOAD_BYTES) {
      onShowToast("Image is too large. Maximum size is 10MB.", "warning");
      return null;
    }

    setCreatingFaceTarget(true);
    try {
      const normalizedUpload = await normalizeFaceIdImage(newFaceTargetFile, {
        maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
      });
      const formData = new FormData();
      formData.append("name", normalizedName);
      formData.append("description", newFaceTargetDescription.trim());
      formData.append("image", normalizedUpload.file, normalizedUpload.file.name);

      const response = await fetch("/api/face-targets", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("jobs.promptEditor.errorCreateFaceTarget"));
      }

      const createdTargetId = Number(data?.target?.id);
      setNewFaceTargetName("");
      setNewFaceTargetDescription("");
      setNewFaceTargetFile(null);
      await fetchFaceTargetsLibraryData();

      if (opts.autoSelect && Number.isInteger(createdTargetId) && createdTargetId > 0) {
        setPromptEditorRegions((prev) =>
          prev.map((region) => {
            const current = Array.isArray(region.face_target_ids) ? region.face_target_ids : [];
            const set = new Set(current);
            set.add(createdTargetId);
            return {
              ...region,
              face_target_ids: Array.from(set),
            };
          })
        );
      }

      if (!opts.silentSuccess) {
        onShowToast(t("jobs.promptEditor.toastTargetFaceCreated"), "success");
      }

      if (Number.isInteger(createdTargetId) && createdTargetId > 0) {
        return createdTargetId;
      }
      return null;
    } catch (error) {
      console.error("Failed to create face target:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorCreateTargetFace"),
        "error"
      );
      return null;
    } finally {
      setCreatingFaceTarget(false);
    }
  };

  const handleCreateFaceTarget = async () => {
    const normalizedName = newFaceTargetName.trim();
    if (!normalizedName) {
      onShowToast(t("jobs.promptEditor.toastFaceTargetNameRequired"), "warning");
      return;
    }
    if (!newFaceTargetFile) {
      onShowToast(t("jobs.promptEditor.toastUploadAtLeastOneFaceImage"), "warning");
      return;
    }
    await createFaceTargetFromDraft({ autoSelect: true });
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

  const handleSaveFaceTargetMeta = async (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    const normalizedName = editingFaceTargetName.trim();
    if (!normalizedName) {
      onShowToast(t("jobs.promptEditor.toastTargetNameRequired"), "warning");
      return;
    }

    setSavingFaceTargetId(targetId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          description: editingFaceTargetDescription.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("jobs.promptEditor.errorUpdateTargetFace"));
      }

      await fetchFaceTargetsLibraryData();
      cancelEditingFaceTarget();
      onShowToast(t("jobs.promptEditor.toastTargetFaceUpdated"), "success");
    } catch (error) {
      console.error("Failed to update face target:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorUpdateTargetFace"),
        "error"
      );
    } finally {
      setSavingFaceTargetId(null);
    }
  };

  const openDeleteFaceTargetDialog = (target: FaceTarget) => {
    const targetId = Number(target?.id);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    const targetLabel = target.name?.trim() || `#${targetId}`;
    setConfirmDeleteFaceTarget({
      isOpen: true,
      targetId,
      targetLabel,
    });
  };

  const closeDeleteFaceTargetDialog = () => {
    setConfirmDeleteFaceTarget({
      isOpen: false,
      targetId: null,
      targetLabel: "",
    });
  };

  const confirmDeleteFaceTargetDialog = () => {
    const targetId = confirmDeleteFaceTarget.targetId;
    closeDeleteFaceTargetDialog();
    if (typeof targetId !== "number" || !Number.isInteger(targetId) || targetId <= 0) return;
    void handleDeleteFaceTarget(targetId);
  };

  const handleDeleteFaceTarget = async (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;

    setDeletingFaceTargetId(targetId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("jobs.promptEditor.errorDeleteTargetFace"));
      }

      await fetchFaceTargetsLibraryData();
      setPromptEditorRegions((prev) =>
        prev.map((region) => ({
          ...region,
          face_target_ids: (Array.isArray(region.face_target_ids) ? region.face_target_ids : []).filter(
            (id) => id !== targetId
          ),
        }))
      );
      if (editingFaceTargetId === targetId) {
        cancelEditingFaceTarget();
      }
      onShowToast(t("jobs.promptEditor.toastTargetFaceDeleted"), "success");
    } catch (error) {
      console.error("Failed to delete face target:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorDeleteTargetFace"),
        "error"
      );
    } finally {
      setDeletingFaceTargetId(null);
    }
  };

  const handleAddFaceTargetImage = async (targetId: number, files: File[]) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!Array.isArray(files) || files.length === 0) return;
    const currentTarget = faceTargetsLibrary.find((target) => target.id === targetId);
    const currentCount = getFaceTargetImageCount(currentTarget);
    if (currentCount >= FACE_TARGET_MAX_IMAGES) {
      onShowToast(`Maximum ${FACE_TARGET_MAX_IMAGES} images per target`, "warning");
      return;
    }
    const availableSlots = FACE_TARGET_MAX_IMAGES - currentCount;
    const candidateFiles = files.filter((file) => String(file.type || "").toLowerCase().startsWith("image/"));
    if (candidateFiles.length === 0) {
      onShowToast(t("jobs.promptEditor.errorUploadFaceImage"), "error");
      return;
    }

    const validSizeFiles = candidateFiles.filter((file) => file.size <= FACE_ID_MAX_UPLOAD_BYTES);
    if (validSizeFiles.length === 0) {
      onShowToast("Image is too large. Maximum size is 10MB.", "warning");
      return;
    }

    const filesToUpload = validSizeFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) {
      onShowToast(`Maximum ${FACE_TARGET_MAX_IMAGES} images per target`, "warning");
      return;
    }

    if (files.length > filesToUpload.length) {
      onShowToast(
        `Only ${filesToUpload.length} image(s) will be uploaded (limit ${FACE_TARGET_MAX_IMAGES} per target).`,
        "warning"
      );
    }

    setFaceTargetUploadingId(targetId);
    try {
      let uploadedCount = 0;
      let firstUploadError: Error | null = null;

      for (const file of filesToUpload) {
        try {
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
          if (!response.ok) {
            throw new Error(data?.error || t("jobs.promptEditor.errorUploadImage"));
          }
          uploadedCount += 1;
        } catch (error) {
          if (!firstUploadError) {
            firstUploadError =
              error instanceof Error
                ? error
                : new Error(t("jobs.promptEditor.errorUploadFaceImage"));
          }
        }
      }

      if (uploadedCount > 0) {
        await fetchFaceTargetsLibraryData();
        onShowToast(
          uploadedCount === 1
            ? t("jobs.promptEditor.toastFaceImageAdded")
            : `${uploadedCount} face images added`,
          "success"
        );
      }
      if (firstUploadError) {
        throw firstUploadError;
      }
    } catch (error) {
      console.error("Failed to upload face target image:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorUploadFaceImage"),
        "error"
      );
    } finally {
      setFaceTargetUploadingId(null);
    }
  };

  const handleDeleteFaceTargetImage = async (targetId: number, imageId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!Number.isInteger(imageId) || imageId <= 0) return;
    setFaceTargetDeletingImageId(imageId);
    try {
      const response = await fetch(`/api/face-targets/${targetId}/images/${imageId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("jobs.promptEditor.errorDeleteFaceImage"));
      }
      await fetchFaceTargetsLibraryData();
      onShowToast(t("jobs.promptEditor.toastFaceImageRemoved"), "success");
    } catch (error) {
      console.error("Failed to delete face target image:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorDeleteFaceImage"),
        "error"
      );
    } finally {
      setFaceTargetDeletingImageId(null);
    }
  };

  const getEditingCameraAgent = (): Agent | null => {
    if (agentFormCameraId === null) return null;
    const targetAgent = agents.find(
      (agent) => agent.is_active === 1 && agent.camera_id === agentFormCameraId
    );
    return targetAgent || null;
  };

  const normalizeAgentFromApiRow = (agent: any): Agent => {
    const split = parsePromptTemplate(agent?.prompt_template || "", agent?.alert_condition);
    const faceTargetIds: number[] = Array.isArray(agent?.face_target_ids)
      ? Array.from(
          new Set(
            agent.face_target_ids
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isInteger(value) && value > 0)
          )
        )
      : [];
    const negativeReferenceImages: NegativeReferenceImage[] = Array.isArray(
      agent?.negative_reference_images
    )
      ? agent.negative_reference_images
          .map((img: any) => {
            const imageId = Number(img?.id);
            const imageUrl =
              typeof img?.image_url === "string" ? img.image_url.trim() : "";
            if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
            return {
              id: imageId,
              image_url: imageUrl,
            } as NegativeReferenceImage;
          })
          .filter(
            (image: NegativeReferenceImage | null): image is NegativeReferenceImage =>
              image !== null
          )
      : [];
    const negativeImageIds = extractNegativeImageIdsFromImages(negativeReferenceImages);
    const analysisRegions = normalizeAnalysisRegionsForForm(
      agent?.analysis_regions ?? agent?.analysisRegions,
      split,
      faceTargetIds,
      negativeImageIds
    );
    return {
      ...agent,
      video_packaging_mode: normalizeAgentVideoPackagingMode(
        agent?.video_packaging_mode ?? agent?.videoPackagingMode
      ),
      only_capture_on_motion: normalizeAgentOnlyCaptureOnMotion(
        agent?.only_capture_on_motion ?? agent?.onlyCaptureOnMotion
      ),
      use_temporal_context: normalizeAgentUseTemporalContext(
        agent?.use_temporal_context ?? agent?.useTemporalContext
      ),
      face_target_ids: faceTargetIds,
      negative_reference_images: negativeReferenceImages,
      analysis_regions: analysisRegions,
    };
  };

  const fetchLatestAgentForPromptEditor = async (cameraId: number): Promise<Agent | null> => {
    if (!Number.isInteger(cameraId) || cameraId <= 0) return null;
    try {
      const response = await fetch(`/api/job-steps/${step.id}/agents`);
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      const normalizedAgents: Agent[] = Array.isArray(data?.agents)
        ? data.agents.map((row: any) => normalizeAgentFromApiRow(row))
        : [];
      if (normalizedAgents.length > 0) {
        setAgents(normalizedAgents);
      }
      return (
        normalizedAgents.find(
          (agent) => agent.is_active === 1 && Number(agent.camera_id) === cameraId
        ) || null
      );
    } catch (error) {
      console.warn("Failed to refresh latest prompt editor agent from backend:", error);
      return null;
    }
  };

  const getPromptEditorCameraName = (cameraId: number | null): string => {
    if (!Number.isInteger(cameraId) || (cameraId as number) <= 0) {
      return "No camera selected";
    }
    const found = cameras.find((camera) => camera.id === cameraId);
    const normalizedName =
      typeof found?.name === "string" ? found.name.trim() : "";
    return normalizedName || `Camera ${cameraId}`;
  };

  const refreshPromptEditorSnapshotMeta = async (cameraId: number): Promise<boolean> => {
    if (!Number.isInteger(cameraId) || cameraId <= 0) return false;
    const response = await fetch(`/api/cameras/${cameraId}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to load camera snapshot metadata");
    }
    const thumbnailUrl =
      typeof data?.thumbnail_url === "string" && data.thumbnail_url.trim()
        ? data.thumbnail_url.trim()
        : null;
    const lastThumbnailUpdate =
      typeof data?.last_thumbnail_update === "string" && data.last_thumbnail_update.trim()
        ? data.last_thumbnail_update.trim()
        : null;
    setPromptEditorSnapshotMeta({
      thumbnail_url: thumbnailUrl,
      last_thumbnail_update: lastThumbnailUpdate,
    });
    return !!thumbnailUrl;
  };

  const clearPromptEditorSnapshotRefreshCooldown = () => {
    if (promptEditorSnapshotRefreshCooldownTimerRef.current) {
      clearTimeout(promptEditorSnapshotRefreshCooldownTimerRef.current);
      promptEditorSnapshotRefreshCooldownTimerRef.current = null;
    }
    setPromptEditorSnapshotRefreshCooldownUntil(0);
  };

  const startPromptEditorSnapshotRefreshCooldown = () => {
    const cooldownUntil = Date.now() + PROMPT_EDITOR_SNAPSHOT_REFRESH_COOLDOWN_MS;
    setPromptEditorSnapshotRefreshCooldownUntil(cooldownUntil);
    if (promptEditorSnapshotRefreshCooldownTimerRef.current) {
      clearTimeout(promptEditorSnapshotRefreshCooldownTimerRef.current);
    }
    promptEditorSnapshotRefreshCooldownTimerRef.current = setTimeout(() => {
      promptEditorSnapshotRefreshCooldownTimerRef.current = null;
      setPromptEditorSnapshotRefreshCooldownUntil(0);
    }, PROMPT_EDITOR_SNAPSHOT_REFRESH_COOLDOWN_MS);
  };

  const requestPromptEditorSnapshotRefresh = async (cameraId: number): Promise<void> => {
    if (!Number.isInteger(cameraId) || cameraId <= 0) return;
    if (promptEditorSnapshotRefreshInFlightRef.current) return;
    if (Date.now() < promptEditorSnapshotRefreshCooldownUntil) return;

    promptEditorSnapshotRefreshInFlightRef.current = true;
    startPromptEditorSnapshotRefreshCooldown();
    setPromptEditorSnapshotRequesting(true);
    setPromptEditorSnapshotError(null);

    try {
      const response = await fetch(`/api/cameras/${cameraId}/refresh-thumbnail`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to request thumbnail refresh");
      }
    } catch (error) {
      setPromptEditorSnapshotRequesting(false);
      setPromptEditorSnapshotError(
        error instanceof Error ? error.message : "Failed to request thumbnail refresh"
      );
    } finally {
      promptEditorSnapshotRefreshInFlightRef.current = false;
    }
  };

  const normalizeNegativeReferenceImages = (rows: unknown): NegativeReferenceImage[] => {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row: any) => {
        const imageId = Number(row?.id);
        const imageUrl = typeof row?.image_url === "string" ? row.image_url.trim() : "";
        if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
        return {
          id: imageId,
          image_url: imageUrl,
        } as NegativeReferenceImage;
      })
      .filter(Boolean) as NegativeReferenceImage[];
  };

  const refreshNegativeReferenceImagesForAgent = async (
    agentId: number
  ): Promise<NegativeReferenceImage[] | null> => {
    if (!Number.isInteger(agentId) || agentId <= 0) return null;
    const response = await fetch(`/api/job-step-agents/${agentId}/negative-images`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to load negative reference images");
    }
    const images = normalizeNegativeReferenceImages(data?.images);
    setAgentForm((prev) => ({
      ...prev,
      negative_reference_images: images,
    }));
    const validIds = new Set(
      images
        .map((img) => Number(img.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setPromptEditorRegions((prev) =>
      prev.map((region) => ({
        ...region,
        negative_image_ids: (Array.isArray(region.negative_image_ids) ? region.negative_image_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0 && validIds.has(id)),
      }))
    );
    return images;
  };

  const handleAddNegativeReferenceImages = async (files: File[]) => {
    if (!Array.isArray(files) || files.length === 0) return;
    const targetAgent = getEditingCameraAgent();
    if (!targetAgent || !Number.isInteger(targetAgent.id) || targetAgent.id <= 0) {
      onShowToast(
        "Save this camera agent first, then upload negative reference images.",
        "warning"
      );
      return;
    }

    const currentCount = getNegativeReferenceImageCount(agentForm.negative_reference_images);
    if (currentCount >= NEGATIVE_REFERENCE_MAX_IMAGES) {
      onShowToast(`Maximum ${NEGATIVE_REFERENCE_MAX_IMAGES} negative reference images`, "warning");
      return;
    }

    const availableSlots = NEGATIVE_REFERENCE_MAX_IMAGES - currentCount;
    const candidateFiles = files.filter((file) =>
      String(file.type || "").toLowerCase().startsWith("image/")
    );
    if (candidateFiles.length === 0) {
      onShowToast(t("jobs.promptEditor.errorUploadFaceImage"), "error");
      return;
    }

    const validSizeFiles = candidateFiles.filter((file) => file.size <= FACE_ID_MAX_UPLOAD_BYTES);
    if (validSizeFiles.length === 0) {
      onShowToast("Image is too large. Maximum size is 10MB.", "warning");
      return;
    }

    const filesToUpload = validSizeFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) {
      onShowToast(`Maximum ${NEGATIVE_REFERENCE_MAX_IMAGES} negative reference images`, "warning");
      return;
    }

    if (files.length > filesToUpload.length) {
      onShowToast(
        `Only ${filesToUpload.length} image(s) will be uploaded (limit ${NEGATIVE_REFERENCE_MAX_IMAGES}).`,
        "warning"
      );
    }

    setUploadingNegativeReferenceImages(true);
    try {
      let uploadedCount = 0;
      let firstUploadError: Error | null = null;

      for (const file of filesToUpload) {
        try {
          const normalizedUpload = await normalizeFaceIdImage(file, {
            maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
          });
          const formData = new FormData();
          formData.append("image", normalizedUpload.file, normalizedUpload.file.name);
          const response = await fetch(
            `/api/job-step-agents/${targetAgent.id}/negative-images`,
            {
              method: "POST",
              body: formData,
            }
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || "Failed to upload negative reference image");
          }
          uploadedCount += 1;
        } catch (error) {
          if (!firstUploadError) {
            firstUploadError =
              error instanceof Error
                ? error
                : new Error("Failed to upload negative reference image");
          }
        }
      }

      if (uploadedCount > 0) {
        await refreshNegativeReferenceImagesForAgent(targetAgent.id);
        await fetchStepData();
        onShowToast(
          uploadedCount === 1
            ? "Negative reference image added"
            : `${uploadedCount} negative reference images added`,
          "success"
        );
      }
      if (firstUploadError) {
        throw firstUploadError;
      }
    } catch (error) {
      console.error("Failed to upload negative reference image:", error);
      onShowToast(
        error instanceof Error ? error.message : "Failed to upload negative reference image",
        "error"
      );
    } finally {
      setUploadingNegativeReferenceImages(false);
    }
  };

  const handleDeleteNegativeReferenceImage = async (imageId: number) => {
    if (!Number.isInteger(imageId) || imageId <= 0) return;
    const targetAgent = getEditingCameraAgent();
    if (!targetAgent || !Number.isInteger(targetAgent.id) || targetAgent.id <= 0) {
      onShowToast("Agent not found for this camera", "error");
      return;
    }

    setDeletingNegativeReferenceImageId(imageId);
    try {
      const response = await fetch(
        `/api/job-step-agents/${targetAgent.id}/negative-images/${imageId}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to delete negative reference image");
      }
      await refreshNegativeReferenceImagesForAgent(targetAgent.id);
      await fetchStepData();
      onShowToast("Negative reference image removed", "success");
    } catch (error) {
      console.error("Failed to delete negative reference image:", error);
      onShowToast(
        error instanceof Error ? error.message : "Failed to delete negative reference image",
        "error"
      );
    } finally {
      setDeletingNegativeReferenceImageId(null);
    }
  };

  const toggleActiveRegionNegativeImage = (imageId: number) => {
    if (!Number.isInteger(imageId) || imageId <= 0) return;
    setPromptEditorRegions((prev) =>
      prev.map((region) => {
        const current = Array.isArray(region.negative_image_ids) ? region.negative_image_ids : [];
        const set = new Set(current);
        if (set.has(imageId)) {
          set.delete(imageId);
        } else {
          set.add(imageId);
        }
        return {
          ...region,
          negative_image_ids: Array.from(set),
        };
      })
    );
  };

  const fetchStepData = async () => {
    try {
      const [targetsRes, agentsRes, alertsRes] = await Promise.all([
        fetch(`/api/job-steps/${step.id}/targets`),
        fetch(`/api/job-steps/${step.id}/agents`),
        fetch(`/api/job-steps/${step.id}/alerts`),
      ]);

      if (targetsRes.ok) {
        const data = await targetsRes.json();
        setTargets(data.targets || []);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        const normalizedAgents = Array.isArray(data?.agents)
          ? data.agents.map((agent: any) => normalizeAgentFromApiRow(agent))
          : [];
        setAgents(normalizedAgents);
      }
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data.alerts || []);
      }
    } catch (error) {
      console.error("Failed to fetch step data:", error);
    }
  };

  useEffect(() => {
    if (!targets.length) return;
    const next: Record<number, AgentPriority> = {};
    targets.forEach((target) => {
      const targetAgent = agents.find(
        (a) => a.is_active === 1 && a.camera_id === target.camera_id
      );
      if (targetAgent?.priority_level) {
        next[target.id] = targetAgent.priority_level;
      }
    });
    if (Object.keys(next).length > 0) {
      setAgentPriorities((prev) => ({ ...prev, ...next }));
    }
  }, [targets, agents]);

  useEffect(() => {
    if (!targets.length) return;
    const next: Record<number, AgentInferenceModel> = {};
    targets.forEach((target) => {
      const targetAgent = agents.find(
        (a) => a.is_active === 1 && a.camera_id === target.camera_id
      );
      if (targetAgent) {
        next[target.id] = normalizeAgentInferenceModel(targetAgent.inference_model);
      }
    });
    if (Object.keys(next).length > 0) {
      setAgentInferenceModels((prev) => ({ ...prev, ...next }));
    }
  }, [targets, agents]);

  useEffect(() => {
    if (!targets.length) return;
    const next: Record<number, AgentRunEverySeconds> = {};
    targets.forEach((target) => {
      const targetAgent = agents.find(
        (a) => a.is_active === 1 && a.camera_id === target.camera_id
      );
      if (targetAgent) {
        next[target.id] = normalizeAgentRunEverySeconds(
          targetAgent.run_every,
          FIXED_AGENT_RUN_EVERY_SECONDS
        );
      }
    });
    if (Object.keys(next).length > 0) {
      setAgentRunEvery((prev) => ({ ...prev, ...next }));
    }
  }, [targets, agents]);

  useEffect(() => {
    if (!targets.length) return;
    const next: Record<number, boolean> = {};
    targets.forEach((target) => {
      const targetAgent = agents.find(
        (a) => a.is_active === 1 && a.camera_id === target.camera_id
      );
      next[target.id] = normalizeAgentOnlyCaptureOnMotion(targetAgent?.only_capture_on_motion);
    });
    if (Object.keys(next).length > 0) {
      setAgentOnlyCaptureOnMotion((prev) => ({ ...prev, ...next }));
    }
  }, [targets, agents]);

  useEffect(() => {
    setTargetInputTypes((prev) => {
      const next: Record<number, TargetInputType> = {};
      targets.forEach((target) => {
        next[target.id] = normalizeTargetInputType(target.input_type ?? prev[target.id]);
      });
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      const sameLength = prevEntries.length === nextEntries.length;
      const sameValues = sameLength && nextEntries.every(([id, value]) => prev[Number(id)] === value);
      return sameValues ? prev : next;
    });
  }, [targets]);

  const fetchPipelineTargets = async (stepId: number) => {
    try {
      const key = String(stepId);
      const response = await fetch(`/api/job-steps/${stepId}/targets`);
      if (response.ok) {
        const data = await response.json();
        setPipelineTargetsByStepId((prev) => ({
          ...prev,
          [key]: data.targets || [],
        }));
      }
    } catch (error) {
      console.error("Failed to fetch pipeline step targets:", error);
    }
  };

  const fetchStartConditionStepTargets = async (stepId: number) => {
    try {
      const response = await fetch(`/api/job-steps/${stepId}/targets`);
      if (response.ok) {
        const data = await response.json();
        setStartConditionStepTargets(data.targets || []);
      }
    } catch (error) {
      console.error("Failed to fetch start condition step targets:", error);
      setStartConditionStepTargets([]);
    }
  };

  const handleAddTarget = async (cameraId: number) => {
    try {
      const response = await fetch(`/api/job-steps/${step.id}/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cameraId }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const createdTargetId = Number(data?.target?.id);
        await fetchStepData();
        setShowTargetSelect(false);
        if (Number.isInteger(createdTargetId) && createdTargetId > 0) {
          triggerAgentCreationHighlight(createdTargetId);
        }
      }
    } catch (error) {
      console.error("Failed to add target:", error);
    }
  };

  const handleRemoveTarget = async (targetId: number) => {
    try {
      const response = await fetch(`/api/job-steps/${step.id}/targets/${targetId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchStepData();
      }
    } catch (error) {
      console.error("Failed to remove target:", error);
    }
  };

  const normalizePromptEditorFields = (fields: PromptEditorFields): PromptEditorFields => ({
    prompt_template: String(fields.prompt_template || "").trim(),
    alert_condition: String(fields.alert_condition || "").trim(),
    negative_condition: String(fields.negative_condition || "").trim(),
  });

  const buildPromptPayload = (fields: PromptEditorFields): { prompt_template: string; alert_condition: string } => {
    const normalized = normalizePromptEditorFields(fields);
    return {
      prompt_template: buildPromptTemplate(normalized),
      alert_condition: normalized.alert_condition,
    };
  };

  const buildAgentUpsertRequestBody = ({
    source,
    cameraId,
    promptPayload,
    analysisRegions,
    inputType,
  }: {
    source: {
      agent_key: string;
      params?: string | null;
      input_schema?: string | null;
      priority_level?: AgentPriority | null;
      inference_model?: AgentInferenceModel;
      model_fps?: number;
      run_every?: AgentRunEverySeconds;
      running_resolution?: AgentRunningResolution | null;
      video_packaging_mode?: AgentVideoPackagingMode | string | null;
      only_capture_on_motion?: boolean;
      use_temporal_context?: boolean;
    };
    cameraId: number;
    promptPayload: {
      prompt_template: string;
      alert_condition: string;
    };
    analysisRegions: AnalysisRegion[];
    inputType?: TargetInputType | null;
  }) => {
    const inferenceModel = normalizeAgentInferenceModel(source.inference_model);
    const body: Record<string, unknown> = {
      agent_key: source.agent_key,
      prompt_template: promptPayload.prompt_template,
      alert_condition: promptPayload.alert_condition,
      camera_id: cameraId,
      params: source.params ?? "{}",
      input_schema: source.input_schema ?? "{}",
      priority_level: source.priority_level || "MEDIUM",
      inference_model: inferenceModel,
      model_fps: normalizeAgentModelFps(source.model_fps),
      run_every: normalizeAgentRunEverySeconds(
        source.run_every,
        FIXED_AGENT_RUN_EVERY_SECONDS
      ),
      video_packaging_mode: normalizeAgentVideoPackagingMode(source.video_packaging_mode),
      running_resolution:
        inferenceModel === "core"
          ? normalizeAgentRunningResolution(
              source.running_resolution,
              DEFAULT_CORE_RUNNING_RESOLUTION
            )
          : null,
      only_capture_on_motion: normalizeAgentOnlyCaptureOnMotion(
        source.only_capture_on_motion
      ),
      face_target_ids: collectFaceTargetIdsFromRegions(analysisRegions),
      analysis_regions: analysisRegions,
    };
    const normalizedInputType =
      inputType == null ? null : normalizeTargetInputType(inputType);
    if (normalizedInputType) {
      body.input_type = normalizedInputType;
    }

    if (JOBS_TEMPORAL_CONTEXT_TOGGLE_ENABLED) {
      body.use_temporal_context = normalizeAgentUseTemporalContext(
        source.use_temporal_context
      );
    }

    return body;
  };

  const getPromptFieldsFromAgent = (
    agent: Pick<Agent, "prompt_template" | "alert_condition">
  ): PromptEditorFields => parsePromptTemplate(agent.prompt_template || "", agent.alert_condition);

  const getAnalysisRegionsFromAgent = (
    agent: Pick<
      Agent,
      "analysis_regions" | "prompt_template" | "alert_condition" | "face_target_ids" | "negative_reference_images"
    >
  ): AnalysisRegion[] => {
    const promptFields = parsePromptTemplate(agent.prompt_template || "", agent.alert_condition);
    const faceTargetIds = Array.isArray(agent.face_target_ids)
      ? Array.from(
          new Set(
            agent.face_target_ids
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isInteger(value) && value > 0)
          )
        )
      : [];
    const negativeImageIds = extractNegativeImageIdsFromImages(
      Array.isArray(agent.negative_reference_images) ? agent.negative_reference_images : []
    );
    return normalizeAnalysisRegionsForPayload(
      agent.analysis_regions,
      promptFields,
      faceTargetIds,
      negativeImageIds
    );
  };

  const upsertAgentFromForm = async (form: AgentFormState): Promise<boolean> => {
    const fallbackPromptFields = normalizePromptEditorFields({
      prompt_template: form.prompt_template,
      alert_condition: form.alert_condition,
      negative_condition: form.negative_condition,
    });
    const fallbackFaceTargetIds = Array.isArray(form.face_target_ids)
      ? form.face_target_ids
      : [];
    const fallbackNegativeImageIds = extractNegativeImageIdsFromImages(form.negative_reference_images);
    const analysisRegions = normalizeAnalysisRegionsForPayload(
      form.analysis_regions,
      fallbackPromptFields,
      fallbackFaceTargetIds,
      fallbackNegativeImageIds
    );
    const mergedFaceTargetIds =
      fallbackFaceTargetIds.length > 0
        ? fallbackFaceTargetIds
        : collectFaceTargetIdsFromRegions(analysisRegions);
    const syncedRegions = analysisRegions.map((region) => ({
      ...region,
      prompt_core: fallbackPromptFields.prompt_template,
      alert_condition: fallbackPromptFields.alert_condition,
      negative_condition: fallbackPromptFields.negative_condition,
      face_target_ids: mergedFaceTargetIds,
      negative_image_ids: fallbackNegativeImageIds,
      context_padding_pct: 0,
    }));
    const primaryRegion = syncedRegions[0] || buildDefaultAnalysisRegion(
      fallbackPromptFields,
      mergedFaceTargetIds,
      fallbackNegativeImageIds,
      0
    );
    const hasFaceTargets = mergedFaceTargetIds.length > 0;
    const normalizedAgentKey = String(form.agent_key || "").trim().toLowerCase();
    const isFaceIdAgent =
      normalizedAgentKey === "faceid" ||
      normalizedAgentKey === "face_id" ||
      normalizedAgentKey === "face-id";
    if (!form.agent_key || (!primaryRegion.prompt_core?.trim() && !hasFaceTargets)) {
      alert(t("jobs.promptEditor.alertAgentKeyAndPromptRequired"));
      return false;
    }
    if (isFaceIdAgent && !hasFaceTargets) {
      alert(t("jobs.promptEditor.alertFaceIdNeedsTarget"));
      return false;
    }

    if (agentFormCameraId === null) {
      alert(t("jobs.promptEditor.alertTargetCameraRequired"));
      return false;
    }

    try {
      const targetForCamera =
        targets.find((target) => target.camera_id === agentFormCameraId) || null;
      const inputTypeForSave = showPromptEditor
        ? promptEditorInputTypeDraft
        : normalizeTargetInputType(
            targetForCamera
              ? targetInputTypes[targetForCamera.id] ?? targetForCamera.input_type
              : "video"
          );
      const promptPayload = buildPromptPayload({
        prompt_template: primaryRegion.prompt_core,
        alert_condition: primaryRegion.alert_condition,
        negative_condition: primaryRegion.negative_condition,
      });
      const response = await fetch(`/api/job-steps/${step.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAgentUpsertRequestBody({
            source: form,
            cameraId: agentFormCameraId,
            promptPayload,
            analysisRegions: syncedRegions,
            inputType: inputTypeForSave,
          })
        ),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (handleModelApiKeyRequired(error)) {
          return false;
        }
        onShowToast(error?.message || error?.error || "Failed to save agent", "error");
        return false;
      }

      await fetchStepData();
      return true;
    } catch (error) {
      console.error("Failed to save agent:", error);
      onShowToast("Failed to save agent", "error");
      return false;
    }
  };

  const handleSaveAgent = async () => {
    const saved = await upsertAgentFromForm(agentForm);
    if (!saved) return;

    setShowAgentForm(false);
    setHighlightAgentForm(false);
    if (agentFormHighlightTimerRef.current) {
      window.clearTimeout(agentFormHighlightTimerRef.current);
      agentFormHighlightTimerRef.current = null;
    }
    setShowPromptEditor(false);
    setPromptEnhanceSuggestion(null);
    setAgentFormCameraId(null);
    setAgentForm(buildEmptyAgentForm());
  };

  const handlePriorityChange = async (
    target: Target,
    targetAgent: Agent | undefined,
    newPriority: AgentPriority
  ) => {
    const previousPriority =
      agentPriorities[target.id] || targetAgent?.priority_level || "MEDIUM";

    setAgentPriorities((prev) => ({ ...prev, [target.id]: newPriority }));

    if (!targetAgent) {
      return;
    }

    setSavingPriorities((prev) => new Set(prev).add(target.id));
    try {
      const promptFields = getPromptFieldsFromAgent(targetAgent);
      const promptPayload = buildPromptPayload(promptFields);
      const analysisRegions = getAnalysisRegionsFromAgent(targetAgent);

      const response = await fetch(`/api/job-steps/${step.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAgentUpsertRequestBody({
            source: {
              ...targetAgent,
              priority_level: newPriority,
            },
            cameraId: targetAgent.camera_id ?? target.camera_id,
            promptPayload,
            analysisRegions,
          })
        ),
      });

      if (response.ok) {
        await fetchStepData();
      } else {
        const error = await response.json().catch(() => null);
        if (handleModelApiKeyRequired(error)) {
          setAgentPriorities((prev) => ({ ...prev, [target.id]: previousPriority }));
          return;
        }
        onShowToast(error?.message || error?.error || "Failed to update priority", "error");
        setAgentPriorities((prev) => ({ ...prev, [target.id]: previousPriority }));
      }
    } catch (error) {
      console.error("Failed to update priority:", error);
      onShowToast("Failed to update priority", "error");
      setAgentPriorities((prev) => ({ ...prev, [target.id]: previousPriority }));
    } finally {
      setSavingPriorities((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  };

  const handleOnlyCaptureOnMotionChange = async (
    target: Target,
    targetAgent: Agent | undefined,
    onlyCaptureOnMotion: boolean
  ) => {
    const previousValue =
      agentOnlyCaptureOnMotion[target.id] ??
      normalizeAgentOnlyCaptureOnMotion(targetAgent?.only_capture_on_motion);

    setAgentOnlyCaptureOnMotion((prev) => ({ ...prev, [target.id]: onlyCaptureOnMotion }));

    if (!targetAgent) {
      return;
    }

    setSavingOnlyCaptureOnMotion((prev) => new Set(prev).add(target.id));
    try {
      const promptFields = getPromptFieldsFromAgent(targetAgent);
      const promptPayload = buildPromptPayload(promptFields);
      const analysisRegions = getAnalysisRegionsFromAgent(targetAgent);

      const response = await fetch(`/api/job-steps/${step.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAgentUpsertRequestBody({
            source: {
              ...targetAgent,
              only_capture_on_motion: onlyCaptureOnMotion,
            },
            cameraId: targetAgent.camera_id ?? target.camera_id,
            promptPayload,
            analysisRegions,
          })
        ),
      });

      if (response.ok) {
        await fetchStepData();
      } else {
        const error = await response.json().catch(() => null);
        if (handleModelApiKeyRequired(error)) {
          setAgentOnlyCaptureOnMotion((prev) => ({ ...prev, [target.id]: previousValue }));
          return;
        }
        onShowToast(error?.message || error?.error || "Failed to update capture mode", "error");
        setAgentOnlyCaptureOnMotion((prev) => ({ ...prev, [target.id]: previousValue }));
      }
    } catch (error) {
      console.error("Failed to update capture mode:", error);
      onShowToast("Failed to update capture mode", "error");
      setAgentOnlyCaptureOnMotion((prev) => ({ ...prev, [target.id]: previousValue }));
    } finally {
      setSavingOnlyCaptureOnMotion((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  };

  const handleCloneAgentFromCamera = async (target: Target, sourceCameraId: number) => {
    const sourceAgent = activeAgentByCameraId.get(sourceCameraId);
    if (!sourceAgent) {
      onShowToast("Selected source camera has no active agent", "warning");
      return;
    }

    setCloningTargets((prev) => {
      const next = new Set(prev);
      next.add(target.id);
      return next;
    });

    try {
      const promptFields = getPromptFieldsFromAgent(sourceAgent);
      const promptPayload = buildPromptPayload(promptFields);
      const analysisRegions = getAnalysisRegionsFromAgent(sourceAgent);

      const response = await fetch(`/api/job-steps/${step.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAgentUpsertRequestBody({
            source: {
              ...sourceAgent,
              only_capture_on_motion: normalizeAgentOnlyCaptureOnMotion(
                sourceAgent.only_capture_on_motion
              ),
            },
            cameraId: target.camera_id,
            promptPayload,
            analysisRegions,
          })
        ),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (handleModelApiKeyRequired(error)) {
          return;
        }
        onShowToast(error?.message || error?.error || "Failed to clone agent", "error");
        return;
      }

      setAgentPriorities((prev) => ({
        ...prev,
        [target.id]: sourceAgent.priority_level || "MEDIUM",
      }));
      setAgentInferenceModels((prev) => ({
        ...prev,
        [target.id]: normalizeAgentInferenceModel(sourceAgent.inference_model),
      }));
      setAgentOnlyCaptureOnMotion((prev) => ({
        ...prev,
        [target.id]: normalizeAgentOnlyCaptureOnMotion(sourceAgent.only_capture_on_motion),
      }));

      await fetchStepData();
      setClonePickerTargetId((current) => (current === target.id ? null : current));
      onShowToast("Agent cloned successfully", "success");
    } catch (error) {
      console.error("Failed to clone agent:", error);
      onShowToast("Failed to clone agent", "error");
    } finally {
      setCloningTargets((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  };

  const requestCloneAgentFromCamera = (target: Target, sourceCameraId: number) => {
    const sourceAgent = activeAgentByCameraId.get(sourceCameraId);
    if (!sourceAgent) {
      onShowToast("Selected source camera has no active agent", "warning");
      return;
    }
    setConfirmCloneAgent({
      isOpen: true,
      targetId: target.id,
      sourceCameraId,
    });
  };

  const closeCloneAgentConfirmDialog = () => {
    setConfirmCloneAgent({
      isOpen: false,
      targetId: null,
      sourceCameraId: null,
    });
  };

  const confirmCloneAgentFromCamera = async () => {
    const target =
      confirmCloneAgent.targetId !== null
        ? targets.find((candidate) => candidate.id === confirmCloneAgent.targetId) || null
        : null;
    const sourceCameraId = confirmCloneAgent.sourceCameraId;
    closeCloneAgentConfirmDialog();
    if (!target || sourceCameraId === null) {
      onShowToast("Unable to resolve clone target", "error");
      return;
    }
    await handleCloneAgentFromCamera(target, sourceCameraId);
  };

  const createEmptyPipelineRow = (): PipelineFormRow => ({
    id: `pipeline-${step.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    input_from_step_id: "",
    input_inject_keys: [],
    target_camera_id: "",
  });

  const updatePipelineRow = (rowId: string, patch: Partial<PipelineFormRow>) => {
    setPipelineForm((prev) => ({
      ...prev,
      pipelines: prev.pipelines.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  };

  const addPipelineRow = () => {
    setPipelineForm((prev) => ({
      ...prev,
      pipelines: [...prev.pipelines, createEmptyPipelineRow()],
    }));
  };

  const removePipelineRow = (rowId: string) => {
    setPipelineForm((prev) => {
      const remaining = prev.pipelines.filter((row) => row.id !== rowId);
      return {
        ...prev,
        pipelines: remaining.length ? remaining : [createEmptyPipelineRow()],
      };
    });
  };

  const handleSavePipeline = async () => {
    try {
      const pipelines = pipelineForm.pipelines
        .filter((p) => p.input_from_step_id)
        .map((p) => {
          const targetId = p.target_camera_id ? parseInt(p.target_camera_id, 10) : null;
          const targetName = targetId
            ? targets.find((t) => t.camera_id === targetId)?.camera_name || null
            : null;
          return {
            input_from_step_id: parseInt(p.input_from_step_id, 10),
            input_inject_keys: normalizePipelineKeys(p.input_inject_keys),
            target_camera_id: Number.isFinite(targetId as any) ? targetId : null,
            target_camera_name: targetName,
          };
        });

      for (const p of pipelines) {
        if (!p.input_from_step_id || Number.isNaN(p.input_from_step_id)) {
          onShowToast("Previous step is required for each pipeline", "error");
          return;
        }
        if (!p.input_inject_keys.length) {
          onShowToast("At least one input target is required for each pipeline", "error");
          return;
        }
        const badKey = p.input_inject_keys.find((k) => k.startsWith("start:"));
        if (badKey) {
          onShowToast("Cannot use 'start:' prefix in input keys - reserved for Start Conditions", "error");
          return;
        }
      }

      const response = await fetch(`/api/job-steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelines,
          on_missing_input: pipelineForm.on_missing_input || "skip",
        }),
      });

      if (response.ok) {
        await onStepUpdated();
        setShowPipelineForm(false);
        onShowToast("Pipeline saved successfully", "success");
      } else {
        const error = await response.json();
        onShowToast(error.message || error.error || "Failed to save pipeline", "error");
      }
    } catch (error) {
      console.error("Failed to save pipeline:", error);
      onShowToast("Failed to save pipeline", "error");
    }
  };

  const handleSaveStepSettings = async () => {
    const timeoutValue = Math.round(Number(editTimeoutSeconds));
    if (!Number.isFinite(timeoutValue) || timeoutValue < MIN_STEP_TIMEOUT_SECONDS) {
      onShowToast(`Timeout must be at least ${MIN_STEP_TIMEOUT_SECONDS / 60} minutes`, "error");
      return;
    }
    if (
      jobMaxTimeoutSeconds !== null &&
      timeoutValue > jobMaxTimeoutSeconds
    ) {
      onShowToast(
        `Timeout cannot exceed job limit (${formatStepTimeoutHuman(jobMaxTimeoutSeconds)})`,
        "error"
      );
      return;
    }

    try {
      const response = await fetch(`/api/job-steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeout_seconds: timeoutValue,
        }),
      });

      if (response.ok) {
        await onStepUpdated();
        setIsEditingTimeout(false);
        onShowToast("Step timeout updated successfully", "success");
      } else {
        const error = await response.json();
        onShowToast(error.message || error.error || "Failed to update step timeout", "error");
      }
    } catch (error) {
      console.error("Failed to update step timeout:", error);
      onShowToast("Failed to update step timeout", "error");
    }
  };

  const handleSaveStartCondition = async () => {
    try {
      let start_condition: string | null = null;
      let start_condition_from_step_id: number | null = null;
      let on_missing_input: string = "skip";

      if (startConditionForm.mode === "sequential") {
        // Sequential: nulls
        const prevStep = steps
          .filter((s) => s.step_order < step.step_order)
          .sort((a, b) => b.step_order - a.step_order)[0];
        if (prevStep) {
          start_condition = "start:sequential";
          start_condition_from_step_id = prevStep.id;
        } else {
          start_condition = null;
          start_condition_from_step_id = null;
        }
        on_missing_input = "skip";
      } else if (startConditionForm.mode === "positive" || startConditionForm.mode === "negative") {
        // Positive/Negative answer based (uses default "result" key internally)
        if (!startConditionForm.step_id) {
          onShowToast("Previous step is required", "error");
          return;
        }
        start_condition_from_step_id = parseInt(startConditionForm.step_id);
        const targetKeySuffix = startConditionForm.target_key?.trim() ? `:${startConditionForm.target_key.trim()}` : "";
        start_condition = `start:${startConditionForm.mode}:result${targetKeySuffix}`;
        on_missing_input = startConditionForm.on_fail;
      } else if (startConditionForm.mode === "custom") {
        // Custom answer based
        if (!startConditionForm.step_id || !startConditionForm.answer_key?.trim()) {
          onShowToast("Previous step and answer key are required", "error");
          return;
        }
        start_condition_from_step_id = parseInt(startConditionForm.step_id);
        const targetKeySuffix = startConditionForm.target_key?.trim() ? `:${startConditionForm.target_key.trim()}` : "";
        start_condition = `start:custom:${startConditionForm.answer_key.trim()}${targetKeySuffix}`;
        on_missing_input = startConditionForm.on_fail;
      } else if (startConditionForm.mode === "time") {
        // Time based
        if (!startConditionForm.time?.trim()) {
          onShowToast("Start time is required", "error");
          return;
        }
        // Validate HH:MM format
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startConditionForm.time)) {
          onShowToast("Invalid time format. Use HH:MM", "error");
          return;
        }
        if (!isTimeWithinScheduleWindows(startConditionForm.time)) {
          onShowToast("Start time must be within the job schedule windows", "error");
          return;
        }
        start_condition_from_step_id = null;
        start_condition = `start:time:${startConditionForm.time}`;
        on_missing_input = "skip";
      }

      const response = await fetch(`/api/job-steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_condition,
          start_condition_from_step_id,
          on_missing_input,
        }),
      });

      if (response.ok) {
        await onStepUpdated();
        setShowStartConditionForm(false);
        onShowToast("Start condition saved successfully", "success");
      } else {
        const error = await response.json();
        onShowToast(error.message || error.error || "Failed to save start condition", "error");
      }
    } catch (error) {
      console.error("Failed to save start condition:", error);
      onShowToast("Failed to save start condition", "error");
    }
  };

  const handleSaveAlert = async () => {
    if (!alertForm.channel) {
      alert("Channel is required");
      return;
    }

    // Validate Telegram configuration
    if (alertForm.channel === "telegram") {
      try {
        const response = await fetch("/api/telegram-settings");
        if (response.ok) {
          const data = await response.json();
          if (!data.enabled || !data.chat_id || !data.bot_token) {
            onShowToast(
              "Telegram must be configured in the Settings page before you can use it for alerts",
              "warning"
            );
            return;
          }
        } else {
          onShowToast(
            "Telegram must be configured in the Settings page before you can use it for alerts",
            "warning"
          );
          return;
        }
      } catch (error) {
        console.error("Failed to check Telegram settings:", error);
        onShowToast("Failed to verify Telegram configuration", "error");
        return;
      }
    }

    // Validate webhook fields
    if (alertForm.channel === "webhook") {
      if (!alertForm.webhook_url || !alertForm.webhook_inject) {
        alert("URL and Inject fields are required for webhook");
        return;
      }
    }

    try {
      // Prepare channel_params based on channel type
      let channelParams = "{}";
      if (alertForm.channel === "webhook") {
        channelParams = JSON.stringify({
          url: alertForm.webhook_url,
          inject: alertForm.webhook_inject,
        });
      }

      const response = await fetch(`/api/job-steps/${step.id}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: alertForm.channel,
          channel_params: channelParams,
          message_template: alertForm.message_template,
        }),
      });

      if (response.ok) {
        await fetchStepData();
        setShowAlertForm(false);
        setAlertForm({
          channel: "telegram",
          channel_params: "{}",
          message_template: "",
          webhook_url: "",
          webhook_inject: "",
        });
        onShowToast("Alert added successfully", "success");
      }
    } catch (error) {
      console.error("Failed to save alert:", error);
      onShowToast("Failed to save alert", "error");
    }
  };

  const handleRemoveAlert = async (alertId: number) => {
    try {
      const response = await fetch(`/api/job-steps/${step.id}/alerts/${alertId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchStepData();
      }
    } catch (error) {
      console.error("Failed to remove alert:", error);
    }
  };

  const triggerAgentCreationHighlight = (targetId: number) => {
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (hasShownAgentCreationHighlightRef.current) return;
    hasShownAgentCreationHighlightRef.current = true;
    if (agentCreationHighlightTimerRef.current) {
      window.clearTimeout(agentCreationHighlightTimerRef.current);
      agentCreationHighlightTimerRef.current = null;
    }
    setHighlightAgentCreationTargetId(null);
    requestAnimationFrame(() => setHighlightAgentCreationTargetId(targetId));
    agentCreationHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightAgentCreationTargetId((current) =>
        current === targetId ? null : current
      );
      agentCreationHighlightTimerRef.current = null;
    }, 5200);
  };

  useEffect(() => {
    return () => {
      if (agentFormHighlightTimerRef.current) {
        window.clearTimeout(agentFormHighlightTimerRef.current);
        agentFormHighlightTimerRef.current = null;
      }
      if (agentCreationHighlightTimerRef.current) {
        window.clearTimeout(agentCreationHighlightTimerRef.current);
        agentCreationHighlightTimerRef.current = null;
      }
    };
  }, []);

  const closePromptEditor = () => {
    if (enhancingPrompt) return;
    setShowPromptEditor(false);
    setPromptEditorInputTypeDraft("video");
    setPromptEnhanceSuggestion(null);
    setPolygonDrawEnabled(false);
    setAnalysisRegionsPanelOpen(false);
    setHoveredPromptRegionId(null);
    setRegionActionRegionId(null);
    setIsRegionActionHovered(false);
    setDraggingPromptVertex(null);
    setPendingPolygonSeed(null);
    setIsSizingPendingPolygon(false);
    setDraftPolygonRect(null);
    setShowNewRegionDialog(false);
    setNewRegionDialogLabel("");
    setNewRegionDialogDescription("");
    setNewRegionDialogAnchor(null);
    setPromptEditorTargetFacesExpanded(false);
    setPromptEditorSnapshotLoading(false);
    setPromptEditorSnapshotRequesting(false);
    setPromptEditorSnapshotError(null);
    setPromptEditorSnapshotMeta({
      thumbnail_url: null,
      last_thumbnail_update: null,
    });
    promptEditorSnapshotRefreshInFlightRef.current = false;
    promptEditorSnapshotRetryInFlightRef.current = false;
    clearPromptEditorSnapshotRefreshCooldown();
    setPromptEditorRegions([
      buildDefaultAnalysisRegion(
        { prompt_template: "", alert_condition: "", negative_condition: "" },
        [],
        [],
        0
      ),
    ]);
    setActivePromptRegionId("full-frame");
    closeDeleteFaceTargetDialog();
    cancelEditingFaceTarget();
    setDeletingFaceTargetId(null);
    setDeletingNegativeReferenceImageId(null);
    setUploadingNegativeReferenceImages(false);
    setNewFaceTargetFile(null);
    setNewFaceTargetName("");
    setNewFaceTargetDescription("");
  };

  const openPromptEditor = async (options?: {
    cameraId?: number | null;
    formState?: AgentFormState;
    targetAgent?: Agent | null;
  }) => {
    const selectedCameraIdRaw =
      options?.cameraId === undefined ? agentFormCameraId : options.cameraId;
    const selectedCameraId =
      Number.isInteger(selectedCameraIdRaw) && Number(selectedCameraIdRaw) > 0
        ? Number(selectedCameraIdRaw)
        : null;
    const selectedPromptTarget =
      selectedCameraId === null
        ? null
        : targets.find((target) => target.camera_id === selectedCameraId) || null;
    const initialPromptEditorInputType = selectedPromptTarget
      ? normalizeTargetInputType(
          targetInputTypes[selectedPromptTarget.id] ?? selectedPromptTarget.input_type
        )
      : "video";
    const sourceForm = options?.formState ?? agentForm;
    let targetAgent =
      options?.targetAgent === undefined ? getEditingCameraAgent() : options.targetAgent;
    if (selectedCameraId !== null) {
      const latestAgent = await fetchLatestAgentForPromptEditor(selectedCameraId);
      if (latestAgent) {
        targetAgent = latestAgent;
      }
    }
    const sourceNegativeReferenceImages =
      targetAgent && Array.isArray(targetAgent.negative_reference_images)
        ? targetAgent.negative_reference_images || []
        : sourceForm.negative_reference_images || [];
    const sourceFaceTargetIds = Array.isArray(sourceForm.face_target_ids)
      ? sourceForm.face_target_ids
      : [];
    const sourceNegativeImageIds = extractNegativeImageIdsFromImages(
      sourceNegativeReferenceImages
    );
    const fallbackPromptFields = normalizePromptEditorFields({
      prompt_template: sourceForm.prompt_template || "",
      alert_condition: sourceForm.alert_condition || "",
      negative_condition: sourceForm.negative_condition || "",
    });
    const initialRegionsRaw = normalizeAnalysisRegionsForForm(
      targetAgent?.analysis_regions ?? sourceForm.analysis_regions,
      fallbackPromptFields,
      sourceFaceTargetIds,
      sourceNegativeImageIds
    );
    const initialRegions = initialRegionsRaw.map((region) => ({
      ...region,
      prompt_core: fallbackPromptFields.prompt_template,
      alert_condition: fallbackPromptFields.alert_condition,
      negative_condition: fallbackPromptFields.negative_condition,
      face_target_ids: sourceFaceTargetIds,
      negative_image_ids: sourceNegativeImageIds,
      context_padding_pct: 0,
    }));
    const initialActiveRegion = initialRegions[0];

    if (targetAgent && Array.isArray(targetAgent.negative_reference_images)) {
      setAgentForm((prev) => ({
        ...prev,
        negative_reference_images: targetAgent.negative_reference_images || [],
      }));
    }

    setPromptEditorRegions(initialRegions);
    setActivePromptRegionId(initialActiveRegion?.region_id || "full-frame");
    setAnalysisRegionsPanelOpen(false);
    setHoveredPromptRegionId(null);
    setRegionActionRegionId(null);
    setIsRegionActionHovered(false);
    setDraggingPromptVertex(null);
    setPendingPolygonSeed(null);
    setIsSizingPendingPolygon(false);
    setDraftPolygonRect(null);
    setShowNewRegionDialog(false);
    setNewRegionDialogLabel("");
    setNewRegionDialogDescription("");
    setNewRegionDialogAnchor(null);
    setPromptEditorTargetFacesExpanded(false);
    setPromptEditorDraft({
      prompt_template: fallbackPromptFields.prompt_template,
      alert_condition: fallbackPromptFields.alert_condition,
      negative_condition: fallbackPromptFields.negative_condition,
    });
    setPromptEditorInputTypeDraft(initialPromptEditorInputType);
    setPolygonDrawEnabled(false);
    cancelEditingFaceTarget();
    setDeletingFaceTargetId(null);
    setDeletingNegativeReferenceImageId(null);
    setPromptEditorSnapshotError(null);
    setPromptEditorSnapshotMeta({
      thumbnail_url: null,
      last_thumbnail_update: null,
    });
    promptEditorSnapshotRefreshInFlightRef.current = false;
    promptEditorSnapshotRetryInFlightRef.current = false;
    clearPromptEditorSnapshotRefreshCooldown();
    setPromptEditorSnapshotRequesting(false);
    setPromptEditorSnapshotLoading(true);
    void fetchFaceTargetsLibraryData();
    setPromptEnhanceSuggestion(null);
    setShowPromptEditor(true);

    if (selectedCameraId === null) {
      setPromptEditorSnapshotLoading(false);
      setPromptEditorSnapshotError("Select a target camera to load snapshot preview.");
      return;
    }

    void (async () => {
      try {
        const hasSnapshot = await refreshPromptEditorSnapshotMeta(selectedCameraId);
        if (!hasSnapshot) {
          await requestPromptEditorSnapshotRefresh(selectedCameraId);
        }
      } catch (error) {
        setPromptEditorSnapshotError(
          error instanceof Error ? error.message : "Failed to load camera snapshot"
        );
      } finally {
        setPromptEditorSnapshotLoading(false);
      }
    })();
  };

  useEffect(() => {
    return () => {
      if (promptEditorSnapshotRefreshCooldownTimerRef.current) {
        clearTimeout(promptEditorSnapshotRefreshCooldownTimerRef.current);
        promptEditorSnapshotRefreshCooldownTimerRef.current = null;
      }
      promptEditorSnapshotRefreshInFlightRef.current = false;
      promptEditorSnapshotRetryInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showPromptEditor) return;
    if (!promptEditorSnapshotRequesting) return;
    if (!Number.isInteger(agentFormCameraId) || (agentFormCameraId as number) <= 0) return;

    const selectedCameraId = Number(agentFormCameraId);
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    const maxAttempts = 20;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      attempts += 1;
      try {
        const hasSnapshot = await refreshPromptEditorSnapshotMeta(selectedCameraId);
        if (cancelled) return;
        if (hasSnapshot) {
          setPromptEditorSnapshotRequesting(false);
          setPromptEditorSnapshotError(null);
        } else if (attempts >= maxAttempts) {
          setPromptEditorSnapshotRequesting(false);
          setPromptEditorSnapshotError(
            "Could not get a snapshot yet. Try again in a few seconds."
          );
        }
      } catch (error) {
        if (!cancelled) {
          setPromptEditorSnapshotRequesting(false);
          setPromptEditorSnapshotError(
            error instanceof Error ? error.message : "Failed to refresh camera snapshot"
          );
        }
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      void tick();
    }, 1500);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showPromptEditor, promptEditorSnapshotRequesting, agentFormCameraId]);

  const retryPromptEditorSnapshot = () => {
    if (promptEditorSnapshotRetryInFlightRef.current) return;
    if (promptEditorSnapshotLoading || promptEditorSnapshotRequesting) return;
    if (Date.now() < promptEditorSnapshotRefreshCooldownUntil) return;
    if (!Number.isInteger(agentFormCameraId) || (agentFormCameraId as number) <= 0) {
      setPromptEditorSnapshotError("Select a target camera to load snapshot preview.");
      return;
    }

    promptEditorSnapshotRetryInFlightRef.current = true;
    startPromptEditorSnapshotRefreshCooldown();
    const selectedCameraId = Number(agentFormCameraId);
    setPromptEditorSnapshotError(null);
    setPromptEditorSnapshotLoading(true);
    setPromptEditorSnapshotRequesting(false);

    void (async () => {
      try {
        const hasSnapshot = await refreshPromptEditorSnapshotMeta(selectedCameraId);
        if (!hasSnapshot) {
          await requestPromptEditorSnapshotRefresh(selectedCameraId);
        }
      } catch (error) {
        setPromptEditorSnapshotError(
          error instanceof Error ? error.message : "Failed to load camera snapshot"
        );
      } finally {
        promptEditorSnapshotRetryInFlightRef.current = false;
        setPromptEditorSnapshotLoading(false);
      }
    })();
  };

  const getPreviewPointFromClient = (clientX: number, clientY: number) => {
    const host = previewCanvasRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;
    return {
      point: {
        x: clamp01((clientX - rect.left) / rect.width),
        y: clamp01((clientY - rect.top) / rect.height),
      } as AnalysisRegionPoint,
      draw_ref_width: Math.max(1, Math.round(rect.width)),
      draw_ref_height: Math.max(1, Math.round(rect.height)),
    };
  };

  const polygonOnlyRegions = useMemo(
    () =>
      (Array.isArray(promptEditorRegions) ? promptEditorRegions : []).filter((region) =>
        hasPolygonPoints(region)
      ),
    [promptEditorRegions]
  );

  const removeRegionAndFallbackToFullFrame = (regionId: string) => {
    if (!regionId) return;
    const fallbackFields = normalizePromptEditorFields(promptEditorDraft);
    const fallbackNegativeIds = extractNegativeImageIdsFromImages(agentForm.negative_reference_images);
    let nextActiveRegionId = "full-frame";
    setPromptEditorRegions((prev) => {
      const remainingPolygons = prev.filter(
        (region) => region.region_id !== regionId && hasPolygonPoints(region)
      );
      if (remainingPolygons.length === 0) {
        return [
          buildDefaultAnalysisRegion(
            fallbackFields,
            agentForm.face_target_ids,
            fallbackNegativeIds,
            0
          ),
        ];
      }
      nextActiveRegionId = remainingPolygons[0].region_id;
      return remainingPolygons;
    });
    setActivePromptRegionId(nextActiveRegionId);
    if (hoveredPromptRegionId === regionId) {
      setHoveredPromptRegionId(null);
    }
    if (regionActionRegionId === regionId) {
      setRegionActionRegionId(null);
      setIsRegionActionHovered(false);
    }
  };

  const handleToggleRegionEnabled = (regionId: string) => {
    updatePromptRegionById(regionId, (region) => ({
      ...region,
      enabled: region.enabled === false,
    }));
  };

  const handlePreviewMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!promptEditorSnapshotUrl) return;
    if ((event.target as HTMLElement)?.closest("[data-region-action='true']")) return;
    setRegionActionRegionId(null);
    setIsRegionActionHovered(false);
    const pointer = getPreviewPointFromClient(event.clientX, event.clientY);
    if (!pointer) return;

    if (pendingPolygonSeed) {
      setIsSizingPendingPolygon(true);
      setDraftPolygonRect({
        start: pendingPolygonSeed.start,
        end: pointer.point,
      });
      return;
    }

    if (!polygonDrawEnabled) return;
    if (polygonOnlyRegions.length >= ANALYSIS_REGION_MAX) {
      onShowToast(`Maximum ${ANALYSIS_REGION_MAX} regions per agent`, "warning");
      return;
    }

    setNewRegionDialogAnchor(pointer.point);
    setNewRegionDialogLabel(`Region ${polygonOnlyRegions.length + 1}`);
    setNewRegionDialogDescription("");
    setShowNewRegionDialog(true);
  };

  const handlePreviewMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const pointer = getPreviewPointFromClient(event.clientX, event.clientY);
    if (!pointer) return;

    if (draggingPromptVertex) {
      updatePromptRegionById(draggingPromptVertex.region_id, (region) => {
        if (!Array.isArray(region.polygon_norm)) return region;
        if (
          draggingPromptVertex.vertex_index < 0 ||
          draggingPromptVertex.vertex_index >= region.polygon_norm.length
        ) {
          return region;
        }
        const nextPoints = [...region.polygon_norm];
        nextPoints[draggingPromptVertex.vertex_index] = pointer.point;
        return {
          ...region,
          polygon_norm: nextPoints,
          full_frame: false,
          draw_ref_width: pointer.draw_ref_width,
          draw_ref_height: pointer.draw_ref_height,
        };
      });
      return;
    }

    if (isSizingPendingPolygon && pendingPolygonSeed) {
      setDraftPolygonRect({
        start: pendingPolygonSeed.start,
        end: pointer.point,
      });
      return;
    }

    for (let idx = polygonOnlyRegions.length - 1; idx >= 0; idx -= 1) {
      const region = polygonOnlyRegions[idx];
      if (pointInPolygon(pointer.point, region.polygon_norm)) {
        setHoveredPromptRegionId(region.region_id);
        setRegionActionRegionId(region.region_id);
        return;
      }
    }
    setHoveredPromptRegionId(null);
    if (!isRegionActionHovered && !showNewRegionDialog) {
      setRegionActionRegionId(null);
    }
  };

  const handlePreviewMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (draggingPromptVertex) {
      setDraggingPromptVertex(null);
      return;
    }

    if (!isSizingPendingPolygon || !pendingPolygonSeed) return;

    const pointer = getPreviewPointFromClient(event.clientX, event.clientY);
    const drawRefWidth = pointer?.draw_ref_width ?? ANALYSIS_REGION_DEFAULT_DRAW_REF_WIDTH;
    const drawRefHeight = pointer?.draw_ref_height ?? ANALYSIS_REGION_DEFAULT_DRAW_REF_HEIGHT;
    const rectPoints = buildRectPolygonFromPoints(
      pendingPolygonSeed.start,
      pointer?.point ?? draftPolygonRect?.end ?? pendingPolygonSeed.start
    );
    setIsSizingPendingPolygon(false);
    setDraftPolygonRect(null);

    if (rectPoints.length < ANALYSIS_REGION_MIN_POINTS) {
      setPendingPolygonSeed(null);
      onShowToast("Polygon area is too small. Try again.", "warning");
      return;
    }

    const fallbackFields = normalizePromptEditorFields(promptEditorDraft);
    const fallbackNegativeIds = extractNegativeImageIdsFromImages(agentForm.negative_reference_images);
    const regionBaseLabel = pendingPolygonSeed.label.trim() || `Region ${polygonOnlyRegions.length + 1}`;
    const baseId = sanitizeRegionId(regionBaseLabel, polygonOnlyRegions.length);
    let createdRegionId = "";
    setPromptEditorRegions((prev) => {
      const keptPolygons = prev.filter((region) => hasPolygonPoints(region));
      if (keptPolygons.length >= ANALYSIS_REGION_MAX) {
        return keptPolygons;
      }
      const used = new Set(keptPolygons.map((region) => region.region_id));
      let nextId = baseId;
      let suffix = 2;
      while (used.has(nextId)) {
        nextId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      createdRegionId = nextId;
      const nextRegion: AnalysisRegion = {
        region_id: nextId,
        label: regionBaseLabel,
        description: pendingPolygonSeed.description.trim(),
        enabled: true,
        full_frame: false,
        polygon_norm: rectPoints,
        draw_ref_width: drawRefWidth,
        draw_ref_height: drawRefHeight,
        context_padding_pct: 0,
        prompt_core: fallbackFields.prompt_template,
        alert_condition: fallbackFields.alert_condition,
        negative_condition: fallbackFields.negative_condition,
        face_target_ids: Array.from(
          new Set(agentForm.face_target_ids.filter((id) => Number.isInteger(id) && id > 0))
        ),
        negative_image_ids: Array.from(new Set(fallbackNegativeIds)),
      };
      return [...keptPolygons, nextRegion];
    });
    setPendingPolygonSeed(null);
    if (createdRegionId) {
      setActivePromptRegionId(createdRegionId);
      setRegionActionRegionId(createdRegionId);
    }
  };

  const handlePreviewMouseLeave = () => {
    if (!draggingPromptVertex) {
      setHoveredPromptRegionId(null);
    }
    if (!isRegionActionHovered) {
      setRegionActionRegionId(null);
    }
  };

  const handleAddVertexToRegion = (regionId: string, event: React.MouseEvent<SVGPolygonElement>) => {
    if (!polygonDrawEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = getPreviewPointFromClient(event.clientX, event.clientY);
    if (!pointer) return;
    let nextVertexIndex = -1;
    updatePromptRegionById(regionId, (region) => {
      if (!hasPolygonPoints(region)) return region;
      const points = Array.isArray(region.polygon_norm) ? region.polygon_norm : [];
      if (points.length >= ANALYSIS_REGION_MAX_POINTS) return region;
      nextVertexIndex = points.length;
      return {
        ...region,
        full_frame: false,
        polygon_norm: [...points, pointer.point],
        draw_ref_width: pointer.draw_ref_width,
        draw_ref_height: pointer.draw_ref_height,
      };
    });
    if (nextVertexIndex >= 0) {
      setActivePromptRegionId(regionId);
      setRegionActionRegionId(regionId);
      setDraggingPromptVertex({
        region_id: regionId,
        vertex_index: nextVertexIndex,
      });
    }
  };

  const handleConfirmNewRegionDialog = () => {
    if (!newRegionDialogAnchor) return;
    setPendingPolygonSeed({
      start: newRegionDialogAnchor,
      label: newRegionDialogLabel.trim() || `Region ${polygonOnlyRegions.length + 1}`,
      description: newRegionDialogDescription.trim(),
    });
    setShowNewRegionDialog(false);
    setNewRegionDialogAnchor(null);
    setPolygonDrawEnabled(true);
    onShowToast("Click and drag over the image to size the polygon.", "info");
  };

  const handleCancelNewRegionDialog = () => {
    setShowNewRegionDialog(false);
    setNewRegionDialogAnchor(null);
    setNewRegionDialogLabel("");
    setNewRegionDialogDescription("");
  };

  // Legacy no-op handlers kept only to satisfy hidden legacy JSX block.
  const handleAddAnalysisRegion = () => {};
  const handleDuplicateActiveRegion = () => {};
  const handleRemoveActiveRegion = () => {};
  const handleToggleActiveRegionFullFrame = () => {};

  const applyPromptEditor = async () => {
    const normalizedDraft = normalizePromptEditorFields(promptEditorDraft);
    let updatedRegions = promptEditorRegions.map((region) => ({
      ...region,
      prompt_core: normalizedDraft.prompt_template,
      alert_condition: normalizedDraft.alert_condition,
      negative_condition: normalizedDraft.negative_condition,
      context_padding_pct: 0,
    }));

    const pendingTargetName = newFaceTargetName.trim();
    const hasPendingTargetName = pendingTargetName.length > 0;
    const hasPendingTargetImage = !!newFaceTargetFile;

    if (hasPendingTargetName !== hasPendingTargetImage) {
      onShowToast(
        t("jobs.promptEditor.toastFillNameAndImage"),
        "warning"
      );
      return;
    }

    if (hasPendingTargetName && hasPendingTargetImage) {
      const createdTargetId = await createFaceTargetFromDraft({
        autoSelect: true,
        silentSuccess: true,
      });
      if (!createdTargetId) {
        return;
      }

      updatedRegions = updatedRegions.map((region) => {
        const set = new Set(
          (Array.isArray(region.face_target_ids) ? region.face_target_ids : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        );
        set.add(createdTargetId);
        return {
          ...region,
          face_target_ids: Array.from(set),
        };
      });
    }

    const normalizedRegions = normalizeAnalysisRegionsForPayload(
      updatedRegions,
      normalizedDraft,
      agentForm.face_target_ids,
      extractNegativeImageIdsFromImages(agentForm.negative_reference_images)
    );
    const normalizedFaceTargetIds = collectFaceTargetIdsFromRegions(normalizedRegions);
    const normalizedNegativeImageIds = extractNegativeImageIdsFromImages(
      agentForm.negative_reference_images
    );
    const syncedRegions = normalizedRegions.map((region) => ({
      ...region,
      prompt_core: normalizedDraft.prompt_template,
      alert_condition: normalizedDraft.alert_condition,
      negative_condition: normalizedDraft.negative_condition,
      face_target_ids: normalizedFaceTargetIds,
      negative_image_ids: normalizedNegativeImageIds,
      context_padding_pct: 0,
    }));
    const nextForm: AgentFormState = {
      ...agentForm,
      prompt_template: normalizedDraft.prompt_template,
      alert_condition: normalizedDraft.alert_condition,
      negative_condition: normalizedDraft.negative_condition,
      face_target_ids: normalizedFaceTargetIds,
      analysis_regions: syncedRegions,
    };

    setAgentForm(nextForm);
    setPromptEditorRegions(syncedRegions);

    const saved = await upsertAgentFromForm(nextForm);
    if (!saved) {
      return;
    }

    setPromptEnhanceSuggestion(null);
    setShowPromptEditor(false);
    onShowToast(t("jobs.promptEditor.toastPromptAndTargetsSaved"), "success");
  };

  const handleEnhancePromptWithAI = async () => {
    const normalized = normalizePromptEditorFields(promptEditorDraft);

    if (!normalized.prompt_template) {
      onShowToast(t("jobs.promptEditor.toastCoreRequiredForEnhance"), "warning");
      return;
    }
    if (!normalized.alert_condition) {
      onShowToast(t("jobs.promptEditor.toastAlertRequiredForEnhance"), "warning");
      return;
    }
    if (agentFormCameraId === null) {
      onShowToast(t("jobs.promptEditor.toastSelectCameraBeforeEnhance"), "warning");
      return;
    }

    const enhanceAnalysisRegions = normalizeAnalysisRegionsForPayload(
      promptEditorRegions,
      normalized,
      Array.isArray(agentForm.face_target_ids) ? agentForm.face_target_ids : [],
      extractNegativeImageIdsFromImages(agentForm.negative_reference_images)
    );

    setEnhancingPrompt(true);
    setPromptEnhanceSuggestion(null);

    try {
      const languageHint =
        typeof navigator !== "undefined" && typeof navigator.language === "string"
          ? navigator.language
          : "";

      const enqueueResponse = await fetch(
        `/api/job-steps/${step.id}/agents/enhance-prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id: agentFormCameraId,
            prompt_template: normalized.prompt_template,
            alert_condition: normalized.alert_condition,
            negative_condition: normalized.negative_condition,
            language: languageHint,
            analysis_regions: enhanceAnalysisRegions,
          }),
        }
      );

      const enqueueData = await enqueueResponse.json().catch(() => null);
      if (!enqueueResponse.ok) {
        if (handleModelApiKeyRequired(enqueueData)) {
          return;
        }
        throw new Error(enqueueData?.error || t("jobs.promptEditor.errorFailedEnqueueEnhance"));
      }

      const commandId = Number(enqueueData?.command_id);
      if (!Number.isInteger(commandId) || commandId <= 0) {
        throw new Error(t("jobs.promptEditor.errorInvalidEnhanceCommandId"));
      }

      const timeoutAt = Date.now() + 120000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const statusResponse = await fetch(
          `/api/job-steps/${step.id}/agents/enhance-prompt/${commandId}`
        );
        const statusData = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok) {
          throw new Error(statusData?.error || t("jobs.promptEditor.errorFailedCheckEnhanceStatus"));
        }

        const status = String(statusData?.status || "").trim().toLowerCase();
        if (status === "pending" || status === "sent") {
          continue;
        }
        if (status === "failed") {
          throw new Error(statusData?.error || t("jobs.promptEditor.errorPromptEnhancementFailed"));
        }
        if (status === "completed") {
          const suggested = normalizePromptEditorFields({
            prompt_template: String(statusData?.suggestion?.prompt_template || ""),
            alert_condition: String(statusData?.suggestion?.alert_condition || ""),
            negative_condition: String(statusData?.suggestion?.negative_condition || ""),
          });

          if (!suggested.prompt_template || !suggested.alert_condition) {
            throw new Error(t("jobs.promptEditor.errorInvalidAiSuggestion"));
          }

          setPromptEnhanceSuggestion({
            ...suggested,
            model_name:
              typeof statusData?.meta?.model_name === "string"
                ? statusData.meta.model_name
                : undefined,
            snapshot_source:
              typeof statusData?.meta?.snapshot_source === "string"
                ? statusData.meta.snapshot_source
                : undefined,
            snapshot_ts_utc_iso:
              typeof statusData?.meta?.snapshot_ts_utc_iso === "string"
                ? statusData.meta.snapshot_ts_utc_iso
                : undefined,
          });
          onShowToast(t("jobs.promptEditor.toastAiSuggestionReady"), "info");
          return;
        }
      }

      throw new Error(t("jobs.promptEditor.errorPromptEnhancementTimedOut"));
    } catch (error) {
      console.error("Failed to enhance prompt:", error);
      onShowToast(
        error instanceof Error ? error.message : t("jobs.promptEditor.errorFailedEnhancePrompt"),
        "error"
      );
    } finally {
      setEnhancingPrompt(false);
    }
  };

  const openAgentEditorForTarget = (
    target: Target,
    targetAgent: Agent | undefined,
    priorityValue: AgentPriority
  ) => {
    let nextForm: AgentFormState;
    if (targetAgent) {
      const split = parsePromptTemplate(
        targetAgent.prompt_template || "",
        targetAgent.alert_condition
      );
      const normalizedNegativeReferenceImages = Array.isArray(targetAgent.negative_reference_images)
        ? targetAgent.negative_reference_images
            .map((img: any) => {
              const imageId = Number(img?.id);
              const imageUrl =
                typeof img?.image_url === "string" ? img.image_url.trim() : "";
              if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) return null;
              return {
                id: imageId,
                image_url: imageUrl,
              } as NegativeReferenceImage;
            })
            .filter((image): image is NegativeReferenceImage => image !== null)
        : [];
      const normalizedFaceTargetIds = Array.isArray(targetAgent.face_target_ids)
        ? Array.from(
            new Set(
              targetAgent.face_target_ids
                .map((value: unknown) => Number(value))
                .filter((value: number) => Number.isInteger(value) && value > 0)
            )
          )
        : [];
      const analysisRegions = normalizeAnalysisRegionsForForm(
        targetAgent.analysis_regions,
        split,
        normalizedFaceTargetIds,
        extractNegativeImageIdsFromImages(normalizedNegativeReferenceImages)
      );
      const execution = applyAgentExecutionConstraints(
        normalizeTargetInputType(targetInputTypes[target.id] ?? target.input_type),
        normalizeAgentInferenceModel(targetAgent.inference_model),
        normalizeAgentRunEverySeconds(
          targetAgent.run_every,
          FIXED_AGENT_RUN_EVERY_SECONDS
        ),
        normalizeAgentInferenceModel(targetAgent.inference_model) === "core"
          ? normalizeAgentRunningResolution(
              targetAgent.running_resolution,
              DEFAULT_CORE_RUNNING_RESOLUTION
            )
          : null,
        normalizeAgentModelFps(targetAgent.model_fps)
      );
      nextForm = {
        agent_key: targetAgent.agent_key,
        prompt_template: split.prompt_template,
        alert_condition: split.alert_condition,
        negative_condition: split.negative_condition,
        params: targetAgent.params,
        input_schema: targetAgent.input_schema,
        priority_level: targetAgent.priority_level || priorityValue,
        inference_model: execution.inferenceModel,
        model_fps: execution.modelFps,
        run_every: execution.runEvery,
        running_resolution: execution.runningResolution,
        video_packaging_mode: normalizeAgentVideoPackagingMode(
          targetAgent.video_packaging_mode
        ),
        only_capture_on_motion: normalizeAgentOnlyCaptureOnMotion(
          targetAgent.only_capture_on_motion
        ),
        use_temporal_context: normalizeAgentUseTemporalContext(
          targetAgent.use_temporal_context
        ),
        face_target_ids: normalizedFaceTargetIds,
        negative_reference_images: normalizedNegativeReferenceImages,
        analysis_regions: analysisRegions,
      };
    } else {
      nextForm = {
        ...buildEmptyAgentForm(),
        priority_level: priorityValue,
      };
    }
    setAgentFormCameraId(target.camera_id);
    setAgentForm(nextForm);
    setShowAgentForm(false);
    setHighlightAgentForm(false);
    if (agentFormHighlightTimerRef.current) {
      window.clearTimeout(agentFormHighlightTimerRef.current);
      agentFormHighlightTimerRef.current = null;
    }
    setPromptEnhanceSuggestion(null);
    void openPromptEditor({
      cameraId: target.camera_id,
      formState: nextForm,
      targetAgent: targetAgent || null,
    });
  };

  const promptCoreFilled = agentForm.prompt_template.trim().length > 0;
  const promptAlertFilled = agentForm.alert_condition.trim().length > 0;
  const promptNegativeFilled = agentForm.negative_condition.trim().length > 0;
  const promptFaceTargetCount = Array.isArray(agentForm.face_target_ids)
    ? agentForm.face_target_ids.length
    : 0;
  const activeRegionFaceTargetIds = Array.from(
    new Set(
      (Array.isArray(promptEditorRegions) ? promptEditorRegions : []).flatMap((region) =>
        (Array.isArray(region?.face_target_ids) ? region.face_target_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    )
  );
  const activeRegionNegativeImageIds = Array.from(
    new Set(
      (Array.isArray(promptEditorRegions) ? promptEditorRegions : []).flatMap((region) =>
        (Array.isArray(region?.negative_image_ids) ? region.negative_image_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    )
  );
  const draftPolygonPoints = draftPolygonRect
    ? buildRectPolygonFromPoints(draftPolygonRect.start, draftPolygonRect.end)
    : [];
  const regionActionRegion =
    polygonOnlyRegions.find((region) => region.region_id === regionActionRegionId) ||
    polygonOnlyRegions.find((region) => region.region_id === hoveredPromptRegionId) ||
    null;
  const regionActionCentroid = regionActionRegion
    ? getPolygonCentroid(regionActionRegion.polygon_norm)
    : null;
  const currentPromptCameraAgent = getEditingCameraAgent();
  const currentPromptCameraRow = useMemo(() => {
    if (!Number.isInteger(agentFormCameraId) || (agentFormCameraId as number) <= 0) return null;
    return cameras.find((camera) => camera.id === agentFormCameraId) || null;
  }, [cameras, agentFormCameraId]);
  const promptSnapshotFilename =
    promptEditorSnapshotMeta.thumbnail_url ||
    (typeof currentPromptCameraRow?.thumbnail_url === "string" &&
    currentPromptCameraRow.thumbnail_url.trim()
      ? currentPromptCameraRow.thumbnail_url.trim()
      : null);
  const promptSnapshotLastUpdate =
    promptEditorSnapshotMeta.last_thumbnail_update ||
    (typeof currentPromptCameraRow?.last_thumbnail_update === "string" &&
    currentPromptCameraRow.last_thumbnail_update.trim()
      ? currentPromptCameraRow.last_thumbnail_update.trim()
      : null);
  const promptEditorSnapshotUrl = promptSnapshotFilename
    ? `/api/thumbnails/${promptSnapshotFilename}${
        promptSnapshotLastUpdate
          ? `?ts=${encodeURIComponent(promptSnapshotLastUpdate)}`
          : ""
      }`
    : null;
  const promptEditorSnapshotRefreshCooldownActive =
    promptEditorSnapshotRefreshCooldownUntil > Date.now();
  const promptEditorSnapshotRefreshBlocked =
    promptEditorSnapshotLoading ||
    promptEditorSnapshotRequesting ||
    promptEditorSnapshotRetryInFlightRef.current ||
    promptEditorSnapshotRefreshInFlightRef.current ||
    promptEditorSnapshotRefreshCooldownActive;
  const canManageNegativeReferences =
    !!currentPromptCameraAgent &&
    Number.isInteger(Number(currentPromptCameraAgent.id)) &&
    Number(currentPromptCameraAgent.id) > 0;
  const negativeReferenceImageCount = getNegativeReferenceImageCount(
    agentForm.negative_reference_images
  );
  const negativeReferenceMaxReached =
    negativeReferenceImageCount >= NEGATIVE_REFERENCE_MAX_IMAGES;
  const promptEditorSummary = promptCoreFilled
    ? `${promptAlertFilled ? t("jobs.promptEditor.summaryAlertConfigured") : t("jobs.promptEditor.summaryAlertMissing")} | ${
        promptNegativeFilled
          ? t("jobs.promptEditor.summaryNegativeConfigured")
          : t("jobs.promptEditor.summaryNegativeOptional")
      } | ${t("jobs.promptEditor.summaryFaceTargets", { count: promptFaceTargetCount })}`
    : t("jobs.promptEditor.summaryConfigurePrompt");
  const canEnhancePromptWithAI =
    agentFormCameraId !== null &&
    promptEditorDraft.prompt_template.trim().length > 0 &&
    promptEditorDraft.alert_condition.trim().length > 0 &&
    !enhancingPrompt;
  const promptEditorTarget = useMemo<Target | null>(() => {
    if (!Number.isInteger(agentFormCameraId) || (agentFormCameraId as number) <= 0) {
      return null;
    }
    return targets.find((target) => target.camera_id === agentFormCameraId) || null;
  }, [agentFormCameraId, targets]);
  const promptEditorTargetInputType = showPromptEditor
    ? promptEditorInputTypeDraft
    : promptEditorTarget
    ? normalizeTargetInputType(
        targetInputTypes[promptEditorTarget.id] ?? promptEditorTarget.input_type
      )
    : "video";
  const getRunEveryOptionLabel = (seconds: AgentRunEverySeconds): string => {
    return seconds === 10
      ? t("jobs.runEveryOption.seconds10")
      : t("jobs.runEveryOption.seconds60");
  };
  const formatAgentRunEveryLabel = (seconds: number | null | undefined): string => {
    const normalized = normalizeAgentRunEverySeconds(
      seconds ?? undefined,
      FIXED_AGENT_RUN_EVERY_SECONDS
    );
    return getRunEveryOptionLabel(normalized);
  };

  useEffect(() => {
    const inferenceModel = normalizeAgentInferenceModel(agentForm.inference_model);
    const constrained = applyAgentExecutionConstraints(
      inferenceModel === "core" ? "video" : promptEditorTargetInputType,
      inferenceModel,
      agentForm.run_every,
      agentForm.running_resolution,
      agentForm.model_fps
    );
    if (
      constrained.runEvery !== agentForm.run_every ||
      constrained.runningResolution !== agentForm.running_resolution ||
      constrained.modelFps !== agentForm.model_fps
    ) {
      setAgentForm((prev) => ({
        ...prev,
        run_every: constrained.runEvery,
        running_resolution: constrained.runningResolution,
        model_fps: constrained.modelFps,
      }));
    }
    if (showPromptEditor && promptEditorTargetInputType !== "video") {
      setPromptEditorInputTypeDraft("video");
    }
  }, [
    agentForm.inference_model,
    agentForm.model_fps,
    agentForm.run_every,
    agentForm.running_resolution,
    showPromptEditor,
    promptEditorTarget,
    promptEditorTargetInputType,
  ]);

  const hasTargets = targets.length > 0;
  
  // Check if each target has an assigned active agent (or fallback default exists)
  const defaultAgent = agents.find((a) => a.is_active === 1 && a.camera_id === null);
  const perCameraReady = targets.every((t) =>
    agents.some((a) => a.is_active === 1 && a.camera_id === t.camera_id) || !!defaultAgent
  );
  const isReady = hasTargets && perCameraReady;

  const availableCameras = cameras.filter(
    (cam) => !targets.some((t) => t.camera_id === cam.id)
  );
  const selectedTargetsForGroup = targets.filter((target) => selectedTargetIds.has(target.id));
  const editingGroup = editingGroupId
    ? inferenceGroups.find((group) => group.id === editingGroupId)
    : null;
  const modalTargets = editingGroup
    ? targets.filter((target) => editingGroup.targetIds.includes(target.id))
    : selectedTargetsForGroup;
  const groupAgentSourceOptions = useMemo<GroupAgentSourceOption[]>(() => {
    const options: GroupAgentSourceOption[] = [];
    modalTargets.forEach((target) => {
      const targetAgent = agents.find(
        (agent) => agent.is_active === 1 && agent.camera_id === target.camera_id
      );
      const effectiveAgent = targetAgent || defaultAgent;
      if (!effectiveAgent?.agent_key) return;

      const cameraLabel = target.camera_name || `Camera ${target.camera_id}`;
      const priorityLevel = targetAgent
        ? normalizeAgentPriority(agentPriorities[target.id] || targetAgent.priority_level)
        : normalizeAgentPriority(defaultAgent?.priority_level);
      const inferenceModel = targetAgent
        ? agentInferenceModels[target.id] || normalizeAgentInferenceModel(targetAgent.inference_model)
        : normalizeAgentInferenceModel(defaultAgent?.inference_model);
      const runEvery = targetAgent
        ? agentRunEvery[target.id] ??
          normalizeAgentRunEverySeconds(
            targetAgent.run_every,
            FIXED_AGENT_RUN_EVERY_SECONDS
          )
        : normalizeAgentRunEverySeconds(
            defaultAgent?.run_every,
            FIXED_AGENT_RUN_EVERY_SECONDS
          );
      const modelFps = normalizeAgentModelFps(
        targetAgent?.model_fps ?? defaultAgent?.model_fps
      );
      const runningResolution =
        inferenceModel === "core"
          ? normalizeAgentRunningResolution(
              targetAgent?.running_resolution ?? defaultAgent?.running_resolution,
              DEFAULT_CORE_RUNNING_RESOLUTION
            )
          : null;
      const inputType =
        inferenceModel === "core"
          ? "video"
          : normalizeTargetInputType(targetInputTypes[target.id] ?? target.input_type);
      const onlyCaptureOnMotion = targetAgent
        ? (agentOnlyCaptureOnMotion[target.id] ??
            normalizeAgentOnlyCaptureOnMotion(targetAgent.only_capture_on_motion))
        : normalizeAgentOnlyCaptureOnMotion(defaultAgent?.only_capture_on_motion);
      const videoPackagingMode = normalizeAgentVideoPackagingMode(
        targetAgent?.video_packaging_mode ?? defaultAgent?.video_packaging_mode
      );

      options.push({
        targetId: target.id,
        cameraId: target.camera_id,
        cameraLabel,
        agentKey: effectiveAgent.agent_key,
        label: `${cameraLabel} - ${effectiveAgent.agent_key}${targetAgent ? "" : " (default)"}`,
        inputType,
        priorityLevel,
        inferenceModel,
        modelFps,
        runEvery,
        runningResolution,
        onlyCaptureOnMotion,
        videoPackagingMode,
      });
    });
    return options;
  }, [
    modalTargets,
    agents,
    defaultAgent,
    agentPriorities,
    agentInferenceModels,
    agentRunEvery,
    agentOnlyCaptureOnMotion,
    targetInputTypes,
  ]);
  const selectedGroupSourceOption =
    groupAgentSourceOptions.find((option) => option.targetId === groupAgentSourceTargetId) ||
    (groupAgentKey
      ? groupAgentSourceOptions.find((option) => option.agentKey === groupAgentKey) || null
      : null);
  const selectedGroupAgentKeys = new Set(
    modalTargets
      .map((target) => {
        const targetAgent = agents.find(
          (agent) => agent.is_active === 1 && agent.camera_id === target.camera_id
        );
        const effectiveAgent = targetAgent || defaultAgent;
        return effectiveAgent?.agent_key || "";
      })
      .filter((key) => key)
  );
  const canSubmitGroup = editingGroupId
    ? !!selectedGroupSourceOption && !savingInferenceGroups
    : selectedTargetIds.size >= 2 && !!selectedGroupSourceOption && !savingInferenceGroups;

  const previousSteps = steps.filter((s) => s.step_order < step.step_order);
  const pipelineSourceSteps = steps.filter((s) => s.step_order <= step.step_order);
  const stepPipelines = parsePipelinesFromStep(step);
  const editTimeoutParts = timeoutSecondsToHourMinuteParts(editTimeoutSeconds);

  const resetEditingTimeout = () => {
    setIsEditingTimeout(false);
    setEditTimeoutSeconds(normalizeTimeoutForHourMinuteUi(step.timeout_seconds));
  };

  const handleDeleteStep = () => {
    onRequestDeleteStep(step.id);
  };

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      {/* Step Header */}
      <div className="w-full flex items-center justify-between p-4 bg-gray-800/50">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 hover:bg-gray-800/50 -m-4 p-4 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-500">
                #{step.step_order}
              </span>
              <h4 className="font-semibold text-gray-200">{step.name}</h4>
              {isReady ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-yellow-400" />
              )}
            </div>
          </div>
          <div
            className="flex items-center gap-2 text-sm text-gray-400"
            onClick={(e) => e.stopPropagation()}
          >
            <Clock className="w-4 h-4" />
            {isEditingTimeout ? (
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <input
                    type="number"
                    value={editTimeoutParts.hours}
                    onChange={(e) =>
                      setEditTimeoutSeconds(
                        hourMinutePartsToTimeoutSeconds(
                          parseNonNegativeIntegerInput(e.target.value),
                          editTimeoutParts.minutes
                        )
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveStepSettings();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        resetEditingTimeout();
                      }
                    }}
                    className="w-14 px-2 py-1 pr-5 bg-gray-700 border border-gray-600 rounded text-gray-200 text-xs focus:outline-none focus:border-blue-500"
                    min="0"
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                    h
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={editTimeoutParts.minutes}
                    onChange={(e) =>
                      setEditTimeoutSeconds(
                        hourMinutePartsToTimeoutSeconds(
                          editTimeoutParts.hours,
                          Math.min(59, parseNonNegativeIntegerInput(e.target.value))
                        )
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveStepSettings();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        resetEditingTimeout();
                      }
                    }}
                    className="w-14 px-2 py-1 pr-5 bg-gray-700 border border-gray-600 rounded text-gray-200 text-xs focus:outline-none focus:border-blue-500"
                    min="0"
                    max="59"
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                    m
                  </span>
                </div>
                <button
                  onClick={handleSaveStepSettings}
                  className="text-blue-400 hover:text-blue-300"
                  title="Save timeout"
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={resetEditingTimeout}
                  className="text-gray-500 hover:text-gray-300"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsEditingTimeout(true);
                  setEditTimeoutSeconds(normalizeTimeoutForHourMinuteUi(step.timeout_seconds));
                }}
                className="text-gray-300 hover:text-blue-300"
                title="Edit timeout"
              >
                {formatStepTimeoutHuman(step.timeout_seconds)}
              </button>
            )}
          </div>
        </button>
        <button
          onClick={handleDeleteStep}
          className="ml-2 p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
          title="Delete step"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Step Details */}
      {expanded && (
        <div className="p-4 space-y-4 bg-gray-900/30">
          {/* Targets Section */}
          <div className="border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-300">{t("jobs.targets")}</h5>
              <button
                onClick={() => setShowTargetSelect(!showTargetSelect)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                  showTargetSelect
                    ? "bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                    : "bg-gradient-to-r from-blue-500 to-cyan-500 border-blue-300/30 text-white shadow-lg shadow-blue-500/30 hover:from-blue-400 hover:to-cyan-400 hover:shadow-blue-500/45"
                }`}
              >
                {showTargetSelect ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showTargetSelect ? t("jobs.cancel") : t("jobs.addTarget")}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                onClick={toggleTargetMultiSelect}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors ${
                  isTargetMultiSelect
                    ? "bg-blue-500/20 border-blue-400/40 text-blue-200"
                    : "bg-gray-800/70 border-gray-700 text-gray-200 hover:bg-gray-800"
                }`}
              >
                <span className="w-4 h-4 rounded border border-current flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
                {isTargetMultiSelect ? t("jobs.exitSelection") : t("jobs.selectMultiple")}
              </button>
              {isTargetMultiSelect && (
                <button
                  type="button"
                  onClick={openGroupModal}
                  disabled={selectedTargetIds.size < 2 || savingInferenceGroups}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors ${
                    selectedTargetIds.size < 2 || savingInferenceGroups
                      ? "bg-blue-500/10 border-blue-400/20 text-blue-200/50 cursor-not-allowed"
                      : "bg-blue-600/60 border-blue-400/60 text-blue-100 hover:bg-blue-600/80"
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  {t("jobs.createGroup")}
                </button>
              )}
              <button
                type="button"
                onClick={handleSelectAllTargets}
                className="flex items-center gap-2 px-4 py-2 rounded-full border text-sm bg-gray-800/70 border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors"
                disabled={targets.length === 0}
              >
                <span className="w-4 h-4 rounded border border-current flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
                {t("jobs.selectAll")}
              </button>
              <button
                type="button"
                onClick={handleClearTargetSelection}
                className="flex items-center gap-2 px-4 py-2 rounded-full border text-sm bg-gray-800/70 border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors"
                disabled={selectedTargetIds.size === 0}
              >
                <X className="w-4 h-4" />
                {t("jobs.clear")}
              </button>
            </div>

            {showTargetSelect && availableCameras.length > 0 && (
              <div className="mb-3 p-3 bg-gray-800/50 rounded border border-gray-700">
                <p className="text-xs text-gray-400 mb-2">{t("jobs.selectCamera")}:</p>
                <div className="flex flex-wrap gap-2">
                  {availableCameras.map((camera) => (
                    <button
                      key={camera.id}
                      onClick={() => handleAddTarget(camera.id)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm transition-colors"
                    >
                      {camera.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {targets.length === 0 ? (
              <p className="text-sm text-gray-500">{t("jobs.noTargets")}</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {targets.map((target) => {
                  const targetAgent = agents.find(
                    (a) => a.is_active === 1 && a.camera_id === target.camera_id
                  );
                  const effectiveAgent = targetAgent || defaultAgent;
                  const activeGroupForTarget = inferenceGroups.find((group) =>
                    group.targetIds.includes(target.id)
                  );
                  const isGrouped = !!activeGroupForTarget;
                  const normalizedEffectiveAgentKey = String(effectiveAgent?.agent_key || "").trim();
                  const normalizedGroupAgentKey = String(activeGroupForTarget?.agentKey || "").trim();
                  const groupSourceTargetId = activeGroupForTarget?.source_target_id ?? null;
                  const isAgentMismatch =
                    !!activeGroupForTarget &&
                    !!effectiveAgent &&
                    (groupSourceTargetId !== null
                      ? groupSourceTargetId !== target.id
                      : normalizedEffectiveAgentKey !== normalizedGroupAgentKey);
                  const priorityValue =
                    agentPriorities[target.id] ||
                    targetAgent?.priority_level ||
                    "MEDIUM";
                  const captureOnMotionOnlyValue =
                    agentOnlyCaptureOnMotion[target.id] ??
                    normalizeAgentOnlyCaptureOnMotion(targetAgent?.only_capture_on_motion);
                  const canToggleCaptureMode = !!targetAgent;
                  const cloneCandidates = cloneCandidatesByTargetId[target.id] || [];
                  const selectedCloneSourceFromState = cloneSourceByTarget[target.id];
                  const selectedCloneSourceCameraId = cloneCandidates.some(
                    (candidate) => candidate.cameraId === selectedCloneSourceFromState
                  )
                    ? selectedCloneSourceFromState
                    : cloneCandidates[0]?.cameraId ?? null;
                  const isCloningAgent = cloningTargets.has(target.id);
                  const shouldHighlightAgentCreationArea =
                    highlightAgentCreationTargetId === target.id;
                  const priorityClasses = {
                    CRITIC: "bg-red-500/20 text-red-200 border-red-500/40",
                    HIGH: "bg-orange-500/20 text-orange-200 border-orange-500/40",
                    MEDIUM: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
                    LOW: "bg-green-500/20 text-green-200 border-green-500/40",
                  } as const;

                  return (
                    <div
                      key={target.id}
                      className="bg-gradient-to-b from-gray-900/60 to-gray-900/30 border border-gray-700/60 rounded-2xl p-4 shadow-inner relative"
                    >
                      {isTargetMultiSelect && (
                        <button
                          type="button"
                          onClick={() => toggleTargetSelection(target.id)}
                          disabled={isGrouped}
                          className={`absolute top-3 right-3 w-5 h-5 rounded-[4px] border flex items-center justify-center shadow-sm ${
                            selectedTargetIds.has(target.id)
                              ? "bg-blue-500 border-blue-400 text-white"
                              : "bg-gray-800/90 border-white/70 text-transparent"
                          } ${isGrouped ? "opacity-40 cursor-not-allowed" : ""}`}
                          title={
                            isGrouped
                              ? t("jobs.alreadyGrouped")
                              : selectedTargetIds.has(target.id)
                              ? t("jobs.deselect")
                              : t("jobs.select")
                          }
                        >
                          {selectedTargetIds.has(target.id) && <Check className="w-3 h-3" />}
                        </button>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center">
                            <Camera className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-100">
                              {target.camera_name || `Camera ${target.camera_id}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRemoveTarget(target.id)}
                            className={`text-gray-500 hover:text-red-400 ${isTargetMultiSelect ? "opacity-0 pointer-events-none" : ""}`}
                            title={t("jobs.removeCamera")}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 border-t border-gray-800/70 pt-4 space-y-4">
                        <div
                          className={`rounded-xl px-2 py-2 -mx-2 transition-all duration-500 ${
                            shouldHighlightAgentCreationArea
                              ? "border border-blue-400/70 bg-blue-500/10 ring-2 ring-blue-400/45 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]"
                              : "border border-transparent"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div
                              className={`text-[11px] uppercase tracking-widest ${
                                shouldHighlightAgentCreationArea
                                  ? "text-blue-300"
                                  : "text-gray-400"
                              }`}
                            >
                              {t("jobs.aiAgent")}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <div className="text-sm">
                              {effectiveAgent ? (
                                targetAgent ? (
                                  <span
                                    className={`text-green-400 ${
                                      isAgentMismatch
                                        ? "line-through decoration-red-400/70 decoration-2"
                                        : ""
                                    }`}
                                  >
                                    {normalizedEffectiveAgentKey}
                                  </span>
                                ) : (
                                  <span
                                    className={`text-yellow-400 ${
                                      isAgentMismatch
                                        ? "line-through decoration-red-400/70 decoration-2"
                                        : ""
                                    }`}
                                  >
                                    {t("jobs.usingDefault")}: {normalizedEffectiveAgentKey}
                                  </span>
                                )
                              ) : (
                                <span className="text-red-400">{t("jobs.notConfigured")}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (cloneCandidates.length === 0) {
                                    onShowToast(
                                      t("jobs.noConfiguredAgentInOtherTargets"),
                                      "info"
                                    );
                                    return;
                                  }

                                  if (cloneCandidates.length === 1) {
                                      requestCloneAgentFromCamera(target, cloneCandidates[0].cameraId);
                                      return;
                                  }

                                  setClonePickerTargetId((current) =>
                                    current === target.id ? null : target.id
                                  );
                                  setCloneSourceByTarget((prev) => {
                                    const currentSource = prev[target.id];
                                    if (
                                      currentSource &&
                                      cloneCandidates.some(
                                        (candidate) => candidate.cameraId === currentSource
                                      )
                                    ) {
                                      return prev;
                                    }
                                    return {
                                      ...prev,
                                      [target.id]: cloneCandidates[0].cameraId,
                                    };
                                  });
                                }}
                                disabled={isCloningAgent}
                                className={`p-1.5 rounded border border-gray-700 text-gray-300 transition-colors ${
                                  isCloningAgent
                                    ? "opacity-60 cursor-wait"
                                    : "hover:bg-gray-700 hover:text-gray-100"
                                } ${
                                  shouldHighlightAgentCreationArea
                                    ? "border-blue-400/70 text-blue-100 bg-blue-500/20 hover:bg-blue-500/30"
                                    : ""
                                }`}
                                title={
                                  cloneCandidates.length <= 1
                                    ? "Clone agent from another camera"
                                    : "Choose source camera to clone from"
                                }
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  openAgentEditorForTarget(
                                    target,
                                    targetAgent,
                                    priorityValue
                                  )
                                }
                                className={`text-xs px-2 py-1 rounded transition-colors ${
                                  shouldHighlightAgentCreationArea
                                    ? "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.75)]"
                                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                                }`}
                              >
                                {targetAgent ? "Change" : "Add"}
                              </button>
                            </div>
                          </div>
                          {clonePickerTargetId === target.id && cloneCandidates.length > 1 && (
                            <div className="mt-2 flex items-center justify-end gap-2">
                              <select
                                value={selectedCloneSourceCameraId ?? ""}
                                onChange={(e) =>
                                  setCloneSourceByTarget((prev) => ({
                                    ...prev,
                                    [target.id]: Number(e.target.value),
                                  }))
                                }
                                className="text-[11px] px-2 py-1 rounded border border-gray-700 bg-gray-900 text-gray-100 focus:outline-none focus:border-blue-500 max-w-[230px]"
                              >
                                {cloneCandidates.map((candidate) => (
                                  <option key={`${target.id}-${candidate.cameraId}`} value={candidate.cameraId}>
                                    {candidate.cameraName} - {candidate.agent.agent_key}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  if (selectedCloneSourceCameraId == null) return;
                                  requestCloneAgentFromCamera(target, selectedCloneSourceCameraId);
                                }}
                                disabled={isCloningAgent || selectedCloneSourceCameraId == null}
                                className={`text-xs px-2 py-1 rounded border border-gray-700 ${
                                  isCloningAgent || selectedCloneSourceCameraId == null
                                    ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                                }`}
                              >
                                {t("jobs.clone")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setClonePickerTargetId(null)}
                                className="p-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition-colors"
                                title={t("jobs.closeClonePicker")}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-widest text-gray-400">{t("jobs.priority")}</div>
                          <div className="mt-2">
                            <select
                              value={priorityValue}
                              onChange={(e) =>
                                handlePriorityChange(
                                  target,
                                  targetAgent,
                                  e.target.value as AgentPriority
                                )
                              }
                              disabled={savingPriorities.has(target.id)}
                              className={`text-[11px] px-2 py-1 rounded border bg-gray-900 text-gray-100 ${priorityClasses[priorityValue]} focus:outline-none ${
                                savingPriorities.has(target.id) ? "opacity-60 cursor-wait" : ""
                              }`}
                            >
                              <option value="CRITIC" style={{ backgroundColor: "#1A1A1A", color: "#D4D4D4" }}>CRITIC</option>
                              <option value="HIGH" style={{ backgroundColor: "#1A1A1A", color: "#D4D4D4" }}>HIGH</option>
                              <option value="MEDIUM" style={{ backgroundColor: "#1A1A1A", color: "#D4D4D4" }}>MEDIUM</option>
                              <option value="LOW" style={{ backgroundColor: "#1A1A1A", color: "#D4D4D4" }}>LOW</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-widest text-gray-400">{t("jobs.captureMode")}</div>
                          <label
                            className={`mt-2 inline-flex items-center gap-2 text-[11px] ${
                              canToggleCaptureMode ? "text-gray-200" : "text-gray-500"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={captureOnMotionOnlyValue}
                              onChange={(e) =>
                                handleOnlyCaptureOnMotionChange(
                                  target,
                                  targetAgent,
                                  e.target.checked
                                )
                              }
                              disabled={
                                !canToggleCaptureMode || savingOnlyCaptureOnMotion.has(target.id)
                              }
                              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500 disabled:opacity-50"
                            />
                            <span>{t("jobs.onlyCaptureMotion")}</span>
                          </label>
                        </div>
                            </div>
                          </div>
                  );
                })}
                </div>
                {defaultAgent && (
                  <div className="mt-2 p-2 bg-blue-900/20 rounded border border-blue-800">
                    <p className="text-xs text-blue-400">
                      {t("jobs.defaultAgentFallback")}: {defaultAgent.agent_key}
                    </p>
                  </div>
                )}
                {inferenceGroups.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                      <Users className="w-4 h-4 text-purple-300" />
                      <span>{t("jobs.inferenceGroups")}</span>
                      <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-purple-600/30 text-purple-100 border border-purple-400/30">
                        {inferenceGroups.length}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {inferenceGroups.map((group) => (
                        <div
                          key={group.id}
                          className="bg-purple-600/15 border border-purple-500/30 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-purple-100">
                              {group.name}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="p-1 rounded-md text-purple-200 hover:text-white hover:bg-purple-500/30 transition-colors"
                                title={t("jobs.editGroup")}
                                onClick={() => {
                                  const inferredSourceTargetId =
                                    group.source_target_id ??
                                    group.targetIds.find((targetId) => {
                                      const target = targets.find((t) => t.id === targetId);
                                      if (!target) return false;
                                      const targetAgent = agents.find(
                                        (agent) =>
                                          agent.is_active === 1 &&
                                          agent.camera_id === target.camera_id
                                      );
                                      const effectiveAgent = targetAgent || defaultAgent;
                                      return effectiveAgent?.agent_key === group.agentKey;
                                    }) ??
                                    null;
                                  setEditingGroupId(group.id);
                                  setGroupName(group.name);
                                  setGroupAgentKey(group.agentKey);
                                  setGroupAgentSourceTargetId(inferredSourceTargetId);
                                  setShowGroupModal(true);
                                }}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveGroup(group.id)}
                                className="p-1 rounded-md text-purple-200 hover:text-white hover:bg-purple-500/30 transition-colors"
                                title={t("jobs.deleteGroup")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {group.targetIds.map((targetId) => {
                              const target = targets.find((t) => t.id === targetId);
                              if (!target) return null;
                              return (
                                <span
                                  key={targetId}
                                  className="px-2.5 py-1 rounded-full bg-purple-900/40 text-purple-100 border border-purple-400/20 text-xs"
                                >
                                  {target.camera_name || `Camera ${target.camera_id}`}
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-3 text-[11px] uppercase tracking-widest text-purple-200">
                            {t("jobs.unifiedAgent")}
                          </div>
                          <div className="text-sm text-purple-100">{group.agentKey}</div>
                          <div className="mt-2 text-[11px] uppercase tracking-widest text-purple-200">
                            {t("jobs.inputType")}
                          </div>
                          <div className="text-sm text-purple-100">
                            {group.inputType === "image" ? t("jobs.image") : t("jobs.video")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showAgentForm && (
                  <div
                    ref={agentFormRef}
                    className={`mt-4 space-y-3 rounded-xl transition-all ${
                      highlightAgentForm
                        ? "ring-2 ring-blue-400/80 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] animate-pulse p-3 bg-blue-500/[0.03]"
                        : ""
                    }`}
                  >
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.targetCamera")} <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={agentFormCameraId ?? ""}
                        onChange={(e) =>
                          setAgentFormCameraId(e.target.value ? parseInt(e.target.value) : null)
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        required
                      >
                        <option value="">{t("jobs.selectTargetCamera")}</option>
                        {targets.map((target) => (
                          <option key={target.id} value={target.camera_id}>
                            {target.camera_name || `Camera ${target.camera_id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.prompt")} <span className="text-red-400">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          void openPromptEditor();
                        }}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-left text-sm focus:outline-none focus:border-blue-500 hover:border-blue-500/70 transition-colors"
                      >
                        <div className="text-gray-200">
                          {promptCoreFilled
                            ? t("jobs.promptEditor.promptConfiguredClickToEdit")
                            : t("jobs.promptEditor.clickToWritePrompt")}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">{promptEditorSummary}</div>
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.captureMode")}
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                        <input
                          type="checkbox"
                          checked={agentForm.only_capture_on_motion}
                          onChange={(e) =>
                            setAgentForm({
                              ...agentForm,
                              only_capture_on_motion: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                        />
                        <span>{t("jobs.onlyCaptureMotion")}</span>
                      </label>
                    </div>
                    {JOBS_TEMPORAL_CONTEXT_TOGGLE_ENABLED && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          {t("jobs.useTemporalContext")}
                        </label>
                        <label className="inline-flex items-start gap-2 text-sm text-gray-200">
                          <input
                            type="checkbox"
                            checked={normalizeAgentUseTemporalContext(agentForm.use_temporal_context)}
                            onChange={(e) =>
                              setAgentForm({
                                ...agentForm,
                                use_temporal_context: e.target.checked,
                              })
                            }
                            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="space-y-1">
                            <span className="block">{t("jobs.useTemporalContext")}</span>
                            <span className="block text-xs text-gray-400">
                              {t("jobs.useTemporalContextDescription")}
                            </span>
                          </span>
                        </label>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveAgent}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                      >
                        {t("jobs.saveAgent")}
                      </button>
                      <button
                        onClick={() => {
                          setShowAgentForm(false);
                          setHighlightAgentForm(false);
                          if (agentFormHighlightTimerRef.current) {
                            window.clearTimeout(agentFormHighlightTimerRef.current);
                            agentFormHighlightTimerRef.current = null;
                          }
                          setShowPromptEditor(false);
                          setPromptEnhanceSuggestion(null);
                          setAgentFormCameraId(null);
                        }}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                      >
                        {t("jobs.cancel")}
                      </button>
                    </div>
                  </div>
                )}
                <ConfirmDialog
                  isOpen={confirmDeleteFaceTarget.isOpen}
                  title={t("jobs.delete")}
                  message={t("jobs.promptEditor.confirmDeleteTarget", {
                    targetLabel: confirmDeleteFaceTarget.targetLabel,
                  })}
                  confirmLabel={t("jobs.promptEditor.delete")}
                  cancelLabel={t("jobs.cancel")}
                  variant="danger"
                  onConfirm={confirmDeleteFaceTargetDialog}
                  onCancel={closeDeleteFaceTargetDialog}
                />
                <ConfirmDialog
                  isOpen={confirmCloneAgent.isOpen}
                  title="Clone agent"
                  message={
                    confirmCloneAgent.targetId !== null && confirmCloneAgent.sourceCameraId !== null
                      ? `Clone agent "${
                          activeAgentByCameraId.get(confirmCloneAgent.sourceCameraId)?.agent_key || ""
                        }" from ${
                          targets.find(
                            (candidate) =>
                              candidate.camera_id === confirmCloneAgent.sourceCameraId
                          )?.camera_name || `Camera ${confirmCloneAgent.sourceCameraId}`
                        } to ${
                          targets.find((candidate) => candidate.id === confirmCloneAgent.targetId)
                            ?.camera_name ||
                          `Camera ${
                            targets.find((candidate) => candidate.id === confirmCloneAgent.targetId)
                              ?.camera_id ?? ""
                          }`
                        }?`
                      : "Clone this agent?"
                  }
                  confirmLabel={t("common.confirm")}
                  cancelLabel={t("jobs.cancel")}
                  variant="info"
                  onConfirm={confirmCloneAgentFromCamera}
                  onCancel={closeCloneAgentConfirmDialog}
                />
                {showPromptEditor && (
                  <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6">
                    <button
                      type="button"
                      className="absolute inset-0 bg-black/45 backdrop-blur-md"
                      onClick={closePromptEditor}
                      aria-label={t("jobs.promptEditor.closePromptEditorAria")}
                    />
                    <div
                      className="relative h-[90vh] max-h-[1050px] w-[min(88vw,1320px)] max-w-[88vw] bg-gray-800 text-gray-100 rounded-md shadow-2xl border border-gray-700 overflow-hidden flex flex-col"
                    >
                      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                        <div>
                          <h4 className="text-lg font-semibold leading-tight">
                            {t("jobs.promptEditor.title")}
                          </h4>
                          <p className="text-xs text-gray-400 mt-1">
                            {t("jobs.promptEditor.subtitle")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={normalizeAgentInferenceModel(agentForm.inference_model)}
                            onChange={(e) => {
                              const previousModel = normalizeAgentInferenceModel(
                                agentForm.inference_model
                              );
                              const nextModel = normalizeAgentInferenceModel(e.target.value);
                              if (shouldShowCoreModelNotice(nextModel, previousModel)) {
                                onShowToast(getCoreModelNoticeCopy(stepLocale).message, "info");
                              }
                              setAgentForm((prev) => {
                                const constrained = applyAgentExecutionConstraints(
                                  prev.inference_model === "core" ? "video" : promptEditorTargetInputType,
                                  nextModel,
                                  prev.run_every,
                                  prev.running_resolution,
                                  prev.model_fps
                                );
                                return {
                                  ...prev,
                                  inference_model: constrained.inferenceModel,
                                  model_fps: constrained.modelFps,
                                  run_every: constrained.runEvery,
                                  running_resolution: constrained.runningResolution,
                                };
                              });
                              if (
                                nextModel === "core" &&
                                promptEditorTargetInputType !== "video"
                              ) {
                                setPromptEditorInputTypeDraft("video");
                              }
                            }}
                            disabled={enhancingPrompt}
                            className="text-xs px-3 py-2 rounded border border-gray-700 bg-gray-900 text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                            title={t("jobs.inferenceModel")}
                            >
                              <option value="core">{t("jobs.inferenceModelOption.core")}</option>
                              <option value="light">{t("jobs.inferenceModelOption.light")}</option>
                              <option value="ultra">{t("jobs.inferenceModelOption.ultra")}</option>
                            </select>
                            <ModelHostingBadge
                              modelTier={normalizeAgentInferenceModel(agentForm.inference_model)}
                            />
                          <select
                            value={promptEditorTargetInputType}
                            onChange={(e) => {
                              if (!promptEditorTarget) return;
                              setPromptEditorInputTypeDraft(
                                normalizeTargetInputType(e.target.value)
                              );
                            }}
                            disabled={
                              !promptEditorTarget ||
                              enhancingPrompt ||
                              normalizeAgentInferenceModel(agentForm.inference_model) === "core"
                            }
                            className="text-xs px-3 py-2 rounded border border-gray-700 bg-gray-900 text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                            title={t("jobs.inputType")}
                          >
                            <option value="video">{t("jobs.video")}</option>
                            {normalizeAgentInferenceModel(agentForm.inference_model) !== "core" && (
                              <option value="image">{t("jobs.image")}</option>
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={closePromptEditor}
                            disabled={enhancingPrompt}
                            className="p-2 rounded-md text-gray-500 hover:text-gray-100 hover:bg-gray-700 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="px-8 py-6 min-h-0 overflow-hidden">
                        <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-6">
                          <div className="relative order-2 xl:order-2 min-h-0 overflow-hidden rounded-xl border border-gray-600/80 bg-gray-900/50 shadow-lg shadow-black/30">
                            <div
                              className={`h-full ${
                                enhancingPrompt ? "overflow-y-hidden" : "overflow-y-auto"
                              } pr-2 pl-4 space-y-5 p-5`}
                            >
                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-100">
                                {t("jobs.runEvery")}
                              </label>
                              <select
                                value={
                                  normalizeAgentInferenceModel(agentForm.inference_model) === "core"
                                    ? 60
                                    : agentForm.run_every
                                }
                                onChange={(e) =>
                                  setAgentForm((prev) => ({
                                    ...prev,
                                    run_every: normalizeAgentRunEverySeconds(
                                      Number(e.target.value),
                                      FIXED_AGENT_RUN_EVERY_SECONDS
                                    ),
                                  }))
                                }
                                disabled={normalizeAgentInferenceModel(agentForm.inference_model) === "core"}
                                className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                title={t("jobs.runInterval")}
                              >
                                {AGENT_RUN_EVERY_OPTIONS.map((seconds) => (
                                  <option key={seconds} value={seconds}>
                                    {getRunEveryOptionLabel(seconds)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {promptEditorTargetInputType === "video" ? (
                              <div className="space-y-2">
                                <label className="block text-sm font-semibold text-gray-100">
                                  Video packaging
                                </label>
                                <select
                                  value={normalizeAgentVideoPackagingMode(
                                    agentForm.video_packaging_mode
                                  )}
                                  onChange={(e) =>
                                    setAgentForm((prev) => ({
                                      ...prev,
                                      video_packaging_mode: normalizeAgentVideoPackagingMode(
                                        e.target.value
                                      ),
                                    }))
                                  }
                                  className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                                >
                                  <option value="frame_sequence">
                                    {getAgentVideoPackagingModeLabel("frame_sequence")}
                                  </option>
                                  <option value="mosaic_2x2">
                                    {getAgentVideoPackagingModeLabel("mosaic_2x2")}
                                  </option>
                                  <option value="mosaic_3x3">
                                    {getAgentVideoPackagingModeLabel("mosaic_3x3")}
                                  </option>
                                </select>
                                <p className="text-xs text-gray-400">
                                  Standard Resolution uses a 2x2 mosaic. Compact Resolution uses a
                                  3x3 mosaic and sends fewer image inputs than High Resolution.
                                </p>
                              </div>
                            ) : null}
                            {supportsAdjustableAgentVideoFps(
                              normalizeAgentInferenceModel(agentForm.inference_model)
                            ) &&
                            promptEditorTargetInputType === "video" ? (
                                <div className="space-y-2">
                                  <label className="block text-sm font-semibold text-gray-100">
                                    Video FPS
                                  </label>
                                <select
                                  value={agentForm.model_fps}
                                  onChange={(e) =>
                                    setAgentForm((prev) => ({
                                      ...prev,
                                      model_fps: normalizeAgentModelFps(
                                        Number(e.target.value),
                                        prev.model_fps
                                      ),
                                    }))
                                  }
                                  className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
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
                            {normalizeAgentInferenceModel(agentForm.inference_model) === "core" ? (
                              <div className="space-y-2">
                                <label className="block text-sm font-semibold text-gray-100">
                                  {t("jobs.runningResolution")}
                                </label>
                                <select
                                  value={agentForm.running_resolution ?? DEFAULT_CORE_RUNNING_RESOLUTION}
                                  onChange={(e) =>
                                    setAgentForm((prev) => ({
                                      ...prev,
                                      running_resolution: normalizeAgentRunningResolution(
                                        Number(e.target.value),
                                        DEFAULT_CORE_RUNNING_RESOLUTION
                                      ),
                                    }))
                                  }
                                  className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
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
                            {JOBS_TEMPORAL_CONTEXT_TOGGLE_ENABLED ? (
                              <div className="space-y-2">
                                <label className="block text-sm font-semibold text-gray-100">
                                  {t("jobs.useTemporalContext")}
                                </label>
                                <label className="flex items-start gap-3 rounded-lg border border-gray-700 bg-gray-800/70 px-3 py-3 text-sm text-gray-200">
                                  <input
                                    type="checkbox"
                                    checked={normalizeAgentUseTemporalContext(
                                      agentForm.use_temporal_context
                                    )}
                                    onChange={(e) =>
                                      setAgentForm((prev) => ({
                                        ...prev,
                                        use_temporal_context: e.target.checked,
                                      }))
                                    }
                                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                                  />
                                  <span className="space-y-1">
                                    <span className="block font-medium text-gray-100">
                                      {t("jobs.useTemporalContext")}
                                    </span>
                                    <span className="block text-xs text-gray-400">
                                      {t("jobs.useTemporalContextDescription")}
                                    </span>
                                  </span>
                                </label>
                              </div>
                            ) : null}
                            <div className={PROMPT_DOCUMENT_BLOCK_CLASS}>
                              <div className={PROMPT_DOCUMENT_SECTION_CLASS}>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(t("jobs.agentKey"))}
                                  </span>
                                  <span className="text-red-600">*</span>
                                </div>
                                <input
                                  aria-label={t("jobs.agentKey")}
                                  type="text"
                                  value={agentForm.agent_key}
                                  onChange={(e) =>
                                    setAgentForm((prev) => ({
                                      ...prev,
                                      agent_key: e.target.value,
                                    }))
                                  }
                                  className={PROMPT_DOCUMENT_INPUT_CLASS}
                                  placeholder={t("jobs.agentKeyPlaceholder")}
                                />
                              </div>
                              <div
                                className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(
                                      t("jobs.promptEditor.promptCoreLabel")
                                    )}
                                  </span>
                                  <span className="text-red-600">*</span>
                                </div>
                                <textarea
                                  aria-label={t("jobs.promptEditor.promptCoreLabel")}
                                  value={promptEditorDraft.prompt_template}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPromptEditorDraft((prev) => ({
                                      ...prev,
                                      prompt_template: value,
                                    }));
                                    setPromptEditorRegions((prev) =>
                                      prev.map((region) => ({
                                        ...region,
                                        prompt_core: value,
                                      }))
                                    );
                                  }}
                                  rows={8}
                                  className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                                  placeholder={t("jobs.promptEditor.promptCorePlaceholder")}
                                />
                              </div>
                              <div
                                className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(
                                      t("jobs.promptEditor.alertConditionLabel")
                                    )}
                                  </span>
                                  <span className="text-red-600">*</span>
                                </div>
                                <textarea
                                  aria-label={t("jobs.promptEditor.alertConditionLabel")}
                                  value={promptEditorDraft.alert_condition}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPromptEditorDraft((prev) => ({
                                      ...prev,
                                      alert_condition: value,
                                    }));
                                    setPromptEditorRegions((prev) =>
                                      prev.map((region) => ({
                                        ...region,
                                        alert_condition: value,
                                      }))
                                    );
                                  }}
                                  rows={5}
                                  className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                                  placeholder={t("jobs.promptEditor.alertConditionPlaceholder")}
                                />
                              </div>
                              <div
                                className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}
                              >
                                <div className="font-mono text-[13px] font-semibold text-gray-100">
                                  {formatPromptDocumentHeading(
                                    t("jobs.promptEditor.negativeConditionLabel"),
                                    {
                                      optional: true,
                                      optionalSuffix: localizedOptionalSuffix,
                                    }
                                  )}
                                </div>
                                <textarea
                                  aria-label={`${t("jobs.promptEditor.negativeConditionLabel")}${localizedOptionalSuffix}`}
                                  value={promptEditorDraft.negative_condition}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPromptEditorDraft((prev) => ({
                                      ...prev,
                                      negative_condition: value,
                                    }));
                                    setPromptEditorRegions((prev) =>
                                      prev.map((region) => ({
                                        ...region,
                                        negative_condition: value,
                                      }))
                                    );
                                  }}
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
                              <p className="text-xs text-gray-400">
                                Upload up to {NEGATIVE_REFERENCE_MAX_IMAGES} examples. Selection applies to the whole agent.
                              </p>
                              <div className="rounded border border-gray-700 bg-gray-800 p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label
                                    className={`text-xs ${
                                      !canManageNegativeReferences || negativeReferenceMaxReached
                                        ? "text-gray-500 cursor-not-allowed"
                                        : "text-blue-400 cursor-pointer hover:underline"
                                    }`}
                                  >
                                    {uploadingNegativeReferenceImages ? "Uploading..." : "Add image(s)"}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      className="hidden"
                                      disabled={
                                        !canManageNegativeReferences ||
                                        negativeReferenceMaxReached ||
                                        uploadingNegativeReferenceImages
                                      }
                                      onChange={(e) => {
                                        const selectedFiles = Array.from(e.target.files || []);
                                        void handleAddNegativeReferenceImages(selectedFiles);
                                        e.currentTarget.value = "";
                                      }}
                                    />
                                  </label>
                                  <span className="text-[11px] text-gray-500">
                                    {negativeReferenceImageCount}/{NEGATIVE_REFERENCE_MAX_IMAGES}
                                  </span>
                                </div>
                                {!canManageNegativeReferences ? (
                                  <p className="text-[11px] text-amber-400">
                                    Save this camera agent first to enable negative image uploads.
                                  </p>
                                ) : null}
                                {Array.isArray(agentForm.negative_reference_images) &&
                                agentForm.negative_reference_images.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    {agentForm.negative_reference_images.map((image) => (
                                      <div
                                        key={image.id}
                                        className={`relative h-14 w-14 rounded overflow-hidden border ${
                                          activeRegionNegativeImageIds.includes(image.id)
                                            ? "border-amber-400"
                                            : "border-gray-700"
                                        } bg-gray-800`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleActiveRegionNegativeImage(image.id)}
                                          className="absolute inset-0 z-10"
                                          title="Select for agent"
                                        />
                                        <img
                                          src={image.image_url}
                                          alt="Negative reference"
                                          className="h-full w-full object-cover"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleDeleteNegativeReferenceImage(image.id)
                                          }
                                          disabled={
                                            deletingNegativeReferenceImageId === image.id ||
                                            uploadingNegativeReferenceImages
                                          }
                                          className="absolute top-0 right-0 z-20 bg-black/70 text-white text-[10px] px-1 leading-4"
                                          title="Remove image"
                                        >
                                          x
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-gray-500">
                                    No negative reference images uploaded.
                                  </p>
                                )}
                              </div>
                            </div>
                            </div>
                            {enhancingPrompt ? (
                              <div className="absolute -inset-px z-20 rounded-xl bg-gray-950/55 backdrop-blur-[2px] flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3 text-gray-100">
                                  <div className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
                                    {t("jobs.promptEditor.enhancing")}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div
                            className={`order-1 xl:order-1 min-h-0 grid gap-4 ${
                              promptEditorTargetFacesExpanded
                                ? "grid-rows-[minmax(0,0.5fr)_minmax(0,1.5fr)]"
                                : "grid-rows-[minmax(0,1.35fr)_minmax(0,0.65fr)]"
                            }`}
                          >
                            <div className="min-h-0 rounded-xl border border-gray-600/80 bg-gray-900/55 overflow-hidden flex flex-col shadow-lg shadow-black/30">
                              <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between gap-2">
                                <div className="text-xs text-gray-300 truncate">
                                  {getPromptEditorCameraName(agentFormCameraId)}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = !polygonDrawEnabled;
                                      setPolygonDrawEnabled(next);
                                      if (!next) {
                                        setShowNewRegionDialog(false);
                                        setPendingPolygonSeed(null);
                                        setIsSizingPendingPolygon(false);
                                        setDraftPolygonRect(null);
                                      }
                                    }}
                                    disabled={
                                      !promptEditorSnapshotUrl ||
                                      polygonOnlyRegions.length >= ANALYSIS_REGION_MAX
                                    }
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
                                    onClick={retryPromptEditorSnapshot}
                                    disabled={promptEditorSnapshotRefreshBlocked}
                                    className="text-[11px] text-blue-300 hover:underline disabled:text-gray-500"
                                  >
                                    {promptEditorSnapshotLoading
                                      ? "Loading..."
                                      : promptEditorSnapshotRequesting
                                      ? "Refreshing..."
                                      : promptEditorSnapshotRefreshCooldownActive
                                      ? "Please wait..."
                                      : promptEditorSnapshotUrl
                                      ? "Refresh preview"
                                      : "Capture preview"}
                                  </button>
                                </div>
                              </div>
                              <div className="hidden">
                                <button
                                  type="button"
                                  onClick={() => setAnalysisRegionsPanelOpen((prev) => !prev)}
                                  className="w-full px-3 py-2 flex items-center justify-between gap-3 hover:bg-gray-800/50 transition-colors"
                                >
                                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                                    Analysis Regions
                                  </span>
                                  <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                                    {analysisRegionsPanelOpen ? "Hide" : "Show"}
                                    {analysisRegionsPanelOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                </button>
                                {analysisRegionsPanelOpen ? (
                                  <div className="px-3 pb-3">
                                    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                                          Active Regions
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={handleAddAnalysisRegion}
                                            className="px-2 py-1 rounded border border-gray-600 bg-gray-800 text-[11px] text-gray-200 hover:bg-gray-700"
                                          >
                                            Add Region
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleDuplicateActiveRegion}
                                            disabled={!activePromptRegion || promptEditorRegions.length >= ANALYSIS_REGION_MAX}
                                            className="px-2 py-1 rounded border border-gray-600 bg-gray-800 text-[11px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                                          >
                                            Duplicate
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleRemoveActiveRegion}
                                            disabled={!activePromptRegion || promptEditorRegions.length <= 1}
                                            className="px-2 py-1 rounded border border-rose-600/40 bg-rose-900/20 text-[11px] text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {promptEditorRegions.map((region, idx) => {
                                          const isActive = region.region_id === activePromptRegion?.region_id;
                                          return (
                                            <button
                                              key={region.region_id}
                                              type="button"
                                              onClick={() => {
                                                setActivePromptRegionId(region.region_id);
                                                setPolygonDrawEnabled(false);
                                              }}
                                              className={`px-3 py-1.5 rounded-md border text-xs transition-colors ${
                                                isActive
                                                  ? "border-blue-500 bg-blue-500/20 text-blue-100"
                                                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-750"
                                              }`}
                                            >
                                              {region.label || `Region ${idx + 1}`}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      {activePromptRegion ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                          <div className="space-y-1.5">
                                            <label className="text-[11px] uppercase tracking-wide text-gray-400">
                                              Region label
                                            </label>
                                            <input
                                              type="text"
                                              value={activePromptRegion.label}
                                              onChange={(e) =>
                                                updatePromptRegionById(activePromptRegion.region_id, (region) => ({
                                                  ...region,
                                                  label: e.target.value,
                                                }))
                                              }
                                              className="w-full px-2.5 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                            />
                                          </div>
                                          <div className="hidden md:block" />
                                          <label className="inline-flex items-center gap-2 text-xs text-gray-200">
                                            <input
                                              type="checkbox"
                                              checked={activePromptRegion.enabled !== false}
                                              onChange={(e) =>
                                                updatePromptRegionById(activePromptRegion.region_id, (region) => ({
                                                  ...region,
                                                  enabled: e.target.checked,
                                                }))
                                              }
                                              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-blue-500"
                                            />
                                            Region enabled
                                          </label>
                                          <label className="inline-flex items-center gap-2 text-xs text-gray-200">
                                            <input
                                              type="checkbox"
                                              checked={activePromptRegion.full_frame}
                                              onChange={handleToggleActiveRegionFullFrame}
                                              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-blue-500"
                                            />
                                            Use full frame (no polygon)
                                          </label>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div className="px-3 py-2 border-b border-gray-700/80 text-[11px] text-gray-400">
                                {pendingPolygonSeed
                                  ? "Drag on the image to size the new polygon."
                                  : polygonDrawEnabled
                                  ? "Click once on image to define polygon name and description."
                                  : polygonOnlyRegions.length > 0
                                  ? `${polygonOnlyRegions.length} polygon(s) configured.`
                                  : "No polygons configured. Full frame will be used."}
                              </div>
                              <div
                                className={`flex-1 bg-gray-900/60 relative p-3 flex items-start justify-center ${
                                  promptEditorTargetFacesExpanded
                                    ? "min-h-[180px]"
                                    : "min-h-[430px]"
                                }`}
                              >
                                {promptEditorSnapshotUrl ? (
                                  <div
                                    ref={previewCanvasRef}
                                    className="relative h-[78%] w-[78%] max-h-full max-w-full border border-gray-700 bg-black/25 flex items-center justify-center -mt-1"
                                    onMouseDown={handlePreviewMouseDown}
                                    onMouseMove={handlePreviewMouseMove}
                                    onMouseUp={handlePreviewMouseUp}
                                    onMouseLeave={handlePreviewMouseLeave}
                                  >
                                    <div className="absolute inset-0 rounded-md overflow-hidden">
                                      <img
                                        key={promptEditorSnapshotUrl}
                                        src={promptEditorSnapshotUrl}
                                        alt={getPromptEditorCameraName(agentFormCameraId)}
                                        className="h-full w-full object-contain object-center select-none pointer-events-none"
                                        draggable={false}
                                        onError={() => {
                                          setPromptEditorSnapshotMeta({
                                            thumbnail_url: null,
                                            last_thumbnail_update: null,
                                          });
                                          setPromptEditorSnapshotError(
                                            "Snapshot unavailable. Try capture preview."
                                          );
                                        }}
                                      />
                                      <svg
                                        className="absolute inset-0 h-full w-full"
                                        viewBox="0 0 100 100"
                                        preserveAspectRatio="none"
                                      >
                                        {polygonOnlyRegions.map((region) => {
                                          const isActive = activePromptRegion?.region_id === region.region_id;
                                          const isHovered = hoveredPromptRegionId === region.region_id;
                                          const points = Array.isArray(region.polygon_norm)
                                            ? region.polygon_norm
                                            : [];
                                          const centroid = getPolygonCentroid(points);
                                          return (
                                            <g key={region.region_id}>
                                              <polygon
                                                points={toSvgPoints(points)}
                                                fill="rgba(0,0,0,0.001)"
                                                stroke="rgba(0,0,0,0)"
                                                strokeWidth={4}
                                                onMouseEnter={() => {
                                                  setHoveredPromptRegionId(region.region_id);
                                                  setRegionActionRegionId(region.region_id);
                                                }}
                                                onMouseMove={() => {
                                                  setHoveredPromptRegionId(region.region_id);
                                                  setRegionActionRegionId(region.region_id);
                                                }}
                                                onMouseLeave={() => {
                                                  if (!isRegionActionHovered) {
                                                    setHoveredPromptRegionId(null);
                                                  }
                                                }}
                                                onMouseDown={(e) => {
                                                  e.stopPropagation();
                                                  setActivePromptRegionId(region.region_id);
                                                  setRegionActionRegionId(region.region_id);
                                                }}
                                                onClick={(e) => handleAddVertexToRegion(region.region_id, e)}
                                              />
                                              <polygon
                                                points={toSvgPoints(points)}
                                                fill={
                                                  region.enabled === false
                                                    ? "rgba(251,146,60,0.18)"
                                                    : isActive
                                                    ? "rgba(59,130,246,0.28)"
                                                    : "rgba(59,130,246,0.16)"
                                                }
                                                stroke={
                                                  region.enabled === false
                                                    ? "rgba(251,146,60,0.95)"
                                                    : isActive
                                                    ? "rgba(147,197,253,0.98)"
                                                    : "rgba(96,165,250,0.9)"
                                                }
                                                strokeWidth={isActive ? 0.65 : 0.45}
                                                pointerEvents="none"
                                              />
                                              <text
                                                x={Math.max(1, Math.min(95, centroid.x * 100))}
                                                y={Math.max(8, Math.min(97, centroid.y * 100))}
                                                fill="#e5e7eb"
                                                fontSize="2.6"
                                                textAnchor="middle"
                                                className="pointer-events-none"
                                              >
                                                {region.label || "Region"}
                                              </text>
                                              {(isActive || isHovered) &&
                                                points.map((point, idx) => (
                                                  <circle
                                                    key={`${region.region_id}-point-${idx}`}
                                                    cx={clamp01(point.x) * 100}
                                                    cy={clamp01(point.y) * 100}
                                                    r={1.05}
                                                    fill={idx === 0 ? "#34d399" : "#60a5fa"}
                                                    stroke="#0b1220"
                                                    strokeWidth={0.35}
                                                    onMouseDown={(e) => {
                                                      e.stopPropagation();
                                                      setActivePromptRegionId(region.region_id);
                                                      setRegionActionRegionId(region.region_id);
                                                      setDraggingPromptVertex({
                                                        region_id: region.region_id,
                                                        vertex_index: idx,
                                                      });
                                                    }}
                                                  />
                                                ))}
                                            </g>
                                          );
                                        })}
                                        {draftPolygonPoints.length >= ANALYSIS_REGION_MIN_POINTS ? (
                                          <polygon
                                            points={toSvgPoints(draftPolygonPoints)}
                                            fill="rgba(16,185,129,0.2)"
                                            stroke="rgba(52,211,153,0.95)"
                                            strokeWidth={0.6}
                                            strokeDasharray="1.8 1.2"
                                            pointerEvents="none"
                                          />
                                        ) : null}
                                      </svg>
                                    </div>
                                    {regionActionRegion && regionActionCentroid ? (
                                      <div
                                        data-region-action="true"
                                        className="absolute z-30 rounded border border-gray-600 bg-gray-950/90 px-2 py-1.5 flex items-center gap-2 shadow-lg"
                                        onMouseEnter={() => setIsRegionActionHovered(true)}
                                        onMouseLeave={() => setIsRegionActionHovered(false)}
                                        style={{
                                          left: `${Math.max(
                                            4,
                                            Math.min(96, regionActionCentroid.x * 100)
                                          )}%`,
                                          top: `${Math.max(
                                            4,
                                            Math.min(96, regionActionCentroid.y * 100)
                                          )}%`,
                                          transform:
                                            regionActionCentroid.y > 0.24
                                              ? "translate(-50%, -120%)"
                                              : "translate(-50%, 20%)",
                                        }}
                                      >
                                        <button
                                          type="button"
                                          data-region-action="true"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleRegionEnabled(regionActionRegion.region_id);
                                          }}
                                          className={`text-[10px] px-2 py-0.5 rounded border ${
                                            regionActionRegion.enabled === false
                                              ? "border-emerald-600/70 text-emerald-300"
                                              : "border-amber-600/70 text-amber-300"
                                          }`}
                                        >
                                          {regionActionRegion.enabled === false ? "Enable" : "Disable"}
                                        </button>
                                        <button
                                          type="button"
                                          data-region-action="true"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeRegionAndFallbackToFullFrame(regionActionRegion.region_id);
                                          }}
                                          className="text-[10px] px-2 py-0.5 rounded border border-rose-600/70 text-rose-300"
                                          title="Delete polygon"
                                        >
                                          X
                                        </button>
                                      </div>
                                    ) : null}
                                    {showNewRegionDialog && newRegionDialogAnchor ? (
                                      <div
                                        data-region-action="true"
                                        className="absolute z-40 w-64 rounded-lg border border-gray-600 bg-gray-900/95 p-3 shadow-xl"
                                        style={{
                                          left: `${Math.max(2, Math.min(98, newRegionDialogAnchor.x * 100))}%`,
                                          top: `${Math.max(2, Math.min(98, newRegionDialogAnchor.y * 100))}%`,
                                          transform: `translate(${
                                            newRegionDialogAnchor.x <= 0.7
                                              ? "8px"
                                              : "calc(-100% - 8px)"
                                          }, ${
                                            newRegionDialogAnchor.y <= 0.28
                                              ? "8px"
                                              : "calc(-100% - 8px)"
                                          })`,
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                      >
                                        <p className="text-xs font-semibold text-gray-200 mb-2">
                                          New polygon
                                        </p>
                                        <div className="space-y-2">
                                          <input
                                            type="text"
                                            value={newRegionDialogLabel}
                                            onChange={(e) => setNewRegionDialogLabel(e.target.value)}
                                            placeholder="Polygon name"
                                            className="w-full px-2 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                          />
                                          <input
                                            type="text"
                                            value={newRegionDialogDescription}
                                            onChange={(e) => setNewRegionDialogDescription(e.target.value)}
                                            placeholder="Description (optional)"
                                            className="w-full px-2 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                          />
                                          <div className="flex items-center justify-end gap-2 pt-1">
                                            <button
                                              type="button"
                                              onClick={handleCancelNewRegionDialog}
                                              className="px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-300"
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleConfirmNewRegionDialog}
                                              className="px-2 py-1 text-[11px] rounded border border-blue-600/70 bg-blue-600/25 text-blue-100"
                                            >
                                              Continue
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                    {promptSnapshotLastUpdate ? (
                                      <div className="absolute bottom-2 right-2 text-[10px] text-gray-300 bg-black/50 px-2 py-1 rounded inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {new Date(promptSnapshotLastUpdate).toLocaleString(stepLocale)}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
                                    <Camera className="w-10 h-10 text-gray-600" />
                                    <p className="text-xs text-gray-400">
                                      {promptEditorSnapshotLoading
                                        ? "Loading latest snapshot..."
                                        : promptEditorSnapshotRequesting
                                        ? "Capturing snapshot in background..."
                                        : "No snapshot available yet."}
                                    </p>
                                    {promptEditorSnapshotError ? (
                                      <p className="text-[11px] text-amber-400">
                                        {promptEditorSnapshotError}
                                      </p>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="min-h-0 rounded-xl border border-gray-600/80 bg-gray-900/55 overflow-hidden flex flex-col shadow-lg shadow-black/30">
                              <div className="px-4 py-3 border-b border-gray-700">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1 min-w-0">
                                    <label className="block text-sm font-semibold text-gray-100">
                                      {t("jobs.promptEditor.targetFacesOptionalLabel")}
                                    </label>
                                    <p className="text-xs text-gray-400">
                                      {t("jobs.promptEditor.targetFacesDescription")}
                                    </p>
                                    <p className="text-[11px] text-blue-300">
                                      Selected faces are shared across all polygons in this agent.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPromptEditorTargetFacesExpanded((prev) => !prev)
                                    }
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500 hover:text-gray-100"
                                    title={
                                      promptEditorTargetFacesExpanded
                                        ? "Collapse target faces panel"
                                        : "Expand target faces panel"
                                    }
                                  >
                                    {promptEditorTargetFacesExpanded ? (
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
                                placeholder={t("jobs.promptEditor.targetNameRequiredPlaceholder")}
                              />
                              <input
                                type="text"
                                value={newFaceTargetDescription}
                                onChange={(e) => setNewFaceTargetDescription(e.target.value)}
                                className="w-full px-3 py-2 rounded border border-gray-700 bg-gray-800 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                                placeholder={t("jobs.promptEditor.targetDescriptionOptionalPlaceholder")}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] || null;
                                  setNewFaceTargetFile(file);
                                }}
                                className="text-xs text-gray-300"
                              />
                              <button
                                type="button"
                                onClick={handleCreateFaceTarget}
                                disabled={creatingFaceTarget}
                                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs"
                              >
                                {creatingFaceTarget
                                  ? t("jobs.promptEditor.creating")
                                  : t("jobs.promptEditor.createTarget")}
                              </button>
                              <button
                                type="button"
                                onClick={fetchFaceTargetsLibraryData}
                                disabled={faceTargetsLoading}
                                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-100 text-xs"
                              >
                                {t("jobs.promptEditor.refresh")}
                              </button>
                            </div>
                            <p className="text-[11px] text-gray-500">
                              {t("jobs.promptEditor.tipAutoCreateOnApply")}
                            </p>
                          </div>

                          <div className="space-y-2">
                            {faceTargetsLoading ? (
                              <p className="text-xs text-gray-500">
                                {t("jobs.promptEditor.loadingTargetFaces")}
                              </p>
                            ) : faceTargetsLibrary.length === 0 ? (
                              <p className="text-xs text-gray-500">
                                {t("jobs.promptEditor.noTargetFacesYet")}
                              </p>
                            ) : (
                              faceTargetsLibrary.map((target) => {
                                const selected = activeRegionFaceTargetIds.includes(target.id);
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
                                          onChange={() => toggleAgentFaceTarget(target.id)}
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
                                              placeholder={t("jobs.promptEditor.targetNamePlaceholder")}
                                            />
                                            <input
                                              type="text"
                                              value={editingFaceTargetDescription}
                                              onChange={(e) =>
                                                setEditingFaceTargetDescription(e.target.value)
                                              }
                                              onClick={(e) => e.stopPropagation()}
                                              className="w-full px-2 py-1 rounded border border-gray-700 bg-gray-800 text-gray-100 text-xs focus:outline-none focus:border-blue-500"
                                              placeholder={t("jobs.promptEditor.targetDescriptionPlaceholder")}
                                            />
                                            <span className="block text-[11px] text-gray-500 mt-0.5">
                                              {t("jobs.promptEditor.imageCount", {
                                                count: currentImageCount,
                                              })}
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
                                              {t("jobs.promptEditor.imageCount", {
                                                count: currentImageCount,
                                              })}
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
                                          {faceTargetUploadingId === target.id
                                            ? t("jobs.promptEditor.uploading")
                                            : t("jobs.promptEditor.addImage")}
                                          <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            disabled={isDeletingTarget || maxImagesReached}
                                            onChange={(e) => {
                                              const selectedFiles = Array.from(e.target.files || []);
                                              void handleAddFaceTargetImage(target.id, selectedFiles);
                                              e.currentTarget.value = "";
                                            }}
                                          />
                                        </label>
                                        {isEditingTarget ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => void handleSaveFaceTargetMeta(target.id)}
                                              disabled={isSavingTarget}
                                              className="text-[11px] text-emerald-400 hover:underline disabled:text-gray-500"
                                            >
                                              {isSavingTarget
                                                ? t("jobs.promptEditor.saving")
                                                : t("jobs.promptEditor.save")}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={cancelEditingFaceTarget}
                                              disabled={isSavingTarget}
                                              className="text-[11px] text-gray-400 hover:underline disabled:text-gray-500"
                                            >
                                              {t("jobs.cancel")}
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
                                              {t("jobs.promptEditor.edit")}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => openDeleteFaceTargetDialog(target)}
                                              disabled={isDeletingTarget}
                                              className="text-[11px] text-rose-400 hover:underline disabled:text-gray-500"
                                            >
                                              {isDeletingTarget
                                                ? t("jobs.promptEditor.deleting")
                                                : t("jobs.promptEditor.delete")}
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
                                                void handleDeleteFaceTargetImage(target.id, image.id)
                                              }
                                              disabled={
                                                faceTargetDeletingImageId === image.id || isDeletingTarget
                                              }
                                              className="absolute top-0 right-0 bg-black/60 text-white text-[10px] px-1 leading-4"
                                              title={t("jobs.promptEditor.removeImageTitle")}
                                            >
                                              x
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-amber-400">
                                        {t("jobs.promptEditor.addAtLeastOneImage")}
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
                  </div>
                </div>
                      <div className="px-8 py-4 border-t border-gray-700 bg-gray-800/70 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={closePromptEditor}
                          disabled={enhancingPrompt}
                          className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm"
                        >
                          {t("jobs.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={handleEnhancePromptWithAI}
                          disabled={!canEnhancePromptWithAI}
                          className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 border border-white/85 hover:border-white disabled:bg-gray-600 disabled:border-white/35 disabled:cursor-not-allowed text-white text-sm inline-flex items-center gap-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {enhancingPrompt
                            ? t("jobs.promptEditor.enhancing")
                            : t("jobs.promptEditor.enhanceWithAI")}
                        </button>
                        <button
                          type="button"
                          onClick={applyPromptEditor}
                          disabled={enhancingPrompt}
                          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
                        >
                          {t("jobs.promptEditor.applyAndSave")}
                        </button>
                      </div>
                      {promptEnhanceSuggestion && (
                        <div className="absolute inset-0 z-20 bg-gray-950/65 backdrop-blur-sm flex items-center justify-center p-6">
                          <div className="w-full max-w-3xl max-h-[85vh] bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden flex flex-col">
                            <div className="px-6 py-4 border-b border-gray-700">
                              <h5 className="text-base font-semibold text-gray-100">
                                {t("jobs.promptEditor.aiSuggestionReadyTitle")}
                              </h5>
                              <p className="text-xs text-gray-400 mt-1">
                                {t("jobs.promptEditor.aiSuggestionReadyDescription")}
                              </p>
                              {(promptEnhanceSuggestion.model_name ||
                                promptEnhanceSuggestion.snapshot_source) && (
                                <p className="text-[11px] text-gray-500 mt-2">
                                  {promptEnhanceSuggestion.model_name
                                    ? `${t("jobs.promptEditor.metaModelPrefix")} ${promptEnhanceSuggestion.model_name}`
                                    : ""}
                                  {promptEnhanceSuggestion.model_name &&
                                  promptEnhanceSuggestion.snapshot_source
                                    ? " | "
                                    : ""}
                                  {promptEnhanceSuggestion.snapshot_source
                                    ? `${t("jobs.promptEditor.metaSnapshotPrefix")} ${promptEnhanceSuggestion.snapshot_source}`
                                    : ""}
                                </p>
                              )}
                            </div>
                            <div className="px-6 py-4 overflow-y-auto">
                              <div className={PROMPT_DOCUMENT_BLOCK_CLASS}>
                                <div className={PROMPT_DOCUMENT_SECTION_CLASS}>
                                  <div className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(
                                      t("jobs.promptEditor.promptCoreLabel")
                                    )}
                                  </div>
                                  <textarea
                                    aria-label={t("jobs.promptEditor.promptCoreLabel")}
                                    value={promptEnhanceSuggestion.prompt_template}
                                    readOnly
                                    rows={5}
                                    className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                                  />
                                </div>
                                <div
                                  className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}
                                >
                                  <div className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(
                                      t("jobs.promptEditor.alertConditionLabel")
                                    )}
                                  </div>
                                  <textarea
                                    aria-label={t("jobs.promptEditor.alertConditionLabel")}
                                    value={promptEnhanceSuggestion.alert_condition}
                                    readOnly
                                    rows={4}
                                    className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                                  />
                                </div>
                                <div
                                  className={`${PROMPT_DOCUMENT_SECTION_CLASS} border-t border-gray-700`}
                                >
                                  <div className="font-mono text-[13px] font-semibold text-gray-100">
                                    {formatPromptDocumentHeading(
                                      t("jobs.promptEditor.negativeConditionLabel"),
                                      {
                                        optional: true,
                                        optionalSuffix: localizedOptionalSuffix,
                                      }
                                    )}
                                  </div>
                                  <textarea
                                    aria-label={`${t("jobs.promptEditor.negativeConditionLabel")}${localizedOptionalSuffix}`}
                                    value={promptEnhanceSuggestion.negative_condition}
                                    readOnly
                                    rows={4}
                                    className={PROMPT_DOCUMENT_TEXTAREA_CLASS}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/70 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPromptEnhanceSuggestion(null)}
                                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm"
                              >
                                {t("jobs.promptEditor.keepCurrent")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const suggested = {
                                    prompt_template: promptEnhanceSuggestion.prompt_template,
                                    alert_condition: promptEnhanceSuggestion.alert_condition,
                                    negative_condition: promptEnhanceSuggestion.negative_condition,
                                  };
                                  setPromptEditorDraft((prev) => ({
                                    ...prev,
                                    ...suggested,
                                  }));
                                  setPromptEditorRegions((prev) =>
                                    prev.map((region) => ({
                                      ...region,
                                      prompt_core: suggested.prompt_template,
                                      alert_condition: suggested.alert_condition,
                                      negative_condition: suggested.negative_condition,
                                    }))
                                  );
                                  setPromptEnhanceSuggestion(null);
                                  onShowToast(
                                    t("jobs.promptEditor.toastAiSuggestionApplied"),
                                    "success"
                                  );
                                }}
                                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
                              >
                                {t("jobs.promptEditor.useSuggested")}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {showGroupModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={closeGroupModal}
              />
              <div className="relative w-full max-w-2xl max-h-[90vh] bg-gray-900/95 border border-gray-800 rounded-2xl shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                  <h4 className="text-lg font-semibold text-white">
                    {editingGroupId ? t("jobs.editInferenceGroup") : t("jobs.createInferenceGroup")}
                  </h4>
                  <button
                    type="button"
                    onClick={closeGroupModal}
                    className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-6 py-4 text-sm text-gray-300 space-y-4 overflow-y-auto min-h-0">
                  <p className="text-gray-400">
                    {editingGroupId
                      ? t("jobs.groupUpdateDescription")
                      : t("jobs.groupCreateDescription")}
                  </p>
                  <div className="space-y-2">
                    {modalTargets.map((target) => (
                      <div
                        key={target.id}
                        className="flex items-center gap-3 bg-gray-800/60 border border-gray-700/60 rounded-xl px-3 py-2"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center">
                          <Camera className="w-4 h-4" />
                        </div>
                        <span className="text-gray-100">
                          {target.camera_name || `Camera ${target.camera_id}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-400 mb-2">
                      {t("jobs.groupNameOptional")}
                    </label>
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      placeholder={t("jobs.groupNamePlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-400 mb-2">
                      {t("jobs.groupAgentSource")}
                    </label>
                    <select
                      value={groupAgentSourceTargetId ?? selectedGroupSourceOption?.targetId ?? ""}
                      onChange={(e) => {
                        const selectedTargetId = Number(e.target.value);
                        if (!Number.isInteger(selectedTargetId) || selectedTargetId <= 0) {
                          setGroupAgentSourceTargetId(null);
                          setGroupAgentKey("");
                          return;
                        }
                        const selectedSource = groupAgentSourceOptions.find(
                          (option) => option.targetId === selectedTargetId
                        );
                        if (!selectedSource) {
                          setGroupAgentSourceTargetId(null);
                          setGroupAgentKey("");
                          return;
                        }
                        setGroupAgentSourceTargetId(selectedSource.targetId);
                        setGroupAgentKey(selectedSource.agentKey);
                      }}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">{t("jobs.selectCameraAgent")}</option>
                      {groupAgentSourceOptions.map((option) => (
                        <option key={`group-source-${option.targetId}`} value={option.targetId}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {selectedGroupAgentKeys.size > 1 && !selectedGroupSourceOption && (
                      <p className="mt-2 text-xs text-orange-300">
                        {t("jobs.selectedCamerasDifferentAgents")}
                      </p>
                    )}
                    {groupAgentSourceOptions.length === 0 && (
                      <p className="mt-2 text-xs text-orange-300">
                        {t("jobs.configureActiveAgentBeforeGroup")}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-400 mb-2">
                      {t("jobs.inputType")}
                    </label>
                    <div className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm">
                      {t("jobs.image")}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-400 mb-2">
                      {t("jobs.inheritedParameters")}
                    </label>
                    {selectedGroupSourceOption ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.sourceCamera")}</div>
                          <div className="text-gray-100">{selectedGroupSourceOption.cameraLabel}</div>
                        </div>
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.agentKey")}</div>
                          <div className="text-gray-100">{selectedGroupSourceOption.agentKey}</div>
                        </div>
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.aiAgentTier")}</div>
                          <div className="text-gray-100 capitalize">{selectedGroupSourceOption.inferenceModel}</div>
                        </div>
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.priority")}</div>
                          <div className="text-gray-100">{selectedGroupSourceOption.priorityLevel}</div>
                        </div>
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.runEvery")}</div>
                          <div className="text-gray-100">{formatAgentRunEveryLabel(selectedGroupSourceOption.runEvery)}</div>
                        </div>
                        <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                          <div className="text-[10px] uppercase tracking-widest text-gray-400">{t("jobs.captureMode")}</div>
                          <div className="text-gray-100">
                            {selectedGroupSourceOption.onlyCaptureOnMotion
                              ? t("jobs.onlyWhenMotionDetected")
                              : t("jobs.alwaysCapture")}
                          </div>
                        </div>
                        {selectedGroupSourceOption.inputType === "video" ? (
                          <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                            <div className="text-[10px] uppercase tracking-widest text-gray-400">Video packaging</div>
                            <div className="text-gray-100">
                              {getAgentVideoPackagingModeLabel(
                                selectedGroupSourceOption.videoPackagingMode
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-400 text-sm">
                        {t("jobs.selectSourceCameraToPreview")}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={closeGroupModal}
                    disabled={savingInferenceGroups}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    {t("jobs.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveGroup}
                    disabled={!canSubmitGroup}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      !canSubmitGroup
                        ? "bg-blue-500/20 text-blue-200/60 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-500"
                    }`}
                  >
                    {savingInferenceGroups
                      ? t("jobs.saving")
                      : editingGroupId
                      ? t("jobs.saveGroup")
                      : t("jobs.createGroup")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Start Condition Section */}
          <div className="border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-300">{t("jobs.startCondition")}</h5>
              {step.step_order !== 1 && (
                <button
                  onClick={() => setShowStartConditionForm(!showStartConditionForm)}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  {showStartConditionForm ? "Cancel" : <Edit2 className="w-3.5 h-3.5 inline" />}
                </button>
              )}
            </div>

            {step.step_order === 1 ? (
              <p className="text-sm text-gray-400">{t("jobs.sequentialJobStart")}</p>
            ) : showStartConditionForm ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t("jobs.mode")}</label>
                  <select
                    value={startConditionForm.mode}
                    onChange={(e) =>
                      setStartConditionForm({
                        ...startConditionForm,
                        mode: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="sequential">{t("jobs.sequentialAfterPreviousStep")}</option>
                    {/*
                    <option value="positive">Positive answer based</option>
                    <option value="negative">Negative answer based</option>
                    */}
                    <option value="custom">{t("jobs.customAnswerBased")}</option>
                    <option value="time">{t("jobs.timeBased")}</option>
                  </select>
                </div>

                {(startConditionForm.mode === "positive" || startConditionForm.mode === "negative" || startConditionForm.mode === "custom") && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.previousStep")}
                      </label>
                      <select
                        value={startConditionForm.step_id}
                        onChange={(e) =>
                          setStartConditionForm({
                            ...startConditionForm,
                            step_id: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="">{t("jobs.selectStep")}</option>
                        {previousSteps.map((s) => (
                          <option key={s.id} value={s.id}>
                            Step #{s.step_order}: {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {startConditionForm.mode === "custom" && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          {t("jobs.answerResultKey")}
                        </label>
                        <input
                          type="text"
                          value={startConditionForm.answer_key}
                          onChange={(e) =>
                            setStartConditionForm({
                              ...startConditionForm,
                              answer_key: e.target.value,
                            })
                          }
                          placeholder={t("jobs.answerResultPlaceholder")}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.targetKey")}
                      </label>
                      <select
                        value={startConditionForm.target_key}
                        onChange={(e) =>
                          setStartConditionForm({
                            ...startConditionForm,
                            target_key: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="">{t("jobs.selectTarget")}</option>
                        {startConditionStepTargets.map((target) => (
                          <option key={target.id} value={target.camera_name || `Camera ${target.camera_id}`}>
                            {target.camera_name || `Camera ${target.camera_id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.whenConditionNotMet")}
                      </label>
                      <select
                        value={startConditionForm.on_fail}
                        onChange={(e) =>
                          setStartConditionForm({
                            ...startConditionForm,
                            on_fail: e.target.value as "skip" | "fail",
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="skip">{t("jobs.skipStep")}</option>
                        <option value="fail">{t("jobs.failJob")}</option>
                      </select>
                    </div>
                  </>
                )}

                {startConditionForm.mode === "time" && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {t("jobs.startTimeHHMM")}
                    </label>
                    <input
                      type="time"
                      value={startConditionForm.time}
                      onChange={(e) =>
                        setStartConditionForm({
                          ...startConditionForm,
                          time: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t("jobs.stepWillStartAtTime")}
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveStartCondition}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    {t("jobs.save")}
                  </button>
                  <button
                    onClick={() => setShowStartConditionForm(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                  >
                    {t("jobs.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-400">
                {(() => {
                  // Check new columns first, then fall back to legacy format
                  const startCondition = step.start_condition || "";
                  const startConditionFromStepId = step.start_condition_from_step_id;
                  
                  // Legacy fallback
                  const legacyInjectKey = step.input_inject_key || "";
                  const legacyFromStepId = step.input_from_step_id;
                  
                  const conditionStr = startCondition || (legacyInjectKey.startsWith("start:") ? legacyInjectKey : "");
                  const fromStepId = startConditionFromStepId || (legacyInjectKey.startsWith("start:") ? legacyFromStepId : null);
                  
                  if (!conditionStr || !conditionStr.startsWith("start:")) {
                    return t("jobs.sequentialAfterPreviousStep");
                  }

                  const parts = conditionStr.split(":");
                  if (parts.length < 3) {
                    return t("jobs.sequentialAfterPreviousStep");
                  }

                  const mode = parts[1];
                  const value = parts.slice(2).join(":");

                  if (mode === "custom") {
                    const answerKey = parts[2] || "";
                    const targetKey = parts[3] || "";
                    const sourceStep = steps.find((s) => s.id === fromStepId);
                    const stepLabel = sourceStep
                      ? `Step #${sourceStep.step_order}: ${sourceStep.name}`
                      : `Step #${fromStepId}`;
                    const targetSuffix = targetKey ? ` ${t("jobs.onTarget")} ${targetKey}` : "";
                    return t("jobs.whenKeyForStep", { stepLabel, answerKey, targetSuffix });
                  }

                  if (mode === "positive" || mode === "negative") {
                    const sourceStep = steps.find((s) => s.id === fromStepId);
                    const stepLabel = sourceStep
                      ? `Step #${sourceStep.step_order}: ${sourceStep.name}`
                      : `Step #${fromStepId}`;
                    
                    // Check if using default "result" key or custom key
                    if (value === "result" || value.startsWith("result:")) {
                      return t("jobs.whenResultIs", { stepLabel, mode });
                    } else {
                      // Extract just the key part (before any target suffix)
                      const keyPart = value.split(":")[0];
                      return t("jobs.whenKeyIs", { stepLabel, keyPart, mode });
                    }
                  } else if (mode === "time") {
                    return t("jobs.atTimeWithinSchedule", { value });
                  }

                  return t("jobs.sequentialAfterPreviousStep");
                })()}
              </div>
            )}
          </div>

          {/* Pipeline Section */}
          <div className="border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-300">{t("jobs.pipelineChooseFromPreviousStep")}</h5>
              <button
                onClick={() => setShowPipelineForm(!showPipelineForm)}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                {showPipelineForm ? t("jobs.cancel") : <Edit2 className="w-3.5 h-3.5 inline" />}
              </button>
            </div>

            {showPipelineForm ? (
              <div className="space-y-4">
                {pipelineForm.pipelines.map((row, idx) => {
                  const targetsForStep = row.input_from_step_id
                    ? String(row.input_from_step_id) === String(step.id)
                      ? targets
                      : pipelineTargetsByStepId[String(row.input_from_step_id)] || []
                    : [];
                  return (
                    <div key={row.id} className="border border-gray-800 rounded-md p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-400">{t("jobs.pipelineRow", { index: idx + 1 })}</div>
                        {pipelineForm.pipelines.length > 1 && (
                          <button
                            onClick={() => removePipelineRow(row.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            {t("jobs.remove")}
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          {t("jobs.inputFromStep")}
                        </label>
                        <select
                          value={row.input_from_step_id || ""}
                          onChange={(e) =>
                            updatePipelineRow(row.id, {
                              input_from_step_id: e.target.value,
                              input_inject_keys: [],
                              target_camera_id: "",
                            })
                          }
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        >
                          <option value="">{t("jobs.none")}</option>
                          {pipelineSourceSteps.map((s) => (
                            <option key={s.id} value={s.id}>
                              Step #{s.step_order}: {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {row.input_from_step_id && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            {t("jobs.inputFromTarget")} <span className="text-red-400">*</span>
                          </label>
                          <select
                            multiple
                            value={row.input_inject_keys}
                            onChange={(e) => {
                              const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                              updatePipelineRow(row.id, { input_inject_keys: selected });
                            }}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                          >
                            {targetsForStep.length === 0 && (
                              <option value="" disabled>
                                {t("jobs.selectTarget")}
                              </option>
                            )}
                            {targetsForStep.map((target) => {
                              const value = target.camera_name || `Camera ${target.camera_id}`;
                              return (
                                <option key={target.id} value={value}>
                                  {value}
                                </option>
                              );
                            })}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            {t("jobs.holdCtrlCmd")}
                          </p>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          {t("jobs.outputToTarget")}
                        </label>
                        <select
                          value={row.target_camera_id}
                          onChange={(e) =>
                            updatePipelineRow(row.id, {
                              target_camera_id: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        >
                          <option value="">{t("jobs.none")}</option>
                          {targets.map((target) => (
                            <option key={target.id} value={target.camera_id}>
                              {target.camera_name || `Camera ${target.camera_id}`}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {t("jobs.pipelineWithoutOutputHint")}
                        </p>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between">
                  <button
                    onClick={addPipelineRow}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                  >
                    {t("jobs.addPipeline")}
                  </button>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">{t("jobs.onMissingInput")}</label>
                    <select
                      value={pipelineForm.on_missing_input}
                      onChange={(e) =>
                        setPipelineForm({
                          ...pipelineForm,
                          on_missing_input: e.target.value,
                        })
                      }
                      className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="skip">{t("jobs.skip")}</option>
                      <option value="fail">{t("jobs.fail")}</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSavePipeline}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    {t("jobs.savePipeline")}
                  </button>
                  <button
                    onClick={() => setShowPipelineForm(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                  >
                    {t("jobs.cancel")}
                  </button>
                </div>
              </div>
            ) : stepPipelines.length > 0 ? (
              <div className="space-y-2 text-sm text-gray-400">
                {stepPipelines.map((p, idx) => {
                  const sourceStep = steps.find((s) => s.id === p.input_from_step_id);
                  const label = sourceStep
                    ? `Step #${sourceStep.step_order}: ${sourceStep.name}`
                    : `Step #${p.input_from_step_id}`;
                  const targetCamera = p.target_camera_id
                    ? targets.find((t) => t.camera_id === p.target_camera_id)
                    : null;
                  const targetLabel = targetCamera
                    ? targetCamera.camera_name || `Camera ${targetCamera.camera_id}`
                    : p.target_camera_id
                    ? `Camera ${p.target_camera_id}`
                    : p.target_camera_name
                    ? p.target_camera_name
                    : t("jobs.none");
                  return (
                    <div key={`${p.input_from_step_id}-${idx}`} className="border border-gray-800 rounded-md p-2">
                      <div>
                        <span className="text-gray-500">{t("jobs.inputFromStep")}:</span> {label}
                      </div>
                      <div>
                        <span className="text-gray-500">{t("jobs.inputFromTarget")}:</span> {p.input_inject_keys.join(", ")}
                      </div>
                      <div>
                        <span className="text-gray-500">{t("jobs.outputToTarget")}:</span> {targetLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t("jobs.noPipelineConfigured")}</p>
            )}
          </div>

          {/* Alerts Section */}
          <div className="border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-300">{t("jobs.alerts")}</h5>
              <button
                onClick={() => setShowAlertForm(!showAlertForm)}
                className={`text-sm ${
                  isReady
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-gray-600 cursor-not-allowed"
                }`}
                disabled={!isReady}
              >
                {showAlertForm ? t("jobs.cancel") : t("jobs.addAlert")}
              </button>
            </div>

            {!isReady ? (
              <p className="text-sm text-gray-500">
                {t("jobs.validation.stepNotReady")}
              </p>
            ) : showAlertForm ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {t("jobs.channel")}
                  </label>
                  <select
                    value={alertForm.channel}
                    onChange={(e) =>
                      setAlertForm({ ...alertForm, channel: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="telegram">{t("jobs.telegram")}</option>
                    <option value="webhook">{t("jobs.webhook")}</option>
                  </select>
                </div>
                {alertForm.channel === "webhook" && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.url")}
                      </label>
                      <input
                        type="text"
                        value={alertForm.webhook_url}
                        onChange={(e) =>
                          setAlertForm({ ...alertForm, webhook_url: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        placeholder={t("jobs.webhookUrlPlaceholder")}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t("jobs.inject")}
                      </label>
                      <input
                        type="text"
                        value={alertForm.webhook_inject}
                        onChange={(e) =>
                          setAlertForm({ ...alertForm, webhook_inject: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        placeholder={t("jobs.injectPlaceholder")}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {t("jobs.messageTemplate")}
                  </label>
                  <textarea
                    value={alertForm.message_template}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        message_template: e.target.value,
                      })
                    }
                    rows={2}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    placeholder={t("jobs.alertMessagePlaceholder")}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveAlert}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    {t("jobs.saveAlert")}
                  </button>
                  <button
                    onClick={() => setShowAlertForm(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
                  >
                    {t("jobs.cancel")}
                  </button>
                </div>
              </div>
            ) : alerts.length === 0 ? (
              <p className="text-sm text-gray-500">{t("jobs.noAlerts")}</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => {
                  let params: any = {};
                  try {
                    params = JSON.parse(alert.channel_params || "{}");
                  } catch (e) {
                    // Ignore parse errors
                  }

                  return (
                    <div
                      key={alert.id}
                      className="flex items-start justify-between text-sm bg-gray-800/50 p-2 rounded"
                    >
                      <div className="flex-1">
                        <p className="text-gray-400 font-medium">{alert.channel}</p>
                        {alert.channel === "webhook" && params.url && (
                          <p className="text-gray-500 text-xs mt-0.5">
                            {t("jobs.url")}: {params.url}
                          </p>
                        )}
                        {alert.message_template && (
                          <p className="text-gray-500 text-xs mt-0.5">
                            {alert.message_template.substring(0, 50)}
                            {alert.message_template.length > 50 ? "..." : ""}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveAlert(alert.id)}
                        className="text-gray-500 hover:text-red-400 ml-2"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

