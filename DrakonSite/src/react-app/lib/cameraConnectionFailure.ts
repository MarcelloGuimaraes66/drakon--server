export type CameraFailurePhase = "startup" | "runtime";

export interface CameraConnectionFailureToastData {
  title?: string;
  message: string;
  failureCode?: string | null;
  failureSummary?: string;
  failureAction?: string;
  technicalDetail?: string;
  failurePhase?: CameraFailurePhase | null;
  failureConfidence?: number | null;
}

interface CameraEventLike {
  message?: string | null;
  details?: unknown;
  details_json?: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readEventDetails(event: CameraEventLike): Record<string, unknown> | null {
  if (isObjectRecord(event.details)) {
    return event.details;
  }

  if (typeof event.details_json !== "string" || !event.details_json.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(event.details_json);
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeFailurePhase(value: unknown): CameraFailurePhase | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "startup" || normalized === "runtime") {
    return normalized;
  }
  return null;
}

export function normalizeCameraConnectionFailedEvent(
  event: CameraEventLike,
): CameraConnectionFailureToastData {
  const fallbackMessage =
    normalizeText(event.message) ||
    "Failed to connect to camera. Please check the RTSP settings and credentials.";
  const details = readEventDetails(event);
  const failure = isObjectRecord(details?.failure) ? details.failure : null;
  const failureSummary = normalizeText(failure?.summary);
  const failureAction = normalizeText(failure?.action);
  const failureCode = normalizeText(failure?.code) || null;
  const technicalDetail =
    normalizeText(failure?.technical_detail) ||
    normalizeText(failure?.technicalDetail) ||
    normalizeText(details?.error);
  const phase =
    normalizeFailurePhase(failure?.phase) || normalizeFailurePhase(details?.failure_phase);
  const notificationKind =
    normalizeText(failure?.notification_kind) || normalizeText(details?.notification_kind);
  const rawConfidence = Number(failure?.confidence);
  const failureConfidence = Number.isFinite(rawConfidence) ? rawConfidence : null;
  const title =
    notificationKind.toLowerCase() === "reminder" && phase === "startup"
      ? "Still Connecting to Camera"
      : notificationKind.toLowerCase() === "reminder" && phase === "runtime"
      ? "Still Reconnecting to Camera"
      : phase === "startup"
      ? "Camera Start Failed"
      : phase === "runtime"
      ? "Camera Connection Lost"
      : undefined;

  return {
    title,
    message: fallbackMessage,
    failureCode,
    failureSummary,
    failureAction,
    technicalDetail:
      technicalDetail && technicalDetail !== fallbackMessage && technicalDetail !== failureSummary
        ? technicalDetail
        : undefined,
    failurePhase: phase,
    failureConfidence,
  };
}
