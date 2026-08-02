export const BCPARKS_BASE = "https://camping.bcparks.ca";

/**
 * GoingToCamp availability / processedAvailability codes we care about:
 * 0 = online-reservable / open
 * 1 = unavailable / booked
 * 3 = not reservable online (often FCFS) — never treat as a hit
 * 5 = unavailable in season / closed
 */
export const AVAILABILITY_OPEN = 0;

export type DailyAvailability = {
  availability: number;
  remainingQuota: number | null;
};

export type MapAvailabilityResponse = {
  mapId: number;
  mapAvailabilities: number[];
  resourceAvailabilities: Record<string, DailyAvailability[]>;
  mapLinkAvailabilities: Record<string, number[]>;
};

export type ResourceLocation = {
  resourceLocationId: number;
  rootMapId: number;
  localizedValues: Array<{
    cultureName: string;
    shortName: string;
    fullName: string;
    website?: string;
  }>;
};

export type NightAvailability = {
  date: string; // YYYY-MM-DD
  dayOfWeek: string;
  availableSites: number;
};

export type OpenSite = {
  resourceId: string;
  mapId: number;
  /** Campsite label from BC Parks (e.g. "B59", "D7") */
  name?: string;
  /** Half of a double site — both halves must be booked (and paid for) together */
  isDouble?: boolean;
};

export type WeekendResult = {
  parkName: string;
  parkShortName: string;
  resourceLocationId: number;
  rootMapId: number;
  driveMinutesFromHome?: number;
  /** Arrival date (first night) */
  arrivalDate: string;
  /** Departure date (morning after last night) */
  departureDate: string;
  nights: NightAvailability[];
  /** Sites with every selected night open (verified online-reservable) */
  fullWeekendSites: number;
  /** Verified open sites (capped for display / deep links) */
  openSites: OpenSite[];
  /** True when more daily candidates existed than we verified */
  sitesCapped?: boolean;
  bookingUrl: string;
  hasAnyAvailability: boolean;
  hasFullWeekend: boolean;
};

export type AvailabilityReport = {
  checkedAt: string;
  startDate: string;
  endDate: string;
  endDateLabel?: string;
  nightLabels: string[];
  pollIntervalMinutes: number;
  homeBase?: string;
  maxDriveMinutesFromHome?: number;
  party?: {
    partySize: number;
    tents: number;
  };
  parksChecked: Array<{
    shortName: string;
    driveMinutesFromHome?: number;
  }>;
  weekends: WeekendResult[];
  errors: string[];
};

export type CheckMeta = {
  checkedAt: string;
  startDate: string;
  endDate: string;
  endDateLabel?: string;
  nightLabels: string[];
  pollIntervalMinutes: number;
  homeBase?: string;
  maxDriveMinutesFromHome?: number;
  party?: {
    partySize: number;
    tents: number;
  };
  parksChecked: Array<{
    shortName: string;
    driveMinutesFromHome?: number;
  }>;
  totalChecks: number;
};

export type CheckEvent =
  | { type: "meta"; meta: CheckMeta }
  | {
      type: "result";
      index: number;
      total: number;
      result: WeekendResult;
    }
  | { type: "error"; index: number; total: number; error: string }
  | { type: "done"; report: AvailabilityReport };
