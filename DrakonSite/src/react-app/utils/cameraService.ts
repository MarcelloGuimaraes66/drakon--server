import {
  emitOpenAiKeyRequiredPrompt,
  isOpenAiKeyRequiredError,
} from "@/react-app/utils/openAiKeyGuard";
import { describeCameraStartFailureDiagnostic } from "@/shared/cameraStartDiagnostics";

type ToggleCameraServiceOptions = {
  cameraId: number;
  isRunning: boolean;
};

export type ToggleCameraServiceResult = {
  nextRunning: 0 | 1;
  agentsDisabledNoSubscription: boolean;
  cameraName: string | null;
  runningAnalytics: string[];
};

export type CameraStartBlockedPayload = {
  error?: string | null;
  message?: string | null;
  error_code?: string | null;
  device?: string | null;
  blocked_cameras?: Array<{
    camera_id?: number | null;
    camera_name?: string | null;
    mode?: string | null;
  }>;
};

type CameraServiceError = Error & {
  status?: number;
  errorCode?: string | null;
  payload?: Record<string, unknown>;
};

async function readResponsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload as Record<string, unknown>;
}

function getErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const message = payload.error ?? payload.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function getOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0);
}

function buildCameraServiceError(
  response: Response,
  payload: Record<string, unknown>,
  fallbackMessage: string
): CameraServiceError {
  const error = new Error(getErrorMessage(payload, fallbackMessage)) as CameraServiceError;
  error.status = response.status;
  error.errorCode =
    typeof payload.error_code === "string" && payload.error_code.trim()
      ? payload.error_code.trim()
      : typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : null;
  error.payload = payload;
  return error;
}

export function describeCameraStartBlockedError(
  error: unknown,
  fallbackCameraName: string
): { title: string; message: string } | null {
  const typedError = error as CameraServiceError | null;
  const payload =
    typedError?.payload && typeof typedError.payload === "object" && !Array.isArray(typedError.payload)
      ? (typedError.payload as CameraStartBlockedPayload)
      : null;
  const errorCode = String(typedError?.errorCode || payload?.error_code || "").trim().toLowerCase();
  if (!payload || (errorCode !== "insufficient_memory" && !errorCode.includes("memory"))) {
    return null;
  }

  const cameraNames = Array.isArray(payload.blocked_cameras)
    ? payload.blocked_cameras
        .map((entry) =>
          typeof entry?.camera_name === "string" && entry.camera_name.trim()
            ? entry.camera_name.trim()
            : ""
        )
        .filter((entry): entry is string => entry.length > 0)
    : [];
  const device =
    typeof payload.device === "string" && payload.device.trim()
      ? payload.device.trim().toUpperCase()
      : "CPU/GPU";
  const subject =
    cameraNames.length > 0
      ? cameraNames.join(", ")
      : fallbackCameraName.trim()
      ? fallbackCameraName.trim()
      : "camera";
  const message =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `Could not start ${subject} because available ${device} memory is too low.`;

  return {
    title: "Camera Start Blocked",
    message,
  };
}

export function describeCameraStartFailureError(
  error: unknown,
  fallbackCameraName: string
): { title: string; message: string } {
  const typedError = error as CameraServiceError | null;
  const payload =
    typedError?.payload && typeof typedError.payload === "object" && !Array.isArray(typedError.payload)
      ? typedError.payload
      : {};
  const errorCode = String(typedError?.errorCode || payload.error_code || "").trim().toLowerCase();
  const rawMessage =
    typedError instanceof Error && typedError.message.trim()
      ? typedError.message.trim()
      : getErrorMessage(payload, "Failed to start camera");
  return describeCameraStartFailureDiagnostic({
    errorCode,
    message: rawMessage,
    cameraName: fallbackCameraName,
  });
}

export async function toggleCameraService({
  cameraId,
  isRunning,
}: ToggleCameraServiceOptions): Promise<ToggleCameraServiceResult> {
  const nextRunning: 0 | 1 = isRunning ? 0 : 1;

  if (!isRunning) {
    const response = await fetch(`/api/cameras/${cameraId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      if (isOpenAiKeyRequiredError(payload)) {
        emitOpenAiKeyRequiredPrompt();
      }
      throw buildCameraServiceError(response, payload, "Failed to start camera");
    }

    return {
      nextRunning,
      agentsDisabledNoSubscription: Boolean(payload.agents_disabled_no_subscription),
      cameraName: getOptionalString(payload.camera_name),
      runningAnalytics: getStringArray(payload.running_analytics),
    };
  }

  const response = await fetch(`/api/cameras/${cameraId}/stop`, {
    method: "POST",
    credentials: "include",
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildCameraServiceError(response, payload, "Failed to stop camera");
  }

  return {
    nextRunning,
    agentsDisabledNoSubscription: false,
    cameraName: getOptionalString(payload.camera_name),
    runningAnalytics: [],
  };
}
