import { BCPARKS_BASE, type MapAvailabilityResponse, type ResourceLocation } from "./types";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; BCParksWeekendWatcher/1.0; +local-dev)",
  Accept: "application/json",
  "Accept-Language": "en-CA,en;q=0.9",
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`BC Parks API ${response.status} for ${url}`);
  }

  return (await response.json()) as T;
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
