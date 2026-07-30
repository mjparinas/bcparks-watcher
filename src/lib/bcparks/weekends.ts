import type { DayOfWeek } from "@/config/watcher.config";

const DAY_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

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

  const rangeStart = parseIsoDate(startDate);
  const rangeEnd = parseIsoDate(endDate);
  const firstNightDow = DAY_INDEX[nights[0]];
  const offsets = nightOffsets(nights);
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
