import { useEffect, useRef, useState } from "react";

export type DashboardAlertSeverityFilter = "ALL" | "CRITIC" | "HIGH" | "MEDIUM" | "LOW";
export type DashboardAlertOriginFilter = "ALL" | "JOB" | "CAMERA_AGENT";

export interface DashboardAlertItem {
  id: number;
  camera_id?: number | null;
  camera_name?: string | null;
  event_type?: string | null;
  origin_kind?: "job" | "camera_agent" | null;
  algo_type?: string | null;
  agent_key?: string | null;
  agent_label?: string | null;
  job_id?: number | null;
  job_name?: string | null;
  step_id?: number | null;
  step_name?: string | null;
  message?: string | null;
  created_at?: string | null;
  detected_at?: string | null;
  details?: Record<string, any> | null;
  priority_level?: string | null;
  media_type?: string | null;
  contributing_events_count?: number;
  group_image_count?: number;
  video_key?: string | null;
  image_key?: string | null;
  video_url?: string | null;
  clip_url?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  search_text?: string | null;
  [key: string]: any;
}

export interface DashboardAlertJobOption {
  job_id: number;
  job_name: string;
}

export interface DashboardAlertAgentOption {
  agent_key: string;
  agent_label: string;
}

type DashboardAlertsResponse = {
  alerts?: DashboardAlertItem[];
  has_more?: boolean;
  next_cursor?: number | null;
  facets?: {
    jobs?: DashboardAlertJobOption[];
    agents?: DashboardAlertAgentOption[];
  };
};

type UseDashboardAlertsOptions = {
  searchTerm: string;
  severity: DashboardAlertSeverityFilter | string;
  origin: DashboardAlertOriginFilter | string;
  jobId: string;
  agentKey: string;
  latestAlertId?: number | null;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 24;
const NEWER_PAGE_SIZE = 100;
const MAX_NEWER_PAGES = 10;

function mergeDashboardAlerts(...sources: DashboardAlertItem[][]): DashboardAlertItem[] {
  const alertsById = new Map<number, DashboardAlertItem>();
  for (const source of sources) {
    for (const alert of source || []) {
      const alertId = Number(alert?.id);
      if (!Number.isInteger(alertId) || alertId <= 0) continue;
      alertsById.set(alertId, alert);
    }
  }
  return Array.from(alertsById.values()).sort(
    (left, right) => (Number(right?.id) || 0) - (Number(left?.id) || 0),
  );
}

function normalizeCursor(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function useDashboardAlerts({
  searchTerm,
  severity,
  origin,
  jobId,
  agentKey,
  latestAlertId,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseDashboardAlertsOptions) {
  const [alerts, setAlerts] = useState<DashboardAlertItem[]>([]);
  const [jobOptions, setJobOptions] = useState<DashboardAlertJobOption[]>([]);
  const [agentOptions, setAgentOptions] = useState<DashboardAlertAgentOption[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingNewer, setIsRefreshingNewer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const queryVersionRef = useRef(0);
  const lastSeenLatestAlertIdRef = useRef(0);
  const alertsRef = useRef<DashboardAlertItem[]>([]);
  const nextCursorRef = useRef<number | null>(null);
  const hasMoreRef = useRef(false);
  const isInitialLoadingRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const isRefreshingNewerRef = useRef(false);
  const resetRequestIdRef = useRef(0);
  const olderRequestIdRef = useRef(0);
  const newerRequestIdRef = useRef(0);
  const optionsRef = useRef({
    searchTerm,
    severity,
    origin,
    jobId,
    agentKey,
    pageSize,
  });

  useEffect(() => {
    optionsRef.current = {
      searchTerm,
      severity,
      origin,
      jobId,
      agentKey,
      pageSize,
    };
  }, [searchTerm, severity, origin, jobId, agentKey, pageSize]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const requestAlertsPage = async ({
    beforeId,
    afterId,
    limit,
    includeFacets = false,
    version,
  }: {
    beforeId?: number | null;
    afterId?: number | null;
    limit: number;
    includeFacets?: boolean;
    version: number;
  }) => {
    const currentOptions = optionsRef.current;
    const params = new URLSearchParams();

    params.set("limit", String(limit));
    const trimmedSearch = currentOptions.searchTerm.trim();
    if (trimmedSearch) {
      params.set("q", trimmedSearch);
    }

    const normalizedSeverity = String(currentOptions.severity || "").trim().toUpperCase();
    if (normalizedSeverity && normalizedSeverity !== "ALL") {
      params.set("severity", normalizedSeverity);
    }

    const normalizedOrigin = String(currentOptions.origin || "").trim().toUpperCase();
    if (normalizedOrigin === "JOB") {
      params.set("origin", "job");
    } else if (normalizedOrigin === "CAMERA_AGENT") {
      params.set("origin", "camera_agent");
    }

    const normalizedJobId = normalizeCursor(currentOptions.jobId);
    if (normalizedJobId) {
      params.set("job_id", String(normalizedJobId));
    }

    const trimmedAgentKey = currentOptions.agentKey.trim();
    if (trimmedAgentKey) {
      params.set("agent_key", trimmedAgentKey);
    }

    if (beforeId) {
      params.set("before_id", String(beforeId));
    }

    if (afterId) {
      params.set("after_id", String(afterId));
    }

    if (includeFacets) {
      params.set("include_facets", "1");
    }

    const response = await fetch(`/api/dashboard-alerts?${params.toString()}`, {
      credentials: "include",
    });
    const payload: DashboardAlertsResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      const responseError =
        typeof (payload as Record<string, unknown>)?.error === "string"
          ? ((payload as Record<string, unknown>).error as string)
          : "Failed to load dashboard alerts.";
      throw new Error(responseError);
    }

    if (!isMountedRef.current || version !== queryVersionRef.current) {
      return null;
    }

    return payload;
  };

  const fetchAlerts = async (mode: "reset" | "older" | "newer", version = queryVersionRef.current) => {
    let modeRequestId = 0;

    if (mode === "older") {
      if (
        isInitialLoadingRef.current ||
        isLoadingMoreRef.current ||
        isRefreshingNewerRef.current ||
        !hasMoreRef.current ||
        !nextCursorRef.current
      ) {
        return;
      }
      isLoadingMoreRef.current = true;
      modeRequestId = olderRequestIdRef.current + 1;
      olderRequestIdRef.current = modeRequestId;
      setIsLoadingMore(true);
    } else if (mode === "newer") {
      if (
        isInitialLoadingRef.current ||
        isLoadingMoreRef.current ||
        isRefreshingNewerRef.current ||
        alertsRef.current.length === 0
      ) {
        return;
      }
      isRefreshingNewerRef.current = true;
      modeRequestId = newerRequestIdRef.current + 1;
      newerRequestIdRef.current = modeRequestId;
      setIsRefreshingNewer(true);
    } else {
      isInitialLoadingRef.current = true;
      modeRequestId = resetRequestIdRef.current + 1;
      resetRequestIdRef.current = modeRequestId;
      setIsInitialLoading(true);
      setError(null);
      alertsRef.current = [];
      nextCursorRef.current = null;
      hasMoreRef.current = false;
      setAlerts([]);
      setNextCursor(null);
      setHasMore(false);
    }

    try {
      if (mode === "newer") {
        const baselineAfterId = normalizeCursor(alertsRef.current[0]?.id);
        if (!baselineAfterId) {
          return;
        }

        let beforeId: number | null = null;
        let newerAlerts: DashboardAlertItem[] = [];
        let shouldContinue = true;
        let pagesFetched = 0;

        while (shouldContinue && pagesFetched < MAX_NEWER_PAGES) {
          const payload = await requestAlertsPage({
            beforeId,
            afterId: baselineAfterId,
            limit: NEWER_PAGE_SIZE,
            version,
          });
          if (!payload) {
            return;
          }

          const incomingAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
          newerAlerts = mergeDashboardAlerts(newerAlerts, incomingAlerts);
          beforeId = normalizeCursor(payload.next_cursor);
          shouldContinue = Boolean(payload.has_more) && Boolean(beforeId);
          pagesFetched += 1;
        }

        if (newerAlerts.length > 0) {
          setAlerts((current) => {
            const next = mergeDashboardAlerts(newerAlerts, current);
            alertsRef.current = next;
            return next;
          });
        }
        return;
      }

      const payload = await requestAlertsPage({
        beforeId: mode === "older" ? nextCursorRef.current : null,
        limit: mode === "older" ? pageSize : pageSize,
        includeFacets: mode === "reset",
        version,
      });
      if (!payload) {
        return;
      }

      const incomingAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
      const incomingHasMore = Boolean(payload.has_more);
      const incomingNextCursor = normalizeCursor(payload.next_cursor);

      if (mode === "reset") {
        alertsRef.current = incomingAlerts;
        nextCursorRef.current = incomingNextCursor;
        hasMoreRef.current = incomingHasMore;
        setAlerts(incomingAlerts);
        setNextCursor(incomingNextCursor);
        setHasMore(incomingHasMore);
        setJobOptions(Array.isArray(payload.facets?.jobs) ? payload.facets?.jobs : []);
        setAgentOptions(Array.isArray(payload.facets?.agents) ? payload.facets?.agents : []);
        return;
      }

      setAlerts((current) => {
        const next = mergeDashboardAlerts(current, incomingAlerts);
        alertsRef.current = next;
        return next;
      });
      nextCursorRef.current = incomingNextCursor;
      hasMoreRef.current = incomingHasMore;
      setNextCursor(incomingNextCursor);
      setHasMore(incomingHasMore);
    } catch (fetchError) {
      console.error("[useDashboardAlerts] Failed to load alerts:", fetchError);
      if (isMountedRef.current && version === queryVersionRef.current) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load alerts.");
      }
    } finally {
      if (!isMountedRef.current) {
        return;
      }

      if (mode === "older") {
        if (modeRequestId !== olderRequestIdRef.current) {
          return;
        }
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      } else if (mode === "newer") {
        if (modeRequestId !== newerRequestIdRef.current) {
          return;
        }
        isRefreshingNewerRef.current = false;
        setIsRefreshingNewer(false);
      } else {
        if (modeRequestId !== resetRequestIdRef.current) {
          return;
        }
        isInitialLoadingRef.current = false;
        setIsInitialLoading(false);
      }
    }
  };

  useEffect(() => {
    queryVersionRef.current += 1;
    const version = queryVersionRef.current;
    void fetchAlerts("reset", version);
  }, [searchTerm, severity, origin, jobId, agentKey, pageSize]);

  useEffect(() => {
    const normalizedLatestAlertId = normalizeCursor(latestAlertId);
    if (!normalizedLatestAlertId) {
      return;
    }
    if (normalizedLatestAlertId <= lastSeenLatestAlertIdRef.current) {
      return;
    }
    lastSeenLatestAlertIdRef.current = normalizedLatestAlertId;
    if (alertsRef.current.length === 0 || isInitialLoadingRef.current) {
      return;
    }
    void fetchAlerts("newer", queryVersionRef.current);
  }, [latestAlertId]);

  return {
    alerts,
    jobOptions,
    agentOptions,
    hasMore,
    nextCursor,
    isInitialLoading,
    isLoadingMore,
    isRefreshingNewer,
    error,
    loadMore: () => fetchAlerts("older", queryVersionRef.current),
    refreshLatest: () => fetchAlerts("newer", queryVersionRef.current),
  };
}
