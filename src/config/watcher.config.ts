/**
 * BC Parks Weekend Watcher — edit this file to change what gets checked.
 *
 * Parks use GoingToCamp IDs from camping.bcparks.ca.
 * Look up more parks with: npm run lookup -- "garibaldi"
 * Or open /api/parks?q=garibaldi while the app is running.
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
   * Optional: only check specific campground map IDs (child maps).
   * Leave empty to check the whole park (recommended).
   */
  mapIds?: number[];
};

export type WatcherConfig = {
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
  year: 2026,
  month: 8,
  nights: ["friday", "saturday", "sunday"],
  pollIntervalMinutes: 5,
  partySize: 2,
  equipmentCategoryId: -32768,
  parks: [
    {
      name: "E. C. Manning Provincial Park",
      shortName: "Manning",
      resourceLocationId: -2147483618,
      rootMapId: -2147483601,
      enabled: true,
    },
    {
      name: "Sasquatch Provincial Park",
      shortName: "Sasquatch",
      resourceLocationId: -2147483539,
      rootMapId: -2147483420,
      enabled: true,
    },
  ],
};
