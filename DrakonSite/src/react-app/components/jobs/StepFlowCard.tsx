import { type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Edit2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface StepFlowCardProps {
  stepOrder: number;
  stepName: ReactNode;
  expanded: boolean;
  isReady: boolean;
  timeoutSlot?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  onToggle: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  rootRef?: (node: HTMLDivElement | null) => void;
  density?: "normal" | "compact";
}

export default function StepFlowCard({
  stepOrder,
  stepName,
  expanded,
  isReady,
  timeoutSlot,
  toolbar,
  children,
  onToggle,
  onDelete,
  onEdit,
  rootRef,
  density = "normal",
}: StepFlowCardProps) {
  const { t } = useTranslation();
  const isCompact = density === "compact";

  const shouldIgnoreToggleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const nestedInteractiveElement = target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="link"]'
    );

    return nestedInteractiveElement !== null && nestedInteractiveElement !== event.currentTarget;
  };

  return (
    <div
      ref={rootRef}
      className={`w-full rounded-[24px] border border-gray-800/80 bg-gray-900/75 shadow-[0_24px_80px_-62px_rgba(0,0,0,1)] backdrop-blur-sm ${
        isCompact ? "rounded-[18px]" : ""
      }`}
    >
      <div className={`border-b border-gray-800/80 ${isCompact ? "px-3 py-2.5" : "px-4 py-3.5"}`}>
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            role="button"
            tabIndex={0}
            onClick={onToggle}
            onKeyDown={(event) => {
              if (shouldIgnoreToggleKey(event)) {
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }}
          >
            <div className={`inline-flex items-center justify-center border border-blue-400/30 bg-blue-500/15 font-semibold text-blue-100 ${
              isCompact ? "h-9 min-w-9 rounded-[10px] text-[12px]" : "h-11 min-w-11 rounded-[14px] text-sm"
            }`}>
              {stepOrder}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className={`min-w-0 line-clamp-2 font-semibold text-gray-100 ${isCompact ? "text-[0.9rem] leading-5" : "text-[1.05rem] leading-6"}`}>{stepName}</div>
                <div
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    isReady
                      ? "border-emerald-400/25 bg-emerald-500/12 text-emerald-200"
                      : "border-amber-400/25 bg-amber-500/12 text-amber-200"
                  }`}
                >
                  {isReady ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {isReady
                    ? t("jobs.stepReady", { defaultValue: "Ready" })
                    : t("jobs.stepNeedsSetup", { defaultValue: "Needs setup" })}
                </div>
              </div>
              <div className={`mt-1 uppercase text-gray-500 ${isCompact ? "text-[8px] tracking-[0.16em]" : "text-[10px] tracking-[0.24em]"}`}>
                {t("jobs.stepName", { defaultValue: "Step" })} {stepOrder}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className={`inline-flex items-center justify-center border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200 ${
                  isCompact ? "h-8 w-8 rounded-[10px]" : "h-10 w-10 rounded-[14px]"
                }`}
                title={t("jobs.edit", { defaultValue: "Edit" })}
              >
                <Edit2 className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggle}
              className={`inline-flex items-center justify-center border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200 ${
                isCompact ? "h-8 w-8 rounded-[10px]" : "h-10 w-10 rounded-[14px]"
              }`}
              title={expanded ? t("common.collapse", { defaultValue: "Collapse" }) : t("common.expand", { defaultValue: "Expand" })}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className={`inline-flex items-center justify-center border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 ${
                isCompact ? "h-8 w-8 rounded-[10px]" : "h-10 w-10 rounded-[14px]"
              }`}
              title={t("jobs.delete", { defaultValue: "Delete" })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${isCompact ? "mt-1.5" : "mt-2.5"}`}>
          {timeoutSlot ? (
            <div className={`inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/60 text-gray-300 ${
              isCompact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1.5 text-[11px]"
            }`}>
              <div className={`uppercase text-gray-500 ${isCompact ? "tracking-[0.14em]" : "tracking-[0.22em]"}`}>
                {t("jobs.stepMaxRuntime", { defaultValue: "Tempo maximo" })}
              </div>
              <div className="text-xs text-gray-200">{timeoutSlot}</div>
            </div>
          ) : null}
        </div>
        {toolbar ? <div className={isCompact ? "mt-2" : "mt-3"}>{toolbar}</div> : null}
      </div>
      {expanded ? <div className={isCompact ? "px-3 pb-3 pt-2.5" : "px-4 pb-4 pt-3"}>{children}</div> : null}
    </div>
  );
}
