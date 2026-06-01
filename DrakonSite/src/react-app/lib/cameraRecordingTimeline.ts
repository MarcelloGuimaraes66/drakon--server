import type {
  CameraRecordingSegment,
  CameraRecordingSummaryBucket,
  CameraRecordingTimelineZoom,
} from "@/shared/cameraRecordings";

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function buildCameraRecordingSummaryUrl(options: {
  cameraId: number;
  zoom: CameraRecordingTimelineZoom;
  focusAt: string;
  timezone?: string;
}) {
  const params = new URLSearchParams({
    zoom: options.zoom,
    focus_at: options.focusAt,
    timezone: options.timezone || getBrowserTimeZone(),
  });
  return `/api/cameras/${options.cameraId}/recordings/summary?${params.toString()}`;
}

export function buildCameraRecordingSegmentsUrl(options: {
  cameraId: number;
  from: string;
  to: string;
  focusAt: string;
}) {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
    focus_at: options.focusAt,
  });
  return `/api/cameras/${options.cameraId}/recordings/segments?${params.toString()}`;
}

export function formatRecordingDurationShort(
  durationSeconds: number,
  locale = "en-US"
) {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return new Intl.NumberFormat(locale).format(seconds) + "s";
  }
  if (seconds === 0) {
    return `${new Intl.NumberFormat(locale).format(minutes)}m`;
  }
  return `${new Intl.NumberFormat(locale).format(minutes)}m ${new Intl.NumberFormat(
    locale
  ).format(seconds)}s`;
}

export function formatRecordingBucketLabel(
  bucket: CameraRecordingSummaryBucket,
  zoom: CameraRecordingTimelineZoom,
  locale = "en-US"
) {
  const date = new Date(bucket.start_at);
  if (zoom === "hour") {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  if (zoom === "day") {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatRecordingBucketSecondaryLabel(
  bucket: CameraRecordingSummaryBucket,
  zoom: CameraRecordingTimelineZoom,
  locale = "en-US"
) {
  const date = new Date(bucket.start_at);
  if (zoom === "hour") {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(date);
  }
  if (zoom === "day") {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
  }).format(date);
}

export function formatRecordingSegmentTimeRange(
  segment: CameraRecordingSegment,
  locale = "en-US"
) {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${formatter.format(new Date(segment.start_at))} - ${formatter.format(
    new Date(segment.end_at)
  )}`;
}

export function formatRecordingDateTime(
  value: string | null | undefined,
  locale = "en-US"
) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatRecordingCompactDate(
  value: string | null | undefined,
  locale = "en-US"
) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}
