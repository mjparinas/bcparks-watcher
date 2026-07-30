export const BCPARKS_BASE = "https://camping.bcparks.ca";

/** GoingToCamp availability code 0 = reservable / open */
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
  /** Sites with every selected night open */
  fullWeekendSites: number;
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
    adults: number;
    kidsAges: number[];
    tents: number;
    cars: number;
    partySize: number;
  };
  parksChecked: Array<{
    shortName: string;
    driveMinutesFromHome?: number;
  }>;
  weekends: WeekendResult[];
  errors: string[];
};
