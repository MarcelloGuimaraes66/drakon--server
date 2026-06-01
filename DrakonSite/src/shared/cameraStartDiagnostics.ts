export type CameraStartFailureDiagnosticInput = {
  errorCode?: string | null;
  message?: string | null;
  cameraName?: string | null;
};

export type CameraStartFailureDiagnostic = {
  title: string;
  message: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function describeCameraStartFailureDiagnostic(
  input: CameraStartFailureDiagnosticInput,
): CameraStartFailureDiagnostic {
  const errorCode = normalizeText(input.errorCode).toLowerCase();
  const rawMessage = normalizeText(input.message) || "Failed to start camera";
  const cameraName = normalizeText(input.cameraName) || "Camera";

  if (errorCode === "linux_agent_not_running") {
    return {
      title: "Agent Offline",
      message: `${cameraName} could not start because the Linux agent is not polling commands.`,
    };
  }

  if (errorCode === "webcam_permission_denied") {
    return {
      title: "Webcam Permission Denied",
      message: `${cameraName} could not start because the webcam device is not readable by this user.`,
    };
  }

  if (
    errorCode === "webcam_device_not_found" ||
    errorCode === "webcam_source_empty" ||
    errorCode === "camera_source_empty" ||
    errorCode === "camera_source_unsupported"
  ) {
    return {
      title: "Camera Source Unavailable",
      message: `${cameraName} could not start because the configured webcam source is unavailable.`,
    };
  }

  if (
    errorCode === "webcam_frame_timeout" ||
    errorCode === "rtsp_frame_timeout" ||
    errorCode === "webcam_probe_timeout" ||
    errorCode === "camera_start_timeout"
  ) {
    return {
      title: "Camera Capture Timed Out",
      message: rawMessage || `${cameraName} did not provide a frame before the start timeout.`,
    };
  }

  if (errorCode.startsWith("rtsp_frame_")) {
    return {
      title: "RTSP Connection Failed",
      message: rawMessage || `${cameraName} did not return a valid RTSP frame.`,
    };
  }

  if (errorCode === "ffmpeg_not_found") {
    return {
      title: "Camera Runtime Missing",
      message: `${cameraName} could not start because ffmpeg is not available on this machine.`,
    };
  }

  return {
    title: "Camera Start Failed",
    message: rawMessage,
  };
}
