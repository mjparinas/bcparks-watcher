import {
  AVAILABILITY_OPEN,
  BCPARKS_BASE,
  type MapAvailabilityResponse,
  type ResourceLocation,
} from "./types";

/** Azure Front Door blocks obvious bot UAs — mirror a normal browser. */
const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  Origin: BCPARKS_BASE,
  Referer: `${BCPARKS_BASE}/create-booking/results`,
};

const RETRYABLE_STATUS = new Set([403, 429, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson<T>(url: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const message = `BC Parks API ${response.status} for ${url}`;
    lastError = new Error(message);

    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) {
      throw lastError;
    }

    // Back off harder on WAF / rate-limit responses
    await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
  }

  throw lastError ?? new Error(`BC Parks API failed for ${url}`);
}

export async function listResourceLocations(): Promise<ResourceLocation[]> {
  return getJson<ResourceLocation[]>(`${BCPARKS_BASE}/api/resourceLocation`);
}

export async function searchParks(query: string): Promise<
  Array<{
    name: string;
    shortName: string;
    resourceLocationId: number;
    rootMapId: number;
    website?: string;
  }>
> {
  const locations = await listResourceLocations();
  const q = query.trim().toLowerCase();

  return locations
    .filter((loc) => {
      const values = loc.localizedValues?.[0];
      if (!values) return false;
      return (
        values.fullName.toLowerCase().includes(q) ||
        values.shortName.toLowerCase().includes(q)
      );
    })
    .map((loc) => {
      const values = loc.localizedValues[0];
      return {
        name: values.fullName,
        shortName: values.shortName,
        resourceLocationId: loc.resourceLocationId,
        rootMapId: loc.rootMapId,
        website: values.website,
      };
    });
}

type MapQuery = {
  mapId: number;
  resourceLocationId: number;
  startDate: string;
  endDate: string;
  partySize: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
  numEquipment: number;
  getDailyAvailability: boolean;
};

function buildMapUrl(query: MapQuery): string {
  const params = new URLSearchParams({
    mapId: String(query.mapId),
    resourceLocationId: String(query.resourceLocationId),
    bookingCategoryId: "0",
    startDate: query.startDate,
    endDate: query.endDate,
    isReserving: "true",
    getDailyAvailability: String(query.getDailyAvailability),
    partySize: String(query.partySize),
    numEquipment: String(query.numEquipment),
    equipmentCategoryId: String(query.equipmentCategoryId),
  });

  if (query.subEquipmentCategoryId != null) {
    params.set("subEquipmentCategoryId", String(query.subEquipmentCategoryId));
  }

  return `${BCPARKS_BASE}/api/availability/map?${params.toString()}`;
}

/**
 * Recursively walk park map tree and merge per-site availability.
 * When getDailyAvailability is true, each site maps to one code per night.
 * When false, each site maps to a single code for the whole stay window
 * (same campsite bookable for the entire Friday→Sunday reservation).
 */
export async function fetchParkAvailability(options: {
  rootMapId: number;
  resourceLocationId: number;
  startDate: string;
  endDate: string;
  partySize: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
  numEquipment?: number;
  getDailyAvailability: boolean;
  /** If set, only these map nodes are queried (no auto-discovery). */
  mapIds?: number[];
}): Promise<Record<string, number[]>> {
  const siteNights: Record<string, number[]> = {};
  const numEquipment = options.numEquipment ?? 1;

  const visit = async (mapId: number, depth: number, seen: Set<number>) => {
    if (seen.has(mapId) || depth > 6) return;
    seen.add(mapId);

    const data = await getJson<MapAvailabilityResponse>(
      buildMapUrl({
        mapId,
        resourceLocationId: options.resourceLocationId,
        startDate: options.startDate,
        endDate: options.endDate,
        partySize: options.partySize,
        equipmentCategoryId: options.equipmentCategoryId,
        subEquipmentCategoryId: options.subEquipmentCategoryId,
        numEquipment,
        getDailyAvailability: options.getDailyAvailability,
      }),
    );

    for (const [resourceId, days] of Object.entries(
      data.resourceAvailabilities ?? {},
    )) {
      siteNights[resourceId] = days.map((d) => d.availability);
    }

    for (const childId of Object.keys(data.mapLinkAvailabilities ?? {})) {
      await visit(Number(childId), depth + 1, seen);
    }
  };

  if (options.mapIds?.length) {
    const seen = new Set<number>();
    for (const mapId of options.mapIds) {
      await visit(mapId, 0, seen);
    }
  } else {
    await visit(options.rootMapId, 0, new Set());
  }

  return siteNights;
}

/** @deprecated Prefer fetchParkAvailability */
export async function fetchParkDailyAvailability(options: {
  rootMapId: number;
  resourceLocationId: number;
  startDate: string;
  endDate: string;
  partySize: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
  numEquipment?: number;
  mapIds?: number[];
}): Promise<Record<string, number[]>> {
  return fetchParkAvailability({
    ...options,
    getDailyAvailability: true,
  });
}

export function buildBookingUrl(options: {
  mapId: number;
  resourceLocationId: number;
  startDate: string;
  endDate: string;
  partySize: number;
  equipmentCategoryId: number;
  subEquipmentCategoryId?: number;
}): string {
  const params = new URLSearchParams({
    mapId: String(options.mapId),
    bookingCategoryId: "0",
    startDate: options.startDate,
    endDate: options.endDate,
    isReserving: "true",
    equipmentId: String(options.equipmentCategoryId),
    subEquipmentId:
      options.subEquipmentCategoryId != null
        ? String(options.subEquipmentCategoryId)
        : "",
    partySize: String(options.partySize),
    resourceLocationId: String(options.resourceLocationId),
  });

  return `${BCPARKS_BASE}/create-booking/results?${params.toString()}`;
}

export type ProcessedDay = {
  availability: number;
  processedAvailability: number;
  remainingQuota: number | null;
};

/**
 * Per-night status for one campsite. `processedAvailability` is what the
 * booking UI uses — 0 is online-reservable, 3 is typically FCFS / not reservable.
 */
export async function fetchResourceProcessedAvailability(options: {
  resourceId: string | number;
  startDate: string;
  endDate: string;
}): Promise<ProcessedDay[]> {
  const params = new URLSearchParams({
    resourceId: String(options.resourceId),
    bookingCategoryId: "0",
    startDate: options.startDate,
    endDate: options.endDate,
    isReserving: "true",
  });

  return getJson<ProcessedDay[]>(
    `${BCPARKS_BASE}/api/availability/resourcedailyavailability?${params}`,
  );
}

/** True when every night in the stay is online-reservable on this site. */
export async function isOnlineReservableStay(options: {
  resourceId: string | number;
  startDate: string;
  /** Inclusive last night of the stay */
  endDate: string;
  nightCount: number;
}): Promise<boolean> {
  const days = await fetchResourceProcessedAvailability({
    resourceId: options.resourceId,
    startDate: options.startDate,
    endDate: options.endDate,
  });

  if (days.length < options.nightCount) return false;

  return days
    .slice(0, options.nightCount)
    .every((day) => day.processedAvailability === AVAILABILITY_OPEN);
}
