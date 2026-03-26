export type CameraConnectionState = "online" | "reconnecting" | "offline";

type CameraStatusLike = {
  is_service_running?: number | boolean | null;
  is_online?: number | boolean | null;
};

export function isCameraServiceRunning(camera: CameraStatusLike | null | undefined): boolean {
  return camera?.is_service_running === 1 || camera?.is_service_running === true;
}

export function isCameraOnline(camera: CameraStatusLike | null | undefined): boolean {
  return camera?.is_online === 1 || camera?.is_online === true;
}

export function getCameraConnectionState(
  camera: CameraStatusLike | null | undefined,
): CameraConnectionState {
  const isRunning = isCameraServiceRunning(camera);
  if (!isRunning) {
    return "offline";
  }

  return isCameraOnline(camera) ? "online" : "reconnecting";
}

