import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { pollingManager } from "@/react-app/lib/PollingManager";
import { dashboardSummaryStore } from "@/react-app/lib/DashboardSummaryStore";
import { type CameraFailurePhase } from "@/react-app/lib/cameraConnectionFailure";
import { emitOpenAiKeyRequiredPrompt } from "@/react-app/utils/openAiKeyGuard";
import { formatAiApiErrorDisplay } from "@/shared/aiApiErrorDisplay";

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
  analytics?: string[];
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
    | "camera_started"
    | "job_staled"
    | "job_start_blocked"
    | "job_started"
    | "agent_api_error";
}

interface EventsContextType {
  toasts: Toast[];
  dismissToast: (id: number) => void;
  pushToast: (toast: Omit<Toast, "id"> & { id?: number }) => number;
  lastEventId: number;
  refreshCameras: () => void;
}

const EventsContext = createContext<EventsContextType | undefined>(undefined);
const AUTO_DISMISS_MS = 10000;

export function EventsProvider({
  children,
  cameras,
}: {
  children: ReactNode;
  cameras: any[];
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastEventId, setLastEventId] = useState(0);
  const [lastJobStaledEventId, setLastJobStaledEventId] = useState(0);
  const [lastJobStartBlockedEventId, setLastJobStartBlockedEventId] = useState(0);
  const [lastJobStartedEventId, setLastJobStartedEventId] = useState(0);
  const [lastAgentApiErrorEventId, setLastAgentApiErrorEventId] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const camerasRef = useRef<any[]>(cameras);
  const refreshCallbacksRef = useRef<Set<() => void>>(new Set());
  const shownToastIdsRef = useRef<Set<number>>(new Set());
  const offlineCameraIdsRef = useRef<Set<number>>(new Set());
  const previousOnlineStateRef = useRef<Map<number, boolean>>(new Map());
  const syntheticToastIdRef = useRef(-1);

  // Keep cameras ref updated
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  // Prime latest IDs on mount to avoid replaying old events
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
        console.error(`[EventsContext] Failed to prime ${eventType}:`, error);
      }
    };

    const primeLastEventIds = async () => {
      await Promise.all([
        primeLatestEventId("camera_connection_failed", setLastEventId),
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
      lastEventId > 0
        ? `/api/events?event_type=camera_connection_failed&after_id=${lastEventId}`
        : "/api/events?event_type=camera_connection_failed";

    pollingManager.register("events", {
      url,
      interval: 10000,
      onData: (events: CameraEvent[]) => {
        if (events.length === 0) return;

        const maxId = Math.max(...events.map((event) => event.id));
        setLastEventId(maxId);

        refreshCallbacksRef.current.forEach((cb) => cb());

        events.forEach((event) => {
          if (!event.camera_id) return;
          if (shownToastIdsRef.current.has(event.id)) return;

          const camera = camerasRef.current.find((row) => row.id === event.camera_id);
          if (!camera) return;

          shownToastIdsRef.current.add(event.id);
          offlineCameraIdsRef.current.add(event.camera_id);
          previousOnlineStateRef.current.set(event.camera_id, false);
        });

        dashboardSummaryStore.refresh();

        const eventIds = events.map((event) => event.id);
        fetch("/api/events/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eventIds }),
        }).catch((error) => {
          console.error("[EventsContext] Failed to mark camera events as read:", error);
        });
      },
      onError: (error) => {
        console.error("[EventsContext] Polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("events");
    };
  }, [lastEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStaledEventId > 0
        ? `/api/events?event_type=job_staled&after_id=${lastJobStaledEventId}`
        : "/api/events?event_type=job_staled";

    pollingManager.register("job-staled-events-context", {
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

        const eventIds = events.map((event) => event.id);
        fetch("/api/events/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eventIds }),
        }).catch((error) => {
          console.error("[EventsContext] Failed to mark job_staled events as read:", error);
        });
      },
      onError: (error) => {
        console.error("[EventsContext] Job staled polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-staled-events-context");
    };
  }, [lastJobStaledEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStartBlockedEventId > 0
        ? `/api/events?event_type=job_start_blocked&after_id=${lastJobStartBlockedEventId}`
        : "/api/events?event_type=job_start_blocked";

    pollingManager.register("job-start-blocked-events-context", {
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

        const eventIds = events.map((event) => event.id);
        fetch("/api/events/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eventIds }),
        }).catch((error) => {
          console.error("[EventsContext] Failed to mark job_start_blocked events as read:", error);
        });
      },
      onError: (error) => {
        console.error("[EventsContext] Job start blocked polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-start-blocked-events-context");
    };
  }, [lastJobStartBlockedEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastJobStartedEventId > 0
        ? `/api/events?event_type=job_started&after_id=${lastJobStartedEventId}`
        : "/api/events?event_type=job_started";

    pollingManager.register("job-started-events-context", {
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

        const eventIds = events.map((event) => event.id);
        fetch("/api/events/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eventIds }),
        }).catch((error) => {
          console.error("[EventsContext] Failed to mark job_started events as read:", error);
        });
      },
      onError: (error) => {
        console.error("[EventsContext] Job started polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("job-started-events-context");
    };
  }, [lastJobStartedEventId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    const url =
      lastAgentApiErrorEventId > 0
        ? `/api/events?event_type=agent_api_error&after_id=${lastAgentApiErrorEventId}`
        : "/api/events?event_type=agent_api_error";

    pollingManager.register("agent-api-error-events-context", {
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

          const formattedApiError = formatAiApiErrorDisplay({
            source: details?.source,
            model: details?.model,
            message: event.message,
            apiErrorMessage: details?.api_error_message,
            rawError: details?.raw_error,
          });
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
              message: formattedApiError.message,
              title: formattedApiError.title,
              type: "agent_api_error",
            },
          ]);

          setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== event.id));
          }, AUTO_DISMISS_MS);
        });

        const eventIds = events.map((event) => event.id);
        fetch("/api/events/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eventIds }),
        }).catch((error) => {
          console.error("[EventsContext] Failed to mark agent_api_error events as read:", error);
        });
      },
      onError: (error) => {
        console.error("[EventsContext] Agent API error polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("agent-api-error-events-context");
    };
  }, [lastAgentApiErrorEventId, isInitialized]);

  // Watch camera status transitions to emit online recovery toast (offline -> online only)
  useEffect(() => {
    if (!isInitialized) return;

    pollingManager.register("camera-status-events-context", {
      url: "/api/cameras",
      interval: 10000,
      onData: (cameraRows: any[]) => {
        if (!Array.isArray(cameraRows)) return;
        camerasRef.current = cameraRows;

        const summaryCameras = dashboardSummaryStore.getCurrent().cameras;
        const summaryById = new Map<number, any>();
        summaryCameras.forEach((camera) => {
          const cameraId = Number(camera?.id);
          if (Number.isFinite(cameraId)) {
            summaryById.set(cameraId, camera);
          }
        });

        const activeCameraIds = new Set<number>();
        let didChangeCameraState = false;
        let didRecoverCamera = false;

        for (const camera of cameraRows) {
          const cameraId = Number(camera?.id);
          if (!Number.isFinite(cameraId)) continue;
          activeCameraIds.add(cameraId);

          const isOnline = camera?.is_online === 1 || camera?.is_online === true;
          const isRunning = camera?.is_service_running === 1 || camera?.is_service_running === true;
          const previousIsOnline = previousOnlineStateRef.current.get(cameraId);
          const summaryCamera = summaryById.get(cameraId);
          const summaryIsOnline =
            summaryCamera?.is_online === 1 || summaryCamera?.is_online === true;
          const summaryIsRunning =
            summaryCamera?.is_service_running === 1 || summaryCamera?.is_service_running === true;

          if (
            !summaryCamera ||
            summaryIsOnline !== isOnline ||
            summaryIsRunning !== isRunning
          ) {
            didChangeCameraState = true;
          }

          if (
            previousIsOnline !== true &&
            isOnline &&
            offlineCameraIdsRef.current.has(cameraId)
          ) {
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

        if (summaryById.size !== activeCameraIds.size) {
          didChangeCameraState = true;
        }

        if (didRecoverCamera || didChangeCameraState) {
          dashboardSummaryStore.refresh();
        }
      },
      onError: (error) => {
        console.error("[EventsContext] Camera status polling error:", error);
      },
    });

    return () => {
      pollingManager.unregister("camera-status-events-context");
    };
  }, [isInitialized]);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const pushToast = (toast: Omit<Toast, "id"> & { id?: number }) => {
    const toastId =
      Number.isInteger(toast.id) && Number(toast.id) !== 0
        ? Number(toast.id)
        : syntheticToastIdRef.current--;

    setToasts((prev) => [...prev, { ...toast, id: toastId }]);

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((entry) => entry.id !== toastId));
      }, AUTO_DISMISS_MS);
    }

    return toastId;
  };

  const refreshCameras = () => {
    refreshCallbacksRef.current.forEach((cb) => cb());
  };

  return (
    <EventsContext.Provider value={{ toasts, dismissToast, pushToast, lastEventId, refreshCameras }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useEvents() {
  const context = useContext(EventsContext);
  if (!context) {
    throw new Error("useEvents must be used within EventsProvider");
  }
  return context;
}


