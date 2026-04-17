import { startTransition, useEffect, useRef, useState } from "react";
import { pollingManager } from "@/react-app/lib/PollingManager";
import {
  buildCameraRecordingSegmentsUrl,
  buildCameraRecordingSummaryUrl,
  getBrowserTimeZone,
} from "@/react-app/lib/cameraRecordingTimeline";
import type {
  CameraRecordingSegmentsResponse,
  CameraRecordingSummaryBucket,
  CameraRecordingSummaryResponse,
  CameraRecordingTimelineZoom,
} from "@/shared/cameraRecordings";

type UseCameraRecordingTimelineArgs = {
  cameraId: number | null;
  isOpen: boolean;
  initialFocusAt?: string | null;
};

export function useCameraRecordingTimeline({
  cameraId,
  isOpen,
  initialFocusAt = null,
}: UseCameraRecordingTimelineArgs) {
  const pollerIdRef = useRef(
    `camera-recordings-${Math.random().toString(36).slice(2)}`
  );
  const [zoom, setZoom] = useState<CameraRecordingTimelineZoom>("hour");
  const [focusAt, setFocusAt] = useState<string>(
    initialFocusAt || new Date().toISOString()
  );
  const [summary, setSummary] = useState<CameraRecordingSummaryResponse | null>(
    null
  );
  const [segments, setSegments] =
    useState<CameraRecordingSegmentsResponse | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const summaryIntervalMs =
    summary?.refresh_policy.recommended_poll_interval_ms ?? 10_000;

  useEffect(() => {
    if (!isOpen || !cameraId) {
      return;
    }
    setZoom("hour");
    setFocusAt(initialFocusAt || new Date().toISOString());
    setSummary(null);
    setSegments(null);
    setSelectedSegmentId(null);
    setError(null);
    setLoadingSummary(true);
    setLoadingSegments(false);
  }, [cameraId, initialFocusAt, isOpen]);

  useEffect(() => {
    if (!isOpen || !cameraId) {
      return;
    }

    const summaryKey = `${pollerIdRef.current}:summary:${cameraId}`;
    const summaryUrl = buildCameraRecordingSummaryUrl({
      cameraId,
      zoom,
      focusAt,
      timezone: getBrowserTimeZone(),
    });

    if (!summary) {
      setLoadingSummary(true);
    }

    pollingManager.register(summaryKey, {
      url: summaryUrl,
      interval: summaryIntervalMs,
      jitterMaxMs: 0,
      onData: (data: CameraRecordingSummaryResponse) => {
        setSummary(data);
        setError(null);
        setLoadingSummary(false);
      },
      onError: (nextError) => {
        setError(nextError.message || "Failed to load recording summary");
        setLoadingSummary(false);
      },
    });

    return () => {
      pollingManager.unregister(summaryKey);
    };
  }, [
    cameraId,
    focusAt,
    isOpen,
    refreshTick,
    summaryIntervalMs,
    zoom,
  ]);

  const summaryBuckets = summary?.buckets || [];
  const activeBucket =
    summaryBuckets.find((bucket) => bucket.key === summary?.focus_bucket_key) ||
    summaryBuckets[summaryBuckets.length - 1] ||
    null;
  const activeBucketStartAt = activeBucket?.start_at || null;
  const activeBucketEndAt = activeBucket?.end_at || null;
  const segmentsIntervalMs =
    segments?.refresh_policy.recommended_poll_interval_ms ??
    summaryIntervalMs;

  useEffect(() => {
    if (
      !isOpen ||
      !cameraId ||
      zoom !== "hour" ||
      !activeBucketStartAt ||
      !activeBucketEndAt
    ) {
      setLoadingSegments(false);
      return;
    }

    const segmentsKey = `${pollerIdRef.current}:segments:${cameraId}`;
    const segmentsUrl = buildCameraRecordingSegmentsUrl({
      cameraId,
      from: activeBucketStartAt,
      to: activeBucketEndAt,
      focusAt,
    });

    if (!segments) {
      setLoadingSegments(true);
    }

    pollingManager.register(segmentsKey, {
      url: segmentsUrl,
      interval: segmentsIntervalMs,
      jitterMaxMs: 0,
      onData: (data: CameraRecordingSegmentsResponse) => {
        setSegments(data);
        setError(null);
        setLoadingSegments(false);
      },
      onError: (nextError) => {
        setError(nextError.message || "Failed to load recording segments");
        setLoadingSegments(false);
      },
    });

    return () => {
      pollingManager.unregister(segmentsKey);
    };
  }, [
    activeBucketEndAt,
    activeBucketStartAt,
    cameraId,
    focusAt,
    isOpen,
    refreshTick,
    segmentsIntervalMs,
    zoom,
  ]);

  useEffect(() => {
    if (!segments) {
      return;
    }
    if (segments.segments.length === 0) {
      setSelectedSegmentId(null);
      return;
    }
    if (
      selectedSegmentId &&
      segments.segments.some((segment) => segment.id === selectedSegmentId)
    ) {
      return;
    }
    setSelectedSegmentId(
      segments.focus_segment_id ||
        segments.segments[segments.segments.length - 1]?.id ||
        null
    );
  }, [segments, selectedSegmentId]);

  const selectedSegment =
    segments?.segments.find((segment) => segment.id === selectedSegmentId) ||
    null;

  const liveEdgeBucket =
    summaryBuckets.find((bucket) => bucket.contains_live_edge) || null;

  function handleBucketSelect(bucket: CameraRecordingSummaryBucket) {
    if (zoom === "month") {
      startTransition(() => {
        setZoom("day");
        setFocusAt(bucket.start_at);
        setLoadingSummary(true);
      });
      return;
    }

    if (zoom === "day") {
      startTransition(() => {
        setZoom("hour");
        setFocusAt(bucket.start_at);
        setLoadingSummary(true);
        setLoadingSegments(true);
      });
      return;
    }

    startTransition(() => {
      setFocusAt(bucket.start_at);
      setLoadingSegments(true);
    });
  }

  function handleZoomChange(nextZoom: CameraRecordingTimelineZoom) {
    startTransition(() => {
      setZoom(nextZoom);
      setLoadingSummary(true);
      if (nextZoom === "hour") {
        setLoadingSegments(true);
      }
    });
  }

  function refreshNow() {
    setLoadingSummary(true);
    if (zoom === "hour") {
      setLoadingSegments(true);
    }
    setRefreshTick((value) => value + 1);
  }

  function jumpToLiveEdge() {
    startTransition(() => {
      setZoom("hour");
      setFocusAt(
        summary?.availability.latest_segment_end_at ||
          new Date().toISOString()
      );
      setLoadingSummary(true);
      setLoadingSegments(true);
    });
  }

  return {
    zoom,
    setZoom: handleZoomChange,
    focusAt,
    setFocusAt,
    summary,
    segments,
    activeBucket,
    selectedSegment,
    selectedSegmentId,
    setSelectedSegmentId,
    loadingSummary,
    loadingSegments,
    error,
    refreshNow,
    handleBucketSelect,
    jumpToLiveEdge,
    liveEdgeBucketKey: liveEdgeBucket?.key || null,
    hasWindowVideo: Boolean(summaryBuckets.some((bucket) => bucket.has_video)),
    canLoadSegments: zoom === "hour" && Boolean(activeBucketStartAt && activeBucketEndAt),
  };
}
