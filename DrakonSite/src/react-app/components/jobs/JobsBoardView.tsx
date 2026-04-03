import { ReactNode } from "react";
import {
  Search,
  Plus,
  Repeat,
  Clock,
  Play,
  StopCircle,
  Camera,
  Layers3,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export interface JobsBoardCardData {
  id: number;
  name: string;
  description: string;
  statusLabel: string;
  statusClassName: string;
  isLive: boolean;
  scheduleLabel: string;
  startLabel: string | null;
  endLabel: string | null;
  stepCount: number;
  targetCount: number;
  isStarting: boolean;
  isStopping: boolean;
  canStart: boolean;
  canStop: boolean;
}

interface JobsBoardViewProps {
  jobsCount: number;
  timezone: string;
  searchQuery: string;
  cards: JobsBoardCardData[];
  tabs?: ReactNode;
  secondaryAction?: ReactNode;
  onSearchChange: (value: string) => void;
  onNewJob: () => void;
  onOpenJob: (jobId: number) => void;
  onStartJob: (jobId: number) => void;
  onStopJob: (jobId: number) => void;
  onDeleteJob: (jobId: number) => void;
}

export default function JobsBoardView({
  jobsCount,
  timezone,
  searchQuery,
  cards,
  tabs,
  secondaryAction,
  onSearchChange,
  onNewJob,
  onOpenJob,
  onStartJob,
  onStopJob,
  onDeleteJob,
}: JobsBoardViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),auto,minmax(0,1fr)] xl:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-100">{t("jobs.title")}</h1>
            <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-gray-800 bg-gray-900 px-3 text-xs font-medium text-gray-300">
              {jobsCount}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-gray-400">{t("jobs.subtitle")}</p>
          <p className="mt-3 text-xs uppercase tracking-[0.22em] text-gray-500">
            {t("jobs.timezoneGlobal")}: <span className="ml-2 font-mono text-gray-300">{timezone}</span>
          </p>
        </div>
        {tabs ? <div className="xl:justify-self-center">{tabs}</div> : <div className="hidden xl:block" />}
        <div className="flex flex-col gap-3 sm:flex-row xl:justify-self-end xl:self-start">
          <label className="relative flex min-h-[44px] min-w-[260px] items-center">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className="h-4 w-4 text-gray-500" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t("jobs.searchJobs")}
              className="h-11 w-full rounded-xl border border-gray-800 bg-gray-900/80 py-2.5 pl-10 pr-4 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-3 sm:min-w-[210px]">
            <button
              type="button"
              onClick={onNewJob}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
              {t("jobs.newJob")}
            </button>
            {secondaryAction}
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-gray-800 bg-gray-900/40 px-6 py-14 text-center">
          <div className="text-lg font-semibold text-gray-200">
            {searchQuery ? t("jobs.noJobsFound") : t("jobs.noJobsDesc")}
          </div>
          {!searchQuery ? (
            <button
              type="button"
              onClick={onNewJob}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-blue-400/35 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/15"
            >
              <Plus className="h-4 w-4" />
              {t("jobs.createJob")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const canRenderStop = card.canStop || card.isStopping;

            return (
              <article
                key={card.id}
                className={`group relative flex min-h-[240px] cursor-pointer flex-col rounded-[26px] border p-4 shadow-[0_28px_90px_-60px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 ${
                  card.isLive
                    ? "border-emerald-400/35 bg-emerald-500/[0.04] shadow-[0_30px_100px_-60px_rgba(16,185,129,0.55)]"
                    : "border-gray-800/80 bg-gray-900/70 hover:border-gray-700"
                }`}
                onClick={() => onOpenJob(card.id)}
              >
                {card.isLive ? (
                  <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-emerald-400/60 opacity-90 shadow-[0_0_30px_rgba(16,185,129,0.28)] animate-pulse" />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${card.statusClassName}`}>
                      {card.statusLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1 text-xs text-gray-300">
                      <Layers3 className="h-3.5 w-3.5" />
                      {card.stepCount} {card.stepCount === 1 ? "step" : "steps"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1 text-xs text-gray-300">
                      <Camera className="h-3.5 w-3.5" />
                      {card.targetCount} {card.targetCount === 1 ? "camera" : "cameras"}
                    </span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-500 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-300" />
                </div>

                <div className="mt-4 flex-1">
                  <h2 className="text-xl font-semibold text-gray-100">{card.name}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-5 text-gray-400">
                    {card.description || t("jobs.descriptionPlaceholder")}
                  </p>
                </div>

                <div className="mt-5 border-t border-gray-800/80 pt-3">
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <Repeat className="h-4 w-4 text-gray-500" />
                    <span className="truncate">{card.scheduleLabel}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1.5 text-xs text-gray-200">
                      <Clock className="h-3.5 w-3.5 text-gray-500" />
                      <span>{card.startLabel || "--"}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1.5 text-xs text-gray-200">
                      <Clock className="h-3.5 w-3.5 text-gray-500" />
                      <span>{card.endLabel || "--"}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {canRenderStop ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onStopJob(card.id);
                        }}
                        disabled={card.isStopping}
                        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
                          card.isStopping
                            ? "cursor-not-allowed bg-gray-800 text-gray-500"
                            : "bg-red-500/12 text-red-300 hover:bg-red-500/18"
                        }`}
                      >
                        <StopCircle className="h-4 w-4" />
                        {t("dashboard.stop")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onStartJob(card.id);
                        }}
                        disabled={!card.canStart || card.isStarting}
                        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
                          !card.canStart || card.isStarting
                            ? "cursor-not-allowed bg-gray-800 text-gray-500"
                            : "bg-emerald-600 text-white hover:bg-emerald-500"
                        }`}
                      >
                        <Play className="h-4 w-4" />
                        {card.isStarting ? t("jobs.starting", { defaultValue: "Starting" }) : t("dashboard.start")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteJob(card.id);
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                      title={t("jobs.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-sm font-medium text-blue-200">{t("jobs.open")}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
