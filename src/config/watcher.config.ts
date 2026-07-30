/**
 * BC Parks Weekend Watcher — edit this file to change what gets checked.
 *
 * Parks use GoingToCamp IDs from camping.bcparks.ca.
 * Look up more parks with: npm run lookup -- "garibaldi"
 * Or open /api/parks?q=garibaldi while the app is running.
 *
 * Access rules (enforced below):
 * - No BC Ferries / boat-only access from homeBase
 * - No toll roads or toll bridges on the drive
 * - Vehicle-accessible frontcountry only
 */

export type DayOfWeek =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type ParkConfig = {
  /** Display name */
  name: string;
  /** Short label used in the UI */
  shortName: string;
  /** GoingToCamp resourceLocationId */
  resourceLocationId: number;
  /** GoingToCamp root map id for the park */
  rootMapId: number;
  /** Set false to skip without deleting the entry */
  enabled: boolean;
  /**
   * Approximate one-way drive time from homeBase (minutes).
   * Used with maxDriveMinutesFromHome to filter the watch list.
   */
  driveMinutesFromHome?: number;
  /** True if reaching the park from homeBase requires a ferry */
  requiresFerry?: boolean;
  /** True if the usual drive uses a toll road / toll bridge */
  requiresTollRoad?: boolean;
  /**
   * Optional: only check specific campground map IDs (child maps).
   * Leave empty to check the whole park (recommended).
   */
  mapIds?: number[];
};

export type PartyConfig = {
  adults: number;
  /** Kid ages — used for notes; partySize counts everyone */
  kidsAges: number[];
  tents: number;
  cars: number;
};

export type WatcherConfig = {
  /** Where drive-time estimates are measured from */
  homeBase: string;
  /**
   * Skip parks farther than this (minutes).
   * Set undefined / omit to include every enabled park regardless of drive time.
   */
  maxDriveMinutesFromHome?: number;
  /** Drop any park marked requiresFerry */
  excludeFerry: boolean;
  /** Drop any park marked requiresTollRoad */
  excludeTollRoads: boolean;
  /**
   * Inclusive start of the search window (YYYY-MM-DD).
   * Weekends must arrive on or after this date.
   */
  startDate: string;
  /**
   * Exclusive end of the search window (YYYY-MM-DD).
   * Weekends must depart before this date (e.g. school start day).
   */
  endDate: string;
  /** Human note for why endDate was chosen */
  endDateLabel?: string;
  /**
   * Nights that make up a stay.
   * Fri–Sun nights = arrive Friday, leave Monday.
   */
  nights: DayOfWeek[];
  /**
   * How often the dashboard / cron should re-check (minutes).
   * Be polite to camping.bcparks.ca — 5+ minutes is a good default.
   */
  pollIntervalMinutes: number;
  /** Booking party details */
  party: PartyConfig;
  /**
   * Total people sent to the BC Parks API (adults + kids).
   * Kept explicit so it’s easy to override.
   */
  partySize: number;
  /** -32768 = standard non-group equipment category */
  equipmentCategoryId: number;
  /**
   * Equipment subtype from camping.bcparks.ca/api/equipment
   * -32768 = 1 Tent
   */
  subEquipmentCategoryId: number;
  /** How many equipment units (tents) to request */
  numEquipment: number;
  parks: ParkConfig[];
  /**
   * Optional webhook (Slack/Discord/etc.) fired when a full weekend opens up.
   * Prefer setting NOTIFY_WEBHOOK_URL in .env.local instead of hardcoding.
   */
  notifyWebhookUrl?: string;
};

export const watcherConfig: WatcherConfig = {
  homeBase: "Langley, BC",
  maxDriveMinutesFromHome: 180,
  excludeFerry: true,
  excludeTollRoads: true,

  // Today → day school starts (BC districts: Tue Sep 8, 2026)
  startDate: "2026-07-29",
  endDate: "2026-09-08",
  endDateLabel: "BC school start (Tue Sep 8, 2026)",

  // Arrive Friday, stay Fri/Sat nights, leave Sunday
  nights: ["friday", "saturday"],

  pollIntervalMinutes: 5,

  party: {
    adults: 2,
    kidsAges: [4, 6],
    tents: 1,
    cars: 1,
  },
  partySize: 4,
  equipmentCategoryId: -32768,
  subEquipmentCategoryId: -32768, // 1 Tent
  numEquipment: 1,

  /**
   * Mainland drive-only frontcountry parks within ~3 hours of Langley.
   * No ferry, no toll roads/bridges.
   */
  parks: [
    {
      name: "Rolley Lake Provincial Park",
      shortName: "Rolley Lake",
      resourceLocationId: -2147483543,
      rootMapId: -2147483430,
      driveMinutesFromHome: 55,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Golden Ears Provincial Park",
      shortName: "Golden Ears",
      resourceLocationId: -2147483606,
      rootMapId: -2147483576,
      driveMinutesFromHome: 60,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Cultus Lake Provincial Park",
      shortName: "Cultus Lake",
      resourceLocationId: -2147483623,
      rootMapId: -2147483610,
      driveMinutesFromHome: 60,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Porteau Cove Provincial Park",
      shortName: "Porteau Cove",
      resourceLocationId: -2147483550,
      rootMapId: -2147483449,
      driveMinutesFromHome: 90,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Sasquatch Provincial Park",
      shortName: "Sasquatch",
      resourceLocationId: -2147483539,
      rootMapId: -2147483420,
      driveMinutesFromHome: 95,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Alice Lake Provincial Park",
      shortName: "Alice Lake",
      resourceLocationId: -2147483647,
      rootMapId: -2147483648,
      driveMinutesFromHome: 110,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Silver Lake Provincial Park",
      shortName: "Silver Lake",
      resourceLocationId: -2147483535,
      rootMapId: -2147483410,
      driveMinutesFromHome: 120,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Sx̱ótsaqel / Chilliwack Lake Park",
      shortName: "Chilliwack Lake",
      resourceLocationId: -2147483627,
      rootMapId: -2147483619,
      driveMinutesFromHome: 130,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "E. C. Manning Provincial Park",
      shortName: "Manning",
      resourceLocationId: -2147483618,
      rootMapId: -2147483601,
      driveMinutesFromHome: 150,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Skagit Valley Provincial Park",
      shortName: "Skagit Valley",
      resourceLocationId: -2147483534,
      rootMapId: -2147483368,
      driveMinutesFromHome: 160,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
    {
      name: "Nairn Falls Provincial Park",
      shortName: "Nairn Falls",
      resourceLocationId: -2147483564,
      rootMapId: -2147483471,
      driveMinutesFromHome: 170,
      requiresFerry: false,
      requiresTollRoad: false,
      enabled: true,
    },
  ],
};

/** Parks that pass enabled / drive-time / ferry / toll filters. */
export function getActiveParks(
  config: WatcherConfig = watcherConfig,
  options?: { shortNames?: string[] },
): ParkConfig[] {
  const maxDrive = config.maxDriveMinutesFromHome;
  const allowList = options?.shortNames?.length
    ? new Set(options.shortNames)
    : null;

  return config.parks
    .filter((park) => park.enabled)
    .filter((park) => !(config.excludeFerry && park.requiresFerry))
    .filter((park) => !(config.excludeTollRoads && park.requiresTollRoad))
    .filter((park) => {
      if (maxDrive == null) return true;
      if (park.driveMinutesFromHome == null) return true;
      return park.driveMinutesFromHome <= maxDrive;
    })
    .filter((park) => (allowList ? allowList.has(park.shortName) : true))
    .sort(
      (a, b) =>
        (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
        (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER),
    );
}
