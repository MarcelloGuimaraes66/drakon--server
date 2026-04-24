export type SavedAgentLibraryLocationType = "camera" | "step_default" | "step_camera";
export type SavedAgentLibrarySourceType = "camera_custom" | "job_step";

export interface SavedAgentLibraryImage {
  id: number;
  image_url: string;
}

export interface SavedAgentLibraryEntry {
  library_key: string;
  source_type: SavedAgentLibrarySourceType;
  location_type: SavedAgentLibraryLocationType;
  id: number;
  agent_key: string;
  algorithm_type: string;
  display_name: string;
  summary: string;
  prompt_template: string;
  alert_condition: string;
  negative_condition: string;
  priority_level: string | null;
  input_type: string;
  video_packaging_mode: string | null;
  inference_model: string | null;
  model_fps: number | null;
  run_every: number | null;
  running_resolution: number | null;
  is_enabled: boolean;
  only_capture_on_motion: boolean;
  use_temporal_context: boolean;
  face_target_ids: number[];
  analysis_regions: unknown[];
  negative_reference_images: SavedAgentLibraryImage[];
  camera_id: number | null;
  camera_name: string;
  step_id: number | null;
  step_title: string;
  job_id: number | null;
  job_name: string;
  target_id: number | null;
  slot_label: string;
  location_label: string;
  updated_at: string | null;
}

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeNumber = (value: unknown): number | null => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
};

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
};

const normalizeLocationType = (value: unknown): SavedAgentLibraryLocationType => {
  const normalized = normalizeText(value);
  if (normalized === "step_default" || normalized === "step_camera") {
    return normalized;
  }
  return "camera";
};

const normalizeSourceType = (value: unknown): SavedAgentLibrarySourceType => {
  const normalized = normalizeText(value);
  return normalized === "job_step" ? "job_step" : "camera_custom";
};

const normalizeFaceTargetIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
};

const normalizeNegativeReferenceImages = (value: unknown): SavedAgentLibraryImage[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const raw = row as Record<string, unknown>;
      const id = normalizePositiveInteger(raw.id);
      const imageUrl = normalizeText(raw.image_url);
      if (!id || !imageUrl) return null;
      return {
        id,
        image_url: imageUrl,
      } as SavedAgentLibraryImage;
    })
    .filter((image): image is SavedAgentLibraryImage => image !== null);
};

const buildFallbackLocationLabel = ({
  locationType,
  cameraId,
  cameraName,
  stepId,
  stepTitle,
  jobId,
  jobName,
  slotLabel,
}: {
  locationType: SavedAgentLibraryLocationType;
  cameraId: number | null;
  cameraName: string;
  stepId: number | null;
  stepTitle: string;
  jobId: number | null;
  jobName: string;
  slotLabel: string;
}): string => {
  if (locationType === "camera") {
    return cameraName || (cameraId ? `Camera #${cameraId}` : "AI Agent");
  }

  const resolvedJobLabel = jobName || (jobId ? `Job #${jobId}` : "Job");
  const resolvedStepLabel = stepTitle || (stepId ? `Step #${stepId}` : "Step");
  const resolvedTargetLabel =
    locationType === "step_camera"
      ? cameraName || slotLabel || (cameraId ? `Camera #${cameraId}` : "Target camera")
      : "Default step agent";

  return `${resolvedJobLabel} / ${resolvedStepLabel} / ${resolvedTargetLabel}`;
};

export const normalizeSavedAgentLibraryEntry = (
  value: unknown
): SavedAgentLibraryEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const id = normalizePositiveInteger(row.id);
  if (!id) return null;

  const sourceType = normalizeSourceType(row.source_type);
  const locationType = normalizeLocationType(row.location_type);
  const cameraId = normalizePositiveInteger(row.camera_id);
  const cameraName = normalizeText(row.camera_name);
  const stepId = normalizePositiveInteger(row.step_id);
  const stepTitle = normalizeText(row.step_title);
  const jobId = normalizePositiveInteger(row.job_id);
  const jobName = normalizeText(row.job_name);
  const targetId = normalizePositiveInteger(row.target_id);
  const slotLabel = normalizeText(row.slot_label);
  const displayName = normalizeText(row.display_name) || `Agent ${id}`;
  const locationLabel =
    normalizeText(row.location_label) ||
    buildFallbackLocationLabel({
      locationType,
      cameraId,
      cameraName,
      stepId,
      stepTitle,
      jobId,
      jobName,
      slotLabel,
    });

  return {
    library_key: normalizeText(row.library_key) || `${sourceType}:${id}`,
    source_type: sourceType,
    location_type: locationType,
    id,
    agent_key: normalizeText(row.agent_key) || normalizeText(row.algorithm_type) || "custom_template",
    algorithm_type:
      normalizeText(row.algorithm_type) || normalizeText(row.agent_key) || "custom_template",
    display_name: displayName,
    summary: normalizeText(row.summary),
    prompt_template: normalizeText(row.prompt_template),
    alert_condition: normalizeText(row.alert_condition),
    negative_condition: normalizeText(row.negative_condition),
    priority_level: normalizeText(row.priority_level ?? row.priorityLevel) || null,
    input_type: normalizeText(row.input_type) || "video",
    video_packaging_mode: normalizeText(row.video_packaging_mode) || null,
    inference_model: normalizeText(row.inference_model) || null,
    model_fps: normalizeNumber(row.model_fps),
    run_every: normalizeNumber(row.run_every),
    running_resolution: normalizeNumber(row.running_resolution),
    is_enabled: normalizeBoolean(row.is_enabled, true),
    only_capture_on_motion: normalizeBoolean(row.only_capture_on_motion, false),
    use_temporal_context: normalizeBoolean(row.use_temporal_context, true),
    face_target_ids: normalizeFaceTargetIds(row.face_target_ids),
    analysis_regions: Array.isArray(row.analysis_regions) ? row.analysis_regions : [],
    negative_reference_images: normalizeNegativeReferenceImages(row.negative_reference_images),
    camera_id: cameraId,
    camera_name: cameraName,
    step_id: stepId,
    step_title: stepTitle,
    job_id: jobId,
    job_name: jobName,
    target_id: targetId,
    slot_label: slotLabel,
    location_label: locationLabel,
    updated_at: normalizeText(row.updated_at) || null,
  };
};

export const getSavedAgentLibraryOptionLabel = (
  agent: Pick<SavedAgentLibraryEntry, "display_name" | "location_label" | "id">
): string => {
  const displayName = normalizeText(agent.display_name) || `Agent ${agent.id}`;
  return displayName;
};

export async function fetchSavedAgentLibrary(): Promise<SavedAgentLibraryEntry[]> {
  const response = await fetch("/api/custom-agents/library");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" && data.error.trim()
        ? data.error.trim()
        : "Failed to load your saved agents"
    );
  }

  const rows: unknown[] = Array.isArray(data?.agents) ? data.agents : [];
  return rows
    .map((row: unknown) => normalizeSavedAgentLibraryEntry(row))
    .filter((row: SavedAgentLibraryEntry | null): row is SavedAgentLibraryEntry => row !== null);
}
