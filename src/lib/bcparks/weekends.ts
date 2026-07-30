import type { DayOfWeek } from "@/config/watcher.config";

export const DAYS_OF_WEEK: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const DAY_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const INDEX_TO_DAY = DAYS_OF_WEEK;

export function isDayOfWeek(value: string): value is DayOfWeek {
  return (DAYS_OF_WEEK as string[]).includes(value);
}

/** Selected nights form one contiguous block (allows week wrap, e.g. Sat–Mon). */
export function areNightsContiguous(nights: DayOfWeek[]): boolean {
  if (nights.length === 0) return false;
  const selected = new Set(nights.map((day) => DAY_INDEX[day]));
  if (selected.size !== nights.length) return false;
  if (selected.size === 1 || selected.size === 7) return true;

  let transitions = 0;
  for (let i = 0; i < 7; i += 1) {
    const cur = selected.has(i);
    const next = selected.has((i + 1) % 7);
    if (cur !== next) transitions += 1;
  }
  return transitions === 2;
}

/** Order nights from the start of the contiguous block through departure. */
export function orderContiguousNights(nights: DayOfWeek[]): DayOfWeek[] {
  if (nights.length === 0) return [];
  const selected = new Set(nights.map((day) => DAY_INDEX[day]));
  let start = [...selected][0] ?? 0;
  for (let i = 0; i < 7; i += 1) {
    if (selected.has(i) && !selected.has((i + 6) % 7)) {
      start = i;
      break;
    }
  }
  return Array.from({ length: selected.size }, (_, step) =>
    INDEX_TO_DAY[(start + step) % 7],
  );
}

export function shortDayLabel(day: DayOfWeek): string {
  return day.slice(0, 3).replace(/^./, (c) => c.toUpperCase());
}

/** Arrive–depart label for selected nights, e.g. Fri+Sat → "Fri–Sun". */
export function staySpanLabel(nights: DayOfWeek[]): string {
  const ordered = orderContiguousNights(nights);
  if (ordered.length === 0) return "Pick nights";
  const arrive = shortDayLabel(ordered[0]);
  const depart =
    INDEX_TO_DAY[(DAY_INDEX[ordered[ordered.length - 1]] + 1) % 7];
  return `${arrive}–${shortDayLabel(depart)}`;
}

export type WeekendWindow = {
  /** Inclusive night dates, in order */
  nights: Date[];
  arrival: Date;
  departure: Date;
};

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function dayName(date: Date): string {
  return date.toLocaleDateString("en-CA", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function nightOffsets(nights: DayOfWeek[]): number[] {
  const offsets: number[] = [0];
  for (let i = 1; i < nights.length; i++) {
    let delta = DAY_INDEX[nights[i]] - DAY_INDEX[nights[i - 1]];
    if (delta <= 0) delta += 7;
    offsets.push(offsets[i - 1] + delta);
  }
  return offsets;
}

/**
 * Build every stay window in [startDate, endDate).
 * Arrival must be >= startDate; departure must be < endDate.
 * Example: nights=[fri,sat,sun] → Fri→Mon trips (leave Monday morning).
 */
export function getWeekendWindowsInRange(
  startDate: string,
  endDate: string,
  nights: DayOfWeek[],
): WeekendWindow[] {
  if (nights.length === 0) return [];
  const ordered = areNightsContiguous(nights)
    ? orderContiguousNights(nights)
    : nights;
  if (!areNightsContiguous(ordered)) return [];

  const rangeStart = parseIsoDate(startDate);
  const rangeEnd = parseIsoDate(endDate);
  const firstNightDow = DAY_INDEX[ordered[0]];
  const offsets = nightOffsets(ordered);
  const windows: WeekendWindow[] = [];

  for (
    let cursor = new Date(rangeStart);
    cursor < rangeEnd;
    cursor = addDays(cursor, 1)
  ) {
    if (cursor.getUTCDay() !== firstNightDow) continue;

    const nightDates = offsets.map((offset) => addDays(cursor, offset));
    const arrival = nightDates[0];
    const departure = addDays(nightDates[nightDates.length - 1], 1);

    if (arrival < rangeStart) continue;
    // endDate is exclusive: must be home before school starts
    if (departure >= rangeEnd) continue;

    windows.push({ nights: nightDates, arrival, departure });
  }

  return windows;
}

/** @deprecated Prefer getWeekendWindowsInRange */
export function getWeekendWindows(
  year: number,
  month: number,
  nights: DayOfWeek[],
): WeekendWindow[] {
  const startDate = formatDate(new Date(Date.UTC(year, month - 1, 1)));
  const endDate = formatDate(new Date(Date.UTC(year, month, 1)));
  return getWeekendWindowsInRange(startDate, endDate, nights);
}
