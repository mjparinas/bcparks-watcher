import {
  applyDateOverrides,
  applyPartyOverrides,
  getActiveParks,
  watcherConfig,
  type DateOverrides,
  type ParkConfig,
  type PartyOverrides,
  type WatcherConfig,
} from "@/config/watcher.config";
import {
  AVAILABILITY_OPEN,
  type AvailabilityReport,
  type CheckEvent,
  type CheckMeta,
  type NightAvailability,
  type OpenSite,
  type WeekendResult,
} from "./types";
import {
  buildBookingUrl,
  fetchParkAvailability,
  fetchResourceNames,
  isOnlineReservableStay,
  type SiteDailyAvailability,
} from "./client";
import {
  addDays,
  dayName,
  formatDate,
  getWeekendWindowsInRange,
  type WeekendWindow,
} from "./weekends";

export type { CheckEvent, CheckMeta };

export type CheckOverrides = Partial<WatcherConfig> & {
  partyOverrides?: PartyOverrides;
  dateOverrides?: DateOverrides;
};

/** How many parks to process at once (outbound calls are also paced). */
const PARK_CONCURRENCY = 4;
/** Max sites to confirm via processedAvailability per park/weekend */
const MAX_VERIFY_SITES = 5;

function resolveConfig(overrides?: CheckOverrides): WatcherConfig {
  const { partyOverrides, dateOverrides, ...rest } = overrides ?? {};
  const base: WatcherConfig = {
    ...watcherConfig,
    ...rest,
    parks: rest.parks ?? watcherConfig.parks,
    nights: rest.nights ?? watcherConfig.nights,
    party: rest.party ?? watcherConfig.party,
  };

  return applyPartyOverrides(
    applyDateOverrides(base, dateOverrides),
    partyOverrides,
  );
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

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Inclusive night dates covered by [startDate, endDate). */
function nightsInExclusiveRange(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const nights: string[] = [];
  for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
    nights.push(formatDate(cursor));
  }
  return nights;
}

function buildDateIndex(nightDates: string[]): Map<string, number> {
  const index = new Map<string, number>();
  nightDates.forEach((date, i) => index.set(date, i));
  return index;
}

function candidatesForWindow(
  daily: Record<string, SiteDailyAvailability>,
  window: WeekendWindow,
  dateIndex: Map<string, number>,
): OpenSite[] {
  const nightIndexes = window.nights.map((date) =>
    dateIndex.get(formatDate(date)),
  );
  if (nightIndexes.some((i) => i == null)) return [];

  const indexes = nightIndexes as number[];
  const candidates: OpenSite[] = [];

  for (const [resourceId, site] of Object.entries(daily)) {
    if (indexes.some((i) => i >= site.nights.length)) continue;
    const everyNightOpen = indexes.every(
      (i) => site.nights[i] === AVAILABILITY_OPEN,
    );
    if (!everyNightOpen) continue;
    candidates.push({ resourceId, mapId: site.mapId });
  }

  return candidates;
}

async function fetchParkDailyRange(options: {
  park: ParkConfig;
  config: WatcherConfig;
  startDate: string;
  endDateApi: string;
}): Promise<Record<string, SiteDailyAvailability>> {
  return fetchParkAvailability({
    rootMapId: options.park.rootMapId,
    resourceLocationId: options.park.resourceLocationId,
    startDate: options.startDate,
    endDate: options.endDateApi,
    partySize: options.config.partySize,
    equipmentCategoryId: options.config.equipmentCategoryId,
    subEquipmentCategoryId: options.config.subEquipmentCategoryId,
    numEquipment: options.config.numEquipment,
    mapIds: options.park.mapIds,
    getDailyAvailability: true,
  });
}

async function verifyOnlineReservableSites(options: {
  candidates: OpenSite[];
  startDate: string;
  endDateApi: string;
  nightCount: number;
}): Promise<OpenSite[]> {
  const verified: OpenSite[] = [];

  for (let i = 0; i < options.candidates.length; i += MAX_VERIFY_SITES) {
    const batch = options.candidates.slice(i, i + MAX_VERIFY_SITES);
    const batchVerified = (
      await Promise.all(
        batch.map(async (site) =>
          (await isOnlineReservableStay({
            resourceId: site.resourceId,
            startDate: options.startDate,
            endDate: options.endDateApi,
            nightCount: options.nightCount,
          }))
            ? site
            : null,
        ),
      )
    ).filter((site): site is OpenSite => site != null);
    verified.push(...batchVerified);
  }

  return verified;
}

async function attachSiteNames(
  park: ParkConfig,
  sites: OpenSite[],
): Promise<OpenSite[]> {
  if (sites.length === 0) return sites;
  try {
    const names = await fetchResourceNames(park.resourceLocationId);
    return sites.map((site) => ({
      ...site,
      name: names[site.resourceId] ?? site.name,
    }));
  } catch {
    return sites;
  }
}

async function buildWeekendResult(options: {
  config: WatcherConfig;
  park: ParkConfig;
  window: WeekendWindow;
  daily: Record<string, SiteDailyAvailability>;
  dateIndex: Map<string, number>;
}): Promise<WeekendResult> {
  const { config, park, window, daily, dateIndex } = options;
  const startDate = formatDate(window.arrival);
  const endDateApi = formatDate(window.nights[window.nights.length - 1]);
  const departureDate = formatDate(window.departure);
  const nightCount = window.nights.length;

  const candidates = candidatesForWindow(daily, window, dateIndex);
  const toVerify = candidates.slice(0, MAX_VERIFY_SITES);
  const sitesCapped = candidates.length > MAX_VERIFY_SITES;

  const verified = await verifyOnlineReservableSites({
    candidates: toVerify,
    startDate,
    endDateApi,
    nightCount,
  });
  const named = await attachSiteNames(park, verified);

  const fullWeekendSites = named.length;
  const first = named[0];

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
    openSites: named,
    sitesCapped,
    bookingUrl: buildBookingUrl({
      mapId: first?.mapId ?? park.rootMapId,
      resourceLocationId: park.resourceLocationId,
      startDate,
      endDate: departureDate,
      partySize: config.partySize,
      equipmentCategoryId: config.equipmentCategoryId,
      subEquipmentCategoryId: config.subEquipmentCategoryId,
      resourceId: first?.resourceId,
    }),
    hasAnyAvailability: fullWeekendSites > 0,
    hasFullWeekend: fullWeekendSites > 0,
  };
}

/**
 * One map-tree walk for the full search range, then slice each stay window
 * in memory and verify a capped set of candidate sites.
 */
async function checkParkWindows(
  config: WatcherConfig,
  park: ParkConfig,
  windows: WeekendWindow[],
): Promise<WeekendResult[]> {
  if (windows.length === 0) return [];

  const rangeNights = nightsInExclusiveRange(config.startDate, config.endDate);
  if (rangeNights.length === 0) return [];

  const endDateApi = rangeNights[rangeNights.length - 1];
  const dateIndex = buildDateIndex(rangeNights);
  const daily = await fetchParkDailyRange({
    park,
    config,
    startDate: config.startDate,
    endDateApi,
  });

  const results: WeekendResult[] = [];
  for (const window of windows) {
    results.push(
      await buildWeekendResult({
        config,
        park,
        window,
        daily,
        dateIndex,
      }),
    );
  }
  return results;
}

export type MoreOpenSitesResult = {
  parkShortName: string;
  arrivalDate: string;
  openSites: OpenSite[];
  sitesCapped: boolean;
};

/**
 * Verify remaining daily candidates for one park/stay, skipping sites already shown.
 */
export async function findRemainingOpenSites(options: {
  shortName: string;
  arrivalDate: string;
  lastNightDate: string;
  nightCount: number;
  excludeResourceIds?: string[];
  partyOverrides?: PartyOverrides;
}): Promise<MoreOpenSitesResult> {
  const config = resolveConfig({ partyOverrides: options.partyOverrides });
  const park = getActiveParks(config, {
    shortNames: [options.shortName],
  })[0];

  if (!park) {
    throw new Error(`Unknown or inactive park: ${options.shortName}`);
  }

  if (options.nightCount < 1) {
    throw new Error("nightCount must be at least 1");
  }

  const exclude = new Set(options.excludeResourceIds ?? []);
  const daily = await fetchParkDailyRange({
    park,
    config,
    startDate: options.arrivalDate,
    endDateApi: options.lastNightDate,
  });

  const nightDates = nightsInExclusiveRange(
    options.arrivalDate,
    formatDate(addDays(parseIsoDate(options.lastNightDate), 1)),
  );
  const dateIndex = buildDateIndex(nightDates);
  const fakeWindow: WeekendWindow = {
    nights: nightDates.map(parseIsoDate),
    arrival: parseIsoDate(options.arrivalDate),
    departure: addDays(parseIsoDate(options.lastNightDate), 1),
  };

  const candidates = candidatesForWindow(daily, fakeWindow, dateIndex).filter(
    (site) => !exclude.has(site.resourceId),
  );

  const verified = await verifyOnlineReservableSites({
    candidates,
    startDate: options.arrivalDate,
    endDateApi: options.lastNightDate,
    nightCount: options.nightCount,
  });
  const named = await attachSiteNames(park, verified);

  return {
    parkShortName: park.shortName,
    arrivalDate: options.arrivalDate,
    openSites: named,
    sitesCapped: false,
  };
}

/**
 * Yields availability results as parks finish (one map walk per park).
 */
export async function* streamAvailabilityCheck(
  overrides?: CheckOverrides,
  options?: { shortNames?: string[] },
): AsyncGenerator<CheckEvent> {
  const config = resolveConfig(overrides);
  const enabledParks = getActiveParks(config, {
    shortNames: options?.shortNames,
  });
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

  if (enabledParks.length === 0 || windows.length === 0) {
    yield {
      type: "done",
      report: {
        ...meta,
        weekends: [],
        errors: [],
      },
    };
    return;
  }

  const concurrency = Math.min(PARK_CONCURRENCY, enabledParks.length);
  let nextPark = 0;
  let active = 0;
  let completed = 0;
  const eventQueue: CheckEvent[] = [];
  let wake: (() => void) | null = null;

  const signal = () => {
    wake?.();
    wake = null;
  };

  const startPark = () => {
    if (nextPark >= enabledParks.length) return;
    const park = enabledParks[nextPark];
    nextPark += 1;
    active += 1;

    void (async () => {
      try {
        const results = await checkParkWindows(config, park, windows);
        for (const result of results) {
          weekends.push(result);
          completed += 1;
          eventQueue.push({
            type: "result",
            index: completed,
            total,
            result,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown park check error";
        for (const window of windows) {
          const labeled = `${park.shortName} ${formatDate(window.arrival)}: ${message}`;
          errors.push(labeled);
          completed += 1;
          eventQueue.push({
            type: "error",
            index: completed,
            total,
            error: labeled,
          });
        }
      } finally {
        active -= 1;
        signal();
      }
    })();
  };

  while (completed < total) {
    while (active < concurrency && nextPark < enabledParks.length) {
      startPark();
    }
    if (eventQueue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
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
  overrides?: CheckOverrides,
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
    .map((hit) => {
      const sites = hit.openSites
        .map((site) => site.name ?? site.resourceId)
        .slice(0, 5)
        .join(", ");
      return `🏕️ ${hit.parkShortName}: ${hit.arrivalDate} → ${hit.departureDate} — ${hit.fullWeekendSites} site(s)${sites ? ` [${sites}]` : ""}\n${hit.bookingUrl}`;
    })
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
