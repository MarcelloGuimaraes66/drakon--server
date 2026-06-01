import { useCallback, useEffect, useMemo, useState } from "react";
import { useRemoteWorkspace } from "@/react-app/contexts/RemoteWorkspaceContext";
import type { Camera } from "@/react-app/lib/DashboardSummaryStore";

const AGENT_CAMERA_DIRECTORY_URL = "/api/agent-camera-directory";
const DASHBOARD_CAMERA_DIRECTORY_FALLBACK_URL = "/api/dashboard";
const REMOTE_WORKSPACE_PROXY_URL = "/api/desktop-workspace-access/remote-proxy";
const AGENT_CAMERA_DIRECTORY_POLL_MS = 30000;

type AgentCameraDirectoryResult = {
  cameras: Camera[];
  lastUpdatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  patchCameraLocal: (cameraId: number, patch: Partial<Camera>) => void;
  removeCameraLocal: (cameraId: number) => void;
};

function normalizeCameraRows(payload: unknown): Camera[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.filter((row) => row && typeof row === "object") as Camera[];
}

function normalizeDashboardCameraRows(payload: unknown): Camera[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  return normalizeCameraRows((payload as { cameras?: unknown }).cameras);
}

function readErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return fallbackMessage;
}

function shouldUseDashboardFallback(status: number): boolean {
  return [404, 405, 500, 501, 502, 503].includes(status);
}

async function fetchJsonPayload(
  path: string,
  remoteSessionId: string | null
): Promise<{ response: Response; payload: unknown }> {
  if (remoteSessionId) {
    const response = await fetch(REMOTE_WORKSPACE_PROXY_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        session_id: remoteSessionId,
        path,
        method: "GET",
        headers: {
          accept: "application/json",
        },
        body_base64: "",
      }),
    });

    return {
      response,
      payload: await response.json().catch(() => null),
    };
  }

  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  return {
    response,
    payload: await response.json().catch(() => null),
  };
}

export function useAgentCameraDirectory(): AgentCameraDirectoryResult {
  const { isRemote, sessionId } = useRemoteWorkspace();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const remoteSessionId = useMemo(
    () => (isRemote && sessionId ? sessionId : null),
    [isRemote, sessionId]
  );

  const applyCameraRows = useCallback((nextCameras: Camera[]) => {
    setCameras(nextCameras);
    setLastUpdatedAt(new Date().toISOString());
    setError(null);
    setIsLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const agentDirectoryResult = await fetchJsonPayload(
        AGENT_CAMERA_DIRECTORY_URL,
        remoteSessionId
      );

      if (agentDirectoryResult.response.ok) {
        applyCameraRows(normalizeCameraRows(agentDirectoryResult.payload));
        return;
      }

      if (shouldUseDashboardFallback(agentDirectoryResult.response.status)) {
        const dashboardFallbackResult = await fetchJsonPayload(
          DASHBOARD_CAMERA_DIRECTORY_FALLBACK_URL,
          remoteSessionId
        );

        if (dashboardFallbackResult.response.ok) {
          applyCameraRows(normalizeDashboardCameraRows(dashboardFallbackResult.payload));
          return;
        }

        throw new Error(
          readErrorMessage(
            dashboardFallbackResult.payload,
            `Failed to load agent cameras (${dashboardFallbackResult.response.status}).`
          )
        );
      }

      throw new Error(
        readErrorMessage(agentDirectoryResult.payload, "Failed to load agent cameras.")
      );
    } catch (error) {
      console.error("[useAgentCameraDirectory] Failed to load cameras:", error);
      setError(error instanceof Error ? error.message : "Failed to load agent cameras.");
      setIsLoading(false);
    }
  }, [applyCameraRows, remoteSessionId]);

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, AGENT_CAMERA_DIRECTORY_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const patchCameraLocal = useCallback((cameraId: number, patch: Partial<Camera>) => {
    setCameras((current) =>
      current.map((camera) =>
        camera.id === cameraId
          ? {
              ...camera,
              ...patch,
            }
          : camera
      )
    );
    setLastUpdatedAt(new Date().toISOString());
  }, []);

  const removeCameraLocal = useCallback((cameraId: number) => {
    setCameras((current) => current.filter((camera) => camera.id !== cameraId));
    setLastUpdatedAt(new Date().toISOString());
  }, []);

  return {
    cameras,
    lastUpdatedAt,
    isLoading,
    error,
    refresh,
    patchCameraLocal,
    removeCameraLocal,
  };
}
