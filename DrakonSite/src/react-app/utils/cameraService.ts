import {
  emitOpenAiKeyRequiredPrompt,
  isOpenAiKeyRequiredError,
} from "@/react-app/utils/openAiKeyGuard";

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

async function setCameraServiceRunning(cameraId: number, nextRunning: 0 | 1): Promise<void> {
  const response = await fetch(`/api/cameras/${cameraId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_service_running: nextRunning }),
    credentials: "include",
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        payload,
        nextRunning === 1 ? "Failed to mark camera as running" : "Failed to mark camera as stopped"
      )
    );
  }
}

async function rollbackCameraServiceRunning(
  cameraId: number,
  nextRunning: 0 | 1
): Promise<void> {
  try {
    await setCameraServiceRunning(cameraId, nextRunning);
  } catch (error) {
    console.error("Failed to rollback camera service state:", error);
  }
}

export async function toggleCameraService({
  cameraId,
  isRunning,
}: ToggleCameraServiceOptions): Promise<ToggleCameraServiceResult> {
  const nextRunning: 0 | 1 = isRunning ? 0 : 1;

  if (!isRunning) {
    await setCameraServiceRunning(cameraId, nextRunning);

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

      await rollbackCameraServiceRunning(cameraId, 0);
      throw new Error(getErrorMessage(payload, "Failed to start camera"));
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
    throw new Error(getErrorMessage(payload, "Failed to stop camera"));
  }

  return {
    nextRunning,
    agentsDisabledNoSubscription: false,
    cameraName: getOptionalString(payload.camera_name),
    runningAnalytics: [],
  };
}
