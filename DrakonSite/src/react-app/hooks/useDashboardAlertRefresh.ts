import { useEffect, useRef, useState } from "react";
import { pollingManager } from "@/react-app/lib/PollingManager";

interface DashboardAlertEvent {
  id: number;
}

const ALERT_POLL_INTERVAL_MS = 4000;
const DASHBOARD_REFRESH_THROTTLE_MS = 1500;

export function useDashboardAlertRefresh(refresh: () => void) {
  const refreshRef = useRef(refresh);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRefreshAtRef = useRef(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastAiDetectionEventId, setLastAiDetectionEventId] = useState(0);
  const [lastJobAlertTriggeredEventId, setLastJobAlertTriggeredEventId] = useState(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const primeLatestEventId = async (
      eventType: string,
      setter: (value: number) => void,
    ) => {
      try {
        const response = await fetch(
          `/api/events?event_type=${encodeURIComponent(eventType)}&limit=1`,
          { credentials: "include" },
        );
        if (!response.ok) return;
        const events: DashboardAlertEvent[] = await response.json();
        if (!cancelled && events.length > 0 && Number.isInteger(events[0]?.id)) {
          setter(events[0].id);
        }
      } catch (error) {
        console.error(`[useDashboardAlertRefresh] Failed to prime ${eventType}:`, error);
      }
    };

    const prime = async () => {
      await Promise.all([
        primeLatestEventId("ai_detection", setLastAiDetectionEventId),
        primeLatestEventId("job_alert_triggered", setLastJobAlertTriggeredEventId),
      ]);

      if (!cancelled) {
        setIsInitialized(true);
      }
    };

    void prime();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const scheduleRefresh = () => {
      const now = Date.now();
      const elapsed = now - lastRefreshAtRef.current;

      if (!refreshTimerRef.current && elapsed >= DASHBOARD_REFRESH_THROTTLE_MS) {
        lastRefreshAtRef.current = now;
        refreshRef.current();
        return;
      }

      if (refreshTimerRef.current) {
        return;
      }

      const delay = Math.max(0, DASHBOARD_REFRESH_THROTTLE_MS - elapsed);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        lastRefreshAtRef.current = Date.now();
        refreshRef.current();
      }, delay);
    };

    if (!isInitialized) {
      return;
    }

    const registerAlertPoller = (
      key: string,
      eventType: string,
      lastEventId: number,
      setLastEventId: (value: number) => void,
    ) => {
      const url =
        lastEventId > 0
          ? `/api/events?event_type=${encodeURIComponent(eventType)}&after_id=${lastEventId}`
          : `/api/events?event_type=${encodeURIComponent(eventType)}`;

      pollingManager.register(key, {
        url,
        interval: ALERT_POLL_INTERVAL_MS,
        jitterMaxMs: 500,
        onData: (events: DashboardAlertEvent[]) => {
          if (!Array.isArray(events) || events.length === 0) return;
          const maxId = Math.max(
            ...events
              .map((event) => Number(event?.id) || 0)
              .filter((eventId) => Number.isInteger(eventId) && eventId > 0),
          );
          if (maxId > 0) {
            setLastEventId(maxId);
          }
          scheduleRefresh();
        },
        onError: (error) => {
          console.error(
            `[useDashboardAlertRefresh] ${eventType} polling error:`,
            error,
          );
        },
      });
    };

    registerAlertPoller(
      "dashboard-ai-detection-alerts",
      "ai_detection",
      lastAiDetectionEventId,
      setLastAiDetectionEventId,
    );
    registerAlertPoller(
      "dashboard-job-alert-triggered-alerts",
      "job_alert_triggered",
      lastJobAlertTriggeredEventId,
      setLastJobAlertTriggeredEventId,
    );

    return () => {
      pollingManager.unregister("dashboard-ai-detection-alerts");
      pollingManager.unregister("dashboard-job-alert-triggered-alerts");
    };
  }, [isInitialized, lastAiDetectionEventId, lastJobAlertTriggeredEventId]);
}
