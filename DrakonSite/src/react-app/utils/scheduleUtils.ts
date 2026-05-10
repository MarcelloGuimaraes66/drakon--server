// Schedule utilities for recurring job execution
// Supports weekly, monthly, and yearly recurring schedules

// =============================================================================
// Core Types
// =============================================================================

export type ScheduleMode = 'weekly' | 'monthly' | 'yearly' | 'one_shot';

export interface TimeWindow {
  start_time: string; // HH:MM or HH:MM:SS format
  end_time: string; // HH:MM or HH:MM:SS format
}

/**
 * New schedule day format from backend API
 * Each day has a name and type-specific selectors
 */
export interface ScheduleDay {
  day_name: string; // e.g., "Monday", "Day 15", "Dec 25"
  day_of_week: number | null; // 0=Sunday...6=Saturday (weekly only)
  day_of_month: number | null; // 1-31 (monthly/yearly)
  month_of_year: number | null; // 1-12 (yearly only)
  windows: TimeWindow[];
}

/**
 * Complete schedule configuration for API requests
 */
export interface ScheduleConfig {
  schedule_mode: ScheduleMode;
  timezone?: string;
  active_from?: string | null;
  active_until?: string | null;
  schedule_days: ScheduleDay[];
}

// =============================================================================
// Legacy Types (for backwards compatibility with existing UI)
// =============================================================================

export interface LegacyTimeWindow {
  start: string; // HH:MM or HH:MM:SS format
  end: string; // HH:MM or HH:MM:SS format
}

export interface DaySchedule {
  enabled: boolean;
  windows: LegacyTimeWindow[];
}

export interface WeeklySchedule {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

// =============================================================================
// Constants
// =============================================================================

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_KEYS: (keyof WeeklySchedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// =============================================================================
// New Schedule Day Helpers
// =============================================================================

/**
 * Create a weekly schedule day
 */
export function createWeeklyDay(dayOfWeek: number, windows: TimeWindow[] = []): ScheduleDay {
  return {
    day_name: WEEKDAY_NAMES[dayOfWeek],
    day_of_week: dayOfWeek,
    day_of_month: null,
    month_of_year: null,
    windows,
  };
}

/**
 * Create a monthly schedule day
 */
export function createMonthlyDay(dayOfMonth: number, windows: TimeWindow[] = []): ScheduleDay {
  return {
    day_name: `Day ${dayOfMonth}`,
    day_of_week: null,
    day_of_month: dayOfMonth,
    month_of_year: null,
    windows,
  };
}

/**
 * Create a yearly schedule day
 */
export function createYearlyDay(month: number, day: number, windows: TimeWindow[] = []): ScheduleDay {
  return {
    day_name: `${MONTH_ABBREVS[month - 1]} ${day}`,
    day_of_week: null,
    day_of_month: day,
    month_of_year: month,
    windows,
  };
}

/**
 * Get default windows for a new day (9 AM - 5 PM)
 */
export function getDefaultWindows(): TimeWindow[] {
  return [{ start_time: '09:00:00', end_time: '17:00:00' }];
}

// =============================================================================
// Conversion Functions: Legacy <-> New Format
// =============================================================================

/**
 * Convert new ScheduleDay[] format to legacy WeeklySchedule
 * (for UI components that still use old format)
 */
export function scheduleDaysToWeeklySchedule(days: ScheduleDay[]): WeeklySchedule {
  const schedule = getEmptyWeeklySchedule();
  
  for (const day of days) {
    if (day.day_of_week === null) continue;
    const dayKey = WEEKDAY_KEYS[day.day_of_week];
    if (!dayKey) continue;

    schedule[dayKey] = {
      enabled: true,
      windows: day.windows.map(w => ({
        start: w.start_time,
        end: w.end_time,
      })),
    };
  }

  return schedule;
}

/**
 * Convert legacy WeeklySchedule to new ScheduleDay[] format
 * (for API requests)
 */
export function weeklyScheduleToScheduleDays(schedule: WeeklySchedule): ScheduleDay[] {
  const days: ScheduleDay[] = [];

  for (let i = 0; i < WEEKDAY_KEYS.length; i++) {
    const dayKey = WEEKDAY_KEYS[i];
    const daySchedule = schedule[dayKey];

    if (daySchedule.enabled && daySchedule.windows.length > 0) {
      days.push({
        day_name: WEEKDAY_NAMES[i],
        day_of_week: i,
        day_of_month: null,
        month_of_year: null,
        windows: daySchedule.windows.map(w => ({
          start_time: w.start,
          end_time: w.end,
        })),
      });
    }
  }

  return days;
}

// =============================================================================
// Empty/Default Schedule Creators
// =============================================================================

/**
 * Get an empty weekly schedule (legacy format)
 */
export function getEmptyWeeklySchedule(): WeeklySchedule {
  return {
    monday: { enabled: false, windows: [] },
    tuesday: { enabled: false, windows: [] },
    wednesday: { enabled: false, windows: [] },
    thursday: { enabled: false, windows: [] },
    friday: { enabled: false, windows: [] },
    saturday: { enabled: false, windows: [] },
    sunday: { enabled: false, windows: [] },
  };
}

/**
 * Get default schedule days for a mode
 */
export function getDefaultScheduleDays(mode: ScheduleMode): ScheduleDay[] {
  switch (mode) {
    case 'weekly':
      // Start with empty schedule - user selects days
      return [];
    case 'monthly':
      // Default: 1st of each month
      return [createMonthlyDay(1, getDefaultWindows())];
    case 'yearly':
      // Default: January 1st
      return [createYearlyDay(1, 1, getDefaultWindows())];
    default:
      return [];
  }
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate time format (HH:MM or HH:MM:SS)
 */
export function isValidTimeFormat(time: string): boolean {
  return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(time);
}

export function parseTimeToSeconds(time: string): number | null {
  if (!isValidTimeFormat(time)) {
    return null;
  }

  const [hoursRaw, minutesRaw, secondsRaw] = String(time).trim().split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw ?? '0');

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function normalizeTimeToHHMMSS(time: string): string | null {
  const totalSeconds = parseTimeToSeconds(time);
  if (totalSeconds === null) {
    return null;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Validate a single time window
 */
export function validateTimeWindow(window: TimeWindow): string | null {
  if (!isValidTimeFormat(window.start_time)) {
    return "Invalid start time format (use HH:MM or HH:MM:SS)";
  }
  
  if (!isValidTimeFormat(window.end_time)) {
    return "Invalid end time format (use HH:MM or HH:MM:SS)";
  }

  const startSeconds = parseTimeToSeconds(window.start_time);
  const endSeconds = parseTimeToSeconds(window.end_time);
  
  if (startSeconds === null || endSeconds === null) {
    return "Invalid time format";
  }

  if (startSeconds >= endSeconds) {
    return "Start time must be before end time";
  }

  return null;
}

/**
 * Check if two time windows overlap
 */
export function timeWindowsOverlap(w1: TimeWindow, w2: TimeWindow): boolean {
  const s1 = parseTimeToSeconds(w1.start_time);
  const e1 = parseTimeToSeconds(w1.end_time);
  const s2 = parseTimeToSeconds(w2.start_time);
  const e2 = parseTimeToSeconds(w2.end_time);

  if (s1 === null || e1 === null || s2 === null || e2 === null) {
    return false;
  }

  return s1 < e2 && s2 < e1;
}

/**
 * Validate a schedule day
 */
export function validateScheduleDay(day: ScheduleDay, mode: ScheduleMode): string | null {
  // Validate selector fields based on mode
  switch (mode) {
    case 'weekly':
      if (day.day_of_week === null || day.day_of_week < 0 || day.day_of_week > 6) {
        return "Invalid day of week";
      }
      break;
    case 'monthly':
      if (day.day_of_month === null || day.day_of_month < 1 || day.day_of_month > 31) {
        return "Day of month must be 1-31";
      }
      break;
    case 'yearly':
      if (day.month_of_year === null || day.month_of_year < 1 || day.month_of_year > 12) {
        return "Month must be 1-12";
      }
      if (day.day_of_month === null || day.day_of_month < 1 || day.day_of_month > 31) {
        return "Day must be 1-31";
      }
      break;
  }

  // Validate windows
  if (day.windows.length === 0) {
    return "At least one time window is required";
  }

  for (const window of day.windows) {
    const error = validateTimeWindow(window);
    if (error) return error;
  }

  // Check for overlapping windows
  for (let i = 0; i < day.windows.length; i++) {
    for (let j = i + 1; j < day.windows.length; j++) {
      if (timeWindowsOverlap(day.windows[i], day.windows[j])) {
        return "Time windows cannot overlap";
      }
    }
  }

  return null;
}

/**
 * Validate an entire schedule configuration
 */
export function validateScheduleConfig(config: ScheduleConfig): string | null {
  if (!['weekly', 'monthly', 'yearly'].includes(config.schedule_mode)) {
    return "Invalid schedule mode";
  }

  if (config.schedule_days.length === 0) {
    return "At least one day must be configured";
  }

  // Check for duplicate days
  const dayKeys = new Set<string>();
  for (const day of config.schedule_days) {
    let key: string;
    switch (config.schedule_mode) {
      case 'weekly':
        key = `w${day.day_of_week}`;
        break;
      case 'monthly':
        key = `m${day.day_of_month}`;
        break;
      case 'yearly':
        key = `y${day.month_of_year}-${day.day_of_month}`;
        break;
      default:
        key = day.day_name;
    }
    if (dayKeys.has(key)) {
      return `Duplicate day: ${day.day_name}`;
    }
    dayKeys.add(key);

    const error = validateScheduleDay(day, config.schedule_mode);
    if (error) {
      return `${day.day_name}: ${error}`;
    }
  }

  return null;
}

// =============================================================================
// Legacy Validation (for backwards compatibility)
// =============================================================================

export function validateLegacyTimeWindow(window: LegacyTimeWindow): string | null {
  return validateTimeWindow({ start_time: window.start, end_time: window.end });
}

export function validateDaySchedule(daySchedule: DaySchedule): string | null {
  if (!daySchedule.enabled) return null;
  if (daySchedule.windows.length === 0) {
    return "At least one time window required for enabled day";
  }

  for (const window of daySchedule.windows) {
    const error = validateLegacyTimeWindow(window);
    if (error) return error;
  }

  // Check for overlaps
  for (let i = 0; i < daySchedule.windows.length; i++) {
    for (let j = i + 1; j < daySchedule.windows.length; j++) {
      const w1 = daySchedule.windows[i];
      const w2 = daySchedule.windows[j];
      if (timeWindowsOverlap(
        { start_time: w1.start, end_time: w1.end },
        { start_time: w2.start, end_time: w2.end }
      )) {
        return "Time windows cannot overlap";
      }
    }
  }

  return null;
}

export function validateWeeklySchedule(schedule: WeeklySchedule): string | null {
  let hasEnabledDay = false;

  for (const dayKey of WEEKDAY_KEYS) {
    if (dayKey === 'sunday') continue; // skip in this loop order
    const daySchedule = schedule[dayKey];
    if (daySchedule.enabled) {
      hasEnabledDay = true;
      const error = validateDaySchedule(daySchedule);
      if (error) return `${dayKey}: ${error}`;
    }
  }

  // Check Sunday too
  if (schedule.sunday.enabled) {
    hasEnabledDay = true;
    const error = validateDaySchedule(schedule.sunday);
    if (error) return `sunday: ${error}`;
  }

  if (!hasEnabledDay) {
    return "At least one day must be enabled";
  }

  return null;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a date to datetime-local input format (YYYY-MM-DDTHH:MM)
 */
export function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Get days of week that are enabled in schedule (legacy format)
 */
export function getEnabledDays(schedule: WeeklySchedule): string[] {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days: (keyof WeeklySchedule)[] = [
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'
  ];

  const enabled: string[] = [];
  days.forEach((day, index) => {
    if (schedule[day].enabled) {
      enabled.push(dayNames[index]);
    }
  });

  return enabled;
}

/**
 * Format schedule days to a human-readable summary
 */
export function formatScheduleSummary(mode: ScheduleMode, days: ScheduleDay[]): string {
  if (days.length === 0) return 'No schedule configured';

  const parts = days.map(day => {
    const windowStr = day.windows
      .map(w => `${w.start_time}–${w.end_time}`)
      .join(', ');
    return `${day.day_name} ${windowStr}`;
  });

  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
  return `${modeLabel}: ${parts.join('; ')}`;
}

/**
 * Get available timezones
 */
export function getTimezones(): string[] {
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Australia/Sydney',
    'UTC',
  ];
}

// =============================================================================
// Legacy Exports (to be removed after ScheduleBuilder and Jobs.tsx are updated)
// =============================================================================

/** @deprecated Use ScheduleDay with TimeWindow[] instead */
export interface ScheduleWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_enabled?: number;
  sort_order?: number;
}

/** @deprecated Legacy function for parsing embedded JSON in description */
export function parseScheduleFromDescription(description: string): {
  humanText: string;
  schedule: WeeklySchedule | null;
} {
  const SCHEDULE_MARKER = "\n\n---\nSCHEDULE_JSON:";
  const markerIndex = description.indexOf(SCHEDULE_MARKER);
  
  if (markerIndex === -1) {
    return { humanText: description, schedule: null };
  }

  const humanText = description.substring(0, markerIndex);
  const scheduleStart = markerIndex + SCHEDULE_MARKER.length;
  const scheduleEnd = description.indexOf("\n", scheduleStart);
  
  if (scheduleEnd === -1) {
    return { humanText: description, schedule: null };
  }

  const base64Json = description.substring(scheduleStart, scheduleEnd);
  
  try {
    const jsonStr = atob(base64Json);
    const schedule = JSON.parse(jsonStr) as WeeklySchedule;
    return { humanText, schedule };
  } catch (error) {
    console.error("Failed to parse schedule:", error);
    return { humanText: description, schedule: null };
  }
}

/** @deprecated Use scheduleDaysToWeeklySchedule instead */
export function windowsToWeeklySchedule(windows: ScheduleWindow[]): WeeklySchedule {
  const schedule = getEmptyWeeklySchedule();
  
  const dayMap: Record<number, keyof WeeklySchedule> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday',
  };

  for (const window of windows) {
    const dayKey = dayMap[window.day_of_week];
    if (!dayKey) continue;

    const daySchedule = schedule[dayKey];
    daySchedule.enabled = true;
    daySchedule.windows.push({
      start: window.start_time,
      end: window.end_time,
    });
  }

  return schedule;
}

/** @deprecated Use validateScheduleDay instead */
export function calculateNextOccurrence(schedule: WeeklySchedule): {
  start: Date;
  end: Date;
} | null {
  const now = new Date();
  const currentDay = now.getDay();
  
  const dayKeys: (keyof WeeklySchedule)[] = [
    'sunday', 'monday', 'tuesday', 'wednesday', 
    'thursday', 'friday', 'saturday'
  ];

  for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
    const checkDay = (currentDay + daysAhead) % 7;
    const dayKey = dayKeys[checkDay];
    const daySchedule = schedule[dayKey];

    if (!daySchedule.enabled || daySchedule.windows.length === 0) {
      continue;
    }

    for (const window of daySchedule.windows) {
      const windowStart = parseTimeForCalc(window.start, daysAhead);
      const windowEnd = parseTimeForCalc(window.end, daysAhead);

      if (windowStart > now) {
        return { start: windowStart, end: windowEnd };
      }
    }
  }

  return null;
}

function parseTimeForCalc(timeStr: string, daysAhead: number): Date {
  const totalSeconds = parseTimeToSeconds(timeStr) ?? 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hours, minutes, seconds, 0);
  return date;
}

/** Helper to check overlap using legacy format */
export function legacyTimeWindowsOverlap(w1: LegacyTimeWindow, w2: LegacyTimeWindow): boolean {
  return timeWindowsOverlap(
    { start_time: w1.start, end_time: w1.end },
    { start_time: w2.start, end_time: w2.end }
  );
}
