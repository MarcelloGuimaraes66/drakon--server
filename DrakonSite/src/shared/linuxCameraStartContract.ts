export type LinuxCameraStartCommandStatus = "completed" | "failed";

export type LinuxCameraStartContract = {
  started: boolean;
  firstFrameCaptured: boolean;
  failed: boolean;
  errorMessage: string;
  errorCode: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function evaluateLinuxCameraStartResult(
  status: LinuxCameraStartCommandStatus,
  result: Record<string, unknown>,
  envelopeError?: unknown,
): LinuxCameraStartContract {
  const started = normalizeBool(result.started);
  const hasFirstFrameField = Object.prototype.hasOwnProperty.call(result, "first_frame_captured");
  const firstFrameCaptured = hasFirstFrameField
    ? normalizeBool(result.first_frame_captured)
    : normalizeBool(result.thumbnail_generated);
  const errorMessage =
    normalizeText(result.error) ||
    normalizeText(envelopeError);
  const errorCode = normalizeText(result.error_code) || "camera_start_failed";

  return {
    started,
    firstFrameCaptured,
    failed: status === "failed" || !!errorMessage || !started || !firstFrameCaptured,
    errorMessage,
    errorCode,
  };
}
