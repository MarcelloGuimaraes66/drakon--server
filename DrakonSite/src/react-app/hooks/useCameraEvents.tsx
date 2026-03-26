import { useEffect, useState, useRef } from "react";
import { pollingManager } from "@/react-app/lib/PollingManager";
import { dashboardSummaryStore } from "@/react-app/lib/DashboardSummaryStore";
import { normalizeCameraConnectionFailedEvent, type CameraFailurePhase } from "@/react-app/lib/cameraConnectionFailure";
import { emitOpenAiKeyRequiredPrompt } from "@/react-app/utils/openAiKeyGuard";

interface CameraEvent {
  id: number;
  user_id: string;
  camera_id: number | null;
  event_type: string;
  message: string | null;
  details?: unknown | null;
  details_json: string | null;
  created_at: string;
  updated_at: string;
}

interface Toast {
  id: number;
  cameraId?: number | null;
  cameraName?: string;
  message: string;
  failureCode?: string | null;
  failureSummary?: string;
  failureAction?: string;
  technicalDetail?: string;
  failurePhase?: CameraFailurePhase | null;
  failureConfidence?: number | null;
  title?: string;
  type?:
    | "offline"
    | "online"
    | "job_staled"
    | "job_start_blocked"
    | "job_started"
    | "agent_api_error";
}

const AUTO_DISMISS_MS = 10000;

export function useCameraEvents(cameras: any[], onCameraStateChange?: () => void) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastCameraEventId, setLastCameraEventId] = useState(0);
  const [lastJobStaledEventId, setLastJobStaledEventId] = useState(0);
  const [lastJobStartBlockedEventId, setLastJobStartBlockedEventId] = useState(0);
  const [lastJobStartedEventId, setLastJobStartedEventId] = useState(0);
  const [lastAgentApiErrorEventId, setLastAgentApiErrorEventId] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const camerasRef = useRef<any[]>(cameras);
  const onCameraStateChangeRef = useRef(onCameraStateChange);
  const shownToastIdsRef = useRef<Set<number>>(new Set());
  const offlineCameraIdsRef = useRef<Set<number>>(new Set());
  const previousOnlineStateRef = useRef<Map<number, boolean>>(new Map());
  const syntheticToastIdRef = useRef(-1);

  // Keep refs updated without triggering effects
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    onCameraStateChangeRef.current = onCameraStateChange;
  }, [onCameraStateChange]);

  useEffect(() => {
    const primeLatestEventId = async (
      eventType: string,
      setter: (value: number) => void,
    ) => {
      try {
        const response = await fetch(
          `/api/events?event_type=${encodeURIComponent(eventType)}&limit=1`,
        );
        if (!response.ok) return;
        const events: CameraEvent[] = await response.json();
        if (events.length > 0 && Number.isInteger(events[0].id)) {
          setter(events[0].id);
        }
      } catch (error) {
        console.error(`[useCameraEvents] Failed to prime ${eventType}:`, error);
      }
    };

    const primeLastEventIds = async () => {
      await Promise.all([
        primeLatestEventId("camera_connection_failed", setLastCameraEventId),
        primeLatestEventId("job_staled", setLastJobStaledEventId),
        primeLatestEventId("job_start_blocked", setLastJobStartBlockedEventId),
        primeLatestEventId("job_started", setLastJobStartedEventId),
        primeLatestEventId("agent_api_error", setLastAgentApiErrorEventId),
      ]);
      setIsInitialized(true);
    };

    primeLastEventIds();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastCameraEventId > 0
        ? `/api/events?event_type=camera_connection_failed&after_id=${lastCameraEventId}`
        : "/api/events?event_type=camera_connection_failed";

    pollingManager.register("camera-events", {
      url,
      interval: 10000,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastCameraEventId(maxId);

        if (onCameraStateChangeRef.current) {
          onCameraStateChangeRef.current();
        }

        events.forEach((event) => {
          if (!event.camera_id) return;
          if (shownToastIdsRef.current.has(event.id)) return;

          const camera = camerasRef.current.find((row) => row.id === event.camera_id);
          if (!camera) return;

          const failureToast = normalizeCameraConnectionFailedEvent(event);
          shownToastIdsRef.current.add(event.id);
          offlineCameraIdsRef.current.add(event.camera_id);
          previousOnlineStateRef.current.set(event.camera_id, false);

          setToasts((prev) => [
            ...prev,
            {
              id: event.id,
              cameraId: event.camera_id,
              cameraName: camera.name,
              message: failureToast.message,
              title: failureToast.title,
              failureCode: failureToast.failureCode,
              failureSummary: failureToast.failureSummary,
              failureAction: failureToast.failureAction,
              technicalDetail: failureToast.technicalDetail,
              failurePhase: failureToast.failurePhase,
              failureConfidence: failureToast.failureConfidence,
              type: "offline",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });

        dashboardSummaryStore.refresh();
      },
      onError: (error) => {
        console.error("[useCameraEvents] Polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("camera-events");
    };
  }, [lastCameraEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStaledEventId > 0
        ? `/api/events?event_type=job_staled&after_id=${lastJobStaledEventId}`
        : "/api/events?event_type=job_staled";

    pollingManager.register("job-staled-events-hook", {
      url,
      interval: 10000,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastJobStaledEventId(maxId);

        events.forEach((event) => {
          if (shownToastIdsRef.current.has(event.id)) return;

          let details: Record<string, unknown> | null = null;
          if (typeof event.details_json === "string" && event.details_json.trim()) {
            try {
              details = JSON.parse(event.details_json);
            } catch {
              details = null;
            }
          }

          const rawJobName =
            typeof details?.job_name === "string"
              ? details.job_name
              : typeof details?.job === "object" &&
                details.job &&
                typeof (details.job as Record<string, unknown>).name === "string"
              ? (details.job as Record<string, string>).name
              : "";
          const jobName = String(rawJobName || "").trim();
          const jobId = Number(
            (details as any)?.job_id ?? (details as any)?.job?.id ?? (details as any)?.jobId,
          );
          const hasJobId = Number.isInteger(jobId) && jobId > 0;

          const title = jobName ? `Job Stalled: ${jobName}` : "Job Stalled";
          const fallbackMessage = jobName
            ? `Job ${jobName} stalled and was stopped automatically.`
            : hasJobId
            ? `Job #${jobId} stalled and was stopped automatically.`
            : "A job stalled and was stopped automatically.";
          const message =
            typeof event.message === "string" && event.message.trim()
              ? event.message.trim()
              : fallbackMessage;

          shownToastIdsRef.current.add(event.id);
          emitOpenAiKeyRequiredPrompt();

          setToasts((prev) => [
            ...prev,
            {
              id: event.id,
              message,
              title,
              type: "job_staled",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });
      },
      onError: (error) => {
        console.error("[useCameraEvents] Job staled polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-staled-events-hook");
    };
  }, [lastJobStaledEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStartBlockedEventId > 0
        ? `/api/events?event_type=job_start_blocked&after_id=${lastJobStartBlockedEventId}`
        : "/api/events?event_type=job_start_blocked";

    pollingManager.register("job-start-blocked-events-hook", {
      url,
      interval: 10000,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastJobStartBlockedEventId(maxId);

        events.forEach((event) => {
          if (shownToastIdsRef.current.has(event.id)) return;

          let details: Record<string, unknown> | null = null;
          if (typeof event.details_json === "string" && event.details_json.trim()) {
            try {
              details = JSON.parse(event.details_json);
            } catch {
              details = null;
            }
          }

          const rawJobName =
            typeof details?.job_name === "string"
              ? details.job_name
              : typeof details?.job === "object" &&
                details.job &&
                typeof (details.job as Record<string, unknown>).name === "string"
              ? (details.job as Record<string, string>).name
              : "";
          const jobName = String(rawJobName || "").trim();
          const jobId = Number(
            (details as any)?.job_id ?? (details as any)?.job?.id ?? (details as any)?.jobId,
          );
          const hasJobId = Number.isInteger(jobId) && jobId > 0;

          const title = jobName ? `Job Start Blocked: ${jobName}` : "Job Start Blocked";
          const fallbackMessage = jobName
            ? `Job "${jobName}" could not start because OpenAI API key is not configured.`
            : hasJobId
            ? `Job #${jobId} could not start because OpenAI API key is not configured.`
            : "A job could not start because OpenAI API key is not configured.";
          const message =
            typeof event.message === "string" && event.message.trim()
              ? event.message.trim()
              : fallbackMessage;

          shownToastIdsRef.current.add(event.id);

          setToasts((prev) => [
            ...prev,
            {
              id: event.id,
              message,
              title,
              type: "job_start_blocked",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });
      },
      onError: (error) => {
        console.error("[useCameraEvents] Job start blocked polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-start-blocked-events-hook");
    };
  }, [lastJobStartBlockedEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStartedEventId > 0
        ? `/api/events?event_type=job_started&after_id=${lastJobStartedEventId}`
        : "/api/events?event_type=job_started";

    pollingManager.register("job-started-events-hook", {
      url,
      interval: 3000,
      jitterMaxMs: 500,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastJobStartedEventId(maxId);
        dashboardSummaryStore.refresh();

        events.forEach((event) => {
          if (shownToastIdsRef.current.has(event.id)) return;

          let details: Record<string, unknown> | null = null;
          if (typeof event.details_json === "string" && event.details_json.trim()) {
            try {
              details = JSON.parse(event.details_json);
            } catch {
              details = null;
            }
          }

          const rawJobName =
            typeof details?.job_name === "string"
              ? details.job_name
              : typeof details?.job === "object" &&
                details.job &&
                typeof (details.job as Record<string, unknown>).name === "string"
              ? (details.job as Record<string, string>).name
              : "";
          const jobName = String(rawJobName || "").trim();
          const jobId = Number(
            (details as any)?.job_id ?? (details as any)?.job?.id ?? (details as any)?.jobId,
          );
          const hasJobId = Number.isInteger(jobId) && jobId > 0;

          const title = jobName ? `Job Started: ${jobName}` : "Job Started";
          const fallbackMessage = jobName
            ? `Job "${jobName}" started successfully.`
            : hasJobId
            ? `Job #${jobId} started successfully.`
            : "A job started successfully.";
          const message =
            typeof event.message === "string" && event.message.trim()
              ? event.message.trim()
              : fallbackMessage;
          shownToastIdsRef.current.add(event.id);

          setToasts((prev) => [
            ...prev,
            {
              id: event.id,
              message,
              title,
              type: "job_started",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });
      },
      onError: (error) => {
        console.error("[useCameraEvents] Job started polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-started-events-hook");
    };
  }, [lastJobStartedEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastAgentApiErrorEventId > 0
        ? `/api/events?event_type=agent_api_error&after_id=${lastAgentApiErrorEventId}`
        : "/api/events?event_type=agent_api_error";

    pollingManager.register("agent-api-error-events-hook", {
      url,
      interval: 4000,
      jitterMaxMs: 500,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastAgentApiErrorEventId(maxId);

        events.forEach((event) => {
          if (shownToastIdsRef.current.has(event.id)) return;

          let details: Record<string, unknown> | null = null;
          if (typeof event.details_json === "string" && event.details_json.trim()) {
            try {
              details = JSON.parse(event.details_json);
            } catch {
              details = null;
            }
          }

          const source = String(details?.source ?? "").toLowerCase();
          const model = String(details?.model ?? "").trim();
          const apiMessage = String(details?.api_error_message ?? "").trim();
          const rawError = String(details?.raw_error ?? "").trim();
          const sourceLabel = source.includes("chat")
            ? "Chat"
            : source.includes("job_or_camera")
            ? "Jobs / AI Agents"
            : source.includes("group") || source.includes("job")
            ? "Jobs"
            : source.includes("camera")
            ? "AI Agents"
            : "Inference";
          const title = model ? `AI API Error (${sourceLabel} - ${model})` : `AI API Error (${sourceLabel})`;
          const fallbackMessage = apiMessage || rawError || "OpenAI API request failed during inference.";
          const message =
            typeof event.message === "string" && event.message.trim()
              ? event.message.trim()
              : fallbackMessage;
          const cameraName =
            typeof event.camera_id === "number"
              ? camerasRef.current.find((row) => row.id === event.camera_id)?.name
              : undefined;

          shownToastIdsRef.current.add(event.id);

          setToasts((prev) => [
            ...prev,
            {
              id: event.id,
              cameraId: event.camera_id,
              cameraName,
              message,
              title,
              type: "agent_api_error",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });
      },
      onError: (error) => {
        console.error("[useCameraEvents] Agent API error polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("agent-api-error-events-hook");
    };
  }, [lastAgentApiErrorEventId, isInitialized]);

  // Watch camera status transitions to emit online recovery toast (offline -> online only)
  useEffect(() => {
    if (!isInitialized) return;

    pollingManager.register("camera-status-hook", {
      url: "/api/cameras",
      interval: 10000,
      onData: (cameraRows: any[]) => {
        if (!Array.isArray(cameraRows)) return;
        camerasRef.current = cameraRows;

        const activeCameraIds = new Set<number>();
        let didRecoverCamera = false;

        for (const camera of cameraRows) {
          const cameraId = Number(camera?.id);
          if (!Number.isFinite(cameraId)) continue;
          activeCameraIds.add(cameraId);

          const isOnline = camera?.is_online === 1 || camera?.is_online === true;
          const previousIsOnline = previousOnlineStateRef.current.get(cameraId);

          if (
            previousIsOnline !== true &&
            isOnline &&
            offlineCameraIdsRef.current.has(cameraId)
          ) {
            const cameraName =
              typeof camera?.name === "string" && camera.name.trim()
                ? camera.name
                : `Camera ${cameraId}`;
            const toastId = syntheticToastIdRef.current--;

            setToasts((prev) => [
              ...prev,
              {
                id: toastId,
                cameraId,
                cameraName,
                message: "Connection restored. Camera is back online.",
                type: "online",
              },
            ]);

            setTimeout(() => {
              setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
            }, AUTO_DISMISS_MS);

            offlineCameraIdsRef.current.delete(cameraId);
            didRecoverCamera = true;
          }

          previousOnlineStateRef.current.set(cameraId, isOnline);
        }

        for (const trackedId of Array.from(previousOnlineStateRef.current.keys())) {
          if (!activeCameraIds.has(trackedId)) {
            previousOnlineStateRef.current.delete(trackedId);
            offlineCameraIdsRef.current.delete(trackedId);
          }
        }

        if (didRecoverCamera) {
          dashboardSummaryStore.refresh();
        }
      },
      onError: (error) => {
        console.error("[useCameraEvents] Camera status polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("camera-status-hook");
    };
  }, [isInitialized]);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  return { toasts, dismissToast };
}


