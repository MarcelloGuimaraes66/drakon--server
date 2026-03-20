import { AlertCircle, Bot } from "lucide-react";

import { ChatProgressInfo } from "@/react-app/utils/chatUtils";

interface PendingAssistantMessageProps {
  content?: string;
  progress?: ChatProgressInfo | null;
  notice?: string | null;
  variant?: "chat-page" | "quick-chat";
}

function PendingDots({ compact = false }: { compact?: boolean }) {
  const sizeClass = compact ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`chat-thinking-dot ${sizeClass}`} style={{ animationDelay: "0ms" }} />
      <span className={`chat-thinking-dot ${sizeClass}`} style={{ animationDelay: "180ms" }} />
      <span className={`chat-thinking-dot ${sizeClass}`} style={{ animationDelay: "360ms" }} />
    </div>
  );
}

export default function PendingAssistantMessage({
  content,
  progress,
  notice,
  variant = "chat-page",
}: PendingAssistantMessageProps) {
  const compact = variant === "quick-chat";
  const hasProgressCard = Boolean(progress?.headline || progress?.detail || notice);

  return (
    <div className="flex gap-4 animate-slide-up">
      <div
        className={
          compact
            ? "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_18px_34px_-20px_rgba(52,211,153,0.95)]"
            : "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_18px_34px_-18px_rgba(45,212,191,0.75)]"
        }
      >
        <Bot className={compact ? "h-4 w-4 text-white" : "h-4 w-4 text-white md:h-5 md:w-5"} />
      </div>

      <div className="min-w-0">
        <div
          className={
            compact
              ? "min-w-0 max-w-[85%] overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.8)] backdrop-blur-sm"
              : "min-w-0 rounded-[28px] border border-white/[0.08] bg-white/[0.035] px-5 py-4 shadow-[0_18px_70px_-42px_rgba(0,0,0,0.92)] backdrop-blur-sm"
          }
        >
          <PendingDots compact={compact} />
          {content ? (
            <p
              className={compact ? "break-words text-sm text-gray-400" : "mt-1 break-words text-sm text-gray-500"}
              style={{ overflowWrap: "anywhere" }}
            >
              {content}
            </p>
          ) : null}
        </div>

        {hasProgressCard ? (
          <div className={compact ? "ml-5 mt-2 flex gap-2.5" : "ml-5 mt-2.5 flex gap-3"}>
            <div className="flex w-3 justify-center">
              <div className={compact ? "h-5 w-px rounded-full bg-white/12" : "h-6 w-px rounded-full bg-white/12"} />
            </div>

            <div
              className={
                notice
                  ? compact
                    ? "max-w-[72%] rounded-[18px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-100 shadow-[0_18px_40px_-24px_rgba(251,191,36,0.35)]"
                    : "max-w-[26rem] rounded-[18px] border border-amber-400/20 bg-amber-400/10 px-3.5 py-2.5 text-amber-100 shadow-[0_18px_40px_-24px_rgba(251,191,36,0.35)]"
                  : compact
                    ? "max-w-[72%] rounded-[18px] border border-white/[0.07] bg-white/[0.028] px-3 py-2 text-gray-200 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.82)] backdrop-blur-sm"
                    : "max-w-[26rem] rounded-[18px] border border-white/[0.07] bg-white/[0.028] px-3.5 py-2.5 text-gray-200 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.82)] backdrop-blur-sm"
              }
            >
              {notice ? (
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                  <p className={compact ? "text-xs leading-[1.125rem]" : "text-[13px] leading-5"}>{notice}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {progress?.headline ? (
                      <p className={compact ? "text-[11px] font-medium text-gray-100" : "text-[13px] font-medium text-gray-100"}>
                        {progress.headline}
                      </p>
                    ) : null}
                    {progress?.step_index && progress?.step_count ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-gray-400">
                        {progress.step_index}/{progress.step_count}
                      </span>
                    ) : null}
                  </div>
                  {progress?.detail ? (
                    <p className={compact ? "mt-1 text-[11px] leading-[1.125rem] text-gray-400" : "mt-1 text-[13px] leading-5 text-gray-400"}>
                      {progress.detail}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
