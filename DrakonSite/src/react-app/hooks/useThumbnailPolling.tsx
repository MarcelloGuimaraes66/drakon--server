import { useEffect, useMemo, useRef } from "react";
import { pollingManager } from "@/react-app/lib/PollingManager";

interface ThumbnailMetadata {
  camera_id: number;
  thumbnail_url: string | null | undefined;
  last_thumbnail_update: string | null | undefined;
  is_service_running: number | undefined;
  is_online: number | undefined;
}

interface Camera {
  id: number;
  thumbnail_url?: string | null;
  last_thumbnail_update?: string | null;
  is_service_running?: number;
  is_online?: number;
}

export function useThumbnailPolling(cameras: Camera[], onUpdate: (updates: ThumbnailMetadata[]) => void) {
  const camerasRef = useRef<Camera[]>(cameras);
  const onUpdateRef = useRef(onUpdate);
  const runningCameraSignature = useMemo(() => {
    return cameras
      .map((camera) => `${camera.id}:${camera.is_service_running === 1 ? 1 : 0}`)
      .sort()
      .join(",");
  }, [cameras]);

  // Keep refs updated
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    // Check if there are any running cameras to determine polling need
    const hasRunningCameras = camerasRef.current.some(c => c.is_service_running === 1);
    
    if (!hasRunningCameras) {
      // No running cameras - don't poll for updates
      console.log('[useThumbnailPolling] No running cameras, skipping polling registration');
      return;
    }

    // Poll only lightweight thumbnail metadata so thumbnail freshness does not force
    // a full dashboard refresh.
    pollingManager.register('camera-thumbnails', {
      url: '/api/camera-thumbnails',
      interval: 5000,
      jitterMaxMs: 0,
      onData: (allCameras: Camera[]) => {
        if (!Array.isArray(allCameras)) {
          return;
        }

        // Find cameras with updated thumbnails
        const updates: ThumbnailMetadata[] = [];
        
        for (const newCamera of allCameras) {
          const oldCamera = camerasRef.current.find(c => c.id === newCamera.id);
          
          if (!oldCamera) continue;
          
          // Check if thumbnail or connection state changed
          if (
            newCamera.thumbnail_url !== oldCamera.thumbnail_url ||
            newCamera.last_thumbnail_update !== oldCamera.last_thumbnail_update ||
            newCamera.is_service_running !== oldCamera.is_service_running ||
            newCamera.is_online !== oldCamera.is_online
          ) {
            updates.push({
              camera_id: newCamera.id,
              thumbnail_url: newCamera.thumbnail_url,
              last_thumbnail_update: newCamera.last_thumbnail_update,
              is_service_running: newCamera.is_service_running,
              is_online: newCamera.is_online,
            });
          }
        }

        if (updates.length > 0) {
          onUpdateRef.current(updates);
        }
      },
      onError: (error) => {
        console.error('[useThumbnailPolling] Polling error:', error);
      },
    });

    return () => {
      pollingManager.unregister('camera-thumbnails');
    };
  }, [runningCameraSignature]);
}
