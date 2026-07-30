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

function toUtcDate(year: number, month: number, day: number): Date {
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

/**
 * Build every weekend-sized night block in a month.
 * Example: nights=[fri,sat,sun] → each Fri–Sun in August.
 */
export function getWeekendWindows(
  year: number,
  month: number,
  nights: DayOfWeek[],
): WeekendWindow[] {
  if (nights.length === 0) return [];

  const firstNightDow = DAY_INDEX[nights[0]];
  const offsets: number[] = [0];

  for (let i = 1; i < nights.length; i++) {
    let delta = DAY_INDEX[nights[i]] - DAY_INDEX[nights[i - 1]];
    if (delta <= 0) delta += 7;
    offsets.push(offsets[i - 1] + delta);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const windows: WeekendWindow[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const start = toUtcDate(year, month, day);
    if (start.getUTCDay() !== firstNightDow) continue;

    const nightDates = offsets.map((offset) => addDays(start, offset));
    windows.push({
      nights: nightDates,
      arrival: nightDates[0],
      departure: addDays(nightDates[nightDates.length - 1], 1),
    });
  }

  return windows;
}
