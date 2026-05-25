import { X, AlertCircle, CheckCircle2 } from "lucide-react";
import { sanitizeAiApiErrorText } from "@/shared/aiApiErrorDisplay";

interface Toast {
  id: number;
  cameraId?: number | null;
  cameraName?: string;
  message: string;
  analytics?: string[];
  failureCode?: string | null;
  failureSummary?: string;
  failureAction?: string;
  technicalDetail?: string;
  failurePhase?: "startup" | "runtime" | null;
  failureConfidence?: number | null;
  title?: string;
  type?:
    | "offline"
    | "online"
    | "camera_started"
    | "camera_start_blocked"
    | "job_staled"
    | "job_start_blocked"
    | "job_step_start_blocked"
    | "job_started"
    | "agent_api_error";
}

interface CameraEventToastProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function CameraEventToast({ toasts, onDismiss }: CameraEventToastProps) {
  const visibleToasts = toasts.filter(
    (toast) => toast.type !== "offline" && toast.type !== "online",
  );

  if (visibleToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[140] flex flex-col gap-3 max-w-md pointer-events-none">
      {visibleToasts.map((toast) => {
        const toastType = toast.type || "offline";
        const isJobStaledToast = toastType === "job_staled";
        const isJobStartBlockedToast = toastType === "job_start_blocked";
        const isJobStepStartBlockedToast = toastType === "job_step_start_blocked";
        const isJobStartedToast = toastType === "job_started";
        const isCameraStartedToast = toastType === "camera_started";
        const isCameraStartBlockedToast = toastType === "camera_start_blocked";
        const isAgentApiErrorToast = toastType === "agent_api_error";
        const isOnlineToast = toast.type === "online";
        const isAmberJobToast =
          isJobStaledToast ||
          isJobStartBlockedToast ||
          isJobStepStartBlockedToast ||
          isCameraStartBlockedToast;
        const isSuccessToast = isJobStartedToast || isOnlineToast || isCameraStartedToast;
        const hasStructuredOfflineFailure =
          toastType === "offline" &&
          (!!toast.failureSummary || !!toast.failureAction || !!toast.technicalDetail);
        const isLowConfidenceFailure =
          typeof toast.failureConfidence === "number" && toast.failureConfidence < 0.7;
        const cameraLabel = toast.cameraName || "Camera";
        const cardClass = isAmberJobToast
          ? "bg-gradient-to-br from-amber-900/95 to-amber-950/95 border-amber-700/50 shadow-amber-500/20"
          : isSuccessToast
          ? "bg-gradient-to-br from-emerald-900/95 to-emerald-950/95 border-emerald-700/50 shadow-emerald-500/20"
          : isAgentApiErrorToast
          ? "bg-gradient-to-br from-red-900/95 to-red-950/95 border-red-700/50 shadow-red-500/20"
          : "bg-gradient-to-br from-red-900/95 to-red-950/95 border-red-700/50 shadow-red-500/20";
        const iconWrapClass = isAmberJobToast
          ? "bg-amber-500/20"
          : isSuccessToast
          ? "bg-emerald-500/20"
          : "bg-red-500/20";
        const iconClass = isAmberJobToast
          ? "text-amber-400"
          : isSuccessToast
          ? "text-emerald-400"
          : "text-red-400";
        const dismissHoverClass = isAmberJobToast
          ? "hover:bg-amber-800/30"
          : isSuccessToast
          ? "hover:bg-emerald-800/30"
          : "hover:bg-red-800/30";
        const toastTitle = isJobStaledToast
          ? toast.title || "Job Stalled"
          : isJobStartBlockedToast
          ? toast.title || "Job Start Blocked"
          : isJobStepStartBlockedToast
          ? toast.title || "Step Start Blocked"
          : isJobStartedToast
          ? toast.title || "Job Started"
          : isCameraStartedToast
          ? toast.title || "Camera Started"
          : isCameraStartBlockedToast
          ? toast.title || "Camera Start Blocked"
          : isAgentApiErrorToast
          ? toast.title || "AI API Error"
          : isOnlineToast
          ? "Camera Online"
          : hasStructuredOfflineFailure && toast.failurePhase === "startup"
          ? toast.title || "Camera Start Failed"
          : hasStructuredOfflineFailure && toast.failurePhase === "runtime"
          ? toast.title || "Camera Connection Lost"
          : "Camera Offline";
        const safeToastTitle = sanitizeAiApiErrorText(toastTitle);
        const safeToastMessage = sanitizeAiApiErrorText(toast.message);

        return (
          <div
            key={toast.id}
            className={`${cardClass} backdrop-blur-xl border rounded-xl shadow-2xl p-4 pointer-events-auto animate-slide-in`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 ${iconWrapClass} rounded-lg flex items-center justify-center flex-shrink-0`}>
                {isSuccessToast ? (
                  <CheckCircle2 className={`w-5 h-5 ${iconClass}`} />
                ) : (
                  <AlertCircle className={`w-5 h-5 ${iconClass}`} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-100 mb-1">
                  {safeToastTitle}
                </h4>
                <p className="text-sm text-gray-300 mb-2">
                  {isJobStaledToast ||
                  isJobStartBlockedToast ||
                  isJobStepStartBlockedToast ||
                  isJobStartedToast ||
                  isCameraStartBlockedToast ||
                  isAgentApiErrorToast ? (
                    <>{safeToastMessage}</>
                  ) : isOnlineToast ? (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span> is back online.
                    </>
                  ) : isCameraStartedToast ? (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span> started successfully.
                    </>
                  ) : hasStructuredOfflineFailure ? (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span>{" "}
                      {isLowConfidenceFailure ? "possible cause: " : ""}
                      {toast.failureSummary || "connection failed."}
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-white">{cameraLabel}</span> is out of range.
                      We will try to reconnect it internally.
                    </>
                  )}
                </p>

                {isCameraStartedToast ? (
                  toast.analytics && toast.analytics.length > 0 ? (
                    <div className="mb-2">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
                        Running analytics
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {toast.analytics.map((analyticsName, index) => (
                          <span
                            key={`${toast.id}-analytics-${index}`}
                            className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-100"
                          >
                            {analyticsName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-gray-400">
                      No analytics are enabled for this camera yet.
                    </p>
                  )
                ) : null}

                {hasStructuredOfflineFailure && toast.failureAction ? (
                  <p className="mb-2 text-xs text-gray-300">
                    {toast.failureAction}
                  </p>
                ) : null}

                {!isJobStaledToast &&
                  !isJobStartBlockedToast &&
                  !isJobStepStartBlockedToast &&
                  !isJobStartedToast &&
                  !isCameraStartBlockedToast &&
                  !isAgentApiErrorToast &&
                  !isCameraStartedToast && (
                  hasStructuredOfflineFailure ? (
                    toast.technicalDetail ? (
                      <p className="text-xs text-gray-400">
                        Technical detail: {toast.technicalDetail}
                      </p>
                    ) : null
                  ) : (
                    <p className="text-xs text-gray-400">
                      {safeToastMessage}
                    </p>
                  )
                )}

                {isCameraStartedToast && toast.message ? (
                  <p className="text-xs text-gray-400">
                    {safeToastMessage}
                  </p>
                ) : null}
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
