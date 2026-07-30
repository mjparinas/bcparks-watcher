import {
  getActiveParks,
  watcherConfig,
  type WatcherConfig,
} from "@/config/watcher.config";
import {
  AVAILABILITY_OPEN,
  type AvailabilityReport,
  type NightAvailability,
  type WeekendResult,
} from "./types";
import { buildBookingUrl, fetchParkDailyAvailability } from "./client";
import { dayName, formatDate, getWeekendWindows } from "./weekends";

function resolveConfig(overrides?: Partial<WatcherConfig>): WatcherConfig {
  return {
    ...watcherConfig,
    ...overrides,
    parks: overrides?.parks ?? watcherConfig.parks,
    nights: overrides?.nights ?? watcherConfig.nights,
  };
}

export async function runAvailabilityCheck(
  overrides?: Partial<WatcherConfig>,
): Promise<AvailabilityReport> {
  const config = resolveConfig(overrides);
  const enabledParks = getActiveParks(config);
  const windows = getWeekendWindows(config.year, config.month, config.nights);
  const weekends: WeekendResult[] = [];
  const errors: string[] = [];

  for (const park of enabledParks) {
    for (const window of windows) {
      const startDate = formatDate(window.arrival);
      const endDateApi = formatDate(window.nights[window.nights.length - 1]);
      const departureDate = formatDate(window.departure);

      try {
        const siteNights = await fetchParkDailyAvailability({
          rootMapId: park.rootMapId,
          resourceLocationId: park.resourceLocationId,
          startDate,
          endDate: endDateApi,
          partySize: config.partySize,
          equipmentCategoryId: config.equipmentCategoryId,
          subEquipmentCategoryId: config.subEquipmentCategoryId,
          mapIds: park.mapIds,
        });

        const nightCounts = window.nights.map(() => 0);
        let fullWeekendSites = 0;

        for (const nights of Object.values(siteNights)) {
          if (nights.length < window.nights.length) continue;

          let allOpen = true;
          for (let i = 0; i < window.nights.length; i++) {
            if (nights[i] === AVAILABILITY_OPEN) {
              nightCounts[i] += 1;
            } else {
              allOpen = false;
            }
          }
          if (allOpen) fullWeekendSites += 1;
        }

        const nights: NightAvailability[] = window.nights.map((date, i) => ({
          date: formatDate(date),
          dayOfWeek: dayName(date),
          availableSites: nightCounts[i],
        }));

        weekends.push({
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
          hasAnyAvailability: nightCounts.some((count) => count > 0),
          hasFullWeekend: fullWeekendSites > 0,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown park check error";
        errors.push(`${park.shortName} ${startDate}: ${message}`);
      }
    }
  }

  weekends.sort((a, b) => {
    if (a.arrivalDate !== b.arrivalDate) {
      return a.arrivalDate.localeCompare(b.arrivalDate);
    }
    const driveDiff =
      (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
      (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER);
    if (driveDiff !== 0) return driveDiff;
    return a.parkShortName.localeCompare(b.parkShortName);
  });

  return {
    checkedAt: new Date().toISOString(),
    year: config.year,
    month: config.month,
    nightLabels: config.nights,
    pollIntervalMinutes: config.pollIntervalMinutes,
    homeBase: config.homeBase,
    maxDriveMinutesFromHome: config.maxDriveMinutesFromHome,
    parksChecked: enabledParks.map((park) => ({
      shortName: park.shortName,
      driveMinutesFromHome: park.driveMinutesFromHome,
    })),
    weekends,
    errors,
  };
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
