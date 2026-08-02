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
const BLOCK_STATUS = new Set([403, 429]);
const MAX_ATTEMPTS = 5;
/** 403 from Azure Front Door rarely clears mid-request — don't burn the function budget. */
const MAX_403_ATTEMPTS = 2;

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function blockErrorMessage(status: number, url: string): string {
  if (status === 403) {
    const hostHint = isVercelRuntime()
      ? " Vercel egress IPs are often blocked; run locally for searches."
      : " Cloud/datacenter IPs are often blocked; residential egress usually works.";
    return `BC Parks API 403 (WAF blocked) for ${url}.${hostHint}`;
  }
  return `BC Parks API ${status} for ${url}`;
}

/**
 * Soft ceiling for outbound BC Parks calls from this process.
 * Undocumented edge limits + WAF mean bursts get 403/429; stay polite.
 * Fast values are used until a block is seen, then pacing degrades to the
 * safe values until enough clean responses accumulate (see noteBlock).
 */
const MAX_IN_FLIGHT_FAST = 6;
const MAX_IN_FLIGHT_SAFE = 4;
const MIN_START_GAP_FAST_MS = 150;
const MIN_START_GAP_SAFE_MS = 225;
/** Clean responses required before returning to fast pacing. */
const RECOVERY_SUCCESSES = 40;
/** After repeated blocks, pause the whole process briefly. */
const CIRCUIT_BLOCKS = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
/** Short personal TTL — snappy re-search without multi-minute staleness. */
const RESPONSE_TTL_MS = 25_000;

/**
 * Concurrent callers for the same URL share one in-flight fetch.
 * Successful responses are reused briefly (RESPONSE_TTL_MS).
 */
const inflightGets = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expires: number; value: unknown }>();

const paceState = {
  inFlight: 0,
  lastStartAt: 0,
  queue: [] as Array<() => void>,
  timer: null as ReturnType<typeof setTimeout> | null,
  blockHits: 0,
  cooldownUntil: 0,
  degraded: false,
  cleanSuccesses: 0,
};

function maxInFlight(): number {
  return paceState.degraded ? MAX_IN_FLIGHT_SAFE : MAX_IN_FLIGHT_FAST;
}

function minStartGapMs(): number {
  return paceState.degraded ? MIN_START_GAP_SAFE_MS : MIN_START_GAP_FAST_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function schedulePacePump(delayMs: number): void {
  if (paceState.timer != null) return;
  paceState.timer = setTimeout(() => {
    paceState.timer = null;
    pumpPaceGate();
  }, delayMs);
}

function pumpPaceGate(): void {
  while (paceState.queue.length > 0 && paceState.inFlight < maxInFlight()) {
    const now = Date.now();
    const gapWait = paceState.lastStartAt + minStartGapMs() - now;
    if (gapWait > 0) {
      schedulePacePump(gapWait);
      return;
    }

    const next = paceState.queue.shift();
    if (!next) return;
    paceState.inFlight += 1;
    paceState.lastStartAt = Date.now();
    next();
  }
}

async function acquirePaceSlot(): Promise<void> {
  const coolWait = paceState.cooldownUntil - Date.now();
  if (coolWait > 0) {
    await sleep(coolWait);
  }

  await new Promise<void>((resolve) => {
    paceState.queue.push(resolve);
    pumpPaceGate();
  });
}

function releasePaceSlot(): void {
  paceState.inFlight = Math.max(0, paceState.inFlight - 1);
  pumpPaceGate();
}

function noteBlock(): void {
  paceState.blockHits += 1;
  paceState.degraded = true;
  paceState.cleanSuccesses = 0;
  if (paceState.blockHits >= CIRCUIT_BLOCKS) {
    paceState.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    paceState.blockHits = 0;
  }
}

function noteSuccess(): void {
  paceState.blockHits = 0;
  if (!paceState.degraded) return;

  paceState.cleanSuccesses += 1;
  if (paceState.cleanSuccesses >= RECOVERY_SUCCESSES) {
    paceState.degraded = false;
    paceState.cleanSuccesses = 0;
  }
}

function retryDelayMs(
  status: number,
  attempt: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader) {
    const asInt = Number(retryAfterHeader);
    if (Number.isFinite(asInt) && asInt >= 0) {
      return Math.min(60_000, asInt * 1000);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.min(60_000, Math.max(0, asDate - Date.now()));
    }
  }

  if (BLOCK_STATUS.has(status)) {
    // ~2s, 5s, 12s, 25s, 40s (+ jitter)
    const base = Math.min(40_000, 1500 * 2 ** attempt);
    return base + Math.floor(Math.random() * 500);
  }

  return 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
}

async function pacedFetch(url: string): Promise<Response> {
  await acquirePaceSlot();
  try {
    return await fetch(url, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
  } finally {
    releasePaceSlot();
  }
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await pacedFetch(url);

    if (response.ok) {
      noteSuccess();
      return (await response.json()) as T;
    }

    const message = blockErrorMessage(response.status, url);
    lastError = new Error(message);

    // 403 from Azure Front Door rarely clears mid-request (especially on Vercel).
    const attemptsForStatus =
      response.status === 403 ? MAX_403_ATTEMPTS : MAX_ATTEMPTS;

    if (
      !RETRYABLE_STATUS.has(response.status) ||
      attempt >= attemptsForStatus
    ) {
      throw lastError;
    }

    // 429 = back off the process. 403 = WAF IP block; circuit cooldown just burns
    // Vercel’s maxDuration without recovering.
    if (response.status === 429) {
      noteBlock();
    }

    await sleep(
      retryDelayMs(
        response.status,
        attempt,
        response.headers.get("retry-after"),
      ),
    );
  }

  throw lastError ?? new Error(`BC Parks API failed for ${url}`);
}

async function getJson<T>(url: string): Promise<T> {
  const cached = responseCache.get(url);
  if (cached && cached.expires > Date.now()) {
    return cached.value as T;
  }
  if (cached) responseCache.delete(url);

  const existing = inflightGets.get(url);
  if (existing) return existing as Promise<T>;

  const request = fetchJsonWithRetry<T>(url)
    .then((data) => {
      responseCache.set(url, {
        expires: Date.now() + RESPONSE_TTL_MS,
        value: data,
      });
      return data;
    })
    .finally(() => {
      if (inflightGets.get(url) === request) {
        inflightGets.delete(url);
      }
    });

  inflightGets.set(url, request);
  return request;
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

function codesHaveOpen(codes: number[] | undefined): boolean {
  return (codes ?? []).some((code) => code === AVAILABILITY_OPEN);
}

export type SiteDailyAvailability = {
  nights: number[];
  mapId: number;
};

/**
 * Walk park map tree and merge per-site daily availability.
 * Fully booked child maps (no open nights on the link) are skipped.
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
  mapIds?: number[];
}): Promise<Record<string, SiteDailyAvailability>> {
  const siteNights: Record<string, SiteDailyAvailability> = {};
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
      siteNights[resourceId] = {
        nights: days.map((d) => d.availability),
        mapId,
      };
    }

    const links = Object.entries(data.mapLinkAvailabilities ?? {});
    for (const [childId, linkCodes] of links) {
      // Skip campgrounds/maps with no open nights in this stay window
      if (!codesHaveOpen(linkCodes)) continue;
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
}): Promise<Record<string, SiteDailyAvailability>> {
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
  resourceId?: string | number;
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

  if (options.resourceId != null) {
    params.set("resourceId", String(options.resourceId));
  }

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

type ResourcePayload = Record<
  string,
  {
    resourceId?: number;
    localizedValues?: Array<{
      cultureName?: string;
      name?: string;
      description?: string;
    }>;
    linkedResources?: Array<{
      linkedResourceId?: number;
      linkedResourceType?: number;
    }>;
  }
>;

export type ResourceMeta = {
  /** Campsite label from BC Parks (e.g. "B59", "D7") */
  name?: string;
  /** Half of a double site — both halves must be booked together */
  isDouble: boolean;
};

const resourceMetaCache = new Map<
  number,
  { expires: number; value: Record<string, ResourceMeta> }
>();
const RESOURCE_META_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Site labels and double-site flags keyed by resourceId for a park.
 * Cached longer than availability — neither changes when sites book.
 *
 * `linkedResources` is how GoingToCamp models a double site: each half links
 * to the other. It is the structured signal, and catches pairs whose English
 * description does not spell out "half of a double site".
 */
export async function fetchResourceMeta(
  resourceLocationId: number,
): Promise<Record<string, ResourceMeta>> {
  const hit = resourceMetaCache.get(resourceLocationId);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }

  const url = `${BCPARKS_BASE}/api/resourceLocation/resources?resourceLocationId=${resourceLocationId}`;
  const payload = await getJson<ResourcePayload>(url);

  const meta: Record<string, ResourceMeta> = {};
  for (const [id, resource] of Object.entries(payload)) {
    meta[id] = {
      name: resource.localizedValues?.[0]?.name?.trim() || undefined,
      isDouble: (resource.linkedResources ?? []).length > 0,
    };
  }

  resourceMetaCache.set(resourceLocationId, {
    expires: Date.now() + RESOURCE_META_TTL_MS,
    value: meta,
  });

  return meta;
}
