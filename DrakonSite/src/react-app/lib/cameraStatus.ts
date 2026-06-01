export type CameraConnectionState = "online" | "reconnecting" | "auth_lost" | "offline";

type CameraStatusLike = {
  is_service_running?: number | boolean | null;
  is_online?: number | boolean | null;
  connection_issue_kind?: string | null;
};

export function isCameraServiceRunning(camera: CameraStatusLike | null | undefined): boolean {
  return camera?.is_service_running === 1 || camera?.is_service_running === true;
}

export function isCameraOnline(camera: CameraStatusLike | null | undefined): boolean {
  return camera?.is_online === 1 || camera?.is_online === true;
}

export function isCameraPairingAuthLost(camera: CameraStatusLike | null | undefined): boolean {
  return camera?.connection_issue_kind === "pairing_auth_lost";
}

export function getCameraConnectionState(
  camera: CameraStatusLike | null | undefined,
): CameraConnectionState {
  const isRunning = isCameraServiceRunning(camera);
  if (!isRunning) {
    return "offline";
  }

  if (isCameraOnline(camera)) {
    return "online";
  }

  return isCameraPairingAuthLost(camera) ? "auth_lost" : "reconnecting";
}
