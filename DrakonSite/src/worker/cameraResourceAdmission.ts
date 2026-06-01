export type CameraRuntimeCaptureMode = "cpu" | "nvidia";

export type CameraRuntimeResourceEstimate = {
  cpu_bytes: number;
  gpu_bytes: number;
  width: number | null;
  height: number | null;
  mode: CameraRuntimeCaptureMode;
  source: string;
};

const DEFAULT_FRAME_WIDTH = 1920;
const DEFAULT_FRAME_HEIGHT = 1080;
const CPU_MODE_MIN_BYTES = 256 * 1024 * 1024;
const GPU_MODE_MIN_CPU_BYTES = 128 * 1024 * 1024;
const GPU_MODE_DEFAULT_GPU_BYTES = 300 * 1024 * 1024;
const CPU_MODE_OVERHEAD_BYTES = 128 * 1024 * 1024;
const GPU_MODE_CPU_OVERHEAD_BYTES = 64 * 1024 * 1024;
const CPU_MODE_PROCESS_SHARE_CAP_BYTES = 384 * 1024 * 1024;
const GPU_MODE_PROCESS_SHARE_CAP_BYTES = 192 * 1024 * 1024;

function toNonNegativeInt(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampEstimateBytes(value: number, floorBytes: number): number {
  if (!Number.isFinite(value)) {
    return floorBytes;
  }
  return Math.max(floorBytes, Math.floor(value));
}

function clampProcessShareBytes(value: number, capBytes: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), capBytes);
}

export async function buildCameraRuntimeResourceEstimate(
  db: D1Database,
  userId: string,
  cameraId: number,
  mode: CameraRuntimeCaptureMode
): Promise<CameraRuntimeResourceEstimate> {
  const [threadMetricsRow, processMetricsRow, openMonitorCameraRow] = await Promise.all([
    db
      .prepare(
        `SELECT
           MAX(capture_mem_estimated_bytes) AS capture_mem_estimated_bytes
         FROM capture_thread_metrics_latest
         WHERE user_id = ?
           AND camera_id = ?`
      )
      .bind(userId, cameraId)
      .first(),
    db
      .prepare(
        `SELECT
           working_set_bytes,
           private_bytes,
           active_cameras
         FROM open_monitor_process_latest
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .bind(userId)
      .first(),
    db
      .prepare(
        `SELECT payload_json
         FROM open_monitor_camera_latest
         WHERE user_id = ?
           AND camera_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .bind(userId, cameraId)
      .first(),
  ]);

  const openMonitorPayload = parseJsonObject((openMonitorCameraRow as any)?.payload_json);
  const width = toNonNegativeInt(openMonitorPayload.width);
  const height = toNonNegativeInt(openMonitorPayload.height);
  const normalizedWidth = width > 0 ? width : DEFAULT_FRAME_WIDTH;
  const normalizedHeight = height > 0 ? height : DEFAULT_FRAME_HEIGHT;
  const frameBytes = normalizedWidth * normalizedHeight * 3;

  const captureMemEstimatedBytes = toNonNegativeInt(
    (threadMetricsRow as any)?.capture_mem_estimated_bytes
  );

  const sharedProcessWorkingSetBytes = toNonNegativeInt(
    (processMetricsRow as any)?.working_set_bytes
  );
  const sharedProcessPrivateBytes = toNonNegativeInt(
    (processMetricsRow as any)?.private_bytes
  );
  const activeCameras = toNonNegativeInt((processMetricsRow as any)?.active_cameras);
  const perCameraProcessBytes =
    sharedProcessWorkingSetBytes > 0 && activeCameras > 0
      ? Math.floor(sharedProcessWorkingSetBytes / activeCameras)
      : 0;
  const perCameraPrivateBytes =
    sharedProcessPrivateBytes > 0 && activeCameras > 0
      ? Math.floor(sharedProcessPrivateBytes / activeCameras)
      : 0;
  const hasProcessShareTelemetry = perCameraProcessBytes > 0 || perCameraPrivateBytes > 0;

  const observedCaptureBytes = Math.max(
    captureMemEstimatedBytes,
    mode === "nvidia" ? Math.ceil(frameBytes * 2) : Math.ceil(frameBytes * 3)
  );

  if (mode === "nvidia") {
    const processShareHint = clampProcessShareBytes(
      Math.max(perCameraProcessBytes, perCameraPrivateBytes),
      GPU_MODE_PROCESS_SHARE_CAP_BYTES
    );
    const cpuBytes = clampEstimateBytes(
      Math.max(
        observedCaptureBytes + GPU_MODE_CPU_OVERHEAD_BYTES,
        processShareHint
      ),
      GPU_MODE_MIN_CPU_BYTES
    );
    const gpuBytes = GPU_MODE_DEFAULT_GPU_BYTES;

    return {
      cpu_bytes: cpuBytes,
      gpu_bytes: gpuBytes,
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      mode,
      source:
        captureMemEstimatedBytes > 0 || hasProcessShareTelemetry
          ? "telemetry_plus_process_share"
          : "resolution_fallback",
    };
  }

  const processShareHint = clampProcessShareBytes(
    Math.max(perCameraProcessBytes, perCameraPrivateBytes),
    CPU_MODE_PROCESS_SHARE_CAP_BYTES
  );
  const cpuBytes = clampEstimateBytes(
    Math.max(
      observedCaptureBytes + CPU_MODE_OVERHEAD_BYTES,
      processShareHint
    ),
    CPU_MODE_MIN_BYTES
  );

  return {
    cpu_bytes: cpuBytes,
    gpu_bytes: 0,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    mode,
    source:
      captureMemEstimatedBytes > 0 || hasProcessShareTelemetry
        ? "telemetry_plus_process_share"
        : "resolution_fallback",
  };
}
