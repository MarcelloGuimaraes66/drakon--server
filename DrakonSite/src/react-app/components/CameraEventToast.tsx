import { X, AlertCircle, CheckCircle2 } from "lucide-react";

interface Toast {
  id: number;
  cameraId?: number | null;
  cameraName?: string;
  message: string;
  title?: string;
  type?:
    | "offline"
    | "online"
    | "job_staled"
    | "job_start_blocked"
    | "job_started"
    | "agent_api_error";
}

interface CameraEventToastProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function CameraEventToast({ toasts, onDismiss }: CameraEventToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[140] flex flex-col gap-3 max-w-md pointer-events-none">
      {toasts.map((toast) => {
        const toastType = toast.type || "offline";
        const isJobStaledToast = toastType === "job_staled";
        const isJobStartBlockedToast = toastType === "job_start_blocked";
        const isJobStartedToast = toastType === "job_started";
        const isAgentApiErrorToast = toastType === "agent_api_error";
        const isOnlineToast = toast.type === "online";
        const isAmberJobToast = isJobStaledToast || isJobStartBlockedToast;
        const cameraLabel = toast.cameraName || "Camera";
        const cardClass = isAmberJobToast
          ? "bg-gradient-to-br from-amber-900/95 to-amber-950/95 border-amber-700/50 shadow-amber-500/20"
          : isJobStartedToast
          ? "bg-gradient-to-br from-emerald-900/95 to-emerald-950/95 border-emerald-700/50 shadow-emerald-500/20"
          : isOnlineToast
          ? "bg-gradient-to-br from-emerald-900/95 to-emerald-950/95 border-emerald-700/50 shadow-emerald-500/20"
          : isAgentApiErrorToast
          ? "bg-gradient-to-br from-red-900/95 to-red-950/95 border-red-700/50 shadow-red-500/20"
          : "bg-gradient-to-br from-red-900/95 to-red-950/95 border-red-700/50 shadow-red-500/20";
        const iconWrapClass = isAmberJobToast
          ? "bg-amber-500/20"
          : isJobStartedToast
          ? "bg-emerald-500/20"
          : isOnlineToast
          ? "bg-emerald-500/20"
          : "bg-red-500/20";
        const iconClass = isAmberJobToast
          ? "text-amber-400"
          : isJobStartedToast
          ? "text-emerald-400"
          : isOnlineToast
          ? "text-emerald-400"
          : "text-red-400";
        const dismissHoverClass = isAmberJobToast
          ? "hover:bg-amber-800/30"
          : isJobStartedToast
          ? "hover:bg-emerald-800/30"
          : isOnlineToast
          ? "hover:bg-emerald-800/30"
          : "hover:bg-red-800/30";
        const toastTitle = isJobStaledToast
          ? toast.title || "Job Stalled"
          : isJobStartBlockedToast
          ? toast.title || "Job Start Blocked"
          : isJobStartedToast
          ? toast.title || "Job Started"
          : isAgentApiErrorToast
          ? toast.title || "AI API Error"
          : isOnlineToast
          ? "Camera Online"
          : "Camera Offline";

        return (
          <div
            key={toast.id}
            className={`${cardClass} backdrop-blur-xl border rounded-xl shadow-2xl p-4 pointer-events-auto animate-slide-in`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 ${iconWrapClass} rounded-lg flex items-center justify-center flex-shrink-0`}>
                {isOnlineToast || isJobStartedToast ? (
                  <CheckCircle2 className={`w-5 h-5 ${iconClass}`} />
                ) : (
                  <AlertCircle className={`w-5 h-5 ${iconClass}`} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-100 mb-1">
                  {toastTitle}
                </h4>
                <p className="text-sm text-gray-300 mb-2">
                  {isJobStaledToast || isJobStartBlockedToast || isJobStartedToast || isAgentApiErrorToast ? (
                    <>{toast.message}</>
                  ) : isOnlineToast ? (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span> is back online.
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span> is out of range.
                      We will try to reconnect it internally.
                    </>
                  )}
                </p>
                {!isJobStaledToast && !isJobStartBlockedToast && !isJobStartedToast && !isAgentApiErrorToast && (
                  <p className="text-xs text-gray-400">
                    {toast.message}
                  </p>
                )}
              </div>

              <button
                onClick={() => onDismiss(toast.id)}
                className={`p-1.5 text-gray-400 hover:text-gray-200 ${dismissHoverClass} rounded-lg transition-colors flex-shrink-0`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
