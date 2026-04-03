import { ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import ScheduleBuilder from "@/react-app/components/ScheduleBuilder";
import { ScheduleDay, ScheduleMode, getDefaultScheduleDays } from "@/react-app/utils/scheduleUtils";

interface JobCreateViewProps {
  tabs?: ReactNode;
  name: string;
  description: string;
  timezone: string;
  scheduleVisible: boolean;
  scheduleMode: ScheduleMode;
  scheduleDays: ScheduleDay[];
  activeFrom: string;
  activeUntil: string;
  onBack: () => void;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onScheduleVisibilityChange: (visible: boolean) => void;
  onModeChange: (mode: ScheduleMode) => void;
  onScheduleDaysChange: (days: ScheduleDay[]) => void;
  onActiveFromChange: (value: string) => void;
  onActiveUntilChange: (value: string) => void;
}

export default function JobCreateView({
  tabs,
  name,
  description,
  timezone,
  scheduleVisible,
  scheduleMode,
  scheduleDays,
  activeFrom,
  activeUntil,
  onBack,
  onClose,
  onSubmit,
  onNameChange,
  onDescriptionChange,
  onScheduleVisibilityChange,
  onModeChange,
  onScheduleDaysChange,
  onActiveFromChange,
  onActiveUntilChange,
}: JobCreateViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
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
          <span className="truncate text-gray-100">
            {t("jobs.tabCreateLabel", { defaultValue: "Criar Job" })}
          </span>
        </div>
        {tabs ? <div className="xl:justify-self-center">{tabs}</div> : <div className="hidden xl:block" />}
        <div className="hidden xl:block" />
      </div>

      <div className="mx-auto max-w-3xl rounded-[30px] border border-gray-800/80 bg-gray-900/78 shadow-[0_42px_120px_-72px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between border-b border-gray-800/80 px-6 py-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.26em] text-gray-500">
              {t("jobs.newJob")}
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-gray-100">
              {t("jobs.createJob", { defaultValue: "Create New Job" })}
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-gray-500">
              {t("jobs.jobName")} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t("jobs.jobNamePlaceholder")}
              className="w-full rounded-[20px] border border-gray-800 bg-gray-950/75 px-4 py-3 text-xl text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-gray-500">
              {t("jobs.description")}
            </label>
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder={t("jobs.descriptionPlaceholder")}
              rows={4}
              className="w-full rounded-[20px] border border-gray-800 bg-gray-950/75 px-4 py-3 text-sm leading-6 text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="rounded-[24px] border border-gray-800/80 bg-gray-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-gray-500">
                  {t("jobs.scheduleConfiguration")}
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  {t("jobs.scheduleOptional", { defaultValue: "Optional" })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onScheduleVisibilityChange(!scheduleVisible)}
                className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/15"
              >
                {scheduleVisible ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {scheduleVisible
                  ? t("jobs.hideSchedule", { defaultValue: "Hide schedule" })
                  : t("jobs.showSchedule", { defaultValue: "Open schedule" })}
              </button>
            </div>

            <div className="mt-4 rounded-[22px] border border-gray-800/80 bg-gray-900/80 p-4">
              {scheduleVisible ? (
                <ScheduleBuilder
                  mode={scheduleMode}
                  scheduleDays={scheduleDays}
                  onModeChange={(mode) => {
                    onModeChange(mode);
                    onScheduleDaysChange(getDefaultScheduleDays(mode));
                  }}
                  onScheduleDaysChange={onScheduleDaysChange}
                  activeFrom={activeFrom}
                  activeUntil={activeUntil}
                  onActiveFromChange={onActiveFromChange}
                  onActiveUntilChange={onActiveUntilChange}
                />
              ) : (
                <div className="rounded-[20px] border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">
                  {t("jobs.scheduleHiddenHint", {
                    defaultValue: "Open the schedule to define weekly, monthly, or yearly windows.",
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[20px] border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3.5">
            <div className="text-xs uppercase tracking-[0.22em] text-blue-100/60">
              {t("jobs.timezoneGlobal")}
            </div>
            <div className="mt-2 font-mono text-sm text-blue-100">{timezone}</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-800/80 bg-gray-900/90 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-700 hover:text-gray-100"
          >
            {t("jobs.cancel")}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            {t("jobs.createJob")}
          </button>
        </div>
      </div>
    </div>
  );
}
