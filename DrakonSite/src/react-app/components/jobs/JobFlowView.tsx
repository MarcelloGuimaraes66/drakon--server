import { Children, ReactNode, RefObject } from "react";
import { ArrowLeft, ArrowRight, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import KnowledgeShareCanvas, { KnowledgeShareConnection } from "@/react-app/components/jobs/KnowledgeShareCanvas";

interface JobFlowViewProps {
  title: string;
  description?: string | null;
  scheduleLabel?: string | null;
  statusLabel: string;
  statusClassName: string;
  flowContainerRef: RefObject<HTMLDivElement | null>;
  anchorElements: Record<string, HTMLDivElement | null>;
  knowledgeConnections: KnowledgeShareConnection[];
  tabs?: ReactNode;
  headerActions?: ReactNode;
  metaRow?: ReactNode;
  editPanel?: ReactNode;
  newStepForm?: ReactNode;
  addStepCard?: ReactNode;
  emptyState?: ReactNode;
  children?: ReactNode;
  flowDensity?: "normal" | "compact";
  onChangeFlowDensity?: (density: "normal" | "compact") => void;
  onBack: () => void;
}

export default function JobFlowView({
  title,
  description,
  scheduleLabel,
  statusLabel,
  statusClassName,
  flowContainerRef,
  anchorElements,
  knowledgeConnections,
  tabs,
  headerActions,
  metaRow,
  editPanel,
  newStepForm,
  addStepCard,
  emptyState,
  children,
  flowDensity = "normal",
  onChangeFlowDensity,
  onBack,
}: JobFlowViewProps) {
  const { t } = useTranslation();
  const flowItems = Children.toArray(children);
  const hasChildren = flowItems.length > 0;
  const isCompact = flowDensity === "compact";
  const itemWidthClass = isCompact ? "w-full sm:w-[270px] xl:w-[282px]" : "w-full sm:w-[344px] xl:w-[360px]";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),auto,minmax(0,1fr)] xl:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/70 text-gray-200 transition-colors hover:border-gray-700 hover:bg-gray-800/80"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400">{t("jobs.title")}</span>
          <span className="text-gray-600">/</span>
          <span className="truncate text-gray-100">{title}</span>
        </div>
        {tabs ? <div className="xl:justify-self-center">{tabs}</div> : <div className="hidden xl:block" />}
        {headerActions ? (
          <div className="flex flex-wrap items-center gap-3 xl:justify-self-end">{headerActions}</div>
        ) : (
          <div className="hidden xl:block" />
        )}
      </div>

      <section className="border-b border-gray-800/80 pb-3">
        <div className="max-w-5xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[1.7rem] font-semibold text-gray-100">{title}</h1>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClassName}`}>
              {statusLabel}
            </span>
          </div>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-gray-400">{description}</p>
          ) : null}
          {scheduleLabel ? (
            <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-100">
              <Repeat className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{scheduleLabel}</span>
            </div>
          ) : null}
        </div>
        {metaRow ? <div className="mt-3 flex flex-wrap items-center gap-2">{metaRow}</div> : null}
      </section>

      {editPanel ? <div>{editPanel}</div> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">
              {t("jobs.steps", { defaultValue: "Steps" })}
            </h2>
          </div>
          {onChangeFlowDensity ? (
            <div className="inline-flex items-center gap-1 rounded-full border border-gray-800 bg-gray-900/80 p-1 text-xs">
              <button
                type="button"
                onClick={() => onChangeFlowDensity("normal")}
                className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                  !isCompact ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
              >
                {t("jobs.normalDensity", { defaultValue: "Normal" })}
              </button>
              <button
                type="button"
                onClick={() => onChangeFlowDensity("compact")}
                className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                  isCompact ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
              >
                {t("jobs.compactDensity", { defaultValue: "Compact" })}
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <div ref={flowContainerRef} className="relative min-h-[240px] pt-1">
            <KnowledgeShareCanvas
              containerRef={flowContainerRef}
              anchorElements={anchorElements}
              connections={knowledgeConnections}
            />
            {hasChildren || newStepForm || addStepCard ? (
              <div className={`relative z-10 flex flex-wrap items-start pb-3 pt-1 ${isCompact ? "gap-2.5" : "gap-4"}`}>
                {flowItems.map((child, index) => (
                  <div key={index} className="contents">
                    <div className={`${itemWidthClass} shrink-0 self-start`}>
                      {child}
                    </div>
                    {index < flowItems.length - 1 ? (
                      <div className="hidden h-12 w-8 shrink-0 items-center justify-center self-start pt-20 text-gray-500/80 lg:flex">
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-800 bg-gray-950/65">
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
                {newStepForm ? (
                  <div className={`${itemWidthClass} shrink-0 self-start`}>{newStepForm}</div>
                ) : addStepCard ? (
                  <div className={`${itemWidthClass} shrink-0 self-start`}>{addStepCard}</div>
                ) : null}
              </div>
            ) : (
              emptyState
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
