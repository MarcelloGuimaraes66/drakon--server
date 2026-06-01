import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { AlertCircle, X } from "lucide-react";

type CameraStartAttentionToastProps = {
  cameraId: number;
  billingEnabled: boolean;
  onDismiss: () => void;
  autoHideMs?: number;
};

export default function CameraStartAttentionToast({
  cameraId,
  billingEnabled,
  onDismiss,
  autoHideMs = 10000,
}: CameraStartAttentionToastProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (typeof window === "undefined" || autoHideMs <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onDismissRef.current();
    }, autoHideMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoHideMs, cameraId]);

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md pointer-events-none">
      <div className="bg-gradient-to-br from-orange-900/95 to-orange-950/95 backdrop-blur-xl border border-orange-700/50 rounded-xl shadow-2xl shadow-orange-500/20 p-4 pointer-events-auto animate-slide-in">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-orange-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-gray-100 mb-1">
              Agent Start Needs Attention
            </h4>
            <p className="text-sm text-gray-300 mb-2">
              Some agents for Camera #{cameraId} were skipped during startup.
            </p>
            <p className="text-xs text-gray-400 mb-3">
              Review the provider API keys and agent settings if detections do not begin.
            </p>
            {billingEnabled ? (
              <Link
                to="/billing"
                onClick={onDismiss}
                className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
              >
                Go to Billing -&gt;
              </Link>
            ) : null}
          </div>

          <button
            onClick={onDismiss}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-orange-800/30 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
