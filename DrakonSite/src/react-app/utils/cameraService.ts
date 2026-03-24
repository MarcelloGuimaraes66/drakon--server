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

  await setCameraServiceRunning(cameraId, nextRunning);

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

      await rollbackCameraServiceRunning(cameraId, 0);
      throw new Error(getErrorMessage(payload, "Failed to start camera"));
    }

    return {
      nextRunning,
      agentsDisabledNoSubscription: Boolean(payload.agents_disabled_no_subscription),
    };
  }

  const response = await fetch("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camera_id: cameraId,
      command_type: "stop_camera",
      payload: JSON.stringify({ camera_id: cameraId }),
    }),
    credentials: "include",
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    await rollbackCameraServiceRunning(cameraId, 1);
    throw new Error(getErrorMessage(payload, "Failed to stop camera"));
  }

  return {
    nextRunning,
    agentsDisabledNoSubscription: false,
  };
}
