export const CAMERA_RECORDING_TIMELINE_ORIGIN = "disk" as const;

export const CAMERA_RECORDING_ZOOMS = ["hour", "day", "month"] as const;
export type CameraRecordingTimelineZoom =
  (typeof CAMERA_RECORDING_ZOOMS)[number];

export const CAMERA_RECORDING_CADENCE_HINTS = [
  "10s",
  "60s",
  "mixed",
  "unknown",
] as const;
export type CameraRecordingCadenceHint =
  (typeof CAMERA_RECORDING_CADENCE_HINTS)[number];

export const CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS = {
  fast: 10_000,
  slow: 60_000,
} as const;

export type CameraRecordingSummaryWindow = {
  zoom: CameraRecordingTimelineZoom;
  from: string;
  to: string;
  normalized_from: string;
  normalized_to: string;
  focus_at: string;
};

export type CameraRecordingSegmentsWindow = {
  from: string;
  to: string;
  focus_at: string;
};

export type CameraRecordingAvailability = {
  has_any_recordings: boolean;
  first_segment_at: string | null;
  last_segment_at: string | null;
  latest_segment_end_at: string | null;
  retention_days: number | null;
};

export type CameraRecordingCaptureState = {
  store_frames_enabled: boolean;
  is_service_running: boolean;
  is_online: boolean;
  cadence_hint: CameraRecordingCadenceHint;
};

export type CameraRecordingRefreshPolicy = {
  recommended_poll_interval_ms: number;
  latest_known_write_at: string | null;
};

export type CameraRecordingSummaryBucket = {
  key: string;
  zoom: CameraRecordingTimelineZoom;
  start_at: string;
  end_at: string;
  clip_count: number;
  recorded_seconds: number;
  coverage_ratio: number;
  dominant_segment_seconds: number | null;
  segment_counts_by_duration: Record<string, number>;
  contains_live_edge: boolean;
  has_video: boolean;
};

export type CameraRecordingSegment = {
  id: string;
  storage_key: string;
  relative_path: string;
  stream_url: string;
  download_url: string;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  cadence_seconds: number;
  file_size_bytes: number;
  file_modified_at: string | null;
  is_finalized: boolean;
};

export type CameraRecordingSegmentsSummary = {
  clip_count: number;
  recorded_seconds: number;
  gap_count: number;
  first_segment_at: string | null;
  last_segment_at: string | null;
};

export type CameraRecordingSummaryResponse = {
  camera_id: number;
  timeline_origin: typeof CAMERA_RECORDING_TIMELINE_ORIGIN;
  timezone: string;
  window: CameraRecordingSummaryWindow;
  availability: CameraRecordingAvailability;
  capture_state: CameraRecordingCaptureState;
  refresh_policy: CameraRecordingRefreshPolicy;
  focus_bucket_key: string | null;
  buckets: CameraRecordingSummaryBucket[];
};

export type CameraRecordingSegmentsResponse = {
  camera_id: number;
  timeline_origin: typeof CAMERA_RECORDING_TIMELINE_ORIGIN;
  window: CameraRecordingSegmentsWindow;
  summary: CameraRecordingSegmentsSummary;
  refresh_policy: CameraRecordingRefreshPolicy;
  focus_segment_id: string | null;
  segments: CameraRecordingSegment[];
};

export function normalizeCameraRecordingZoom(
  value: unknown,
  fallback: CameraRecordingTimelineZoom = "hour"
): CameraRecordingTimelineZoom {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "hour" ||
    normalized === "day" ||
    normalized === "month"
  ) {
    return normalized;
  }
  return fallback;
}

export function normalizeCameraRecordingCadenceHint(
  value: unknown,
  fallback: CameraRecordingCadenceHint = "unknown"
): CameraRecordingCadenceHint {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "10s" ||
    normalized === "60s" ||
    normalized === "mixed" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return fallback;
}
