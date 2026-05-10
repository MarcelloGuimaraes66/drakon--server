import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X, Clock, Calendar, CalendarDays } from "lucide-react";
import {
  ScheduleMode,
  ScheduleDay,
  TimeWindow,
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
    onScheduleDaysChange([]);
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
  onUpdateWindow,
  onRemoveWindow,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  windows: TimeWindow[];
  onAddWindow: () => void;
  onUpdateWindow: (windowIndex: number, field: "start_time" | "end_time", value: string) => void;
  onRemoveWindow: (windowIndex: number) => void;
}) {
  const { t } = useTranslation();
  const hasError = enabled && windows.length === 0;

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
          <button onClick={onAddWindow} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <Plus className="w-3 h-3" />
            {t("jobs.scheduleBuilder.addWindow")}
          </button>
        )}
      </div>

      {enabled && windows.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {windows.map((window, windowIndex) => {
            const error = validateTimeWindow(window);
            const hasOverlap = windows.some((w, i) => i !== windowIndex && timeWindowsOverlap(window, w));
            const translatedError = normalizeWindowError(error, t);

            return (
              <div key={windowIndex} className="flex items-center gap-2 bg-gray-800/50 p-2 rounded">
                <Clock className="w-3.5 h-3.5 text-gray-500" />
                <TimeInput
                  value={window.start_time}
                  onChange={(nextValue) => onUpdateWindow(windowIndex, "start_time", nextValue)}
                  ariaLabel={t("jobs.startTime")}
                />
                <span className="text-gray-500">-&gt;</span>
                <TimeInput
                  value={window.end_time}
                  onChange={(nextValue) => onUpdateWindow(windowIndex, "end_time", nextValue)}
                  ariaLabel={t("jobs.endTime")}
                />
                <button onClick={() => onRemoveWindow(windowIndex)} className="ml-auto text-gray-500 hover:text-red-400">
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
        </div>
      )}
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
