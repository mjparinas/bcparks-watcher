/**
 * BC Parks Weekend Watcher — edit this file to change what gets checked.
 *
 * Parks use GoingToCamp IDs from camping.bcparks.ca.
 * Look up more parks with: npm run lookup -- "garibaldi"
 * Or open /api/parks?q=garibaldi while the app is running.
 *
 * Drive times are approximate off-peak minutes from Langley, BC.
 *
 * Access rules (enforced below):
 * - No BC Ferries / boat-only access from homeBase
 * - No toll roads or toll bridges on the drive
 * - Vehicle-accessible frontcountry only
 *
 * Intentionally excluded nearby parks:
 * - Sunshine Coast (Porpoise Bay, Saltery Bay, Inland Lake) — ferry
 * - Vancouver Island / Gulf Islands — ferry
 * - Marine / boat-access campgrounds
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
  /** Calendar year to scan (e.g. 2026) */
  year: number;
  /** Calendar month 1–12 (8 = August) */
  month: number;
  /**
   * Nights that make up a "weekend" block.
   * Default Fri/Sat/Sun = arrive Friday, stay three nights, leave Monday.
   */
  nights: DayOfWeek[];
  /**
   * How often the dashboard / cron should re-check (minutes).
   * Be polite to camping.bcparks.ca — 5+ minutes is a good default.
   */
  pollIntervalMinutes: number;
  partySize: number;
  /** -32768 = standard non-group equipment category */
  equipmentCategoryId: number;
  /**
   * Optional equipment subtype (tent, RV, …).
   * Leave undefined for any. See camping.bcparks.ca/api/equipment
   */
  subEquipmentCategoryId?: number;
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
  year: 2026,
  month: 8,
  nights: ["friday", "saturday", "sunday"],
  pollIntervalMinutes: 5,
  partySize: 2,
  equipmentCategoryId: -32768,
  /**
   * Mainland drive-only frontcountry parks within ~3 hours of Langley.
   * No ferry, no toll roads/bridges (Port Mann & Golden Ears are toll-free).
   * Drive times are approximate off-peak one-way estimates.
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
): ParkConfig[] {
  const maxDrive = config.maxDriveMinutesFromHome;

  return config.parks
    .filter((park) => park.enabled)
    .filter((park) => !(config.excludeFerry && park.requiresFerry))
    .filter((park) => !(config.excludeTollRoads && park.requiresTollRoad))
    .filter((park) => {
      if (maxDrive == null) return true;
      if (park.driveMinutesFromHome == null) return true;
      return park.driveMinutesFromHome <= maxDrive;
    })
    .sort(
      (a, b) =>
        (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
        (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER),
    );
}
