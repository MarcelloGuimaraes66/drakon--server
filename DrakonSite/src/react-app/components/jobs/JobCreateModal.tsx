import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import ScheduleBuilder from "@/react-app/components/ScheduleBuilder";
import { ScheduleDay, ScheduleMode, getDefaultScheduleDays } from "@/react-app/utils/scheduleUtils";

interface JobCreateModalProps {
  isOpen: boolean;
  name: string;
  description: string;
  timezone: string;
  scheduleVisible: boolean;
  scheduleMode: ScheduleMode;
  scheduleDays: ScheduleDay[];
  activeFrom: string;
  activeUntil: string;
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

export default function JobCreateModal({
  isOpen,
  name,
  description,
  timezone,
  scheduleVisible,
  scheduleMode,
  scheduleDays,
  activeFrom,
  activeUntil,
  onClose,
  onSubmit,
  onNameChange,
  onDescriptionChange,
  onScheduleVisibilityChange,
  onModeChange,
  onScheduleDaysChange,
  onActiveFromChange,
  onActiveUntilChange,
}: JobCreateModalProps) {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t("jobs.closeCreateJob", { defaultValue: "Close create job modal" })}
      />
      <div className="relative max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[32px] border border-gray-800/80 bg-gray-900 text-gray-100 shadow-[0_40px_120px_-50px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between border-b border-gray-800/80 px-6 py-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-gray-500">{t("jobs.newJob")}</div>
            <h2 className="mt-1 text-3xl font-semibold text-gray-100">{t("jobs.createJob")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
            <div className="space-y-5">
              <div className="rounded-[28px] border border-gray-800/80 bg-gray-950/60 p-5">
                <label className="block text-xs uppercase tracking-[0.22em] text-gray-500">
                  {t("jobs.jobName")}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder={t("jobs.jobNamePlaceholder")}
                  className="mt-3 w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-lg text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                />
                <label className="mt-5 block text-xs uppercase tracking-[0.22em] text-gray-500">
                  {t("jobs.description")}
                </label>
                <textarea
                  value={description}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  placeholder={t("jobs.descriptionPlaceholder")}
                  rows={5}
                  className="mt-3 w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm leading-6 text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-[28px] border border-blue-500/15 bg-blue-500/[0.04] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-blue-200/70">
                  {t("jobs.timezoneGlobal")}
                </div>
                <div className="mt-2 font-mono text-sm text-blue-100">{timezone}</div>
                <p className="mt-3 text-sm text-blue-100/75">
                  {t("jobs.scheduleBuilder.summaryTitle", { defaultValue: "Schedule" })}
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-gray-800/80 bg-gray-950/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-gray-500">
                    {t("jobs.scheduleConfiguration")}
                  </div>
                  <p className="mt-2 text-sm text-gray-400">
                    {t("jobs.scheduleBuilder.configureSelectedDays", {
                      defaultValue: "Configure how this job should run.",
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onScheduleVisibilityChange(!scheduleVisible)}
                  className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/15"
                >
                  {scheduleVisible ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {scheduleVisible
                    ? t("jobs.hideSchedule", { defaultValue: "Hide schedule" })
                    : t("jobs.showSchedule", { defaultValue: "Open schedule" })}
                </button>
              </div>

              {scheduleVisible ? (
                <div className="mt-5 rounded-[24px] border border-gray-800/80 bg-gray-900/80 p-4">
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
                </div>
              ) : (
                <div className="mt-5 rounded-[24px] border border-dashed border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-500">
                  {t("jobs.scheduleHiddenHint", {
                    defaultValue: "Open the schedule to define weekly, monthly, or yearly windows.",
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-800/80 bg-gray-900/90 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-gray-800 bg-gray-950/60 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-700 hover:text-gray-100"
          >
            {t("jobs.cancel")}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            {t("jobs.createJob")}
          </button>
        </div>
      </div>
    </div>
  );
}
