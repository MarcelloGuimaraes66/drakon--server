export type CameraCaptureAccelerationMode = "cpu" | "nvidia";

export type CameraCaptureAccelerationApplyResult = {
  status: "applied" | "unsupported" | "unavailable" | "error";
  persisted_mode: CameraCaptureAccelerationMode;
  running_before_apply: boolean;
  restart_enqueued: boolean;
  restart_error?: string | null;
  scan?: {
    status: "supported" | "unsupported" | "unavailable" | "not_needed";
    reason_code: string;
    reason: string;
  } | null;
};

async function readResponsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeMode(value: unknown, fallback: CameraCaptureAccelerationMode): CameraCaptureAccelerationMode {
  return value === "nvidia" ? "nvidia" : fallback;
}

export async function applyCameraCaptureAcceleration(
  cameraId: number,
  requestedMode: CameraCaptureAccelerationMode,
  restartIfRunning = true
): Promise<CameraCaptureAccelerationApplyResult> {
  const response = await fetch(`/api/cameras/${cameraId}/capture-acceleration/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      requested_mode: requestedMode,
      restart_if_running: restartIfRunning,
    }),
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error(
        "The running backend does not have the GPU decode API yet. Update and restart the desktop/web runtime that serves /api."
      );
    }

    throw new Error(
      getString(payload.error) ||
        getString(payload.message) ||
        `Failed to apply camera capture acceleration mode (${response.status})`
    );
  }

  const scanPayload =
    payload.scan && typeof payload.scan === "object" && !Array.isArray(payload.scan)
      ? (payload.scan as Record<string, unknown>)
      : null;
  const scanStatusRaw = getString(scanPayload?.status) || "unavailable";
  const scanStatus =
    scanStatusRaw === "supported" ||
    scanStatusRaw === "unsupported" ||
    scanStatusRaw === "unavailable" ||
    scanStatusRaw === "not_needed"
      ? scanStatusRaw
      : "unavailable";
  const statusRaw = getString(payload.status) || "";
  const status =
    statusRaw === "applied" ||
    statusRaw === "unsupported" ||
    statusRaw === "unavailable" ||
    statusRaw === "error"
      ? statusRaw
      : "error";

  return {
    status,
    persisted_mode: normalizeMode(payload.persisted_mode, requestedMode),
    running_before_apply: Boolean(payload.running_before_apply),
    restart_enqueued: Boolean(payload.restart_enqueued),
    restart_error: getString(payload.restart_error),
    scan: scanPayload
      ? {
          status: scanStatus,
          reason_code: getString(scanPayload.reason_code) || "unknown",
          reason: getString(scanPayload.reason) || "GPU decode is not available.",
        }
      : null,
  };
}
