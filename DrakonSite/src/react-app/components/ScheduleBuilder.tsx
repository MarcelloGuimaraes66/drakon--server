import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X, Clock, Calendar, CalendarDays } from "lucide-react";
import {
  ScheduleMode,
  ScheduleDay,
  TimeWindow,
  RepeatedTimeUnit,
  buildRepeatedTimeWindows,
  normalizeTimeToHHMMSS,
  parseTimeToSeconds,
  validateTimeWindow,
  timeWindowsOverlap,
  createWeeklyDay,
  createMonthlyDay,
  createYearlyDay,
} from "@/react-app/utils/scheduleUtils";

interface ScheduleBuilderProps {
  mode: ScheduleMode;
  scheduleDays: ScheduleDay[];
  onModeChange: (mode: ScheduleMode) => void;
  onScheduleDaysChange: (days: ScheduleDay[]) => void;
  activeFrom?: string;
  activeUntil?: string;
  onActiveFromChange?: (value: string) => void;
  onActiveUntilChange?: (value: string) => void;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function getDaysInMonth(month: number): number {
  const daysPerMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysPerMonth[month - 1] || 31;
}

function getLocaleTag(language: string): string {
  return (language || "en").replace("_", "-");
}

function formatWeekdayName(dayOfWeek: number, locale: string): string {
  const baseDate = new Date(Date.UTC(2024, 0, 7 + dayOfWeek));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(baseDate);
  } catch {
    return new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(baseDate);
  }
}

function formatMonthName(month: number, locale: string): string {
  const date = new Date(Date.UTC(2024, month - 1, 1));
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(date);
  }
}

function formatMonthDay(month: number, day: number, locale: string): string {
  const date = new Date(Date.UTC(2024, Math.max(0, month - 1), Math.max(1, day)));
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  }
}

function formatDayOfMonth(day: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(day);
  } catch {
    return String(day);
  }
}

function normalizeWindowError(error: string | null, t: (key: string, options?: any) => string): string {
  if (!error) return "";
  const normalized = error.toLowerCase();
  if (normalized.includes("start time must be before end time")) {
    return t("jobs.scheduleBuilder.startBeforeEnd", { defaultValue: "Start time must be before end time" });
  }
  if (normalized.includes("invalid")) {
    return t("jobs.scheduleBuilder.invalidTimeFormat", { defaultValue: "Invalid time format" });
  }
  return error;
}

const TIME_FALLBACK = "00:00:00";
const DEFAULT_WINDOW: TimeWindow = { start_time: "09:00:00", end_time: "17:00:00" };
const DEFAULT_REPEATED_WINDOW_DRAFT = {
  start_time: "09:00:00",
  duration_value: 30,
  duration_unit: "minutes" as RepeatedTimeUnit,
  repeat_value: 30,
  repeat_unit: "minutes" as RepeatedTimeUnit,
  occurrence_count: 4,
};
const COLLAPSED_WINDOW_COUNT = 4;

type RepeatedWindowDraft = typeof DEFAULT_REPEATED_WINDOW_DRAFT;

function parseTimeParts(value: string): { hours: number; minutes: number; seconds: number } {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ""));
  if (!match) return { hours: 0, minutes: 0, seconds: 0 };
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  return {
    hours: Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 0,
    minutes: Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0,
    seconds: Number.isFinite(seconds) ? Math.min(59, Math.max(0, seconds)) : 0,
  };
}

function toHHMMSS(hours: number, minutes: number, seconds: number): string {
  const safeHours = Math.min(23, Math.max(0, Math.floor(hours)));
  const safeMinutes = Math.min(59, Math.max(0, Math.floor(minutes)));
  const safeSeconds = Math.min(59, Math.max(0, Math.floor(seconds)));
  return `${String(safeHours).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}:${String(safeSeconds).padStart(2, "0")}`;
}

function sanitizeTimePart(raw: string, max: number, fallback: number): number {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 2);
  if (!digits) return fallback;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

function sortWindowsByStartTime(windows: TimeWindow[]): TimeWindow[] {
  return [...windows].sort((left, right) => {
    const leftStart = parseTimeToSeconds(left.start_time) ?? 0;
    const rightStart = parseTimeToSeconds(right.start_time) ?? 0;
    const leftEnd = parseTimeToSeconds(left.end_time) ?? 0;
    const rightEnd = parseTimeToSeconds(right.end_time) ?? 0;
    return leftStart - rightStart || leftEnd - rightEnd;
  });
}

function sortWindowEntriesByStartTime(windows: TimeWindow[]): Array<{ window: TimeWindow; index: number }> {
  return windows
    .map((window, index) => ({ window, index }))
    .sort((left, right) => {
      const leftStart = parseTimeToSeconds(left.window.start_time) ?? 0;
      const rightStart = parseTimeToSeconds(right.window.start_time) ?? 0;
      const leftEnd = parseTimeToSeconds(left.window.end_time) ?? 0;
      const rightEnd = parseTimeToSeconds(right.window.end_time) ?? 0;
      return leftStart - rightStart || leftEnd - rightEnd || left.index - right.index;
    });
}

function normalizeWindowLabel(time: string): string {
  const normalized = normalizeTimeToHHMMSS(time) || TIME_FALLBACK;
  return normalized.endsWith(":00") ? normalized.slice(0, 5) : normalized;
}

function formatWindowLabel(window: TimeWindow): string {
  return `${normalizeWindowLabel(window.start_time)} -> ${normalizeWindowLabel(window.end_time)}`;
}

function isDefaultSingleWindow(windows: TimeWindow[]): boolean {
  if (windows.length !== 1) return false;
  const [window] = windows;
  return (
    normalizeTimeToHHMMSS(window?.start_time || "") === DEFAULT_WINDOW.start_time &&
    normalizeTimeToHHMMSS(window?.end_time || "") === DEFAULT_WINDOW.end_time
  );
}

function secondsToRepeatedTimeDraft(totalSeconds: number): { value: number; unit: RepeatedTimeUnit } {
  if (totalSeconds > 0 && totalSeconds % 3600 === 0) {
    return { value: Math.max(1, totalSeconds / 3600), unit: "hours" };
  }
  return { value: Math.max(1, Math.round(totalSeconds / 60)), unit: "minutes" };
}

function buildRepeatedWindowDraftFromWindows(windows: TimeWindow[]): RepeatedWindowDraft {
  if (!Array.isArray(windows) || windows.length === 0 || isDefaultSingleWindow(windows)) {
    return { ...DEFAULT_REPEATED_WINDOW_DRAFT };
  }

  const orderedWindows = sortWindowsByStartTime(windows);
  const [firstWindow, secondWindow] = orderedWindows;
  const firstStartSeconds = parseTimeToSeconds(firstWindow?.start_time || "");
  const firstEndSeconds = parseTimeToSeconds(firstWindow?.end_time || "");
  if (firstStartSeconds === null || firstEndSeconds === null || firstEndSeconds <= firstStartSeconds) {
    return { ...DEFAULT_REPEATED_WINDOW_DRAFT, occurrence_count: Math.max(1, windows.length) };
  }

  const durationDraft = secondsToRepeatedTimeDraft(firstEndSeconds - firstStartSeconds);
  let repeatSeconds = firstEndSeconds - firstStartSeconds;
  const secondStartSeconds = parseTimeToSeconds(secondWindow?.start_time || "");
  if (secondStartSeconds !== null && secondStartSeconds > firstStartSeconds) {
    repeatSeconds = secondStartSeconds - firstStartSeconds;
  }
  const repeatDraft = secondsToRepeatedTimeDraft(repeatSeconds);

  return {
    start_time: normalizeTimeToHHMMSS(firstWindow.start_time) || DEFAULT_REPEATED_WINDOW_DRAFT.start_time,
    duration_value: durationDraft.value,
    duration_unit: durationDraft.unit,
    repeat_value: repeatDraft.value,
    repeat_unit: repeatDraft.unit,
    occurrence_count: Math.max(1, windows.length),
  };
}

function getInlineScheduleBuilderCopy(language: string) {
  if (String(language || "").toLowerCase().startsWith("pt")) {
    return {
      generateSequence: "Gerar sequencia",
      hideSequence: "Ocultar sequencia",
      showAllWindows: "Mostrar todas {{count}} janelas",
      showFewerWindows: "Mostrar menos janelas",
      duration: "Duracao",
      occurrences: "Quantidade",
      sequenceSummary: "{{count}} janelas de {{start}} ate {{end}}.",
      sequenceReplaceHint:
        "Aplicar a sequencia substitui as janelas atuais deste dia. Depois voce pode editar cada uma.",
      applySequence: "Aplicar sequencia",
      previewMore: " +{{count}} a mais",
    };
  }

  return {
    generateSequence: "Generate sequence",
    hideSequence: "Hide sequence",
    showAllWindows: "Show all {{count}} windows",
    showFewerWindows: "Show fewer windows",
    duration: "Duration",
    occurrences: "Occurrences",
    sequenceSummary: "{{count}} windows from {{start}} to {{end}}.",
    sequenceReplaceHint:
      "Apply sequence replaces this day's current windows. You can edit each window afterwards.",
    applySequence: "Apply sequence",
    previewMore: " +{{count}} more",
  };
}

function TimeInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  ariaLabel: string;
}) {
  const { hours, minutes, seconds } = parseTimeParts(value || TIME_FALLBACK);
  const [hourDraft, setHourDraft] = useState(String(hours).padStart(2, "0"));
  const [minuteDraft, setMinuteDraft] = useState(String(minutes).padStart(2, "0"));
  const [secondDraft, setSecondDraft] = useState(String(seconds).padStart(2, "0"));
  const hourInputRef = useRef<HTMLInputElement | null>(null);
  const minuteInputRef = useRef<HTMLInputElement | null>(null);
  const secondInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHourDraft(String(hours).padStart(2, "0"));
    setMinuteDraft(String(minutes).padStart(2, "0"));
    setSecondDraft(String(seconds).padStart(2, "0"));
  }, [hours, minutes, seconds]);

  const commitValue = (nextHourRaw: string, nextMinuteRaw: string, nextSecondRaw: string) => {
    const nextHour = sanitizeTimePart(nextHourRaw, 23, hours);
    const nextMinute = sanitizeTimePart(nextMinuteRaw, 59, minutes);
    const nextSecond = sanitizeTimePart(nextSecondRaw, 59, seconds);
    const normalizedHour = String(nextHour).padStart(2, "0");
    const normalizedMinute = String(nextMinute).padStart(2, "0");
    const normalizedSecond = String(nextSecond).padStart(2, "0");
    setHourDraft(normalizedHour);
    setMinuteDraft(normalizedMinute);
    setSecondDraft(normalizedSecond);
    const normalizedValue = toHHMMSS(nextHour, nextMinute, nextSecond);
    if (normalizedValue !== value) {
      onChange(normalizedValue);
    }
  };

  const normalizeDraft = (raw: string) => String(raw || "").replace(/\D/g, "").slice(0, 2);

  const focusMinuteInput = () => {
    requestAnimationFrame(() => {
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    });
  };

  const focusSecondInput = () => {
    requestAnimationFrame(() => {
      secondInputRef.current?.focus();
      secondInputRef.current?.select();
    });
  };

  return (
    <div className="flex items-center gap-1 rounded border border-gray-600 bg-gray-700 px-2 py-1">
      <input
        ref={hourInputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={hourDraft}
        onChange={(e) => {
          const nextHourRaw = normalizeDraft(e.target.value);
          setHourDraft(nextHourRaw);
          if (nextHourRaw.length === 2) {
            commitValue(nextHourRaw, minuteDraft, secondDraft);
            focusMinuteInput();
          }
        }}
        onBlur={() => commitValue(hourDraft, minuteDraft, secondDraft)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitValue(hourDraft, minuteDraft, secondDraft);
          }
        }}
        className="w-7 bg-transparent text-center text-sm text-gray-200 focus:outline-none"
        aria-label={`${ariaLabel} hour`}
      />
      <span className="text-sm text-gray-500">:</span>
      <input
        ref={minuteInputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={minuteDraft}
        onChange={(e) => {
          const nextMinuteRaw = normalizeDraft(e.target.value);
          setMinuteDraft(nextMinuteRaw);
          if (nextMinuteRaw.length === 2) {
            commitValue(hourDraft, nextMinuteRaw, secondDraft);
            focusSecondInput();
          }
        }}
        onBlur={() => commitValue(hourDraft, minuteDraft, secondDraft)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitValue(hourDraft, minuteDraft, secondDraft);
          }
        }}
        className="w-7 bg-transparent text-center text-sm text-gray-200 focus:outline-none"
        aria-label={`${ariaLabel} minute`}
      />
      <span className="text-sm text-gray-500">:</span>
      <input
        ref={secondInputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={secondDraft}
        onChange={(e) => {
          const nextSecondRaw = normalizeDraft(e.target.value);
          setSecondDraft(nextSecondRaw);
          if (nextSecondRaw.length === 2) {
            commitValue(hourDraft, minuteDraft, nextSecondRaw);
          }
        }}
        onBlur={() => commitValue(hourDraft, minuteDraft, secondDraft)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitValue(hourDraft, minuteDraft, secondDraft);
          }
        }}
        className="w-7 bg-transparent text-center text-sm text-gray-200 focus:outline-none"
        aria-label={`${ariaLabel} second`}
      />
    </div>
  );
}

export default function ScheduleBuilder({
  mode,
  scheduleDays,
  onModeChange,
  onScheduleDaysChange,
  activeFrom,
  activeUntil,
  onActiveFromChange,
  onActiveUntilChange,
}: ScheduleBuilderProps) {
  const { t, i18n } = useTranslation();
  const locale = useMemo(
    () => getLocaleTag(i18n.resolvedLanguage || i18n.language || "en"),
    [i18n.resolvedLanguage, i18n.language]
  );

  const weekdays = useMemo(
    () =>
      WEEKDAY_ORDER.map((dayOfWeek) => ({
        dayOfWeek,
        name: formatWeekdayName(dayOfWeek, locale),
      })),
    [locale]
  );

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        value: index + 1,
        name: formatMonthName(index + 1, locale),
      })),
    [locale]
  );

  const isWeekdayEnabled = (dayOfWeek: number) => {
    return scheduleDays.some((d) => d.day_of_week === dayOfWeek);
  };

  const toggleWeekday = (dayOfWeek: number) => {
    if (isWeekdayEnabled(dayOfWeek)) {
      onScheduleDaysChange(scheduleDays.filter((d) => d.day_of_week !== dayOfWeek));
    } else {
      const newDay = createWeeklyDay(dayOfWeek, [{ ...DEFAULT_WINDOW }]);
      onScheduleDaysChange(
        [...scheduleDays, newDay].sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0))
      );
    }
  };

  const isMonthDayEnabled = (dayOfMonth: number) => {
    return scheduleDays.some((d) => d.day_of_month === dayOfMonth);
  };

  const toggleMonthDay = (dayOfMonth: number) => {
    if (isMonthDayEnabled(dayOfMonth)) {
      onScheduleDaysChange(scheduleDays.filter((d) => d.day_of_month !== dayOfMonth));
    } else {
      const newDay = createMonthlyDay(dayOfMonth);
      newDay.windows = [{ ...DEFAULT_WINDOW }];
      onScheduleDaysChange(
        [...scheduleDays, newDay].sort((a, b) => (a.day_of_month ?? 0) - (b.day_of_month ?? 0))
      );
    }
  };

  const findYearlyDay = (month: number, day: number) => {
    return scheduleDays.find((d) => d.month_of_year === month && d.day_of_month === day);
  };

  const addYearlyDate = (month: number, day: number) => {
    if (findYearlyDay(month, day)) return;
    const newDay = createYearlyDay(month, day);
    newDay.windows = [{ ...DEFAULT_WINDOW }];
    onScheduleDaysChange(
      [...scheduleDays, newDay].sort((a, b) => {
        const monthDiff = (a.month_of_year ?? 0) - (b.month_of_year ?? 0);
        if (monthDiff !== 0) return monthDiff;
        return (a.day_of_month ?? 0) - (b.day_of_month ?? 0);
      })
    );
  };

  const removeYearlyDate = (month: number, day: number) => {
    onScheduleDaysChange(scheduleDays.filter((d) => !(d.month_of_year === month && d.day_of_month === day)));
  };

  const updateDayWindows = (dayIndex: number, windows: TimeWindow[]) => {
    const newDays = [...scheduleDays];
    newDays[dayIndex] = { ...newDays[dayIndex], windows };
    onScheduleDaysChange(newDays);
  };

  const addWindow = (dayIndex: number) => {
    const day = scheduleDays[dayIndex];
    updateDayWindows(dayIndex, [...day.windows, { ...DEFAULT_WINDOW }]);
  };

  const updateWindow = (
    dayIndex: number,
    windowIndex: number,
    field: "start_time" | "end_time",
    value: string
  ) => {
    const day = scheduleDays[dayIndex];
    const newWindows = [...day.windows];
    newWindows[windowIndex] = { ...newWindows[windowIndex], [field]: value };
    updateDayWindows(dayIndex, newWindows);
  };

  const removeWindow = (dayIndex: number, windowIndex: number) => {
    const day = scheduleDays[dayIndex];
    updateDayWindows(dayIndex, day.windows.filter((_, i) => i !== windowIndex));
  };

  const handleModeChange = (newMode: ScheduleMode) => {
    onModeChange(newMode);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["weekly", "monthly", "yearly"] as ScheduleMode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
            }`}
          >
            {m === "weekly" ? t("jobs.weekly") : m === "monthly" ? t("jobs.monthly") : t("jobs.yearly")}
          </button>
        ))}
      </div>

      {mode === "weekly" && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400 mb-3">{t("jobs.scheduleBuilder.selectWeekDays")}</p>
          {weekdays.map(({ dayOfWeek, name }) => {
            const enabled = isWeekdayEnabled(dayOfWeek);
            const dayIndex = scheduleDays.findIndex((d) => d.day_of_week === dayOfWeek);
            const day = dayIndex >= 0 ? scheduleDays[dayIndex] : null;

            return (
              <DayCard
                key={dayOfWeek}
                label={name}
                enabled={enabled}
                onToggle={() => toggleWeekday(dayOfWeek)}
                windows={day?.windows || []}
                onAddWindow={() => addWindow(dayIndex)}
                onReplaceWindows={(nextWindows) => updateDayWindows(dayIndex, nextWindows)}
                onUpdateWindow={(wi, field, val) => updateWindow(dayIndex, wi, field, val)}
                onRemoveWindow={(wi) => removeWindow(dayIndex, wi)}
              />
            );
          })}
        </div>
      )}

      {mode === "monthly" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t("jobs.scheduleBuilder.selectMonthDays")}</p>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
              const enabled = isMonthDayEnabled(day);
              return (
                <button
                  key={day}
                  onClick={() => toggleMonthDay(day)}
                  className={`p-2 text-sm rounded transition-colors ${
                    enabled ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {scheduleDays.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-sm text-gray-400">{t("jobs.scheduleBuilder.configureSelectedDays")}</p>
              {scheduleDays.map((day, dayIndex) => (
                <DayCard
                  key={day.day_of_month}
                  label={t("jobs.scheduleBuilder.dayLabel", { day: day.day_of_month })}
                  enabled={true}
                  onToggle={() => toggleMonthDay(day.day_of_month!)}
                  windows={day.windows}
                  onAddWindow={() => addWindow(dayIndex)}
                  onReplaceWindows={(nextWindows) => updateDayWindows(dayIndex, nextWindows)}
                  onUpdateWindow={(wi, field, val) => updateWindow(dayIndex, wi, field, val)}
                  onRemoveWindow={(wi) => removeWindow(dayIndex, wi)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "yearly" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t("jobs.scheduleBuilder.addSpecificDates")}</p>

          <YearlyDatePicker selectedDates={scheduleDays} onAddDate={addYearlyDate} months={months} locale={locale} />

          {scheduleDays.length > 0 && (
            <div className="space-y-2">
              {scheduleDays.map((day, dayIndex) => (
                <DayCard
                  key={`${day.month_of_year}-${day.day_of_month}`}
                  label={
                    day.month_of_year && day.day_of_month
                      ? formatMonthDay(day.month_of_year, day.day_of_month, locale)
                      : day.day_name
                  }
                  enabled={true}
                  onToggle={() => removeYearlyDate(day.month_of_year!, day.day_of_month!)}
                  windows={day.windows}
                  onAddWindow={() => addWindow(dayIndex)}
                  onReplaceWindows={(nextWindows) => updateDayWindows(dayIndex, nextWindows)}
                  onUpdateWindow={(wi, field, val) => updateWindow(dayIndex, wi, field, val)}
                  onRemoveWindow={(wi) => removeWindow(dayIndex, wi)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {(onActiveFromChange || onActiveUntilChange) && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-4">
          <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {t("jobs.scheduleBuilder.activeDateRange")}
          </h4>
          <p className="text-xs text-gray-500">{t("jobs.scheduleBuilder.activeDateRangeDesc")}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("jobs.scheduleBuilder.activeFrom")}</label>
              <input
                type="date"
                value={activeFrom || ""}
                onChange={(e) => onActiveFromChange?.(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("jobs.scheduleBuilder.activeUntil")}</label>
              <input
                type="date"
                value={activeUntil || ""}
                onChange={(e) => onActiveUntilChange?.(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {activeFrom && activeUntil && new Date(activeFrom) > new Date(activeUntil) && (
            <p className="text-xs text-red-400">{t("jobs.scheduleBuilder.activeRangeInvalid")}</p>
          )}
        </div>
      )}

      <ScheduleSummary mode={mode} scheduleDays={scheduleDays} activeFrom={activeFrom} activeUntil={activeUntil} locale={locale} />
    </div>
  );
}

function DayCard({
  label,
  enabled,
  onToggle,
  windows,
  onAddWindow,
  onReplaceWindows,
  onUpdateWindow,
  onRemoveWindow,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  windows: TimeWindow[];
  onAddWindow: () => void;
  onReplaceWindows: (windows: TimeWindow[]) => void;
  onUpdateWindow: (windowIndex: number, field: "start_time" | "end_time", value: string) => void;
  onRemoveWindow: (windowIndex: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const hasError = enabled && windows.length === 0;
  const inlineCopy = useMemo(
    () => getInlineScheduleBuilderCopy(i18n.resolvedLanguage || i18n.language || "en"),
    [i18n.language, i18n.resolvedLanguage]
  );
  const [isSequenceBuilderVisible, setIsSequenceBuilderVisible] = useState(false);
  const [showAllWindows, setShowAllWindows] = useState(false);
  const [repeatedWindowDraft, setRepeatedWindowDraft] = useState<RepeatedWindowDraft>(() =>
    buildRepeatedWindowDraftFromWindows(windows)
  );
  const hasWindowIssues = useMemo(
    () =>
      windows.some((window, windowIndex) => {
        if (validateTimeWindow(window)) return true;
        return windows.some((otherWindow, otherIndex) => {
          if (windowIndex === otherIndex) return false;
          return timeWindowsOverlap(window, otherWindow);
        });
      }),
    [windows]
  );
  const generatedSequence = useMemo(
    () => buildRepeatedTimeWindows(repeatedWindowDraft),
    [repeatedWindowDraft]
  );
  const orderedWindows = useMemo(() => sortWindowEntriesByStartTime(windows), [windows]);
  const visibleWindows =
    showAllWindows || hasWindowIssues || orderedWindows.length <= COLLAPSED_WINDOW_COUNT
      ? orderedWindows
      : orderedWindows.slice(0, COLLAPSED_WINDOW_COUNT);

  useEffect(() => {
    if (orderedWindows.length <= COLLAPSED_WINDOW_COUNT || hasWindowIssues) {
      setShowAllWindows(false);
    }
  }, [hasWindowIssues, orderedWindows.length]);

  const toggleSequenceBuilder = () => {
    setIsSequenceBuilderVisible((current) => {
      const next = !current;
      if (next) {
        setRepeatedWindowDraft(buildRepeatedWindowDraftFromWindows(windows));
      }
      return next;
    });
  };

  const handleApplySequence = () => {
    if ("error" in generatedSequence) return;
    onReplaceWindows(generatedSequence.windows);
    setShowAllWindows(false);
    setIsSequenceBuilderVisible(false);
  };

  return (
    <div className={`border rounded-lg ${enabled ? "border-blue-600 bg-blue-600/5" : "border-gray-700 bg-gray-800/30"}`}>
      <div className="flex items-center justify-between p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggle}
            className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
          <span className={`font-medium ${enabled ? "text-gray-200" : "text-gray-500"}`}>{label}</span>
          {hasError && <span className="text-xs text-red-400">{t("jobs.scheduleBuilder.addAtLeastOneWindow")}</span>}
        </label>
        {enabled && (
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSequenceBuilder}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              {isSequenceBuilderVisible
                ? t("jobs.scheduleBuilder.hideSequence", { defaultValue: inlineCopy.hideSequence })
                : t("jobs.scheduleBuilder.generateSequence", { defaultValue: inlineCopy.generateSequence })}
            </button>
            <button onClick={onAddWindow} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {t("jobs.scheduleBuilder.addWindow")}
            </button>
          </div>
        )}
      </div>

      {enabled && isSequenceBuilderVisible && (
        <RepeatedWindowBuilder
          draft={repeatedWindowDraft}
          onDraftChange={setRepeatedWindowDraft}
          result={generatedSequence}
          onApply={handleApplySequence}
        />
      )}

      {enabled && windows.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {visibleWindows.map(({ window, index: resolvedWindowIndex }) => {
            const error = validateTimeWindow(window);
            const hasOverlap = windows.some(
              (w, i) => i !== resolvedWindowIndex && timeWindowsOverlap(window, w)
            );
            const translatedError = normalizeWindowError(error, t);

            return (
              <div key={`${window.start_time}-${window.end_time}-${resolvedWindowIndex}`} className="flex items-center gap-2 bg-gray-800/50 p-2 rounded">
                <Clock className="w-3.5 h-3.5 text-gray-500" />
                <TimeInput
                  value={window.start_time}
                  onChange={(nextValue) => onUpdateWindow(resolvedWindowIndex, "start_time", nextValue)}
                  ariaLabel={t("jobs.startTime")}
                />
                <span className="text-gray-500">-&gt;</span>
                <TimeInput
                  value={window.end_time}
                  onChange={(nextValue) => onUpdateWindow(resolvedWindowIndex, "end_time", nextValue)}
                  ariaLabel={t("jobs.endTime")}
                />
                <button onClick={() => onRemoveWindow(resolvedWindowIndex)} className="ml-auto text-gray-500 hover:text-red-400">
                  <X className="w-3.5 h-3.5" />
                </button>
                {(error || hasOverlap) && (
                  <span className="text-xs text-red-400 ml-2">
                    {hasOverlap ? t("jobs.scheduleBuilder.overlapWindow") : translatedError}
                  </span>
                )}
              </div>
            );
          })}
          {orderedWindows.length > COLLAPSED_WINDOW_COUNT && !hasWindowIssues && (
            <button
              onClick={() => setShowAllWindows((current) => !current)}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              {showAllWindows
                ? t("jobs.scheduleBuilder.showFewerWindows", { defaultValue: inlineCopy.showFewerWindows })
                : t("jobs.scheduleBuilder.showAllWindows", {
                    count: orderedWindows.length,
                    defaultValue: inlineCopy.showAllWindows,
                  })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RepeatedWindowBuilder({
  draft,
  onDraftChange,
  result,
  onApply,
}: {
  draft: RepeatedWindowDraft;
  onDraftChange: Dispatch<SetStateAction<RepeatedWindowDraft>>;
  result: ReturnType<typeof buildRepeatedTimeWindows>;
  onApply: () => void;
}) {
  const { t, i18n } = useTranslation();
  const inlineCopy = useMemo(
    () => getInlineScheduleBuilderCopy(i18n.resolvedLanguage || i18n.language || "en"),
    [i18n.language, i18n.resolvedLanguage]
  );
  const previewWindows = "error" in result ? [] : result.windows;
  const previewLabel = previewWindows
    .slice(0, 3)
    .map((window) => formatWindowLabel(window))
    .join(", ");
  const hiddenWindowCount = Math.max(0, previewWindows.length - 3);

  const updateDraft = <K extends keyof RepeatedWindowDraft>(key: K, value: RepeatedWindowDraft[K]) => {
    onDraftChange((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="mx-3 mb-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-3">
      <div className="grid gap-3 lg:grid-cols-4">
        <div className="space-y-1">
          <label className="block text-[11px] uppercase tracking-wide text-gray-500">
            {t("jobs.startTime")}
          </label>
          <TimeInput
            value={draft.start_time}
            onChange={(nextValue) => updateDraft("start_time", nextValue)}
            ariaLabel={t("jobs.startTime")}
          />
        </div>
        <NumberUnitField
          label={t("jobs.scheduleBuilder.sequenceDuration", { defaultValue: inlineCopy.duration })}
          value={draft.duration_value}
          unit={draft.duration_unit}
          onValueChange={(nextValue) => updateDraft("duration_value", nextValue)}
          onUnitChange={(nextUnit) => updateDraft("duration_unit", nextUnit)}
        />
        <NumberUnitField
          label={t("jobs.runEvery")}
          value={draft.repeat_value}
          unit={draft.repeat_unit}
          onValueChange={(nextValue) => updateDraft("repeat_value", nextValue)}
          onUnitChange={(nextUnit) => updateDraft("repeat_unit", nextUnit)}
        />
        <div className="space-y-1">
          <label className="block text-[11px] uppercase tracking-wide text-gray-500">
            {t("jobs.scheduleBuilder.sequenceOccurrences", { defaultValue: inlineCopy.occurrences })}
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={draft.occurrence_count}
            onChange={(e) => updateDraft("occurrence_count", Number.parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
        {"error" in result ? (
          <p className="text-xs text-red-400">{result.error}</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-gray-400">
              {t("jobs.scheduleBuilder.sequenceSummary", {
                count: previewWindows.length,
                start: normalizeWindowLabel(result.first_start_time),
                end: normalizeWindowLabel(result.last_end_time),
                defaultValue: inlineCopy.sequenceSummary,
              })}
            </p>
            <p className="text-xs text-gray-500">
              {previewLabel}
              {hiddenWindowCount > 0
                ? t("jobs.scheduleBuilder.previewMore", {
                    count: hiddenWindowCount,
                    defaultValue: inlineCopy.previewMore,
                  })
                : ""}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {t("jobs.scheduleBuilder.sequenceReplaceHint", {
            defaultValue: inlineCopy.sequenceReplaceHint,
          })}
        </p>
        <button
          onClick={onApply}
          disabled={"error" in result}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            "error" in result
              ? "cursor-not-allowed bg-gray-700 text-gray-500"
              : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {t("jobs.scheduleBuilder.applySequence", { defaultValue: inlineCopy.applySequence })}
        </button>
      </div>
    </div>
  );
}

function NumberUnitField({
  label,
  value,
  unit,
  onValueChange,
  onUnitChange,
}: {
  label: string;
  value: number;
  unit: RepeatedTimeUnit;
  onValueChange: (value: number) => void;
  onUnitChange: (unit: RepeatedTimeUnit) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1">
      <label className="block text-[11px] uppercase tracking-wide text-gray-500">{label}</label>
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          step={1}
          value={value}
          onChange={(e) => onValueChange(Number.parseInt(e.target.value, 10) || 0)}
          className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as RepeatedTimeUnit)}
          className="rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="minutes">{t("jobs.minutes")}</option>
          <option value="hours">{t("jobs.hours")}</option>
        </select>
      </div>
    </div>
  );
}

function YearlyDatePicker({
  selectedDates,
  onAddDate,
  months,
  locale,
}: {
  selectedDates: ScheduleDay[];
  onAddDate: (month: number, day: number) => void;
  months: Array<{ value: number; name: string }>;
  locale: string;
}) {
  const { t } = useTranslation();
  const [selectedMonth, setSelectedMonth] = useState(1);
  const [selectedDay, setSelectedDay] = useState(1);

  const maxDays = getDaysInMonth(selectedMonth);

  const handleAdd = () => {
    onAddDate(selectedMonth, Math.min(selectedDay, maxDays));
  };

  const isAlreadySelected = selectedDates.some(
    (d) => d.month_of_year === selectedMonth && d.day_of_month === selectedDay
  );

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
      <CalendarDays className="w-5 h-5 text-gray-500" />
      <select
        value={selectedMonth}
        onChange={(e) => {
          const nextMonth = Number(e.target.value);
          setSelectedMonth(nextMonth);
          setSelectedDay((prev) => Math.min(prev, getDaysInMonth(nextMonth)));
        }}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
      >
        {months.map(({ value, name }) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
      <select
        value={Math.min(selectedDay, maxDays)}
        onChange={(e) => setSelectedDay(Number(e.target.value))}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
      >
        {Array.from({ length: maxDays }, (_, i) => i + 1).map((day) => (
          <option key={day} value={day}>
            {formatDayOfMonth(day, locale)}
          </option>
        ))}
      </select>
      <button
        onClick={handleAdd}
        disabled={isAlreadySelected}
        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
          isAlreadySelected ? "bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-500"
        }`}
      >
        {t("jobs.scheduleBuilder.addDate")}
      </button>
    </div>
  );
}

function ScheduleSummary({
  mode,
  scheduleDays,
  activeFrom,
  activeUntil,
  locale,
}: {
  mode: ScheduleMode;
  scheduleDays: ScheduleDay[];
  activeFrom?: string;
  activeUntil?: string;
  locale: string;
}) {
  const { t } = useTranslation();

  if (scheduleDays.length === 0) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <p className="text-sm text-gray-500">{t("jobs.scheduleBuilder.noScheduleConfigured")}</p>
      </div>
    );
  }

  const getSummary = () => {
    switch (mode) {
      case "weekly": {
        const orderMap = new Map(WEEKDAY_ORDER.map((value, index) => [value, index]));
        const dayNames = scheduleDays
          .map((d) => d.day_of_week)
          .filter((dayOfWeek): dayOfWeek is number => typeof dayOfWeek === "number")
          .sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999))
          .map((dayOfWeek) => formatWeekdayName(dayOfWeek, locale))
          .join(", ");
        return t("jobs.scheduleBuilder.summaryRunsWeekly", { days: dayNames });
      }
      case "monthly": {
        const days = scheduleDays
          .map((d) => d.day_of_month)
          .filter((day): day is number => typeof day === "number")
          .sort((a, b) => a - b)
          .map((day) => formatDayOfMonth(day, locale))
          .join(", ");
        return t("jobs.scheduleBuilder.summaryRunsMonthly", { days });
      }
      case "yearly": {
        const dates = [...scheduleDays]
          .sort((a, b) => {
            const monthDiff = (a.month_of_year ?? 0) - (b.month_of_year ?? 0);
            if (monthDiff !== 0) return monthDiff;
            return (a.day_of_month ?? 0) - (b.day_of_month ?? 0);
          })
          .map((d) => {
            if (typeof d.month_of_year === "number" && typeof d.day_of_month === "number") {
              return formatMonthDay(d.month_of_year, d.day_of_month, locale);
            }
            return d.day_name;
          })
          .join(", ");
        return t("jobs.scheduleBuilder.summaryRunsYearly", { dates });
      }
      default:
        return "";
    }
  };

  const totalWindows = scheduleDays.reduce((sum, d) => sum + d.windows.length, 0);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <h4 className="text-sm font-medium text-gray-300 mb-2">{t("jobs.scheduleBuilder.summaryTitle")}</h4>
      <p className="text-sm text-blue-400">{getSummary()}</p>
      <p className="text-sm text-gray-500 mt-1">
        {t("jobs.scheduleBuilder.summaryDaysConfigured", { count: scheduleDays.length, windows: totalWindows })}
      </p>
      {(activeFrom || activeUntil) && (
        <p className="text-sm text-gray-500 mt-1">
          {activeFrom && activeUntil
            ? t("jobs.scheduleBuilder.summaryActiveFromTo", { from: activeFrom, until: activeUntil })
            : activeFrom
            ? t("jobs.scheduleBuilder.summaryActiveFrom", { from: activeFrom })
            : t("jobs.scheduleBuilder.summaryActiveUntil", { until: activeUntil })}
        </p>
      )}
    </div>
  );
}
