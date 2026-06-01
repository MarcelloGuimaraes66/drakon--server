import { useEffect, useRef } from "react";
import {
  getCameraConnectionState,
  isCameraServiceRunning,
} from "@/react-app/lib/cameraStatus";

type ThumbnailRecoveryCamera = {
  id: number;
  thumbnail_url?: string | null;
  is_service_running?: number | boolean | null;
  is_online?: number | boolean | null;
};

const THUMBNAIL_RECOVERY_DELAY_MS = 15000;

function hasThumbnail(camera: ThumbnailRecoveryCamera | null | undefined): boolean {
  return typeof camera?.thumbnail_url === "string" && camera.thumbnail_url.trim().length > 0;
}

export function useThumbnailRecovery(cameras: ThumbnailRecoveryCamera[]) {
  const camerasRef = useRef<ThumbnailRecoveryCamera[]>(cameras);
  const scheduledTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const attemptedCameraIdsRef = useRef<Set<number>>(new Set());
  const inFlightCameraIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    const eligibleCameraIds = new Set<number>();

    for (const camera of cameras) {
      const cameraId = Number(camera?.id) || 0;
      if (cameraId <= 0) continue;

      const connectionState = getCameraConnectionState(camera);
      const running = isCameraServiceRunning(camera);
      const thumbnailPresent = hasThumbnail(camera);
      const eligible = running && connectionState === "online" && !thumbnailPresent;

      if (!eligible) {
        const timer = scheduledTimersRef.current.get(cameraId);
        if (timer) {
          clearTimeout(timer);
          scheduledTimersRef.current.delete(cameraId);
        }

        if (!running || connectionState !== "online" || thumbnailPresent) {
          attemptedCameraIdsRef.current.delete(cameraId);
          inFlightCameraIdsRef.current.delete(cameraId);
        }
        continue;
      }

      eligibleCameraIds.add(cameraId);

      if (
        scheduledTimersRef.current.has(cameraId) ||
        attemptedCameraIdsRef.current.has(cameraId) ||
        inFlightCameraIdsRef.current.has(cameraId)
      ) {
        continue;
      }

      const timer = setTimeout(() => {
        scheduledTimersRef.current.delete(cameraId);

        const currentCamera = camerasRef.current.find((candidate) => Number(candidate?.id) === cameraId);
        if (!currentCamera) {
          attemptedCameraIdsRef.current.delete(cameraId);
          inFlightCameraIdsRef.current.delete(cameraId);
          return;
        }

        const currentConnectionState = getCameraConnectionState(currentCamera);
        const currentRunning = isCameraServiceRunning(currentCamera);
        const thumbnailPresent = hasThumbnail(currentCamera);
        if (!currentRunning || currentConnectionState !== "online" || thumbnailPresent) {
          attemptedCameraIdsRef.current.delete(cameraId);
          inFlightCameraIdsRef.current.delete(cameraId);
          return;
        }

        attemptedCameraIdsRef.current.add(cameraId);
        inFlightCameraIdsRef.current.add(cameraId);

        void (async () => {
          try {
            const response = await fetch(`/api/cameras/${cameraId}/refresh-thumbnail`, {
              method: "POST",
              credentials: "include",
            });

            if (!response.ok) {
              attemptedCameraIdsRef.current.delete(cameraId);
              console.warn(`[useThumbnailRecovery] Failed to refresh thumbnail for camera ${cameraId}`);
            }
          } catch (error) {
            attemptedCameraIdsRef.current.delete(cameraId);
            console.error(`[useThumbnailRecovery] Thumbnail recovery failed for camera ${cameraId}:`, error);
          } finally {
            inFlightCameraIdsRef.current.delete(cameraId);
          }
        })();
      }, THUMBNAIL_RECOVERY_DELAY_MS);

      scheduledTimersRef.current.set(cameraId, timer);
    }

    for (const [cameraId, timer] of scheduledTimersRef.current) {
      if (!eligibleCameraIds.has(cameraId)) {
        clearTimeout(timer);
        scheduledTimersRef.current.delete(cameraId);
      }
    }
  }, [cameras]);

  useEffect(() => {
    const scheduledTimers = scheduledTimersRef.current;
    return () => {
      for (const timer of scheduledTimers.values()) {
        clearTimeout(timer);
      }
      scheduledTimers.clear();
    };
  }, []);
}
