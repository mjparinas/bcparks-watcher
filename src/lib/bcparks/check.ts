import {
  getActiveParks,
  watcherConfig,
  type ParkConfig,
  type WatcherConfig,
} from "@/config/watcher.config";
import {
  AVAILABILITY_OPEN,
  type AvailabilityReport,
  type CheckEvent,
  type CheckMeta,
  type NightAvailability,
  type WeekendResult,
} from "./types";
import { buildBookingUrl, fetchParkAvailability } from "./client";
import {
  dayName,
  formatDate,
  getWeekendWindowsInRange,
  type WeekendWindow,
} from "./weekends";

export type { CheckEvent, CheckMeta };

function resolveConfig(overrides?: Partial<WatcherConfig>): WatcherConfig {
  return {
    ...watcherConfig,
    ...overrides,
    parks: overrides?.parks ?? watcherConfig.parks,
    nights: overrides?.nights ?? watcherConfig.nights,
    party: overrides?.party ?? watcherConfig.party,
  };
}

function sortWeekends(weekends: WeekendResult[]): WeekendResult[] {
  return [...weekends].sort((a, b) => {
    if (a.arrivalDate !== b.arrivalDate) {
      return a.arrivalDate.localeCompare(b.arrivalDate);
    }
    const driveDiff =
      (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
      (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER);
    if (driveDiff !== 0) return driveDiff;
    return a.parkShortName.localeCompare(b.parkShortName);
  });
}

function buildMeta(
  config: WatcherConfig,
  enabledParks: ParkConfig[],
  totalChecks: number,
): CheckMeta {
  return {
    checkedAt: new Date().toISOString(),
    startDate: config.startDate,
    endDate: config.endDate,
    endDateLabel: config.endDateLabel,
    nightLabels: config.nights,
    pollIntervalMinutes: config.pollIntervalMinutes,
    homeBase: config.homeBase,
    maxDriveMinutesFromHome: config.maxDriveMinutesFromHome,
    party: {
      ...config.party,
      partySize: config.partySize,
    },
    parksChecked: enabledParks.map((park) => ({
      shortName: park.shortName,
      driveMinutesFromHome: park.driveMinutesFromHome,
    })),
    totalChecks,
  };
}

/**
 * A "full weekend" means the SAME campsite is reservable for every night
 * in the stay — not different sites on different nights, and not sites that
 * only look open as a continuous stay while individual nights (or checkout
 * rules) block the Friday→Sunday trip.
 */
async function checkParkWindow(
  config: WatcherConfig,
  park: ParkConfig,
  window: WeekendWindow,
): Promise<WeekendResult> {
  const startDate = formatDate(window.arrival);
  const endDateApi = formatDate(window.nights[window.nights.length - 1]);
  const departureDate = formatDate(window.departure);

  const shared = {
    rootMapId: park.rootMapId,
    resourceLocationId: park.resourceLocationId,
    startDate,
    endDate: endDateApi,
    partySize: config.partySize,
    equipmentCategoryId: config.equipmentCategoryId,
    subEquipmentCategoryId: config.subEquipmentCategoryId,
    numEquipment: config.numEquipment,
    mapIds: park.mapIds,
  };

  const [continuous, daily] = await Promise.all([
    fetchParkAvailability({ ...shared, getDailyAvailability: false }),
    fetchParkAvailability({ ...shared, getDailyAvailability: true }),
  ]);

  const nightCount = window.nights.length;
  let fullWeekendSites = 0;

  for (const [resourceId, stayCodes] of Object.entries(continuous)) {
    // Must be bookable as one continuous reservation on this site
    if (!stayCodes.some((code) => code === AVAILABILITY_OPEN)) continue;

    const nightCodes = daily[resourceId];
    if (!nightCodes || nightCodes.length < nightCount) continue;

    // Every night in the stay must be open on THIS same site.
    // Filters out departure/checkout-restricted sites that the continuous
    // endpoint sometimes marks available even when a night is blocked.
    const everyNightOpen = nightCodes
      .slice(0, nightCount)
      .every((code) => code === AVAILABILITY_OPEN);
    if (!everyNightOpen) continue;

    fullWeekendSites += 1;
  }

  const nights: NightAvailability[] = window.nights.map((date) => ({
    date: formatDate(date),
    dayOfWeek: dayName(date),
    availableSites: fullWeekendSites,
  }));

  return {
    parkName: park.name,
    parkShortName: park.shortName,
    resourceLocationId: park.resourceLocationId,
    rootMapId: park.rootMapId,
    driveMinutesFromHome: park.driveMinutesFromHome,
    arrivalDate: startDate,
    departureDate,
    nights,
    fullWeekendSites,
    bookingUrl: buildBookingUrl({
      mapId: park.rootMapId,
      resourceLocationId: park.resourceLocationId,
      startDate,
      endDate: departureDate,
      partySize: config.partySize,
      equipmentCategoryId: config.equipmentCategoryId,
      subEquipmentCategoryId: config.subEquipmentCategoryId,
    }),
    hasAnyAvailability: fullWeekendSites > 0,
    hasFullWeekend: fullWeekendSites > 0,
  };
}

/**
 * Yields availability results one park/weekend at a time for progressive UI.
 */
export async function* streamAvailabilityCheck(
  overrides?: Partial<WatcherConfig>,
): AsyncGenerator<CheckEvent> {
  const config = resolveConfig(overrides);
  const enabledParks = getActiveParks(config);
  const windows = getWeekendWindowsInRange(
    config.startDate,
    config.endDate,
    config.nights,
  );
  const total = enabledParks.length * windows.length;
  const weekends: WeekendResult[] = [];
  const errors: string[] = [];
  const meta = buildMeta(config, enabledParks, total);

  yield { type: "meta", meta };

  let index = 0;
  for (const park of enabledParks) {
    for (const window of windows) {
      index += 1;
      const startDate = formatDate(window.arrival);
      try {
        const result = await checkParkWindow(config, park, window);
        weekends.push(result);
        yield { type: "result", index, total, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown park check error";
        const labeled = `${park.shortName} ${startDate}: ${message}`;
        errors.push(labeled);
        yield { type: "error", index, total, error: labeled };
      }
    }
  }

  const report: AvailabilityReport = {
    ...meta,
    weekends: sortWeekends(weekends),
    errors,
  };

  yield { type: "done", report };
}

export async function runAvailabilityCheck(
  overrides?: Partial<WatcherConfig>,
): Promise<AvailabilityReport> {
  let report: AvailabilityReport | null = null;

  for await (const event of streamAvailabilityCheck(overrides)) {
    if (event.type === "done") {
      report = event.report;
    }
  }

  if (!report) {
    throw new Error("Availability check produced no report");
  }

  return report;
}

export async function notifyIfAvailable(
  report: AvailabilityReport,
  webhookUrl?: string,
): Promise<void> {
  const url =
    webhookUrl ||
    process.env.NOTIFY_WEBHOOK_URL ||
    watcherConfig.notifyWebhookUrl;

  if (!url) return;

  const hits = report.weekends.filter((weekend) => weekend.hasFullWeekend);
  if (hits.length === 0) return;

  const text = hits
    .map(
      (hit) =>
        `🏕️ ${hit.parkShortName}: ${hit.arrivalDate} → ${hit.departureDate} — ${hit.fullWeekendSites} site(s)\n${hit.bookingUrl}`,
    )
    .join("\n\n");

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `BC Parks weekend availability found:\n\n${text}`,
      content: `BC Parks weekend availability found:\n\n${text}`,
    }),
  });
}
