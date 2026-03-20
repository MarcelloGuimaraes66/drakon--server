import { useCallback, useRef } from 'react';

/**
 * Throttled camera refresh hook - prevents refresh storms
 * when multiple events arrive in quick succession
 */
export function useCameraRefresh(fetchCameras: () => Promise<void>) {
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRef = useRef(false);

  const throttledRefresh = useCallback(() => {
    // If already pending, just mark it and return
    if (pendingRef.current) {
      return;
    }

    // If we have an active throttle, mark as pending and return
    if (throttleTimerRef.current) {
      pendingRef.current = true;
      return;
    }

    // Execute immediately
    fetchCameras();

    // Set throttle window (5 seconds)
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;

      // If there was a pending request during throttle, execute it now
      if (pendingRef.current) {
        pendingRef.current = false;
        fetchCameras();
        
        // Reset throttle window
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
        }, 5000);
      }
    }, 5000);
  }, [fetchCameras]);

  return throttledRefresh;
}
