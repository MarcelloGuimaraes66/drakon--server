export type SharedCameraPermissionProfile =
  | "find_only"
  | "shared_job_execution"
  | "shared_job_execution_with_event_media";

export type SharedCameraAccessConfiguration = {
  allow_job_execution: boolean;
  allow_agent_execution: boolean;
  allow_event_media: boolean;
  allow_cross_camera_federation: boolean;
};

export type SharedCameraExecutionDescriptor = {
  cameraId: number;
  cameraName: string;
  originType: "local" | "shared_find";
  executionDomain: string;
  shareId: number | null;
  ownerPublicId: string | null;
  ownerLocalCameraId: number | null;
  sharedStatus: string | null;
  permissionProfile: SharedCameraPermissionProfile;
  accessConfig: SharedCameraAccessConfiguration;
  isShared: boolean;
};

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function clampPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizeSharedCameraPermissionProfile(
  value: unknown,
  fallback: SharedCameraPermissionProfile = "shared_job_execution"
): SharedCameraPermissionProfile {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "find_only") {
    return "find_only";
  }
  if (
    normalized === "shared_job_execution_with_event_media" ||
    normalized === "shared_camera_with_event_media" ||
    normalized === "shared_camera_event_media"
  ) {
    return "shared_job_execution_with_event_media";
  }
  if (
    normalized === "shared_job_execution" ||
    normalized === "shared_camera_execution" ||
    normalized === "shared_camera_basic"
  ) {
    return "shared_job_execution";
  }
  return fallback;
}

export function buildDefaultSharedCameraAccessConfiguration(
  profile: SharedCameraPermissionProfile = "shared_job_execution"
): SharedCameraAccessConfiguration {
  return {
    allow_job_execution: profile !== "find_only",
    allow_agent_execution: profile !== "find_only",
    allow_event_media: profile === "shared_job_execution_with_event_media",
    allow_cross_camera_federation: profile !== "find_only",
  };
}

export function normalizeSharedCameraAccessConfiguration(
  value: unknown,
  profileFallback: SharedCameraPermissionProfile = "shared_job_execution"
): SharedCameraAccessConfiguration {
  const fallback = buildDefaultSharedCameraAccessConfiguration(profileFallback);
  const source = parseJsonObject(value) || {};
  return {
    allow_job_execution: normalizeBoolean(
      source.allow_job_execution ?? source.allowJobExecution,
      fallback.allow_job_execution
    ),
    allow_agent_execution: normalizeBoolean(
      source.allow_agent_execution ?? source.allowAgentExecution,
      fallback.allow_agent_execution
    ),
    allow_event_media: normalizeBoolean(
      source.allow_event_media ?? source.allowEventMedia,
      fallback.allow_event_media
    ),
    allow_cross_camera_federation: normalizeBoolean(
      source.allow_cross_camera_federation ?? source.allowCrossCameraFederation,
      fallback.allow_cross_camera_federation
    ),
  };
}

export function buildSharedCameraAccessPayload(
  config: SharedCameraAccessConfiguration
): Record<string, unknown> {
  return {
    allow_job_execution: Boolean(config.allow_job_execution),
    allow_agent_execution: Boolean(config.allow_agent_execution),
    allow_event_media: Boolean(config.allow_event_media),
    allow_cross_camera_federation: Boolean(config.allow_cross_camera_federation),
  };
}

export function serializeSharedCameraAccessConfiguration(
  config: SharedCameraAccessConfiguration
): string {
  return JSON.stringify(buildSharedCameraAccessPayload(config));
}

export function canExecuteSharedCamera(
  profile: SharedCameraPermissionProfile,
  accessConfig: SharedCameraAccessConfiguration
): boolean {
  return profile !== "find_only" && accessConfig.allow_job_execution;
}

export function canUseSharedCameraCrossCameraFederation(
  profile: SharedCameraPermissionProfile,
  accessConfig: SharedCameraAccessConfiguration
): boolean {
  return (
    profile !== "find_only" &&
    accessConfig.allow_job_execution &&
    accessConfig.allow_cross_camera_federation
  );
}

export function allowsSharedCameraEventMedia(
  accessConfig: SharedCameraAccessConfiguration
): boolean {
  return accessConfig.allow_event_media;
}

export function buildExecutionDomainForCameraRow(row: unknown): string {
  const normalizedOriginType = normalizeText((row as any)?.origin_type).toLowerCase();
  if (normalizedOriginType === "shared_find") {
    const ownerPublicId = normalizeText((row as any)?.shared_owner_public_id);
    if (ownerPublicId) {
      return `shared_owner:${ownerPublicId}`;
    }
  }
  return "local";
}

export function buildSharedCameraExecutionDescriptor(
  row: unknown
): SharedCameraExecutionDescriptor | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const cameraId = clampPositiveInteger((row as any)?.id);
  if (!cameraId) {
    return null;
  }

  const originType =
    normalizeText((row as any)?.origin_type).toLowerCase() === "shared_find"
      ? "shared_find"
      : "local";
  const ownerPublicId =
    originType === "shared_find"
      ? normalizeText((row as any)?.shared_owner_public_id) || null
      : null;
  const shareId =
    originType === "shared_find"
      ? clampPositiveInteger((row as any)?.shared_share_id)
      : null;
  const ownerLocalCameraId =
    originType === "shared_find"
      ? clampPositiveInteger((row as any)?.shared_owner_local_camera_id)
      : null;
  const permissionProfile = normalizeSharedCameraPermissionProfile(
    (row as any)?.shared_permission_profile,
    originType === "shared_find" ? "shared_job_execution" : "shared_job_execution"
  );
  const accessConfig = normalizeSharedCameraAccessConfiguration(
    (row as any)?.shared_access_config_json,
    permissionProfile
  );

  return {
    cameraId,
    cameraName: normalizeText((row as any)?.name),
    originType,
    executionDomain:
      originType === "shared_find" && ownerPublicId
        ? `shared_owner:${ownerPublicId}`
        : "local",
    shareId,
    ownerPublicId,
    ownerLocalCameraId,
    sharedStatus:
      originType === "shared_find"
        ? normalizeText((row as any)?.shared_status) || "accepted"
        : null,
    permissionProfile,
    accessConfig,
    isShared: originType === "shared_find",
  };
}
