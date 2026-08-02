"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DayOfWeek } from "@/config/watcher.config";
import {
  areNightsContiguous,
  DAYS_OF_WEEK,
  isDayOfWeek,
  orderContiguousNights,
  shortDayLabel,
} from "@/lib/bcparks/weekends";
import type {
  AvailabilityReport,
  CheckEvent,
  CheckMeta,
  OpenSite,
  WeekendResult,
} from "@/lib/bcparks/types";

type PublicConfig = {
  homeBase?: string;
  maxDriveMinutesFromHome?: number;
  startDate: string;
  endDate: string;
  endDateLabel?: string;
  nights: string[];
  pollIntervalMinutes: number;
  partySize: number;
  tents: number;
  excludeDoubleSites?: boolean;
  parks: Array<{
    name: string;
    shortName: string;
    driveMinutesFromHome?: number;
  }>;
};

function formatCheckedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatStay(weekend: WeekendResult): string {
  const start = new Date(`${weekend.arrivalDate}T12:00:00Z`);
  const end = new Date(`${weekend.departureDate}T12:00:00Z`);
  const startLabel = start.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} → ${endLabel}`;
}

function resultKey(weekend: WeekendResult): string {
  return `${weekend.parkShortName}:${weekend.arrivalDate}:${weekend.departureDate}`;
}

const GONE_FLASH_MS = 12_000;

type GoneOpening = {
  key: string;
  weekend: WeekendResult;
  goneAt: number;
};

type SortBy = "date" | "distance";

function isSortBy(value: unknown): value is SortBy {
  return value === "date" || value === "distance";
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    err.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed")
  );
}

/** Idle gap between SSE chunks before we treat the stream as dead (sleep/wake). */
const STREAM_IDLE_MS = 90_000;

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const idleTimer = window.setTimeout(() => {
      cleanup();
      reject(new Error("STREAM_IDLE"));
    }, STREAM_IDLE_MS);

    const cleanup = () => {
      window.clearTimeout(idleTimer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (err: unknown) => {
        cleanup();
        reject(err);
      },
    );
  });
}

function sortWeekends(
  weekends: WeekendResult[],
  sortBy: SortBy = "date",
): WeekendResult[] {
  return [...weekends].sort((a, b) => {
    const driveDiff =
      (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
      (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER);
    const dateDiff = a.arrivalDate.localeCompare(b.arrivalDate);
    const nameDiff = a.parkShortName.localeCompare(b.parkShortName);

    if (sortBy === "distance") {
      if (driveDiff !== 0) return driveDiff;
      if (dateDiff !== 0) return dateDiff;
      return nameDiff;
    }

    if (dateDiff !== 0) return dateDiff;
    if (driveDiff !== 0) return driveDiff;
    return nameDiff;
  });
}

type PartySettings = {
  partySize: number;
  tents: number;
};

type DateSettings = {
  startDate: string;
  endDate: string;
};

const DEFAULT_PARTY: PartySettings = {
  partySize: 4,
  tents: 1,
};

const DEFAULT_DATES: DateSettings = {
  startDate: "2026-07-29",
  endDate: "2026-09-08",
};

const DEFAULT_NIGHTS: DayOfWeek[] = ["friday", "saturday"];

function partyFromConfig(config: PublicConfig): PartySettings {
  return {
    partySize: config.partySize ?? DEFAULT_PARTY.partySize,
    tents: config.tents ?? DEFAULT_PARTY.tents,
  };
}

function datesFromConfig(config: PublicConfig): DateSettings {
  return {
    startDate: config.startDate || DEFAULT_DATES.startDate,
    endDate: config.endDate || DEFAULT_DATES.endDate,
  };
}

function nightsFromConfig(config: PublicConfig): DayOfWeek[] {
  const parsed = (config.nights ?? [])
    .map((night) => night.toLowerCase())
    .filter(isDayOfWeek);
  if (parsed.length > 0 && areNightsContiguous(parsed)) {
    return orderContiguousNights(parsed);
  }
  return DEFAULT_NIGHTS;
}

function nightsKey(nights: DayOfWeek[]): string {
  return nights.join(",");
}

/**
 * Settings that change which sites qualify, so sticky results from a previous
 * value can never be reused.
 */
function resultsSignature(party: PartySettings, excludeDoubles: boolean): string {
  return `${party.partySize}:${party.tents}:${excludeDoubles ? "nodbl" : "all"}`;
}

/**
 * Everything that decides which openings a scan can return. The first completed
 * scan for a signature is a silent baseline, so only openings that appear while
 * watching raise an alert.
 */
function filterSignature(
  parks: Set<string>,
  party: PartySettings,
  dates: DateSettings,
  nights: DayOfWeek[],
  excludeDoubles: boolean,
): string {
  return [
    [...parks].sort().join("|"),
    resultsSignature(party, excludeDoubles),
    `${dates.startDate}..${dates.endDate}`,
    nightsKey(nights),
  ].join(";");
}

function resultMatchesFilters(
  weekend: WeekendResult,
  parks: Set<string>,
  dates: DateSettings,
  nights: DayOfWeek[],
): boolean {
  if (!parks.has(weekend.parkShortName)) return false;
  if (weekend.arrivalDate < dates.startDate) return false;
  if (weekend.departureDate >= dates.endDate) return false;
  if (!areNightsContiguous(nights)) return false;

  const ordered = orderContiguousNights(nights);
  if (weekend.nights.length !== ordered.length) return false;

  for (let i = 0; i < ordered.length; i += 1) {
    const nightDate = weekend.nights[i]?.date;
    if (!nightDate) return false;
    const dow = new Date(`${nightDate}T12:00:00Z`).getUTCDay();
    if (DAYS_OF_WEEK[dow] !== ordered[i]) return false;
  }

  return true;
}

function pruneWeekendsToFilters(
  weekends: WeekendResult[],
  parks: Set<string>,
  dates: DateSettings,
  nights: DayOfWeek[],
): WeekendResult[] {
  return weekends.filter((weekend) =>
    resultMatchesFilters(weekend, parks, dates, nights),
  );
}

const STORAGE_KEY = "bcparks-watcher-filters-v1";

type SavedFilters = {
  parks?: string[];
  party?: PartySettings;
  dates?: DateSettings;
  nights?: string[];
  autoRefresh?: boolean;
  sortBy?: SortBy;
  excludeDoubles?: boolean;
};

function readSavedFilters(): SavedFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedFilters;
  } catch {
    return null;
  }
}

function writeSavedFilters(filters: SavedFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota / private mode
  }
}

function todayIsoLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ALERT_PEAK_GAIN = 0.6;

let audioCtx: AudioContext | null = null;

/** One shared context — per-alert contexts hit browser limits and start suspended. */
function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Autoplay policy only lifts inside a user gesture; call from a real event. */
function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

async function playAlertTone(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Resume before reading currentTime — a suspended clock does not advance.
    if (ctx.state === "suspended") await ctx.resume();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.connect(ctx.destination);

    const beep = (freq: number, start: number, duration: number) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(ALERT_PEAK_GAIN, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      gain.connect(compressor);

      // Detuned pair: carries further than a bare sine at the same amplitude.
      for (const detune of [0, 7]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + duration + 0.03);
      }
    };

    const t = ctx.currentTime;
    beep(880, t, 0.16);
    beep(1245, t + 0.18, 0.16);
    beep(1245, t + 0.38, 0.28);
  } catch {
    // autoplay / unsupported — ignore
  }
}

function announceOpening(weekend: WeekendResult): void {
  void playAlertTone();
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const sites = (weekend.openSites ?? [])
    .slice(0, 3)
    .map((site) => site.name ?? formatSiteId(site.resourceId))
    .join(", ");
  new Notification("BC Parks site open", {
    body: `${weekend.parkShortName}: ${weekend.arrivalDate} → ${weekend.departureDate} · ${weekend.fullWeekendSites} site(s)${sites ? ` · ${sites}` : ""}`,
    requireInteraction: true,
    tag: resultKey(weekend),
  });
}

export function Dashboard() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [meta, setMeta] = useState<CheckMeta | null>(null);
  const [weekends, setWeekends] = useState<WeekendResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState({ index: 0, total: 0 });
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifyPermission, setNotifyPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [selectedParks, setSelectedParks] = useState<Set<string>>(new Set());
  const [party, setParty] = useState<PartySettings>(DEFAULT_PARTY);
  const [dates, setDates] = useState<DateSettings>(DEFAULT_DATES);
  const [nights, setNights] = useState<DayOfWeek[]>(DEFAULT_NIGHTS);
  const [excludeDoubles, setExcludeDoubles] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [recentlyGone, setRecentlyGone] = useState<GoneOpening[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);
  const previousHits = useRef<Set<string>>(new Set());
  const hitsBeforeSearch = useRef<Map<string, WeekendResult>>(new Map());
  const weekendsRef = useRef<WeekendResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const selectedParksRef = useRef(selectedParks);
  const partyRef = useRef(party);
  const datesRef = useRef(dates);
  const nightsRef = useRef(nights);
  const excludeDoublesRef = useRef(excludeDoubles);
  const sortByRef = useRef(sortBy);
  const autoRefreshRef = useRef(autoRefresh);
  const configRef = useRef(config);
  const isCheckingRef = useRef(isChecking);
  const lastSuccessAtRef = useRef(0);
  const resumeTimerRef = useRef<number | null>(null);
  const loadRef = useRef<
    ((parksOverride?: Set<string>) => Promise<void>) | null
  >(null);
  const skipSettingsReload = useRef(true);
  /** Signature of the settings that produced the results currently on screen */
  const resultsPartyKey = useRef(resultsSignature(party, excludeDoubles));
  /** Filter signature whose openings have already been seen at least once */
  const baselineSignature = useRef<string | null>(null);

  const nightsContiguous = useMemo(
    () => areNightsContiguous(nights),
    [nights],
  );

  useEffect(() => {
    selectedParksRef.current = selectedParks;
  }, [selectedParks]);

  useEffect(() => {
    weekendsRef.current = weekends;
  }, [weekends]);

  useEffect(() => {
    if (recentlyGone.length === 0) return;
    const id = window.setInterval(() => {
      const cutoff = Date.now() - GONE_FLASH_MS;
      setRecentlyGone((current) => {
        const next = current.filter((item) => item.goneAt > cutoff);
        return next.length === current.length ? current : next;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [recentlyGone.length]);

  useEffect(() => {
    partyRef.current = party;
  }, [party]);

  useEffect(() => {
    datesRef.current = dates;
  }, [dates]);

  useEffect(() => {
    nightsRef.current = nights;
  }, [nights]);

  useEffect(() => {
    excludeDoublesRef.current = excludeDoubles;
  }, [excludeDoubles]);

  useEffect(() => {
    sortByRef.current = sortBy;
  }, [sortBy]);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    isCheckingRef.current = isChecking;
  }, [isChecking]);

  const scheduleResumeLoad = useCallback((delayMs = 600) => {
    if (resumeTimerRef.current != null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      if (!navigator.onLine) return;
      void loadRef.current?.();
    }, delayMs);
  }, []);

  const markGone = useCallback((weekend: WeekendResult) => {
    const key = resultKey(weekend);
    previousHits.current.delete(key);
    hitsBeforeSearch.current.delete(key);
    setRecentlyGone((current) => {
      if (current.some((item) => item.key === key)) return current;
      return [
        ...current,
        {
          key,
          weekend: { ...weekend, hasFullWeekend: false, hasAnyAvailability: false },
          goneAt: Date.now(),
        },
      ];
    });
  }, []);

  const load = useCallback(async (parksOverride?: Set<string>) => {
    const parksToCheck = parksOverride ?? selectedParksRef.current;
    const partyToUse = partyRef.current;
    const datesToUse = datesRef.current;
    const nightsToUse = nightsRef.current;
    const excludeDoublesToUse = excludeDoublesRef.current;
    const runSignature = filterSignature(
      parksToCheck,
      partyToUse,
      datesToUse,
      nightsToUse,
      excludeDoublesToUse,
    );
    // Openings already on screen when a scan starts are not new.
    const announceNewHits = baselineSignature.current === runSignature;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setErrors([]);
    setProgress({ index: 0, total: 0 });

    const partyKey = resultsSignature(partyToUse, excludeDoublesToUse);
    if (resultsPartyKey.current !== partyKey) {
      // Party/tents/double-site changes alter which sites qualify — drop all
      // sticky results.
      setWeekends([]);
      setRecentlyGone([]);
      previousHits.current = new Set();
      hitsBeforeSearch.current = new Map();
      resultsPartyKey.current = partyKey;
    } else {
      const pruned = pruneWeekendsToFilters(
        weekendsRef.current,
        parksToCheck,
        datesToUse,
        nightsToUse,
      );
      hitsBeforeSearch.current = new Map(
        pruned
          .filter((weekend) => weekend.hasFullWeekend)
          .map((weekend) => [resultKey(weekend), weekend]),
      );
      setRecentlyGone([]);
      setWeekends(pruned);
      const keepKeys = new Set(
        pruned.filter((weekend) => weekend.hasFullWeekend).map(resultKey),
      );
      previousHits.current = new Set(
        [...previousHits.current].filter((key) => keepKeys.has(key)),
      );
    }

    if (!areNightsContiguous(nightsToUse)) {
      setIsChecking(false);
      setError("Select contiguous nights before searching.");
      return;
    }

    setIsChecking(true);

    if (parksToCheck.size === 0) {
      setWeekends([]);
      setRecentlyGone([]);
      previousHits.current = new Set();
      hitsBeforeSearch.current = new Map();
      setIsChecking(false);
      return;
    }

    const ordered = orderContiguousNights(nightsToUse);
    const params = new URLSearchParams({
      parks: Array.from(parksToCheck).join(","),
      partySize: String(partyToUse.partySize),
      tents: String(partyToUse.tents),
      startDate: datesToUse.startDate,
      endDate: datesToUse.endDate,
      nights: ordered.join(","),
      excludeDoubles: excludeDoublesToUse ? "1" : "0",
      // Ensure each Search/auto-refresh is a distinct request
      _: String(Date.now()),
    });

    let sawDone = false;

    try {
      // Optimistic clock so a fast re-search still shows a new "Updated" time
      setMeta((current) =>
        current
          ? { ...current, checkedAt: new Date().toISOString() }
          : current,
      );

      const response = await fetch(`/api/availability/stream?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await readStreamChunk(
          reader,
          controller.signal,
        );
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;

          let event: CheckEvent;
          try {
            event = JSON.parse(line.slice(6)) as CheckEvent;
          } catch {
            continue;
          }

          if (event.type === "meta") {
            setMeta(event.meta);
            setProgress({ index: 0, total: event.meta.totalChecks });
          } else if (event.type === "result") {
            setProgress({ index: event.index, total: event.total });
            const key = resultKey(event.result);

            if (event.result.hasFullWeekend) {
              setRecentlyGone((current) =>
                current.filter((item) => item.key !== key),
              );
              hitsBeforeSearch.current.delete(key);
              setWeekends((current) =>
                sortWeekends(
                  [
                    ...current.filter((item) => resultKey(item) !== key),
                    event.result,
                  ],
                  sortByRef.current,
                ),
              );
              if (!previousHits.current.has(key)) {
                previousHits.current.add(key);
                if (announceNewHits) {
                  announceOpening(event.result);
                }
              }
            } else {
              const prior = hitsBeforeSearch.current.get(key);
              if (prior) {
                markGone(prior);
              }
              setWeekends((current) =>
                sortWeekends(
                  [
                    ...current.filter((item) => resultKey(item) !== key),
                    event.result,
                  ],
                  sortByRef.current,
                ),
              );
            }
          } else if (event.type === "error") {
            setProgress({ index: event.index, total: event.total });
            setErrors((current) => [...current, event.error]);
          } else if (event.type === "done") {
            sawDone = true;
            lastSuccessAtRef.current = Date.now();
            setMeta({
              checkedAt: event.report.checkedAt,
              startDate: event.report.startDate,
              endDate: event.report.endDate,
              endDateLabel: event.report.endDateLabel,
              nightLabels: event.report.nightLabels,
              pollIntervalMinutes: event.report.pollIntervalMinutes,
              homeBase: event.report.homeBase,
              maxDriveMinutesFromHome: event.report.maxDriveMinutesFromHome,
              party: event.report.party,
              parksChecked: event.report.parksChecked,
              totalChecks:
                event.report.weekends.length + event.report.errors.length,
            });
            setWeekends(sortWeekends(event.report.weekends, sortByRef.current));
            resultsPartyKey.current = resultsSignature(
              partyRef.current,
              excludeDoublesRef.current,
            );
            setErrors(event.report.errors);
            setProgress({
              index: event.report.weekends.length + event.report.errors.length,
              total: event.report.weekends.length + event.report.errors.length,
            });

            const hitKeys = new Set(
              event.report.weekends
                .filter((weekend) => weekend.hasFullWeekend)
                .map(resultKey),
            );
            for (const [key, weekend] of hitsBeforeSearch.current) {
              if (!hitKeys.has(key)) {
                markGone(weekend);
              }
            }
            hitsBeforeSearch.current = new Map();
            previousHits.current = hitKeys;
            baselineSignature.current = runSignature;
          }
        }
      }

      if (!sawDone && !controller.signal.aborted) {
        throw new Error("INTERRUPTED");
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      const interrupted =
        err instanceof Error &&
        (err.message === "INTERRUPTED" ||
          err.message === "STREAM_IDLE" ||
          isNetworkError(err));
      if (interrupted) {
        setError("Connection interrupted — will retry when you're back.");
        if (autoRefreshRef.current) {
          scheduleResumeLoad(1_200);
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (abortRef.current === controller) {
        setIsChecking(false);
      }
    }
  }, [markGone, scheduleResumeLoad]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/config")
      .then((response) => response.json())
      .then((data: PublicConfig) => {
        if (cancelled) return;
        const saved = readSavedFilters();
        const available = data.parks.map((park) => park.shortName);
        const availableSet = new Set(available);

        const parks = new Set(
          saved?.parks?.length
            ? saved.parks.filter((name) => availableSet.has(name))
            : available,
        );
        if (parks.size === 0) {
          for (const name of available) parks.add(name);
        }

        const nextParty = saved?.party
          ? {
              partySize: saved.party.partySize || data.partySize,
              tents: saved.party.tents || data.tents,
            }
          : partyFromConfig(data);

        const configDates = datesFromConfig(data);
        const today = todayIsoLocal();
        let nextDates = saved?.dates
          ? {
              startDate: saved.dates.startDate || configDates.startDate,
              endDate: saved.dates.endDate || configDates.endDate,
            }
          : configDates;
        if (nextDates.startDate < today) {
          nextDates = { ...nextDates, startDate: today };
        }
        if (nextDates.startDate >= nextDates.endDate) {
          nextDates = configDates;
        }

        const savedNights = (saved?.nights ?? [])
          .map((night) => night.toLowerCase())
          .filter(isDayOfWeek);
        const nextNights =
          savedNights.length > 0 && areNightsContiguous(savedNights)
            ? orderContiguousNights(savedNights)
            : nightsFromConfig(data);

        if (typeof saved?.autoRefresh === "boolean") {
          setAutoRefresh(saved.autoRefresh);
        }
        if (isSortBy(saved?.sortBy)) {
          setSortBy(saved.sortBy);
          sortByRef.current = saved.sortBy;
        }

        const nextExcludeDoubles =
          typeof saved?.excludeDoubles === "boolean"
            ? saved.excludeDoubles
            : Boolean(data.excludeDoubleSites);

        setConfig(data);
        setSelectedParks(parks);
        setParty(nextParty);
        setDates(nextDates);
        setNights(nextNights);
        setExcludeDoubles(nextExcludeDoubles);
        partyRef.current = nextParty;
        datesRef.current = nextDates;
        nightsRef.current = nextNights;
        excludeDoublesRef.current = nextExcludeDoubles;
        resultsPartyKey.current = resultsSignature(
          nextParty,
          nextExcludeDoubles,
        );
        setSettingsReady(true);
        void load(parks);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });

    // Request browser notification permission up front so openings can alert by default
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        void Notification.requestPermission().then((permission) => {
          if (!cancelled) setNotifyPermission(permission);
        });
      } else {
        setNotifyPermission(Notification.permission);
      }
    } else {
      queueMicrotask(() => {
        if (!cancelled) setNotifyPermission("unsupported");
      });
    }

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!settingsReady) return;
    writeSavedFilters({
      parks: Array.from(selectedParks),
      party,
      dates,
      nights,
      autoRefresh,
      sortBy,
      excludeDoubles,
    });
  }, [
    settingsReady,
    selectedParks,
    party,
    dates,
    nights,
    autoRefresh,
    sortBy,
    excludeDoubles,
  ]);

  useEffect(() => {
    if (!autoRefresh || !config) return;
    const ms = Math.max(config.pollIntervalMinutes, 1) * 60_000;
    const id = window.setInterval(() => {
      if (!navigator.onLine) return;
      void load();
    }, ms);
    return () => window.clearInterval(id);
  }, [autoRefresh, config, load]);

  // Alerts fire on a timer, not a click — unlock audio on the first gesture
  // so the tone is not silenced by autoplay policy later.
  useEffect(() => {
    const onGesture = () => unlockAudio();
    const options = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", onGesture, options);
    window.addEventListener("keydown", onGesture, options);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  // Survive laptop sleep / network blips: abort hung searches and catch up.
  // Keep polling while the tab is hidden; only gate on connectivity.
  useEffect(() => {
    if (!settingsReady) return;

    const resumeIfNeeded = () => {
      if (!autoRefreshRef.current) return;
      if (!navigator.onLine) return;

      const pollMs =
        Math.max(configRef.current?.pollIntervalMinutes ?? 10, 1) * 60_000;
      const due =
        lastSuccessAtRef.current === 0 ||
        Date.now() - lastSuccessAtRef.current >= pollMs * 0.8;

      if (isCheckingRef.current) {
        // Mid-search connections often die across sleep — restart cleanly.
        abortRef.current?.abort();
        setIsChecking(false);
        scheduleResumeLoad(800);
        return;
      }

      if (due) {
        scheduleResumeLoad(500);
      }
    };

    const onVisibility = () => {
      // Browsers throttle timers in background; catch up when shown again.
      if (document.visibilityState === "visible") resumeIfNeeded();
    };
    const onOnline = () => resumeIfNeeded();
    const onPageShow = () => resumeIfNeeded();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      if (resumeTimerRef.current != null) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, [settingsReady, scheduleResumeLoad]);

  // Drop sticky results immediately when filters change (before search restarts).
  useEffect(() => {
    if (!settingsReady) return;
    const parks = selectedParks;
    const partyKey = resultsSignature(party, excludeDoubles);
    if (resultsPartyKey.current !== partyKey) {
      setWeekends([]);
      setRecentlyGone([]);
      previousHits.current = new Set();
      hitsBeforeSearch.current = new Map();
      resultsPartyKey.current = partyKey;
      return;
    }
    setRecentlyGone((current) =>
      current.filter((item) =>
        resultMatchesFilters(item.weekend, parks, dates, nights),
      ),
    );
    setWeekends((current) => {
      const next = pruneWeekendsToFilters(current, parks, dates, nights);
      const keepKeys = new Set(
        next.filter((weekend) => weekend.hasFullWeekend).map(resultKey),
      );
      previousHits.current = new Set(
        [...previousHits.current].filter((key) => keepKeys.has(key)),
      );
      return next;
    });
  }, [
    settingsReady,
    selectedParks,
    dates.startDate,
    dates.endDate,
    nightsKey(nights),
    party.partySize,
    party.tents,
    excludeDoubles,
  ]);
  useEffect(() => {
    if (!settingsReady || !config) return;
    if (skipSettingsReload.current) {
      skipSettingsReload.current = false;
      return;
    }
    if (!areNightsContiguous(nights)) {
      abortRef.current?.abort();
      setIsChecking(false);
      return;
    }
    const id = window.setTimeout(() => {
      void load();
    }, 350);
    return () => window.clearTimeout(id);
    // Intentionally keyed on settings fields only — not load/config identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    party.partySize,
    party.tents,
    dates.startDate,
    dates.endDate,
    nightsKey(nights),
    excludeDoubles,
    settingsReady,
  ]);

  const requestNotifications = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotifyPermission(permission);
  };

  const togglePark = (shortName: string) => {
    setSelectedParks((current) => {
      const next = new Set(current);
      if (next.has(shortName)) next.delete(shortName);
      else next.add(shortName);
      void load(next);
      return next;
    });
  };

  const toggleNight = (day: DayOfWeek) => {
    setNights((current) => {
      const selected = new Set(current);
      if (selected.has(day)) selected.delete(day);
      else selected.add(day);
      return DAYS_OF_WEEK.filter((entry) => selected.has(entry));
    });
  };

  const updateParty = <K extends keyof PartySettings>(
    key: K,
    value: PartySettings[K],
  ) => {
    setParty((current) => ({ ...current, [key]: value }));
  };

  const updateDates = <K extends keyof DateSettings>(
    key: K,
    value: DateSettings[K],
  ) => {
    setDates((current) => {
      const next = { ...current, [key]: value };
      if (key === "startDate" && value >= next.endDate) {
        const [y, m, d] = value.split("-").map(Number);
        const bumped = new Date(Date.UTC(y, m - 1, d + 1));
        next.endDate = bumped.toISOString().slice(0, 10);
      }
      if (key === "endDate" && value <= next.startDate) {
        const [y, m, d] = value.split("-").map(Number);
        const bumped = new Date(Date.UTC(y, m - 1, d - 1));
        next.startDate = bumped.toISOString().slice(0, 10);
      }
      return next;
    });
  };

  const fullHits = useMemo(
    () =>
      sortWeekends(
        weekends.filter((w) => w.hasFullWeekend),
        sortBy,
      ),
    [weekends, sortBy],
  );
  const visibleGone = useMemo(
    () =>
      sortWeekends(
        recentlyGone.map((item) => item.weekend),
        sortBy,
      ),
    [recentlyGone, sortBy],
  );
  const progressLabel =
    isChecking && progress.total > 0
      ? `${progress.index}/${progress.total}`
      : null;
  const selectedCount = selectedParks.size;
  const totalParks = config?.parks.length ?? 0;
  const statusLine = isChecking
    ? progressLabel
      ? `Searching ${progressLabel}`
      : "Searching…"
    : meta
      ? `Updated ${formatCheckedAt(meta.checkedAt)}${
          visibleGone.length > 0
            ? ` · ${visibleGone.length} gone`
            : ""
        }`
      : "Ready";
  const emptyMessage = !nightsContiguous
    ? "Choose consecutive nights to search."
    : selectedParks.size === 0
      ? "Select at least one park."
      : isChecking
        ? "Looking for openings…"
        : visibleGone.length > 0
          ? "No openings left — recent ones faded below."
          : "No openings for these filters.";

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero-top">
          <p className="brand">BC Parks Watcher</p>
          <div className="actions">
            {isChecking ? (
              <button
                type="button"
                className="btn stop"
                aria-label="Stop search"
                title="Stop search"
                onClick={() => abortRef.current?.abort()}
              >
                <span className="stop-icon" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => void load()}
                disabled={!nightsContiguous || selectedParks.size === 0}
              >
                Search
              </button>
            )}
          </div>
        </div>

        <p className="status-line">
          <span>{statusLine}</span>
          <span className="status-sep" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className={`text-toggle ${autoRefresh ? "on" : ""}`}
            onClick={() => setAutoRefresh((value) => !value)}
          >
            Auto{" "}
            {autoRefresh
              ? formatDuration(config?.pollIntervalMinutes ?? 10)
              : "off"}
          </button>
          {notifyPermission !== "granted" &&
          notifyPermission !== "unsupported" ? (
            <>
              <span className="status-sep" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="text-toggle"
                onClick={() => void requestNotifications()}
                disabled={notifyPermission === "denied"}
              >
                {notifyPermission === "denied" ? "Alerts blocked" : "Enable alerts"}
              </button>
            </>
          ) : null}
        </p>

        <div className="filters">
          <div className="filter-row">
            <div className="filter-block">
              <span className="filter-label">Nights</span>
              <div
                className="day-chips"
                role="group"
                aria-label="Nights to stay"
              >
                {DAYS_OF_WEEK.map((day) => {
                  const selected = nights.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`day-chip ${selected ? "selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => toggleNight(day)}
                    >
                      {shortDayLabel(day)}
                    </button>
                  );
                })}
              </div>
              {!nightsContiguous ? (
                <p className="day-hint">Nights must be consecutive.</p>
              ) : null}
            </div>

            <div className="filter-block">
              <span className="filter-label">Sites</span>
              <div className="day-chips" role="group" aria-label="Site types">
                <button
                  type="button"
                  className={`day-chip ${excludeDoubles ? "selected" : ""}`}
                  aria-pressed={excludeDoubles}
                  title="Double sites must be booked together with their other half"
                  onClick={() => setExcludeDoubles((value) => !value)}
                >
                  Hide doubles
                </button>
              </div>
            </div>
          </div>

          <div className="filter-block">
            <span className="filter-label">When & party</span>
            <div
              className="party-controls"
              role="group"
              aria-label="Dates and party"
            >
              <DateField
                label="From"
                value={dates.startDate}
                max={dates.endDate}
                onChange={(value) => updateDates("startDate", value)}
              />
              <DateField
                label="Until"
                value={dates.endDate}
                min={dates.startDate}
                onChange={(value) => updateDates("endDate", value)}
              />
              <Stepper
                label="People"
                value={party.partySize}
                min={1}
                max={16}
                onChange={(value) => updateParty("partySize", value)}
              />
              <Stepper
                label="Tents"
                value={party.tents}
                min={1}
                max={3}
                onChange={(value) => updateParty("tents", value)}
              />
            </div>
          </div>

          {config?.parks?.length ? (
            <div className="filter-block">
              <span className="filter-label">
                Parks
                {selectedCount > 0 && totalParks > 0
                  ? ` · ${selectedCount}/${totalParks}`
                  : ""}
              </span>
              <div className="park-chips" role="group" aria-label="Parks">
                {config.parks.map((park) => {
                  const selected = selectedParks.has(park.shortName);
                  return (
                    <button
                      key={park.shortName}
                      type="button"
                      className={`park-chip ${selected ? "selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => togglePark(park.shortName)}
                    >
                      <span className="park-chip-name">{park.shortName}</span>
                      {park.driveMinutesFromHome != null ? (
                        <span className="park-drive">
                          {formatDuration(park.driveMinutesFromHome)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {isChecking && progress.total > 0 ? (
          <div
            className="progress-track"
            aria-label={`Progress ${progress.index} of ${progress.total}`}
          >
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(
                  100,
                  (progress.index / progress.total) * 100,
                )}%`,
              }}
            />
          </div>
        ) : null}
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      <section
        className={`section ${fullHits.length > 0 || visibleGone.length > 0 ? "highlight" : ""}`}
      >
        <div className="section-head">
          <h2>
            Openings
            {fullHits.length > 0 ? (
              <span className="count">{fullHits.length}</span>
            ) : null}
          </h2>
          {fullHits.length > 0 || visibleGone.length > 0 ? (
            <div className="sort-toggle" role="group" aria-label="Sort openings">
              <span className="sort-label">Sort</span>
              <div className="sort-seg">
                <button
                  type="button"
                  className={`sort-option ${sortBy === "date" ? "selected" : ""}`}
                  aria-pressed={sortBy === "date"}
                  onClick={() => setSortBy("date")}
                >
                  Date
                </button>
                <button
                  type="button"
                  className={`sort-option ${sortBy === "distance" ? "selected" : ""}`}
                  aria-pressed={sortBy === "distance"}
                  onClick={() => setSortBy("distance")}
                >
                  Distance
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {fullHits.length > 0 || visibleGone.length > 0 ? (
          <div className="result-list">
            {fullHits.map((weekend) => (
              <WeekendRow
                key={resultKey(weekend)}
                weekend={weekend}
                party={party}
                excludeDoubles={excludeDoubles}
                onExpandSites={(key, expansion) => {
                  setWeekends((current) =>
                    sortWeekends(
                      current.map((item) => {
                        if (resultKey(item) !== key) return item;
                        const seen = new Set(
                          item.openSites.map((site) => site.resourceId),
                        );
                        const added = expansion.openSites.filter(
                          (site) => !seen.has(site.resourceId),
                        );
                        const openSites = [...item.openSites, ...added];
                        return {
                          ...item,
                          openSites,
                          fullWeekendSites: openSites.length,
                          sitesCapped: expansion.sitesCapped,
                          nights: item.nights.map((night) => ({
                            ...night,
                            availableSites: openSites.length,
                          })),
                        };
                      }),
                      sortByRef.current,
                    ),
                  );
                }}
              />
            ))}
            {visibleGone.map((weekend) => (
              <GoneRow key={`gone:${resultKey(weekend)}`} weekend={weekend} />
            ))}
          </div>
        ) : isChecking ? (
          <div className="skeleton" />
        ) : (
          <p className="empty">{emptyMessage}</p>
        )}
      </section>

      {errors.length > 0 ? (
        <section className="section">
          <h2>Errors</h2>
          <ul className="error-list">
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="stepper date-field">
      <span className="stepper-label">{label}</span>
      <input
        type="date"
        className="date-input"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="stepper">
      <span className="stepper-label">{label}</span>
      <span className="stepper-controls">
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <span className="stepper-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </span>
    </label>
  );
}

function formatSiteId(resourceId: string): string {
  return resourceId.startsWith("-") ? resourceId.slice(1) : resourceId;
}

function siteLabel(site: { resourceId: string; name?: string }): string {
  return site.name?.trim() || formatSiteId(site.resourceId);
}

function bookingUrlForSite(base: string, resourceId: string): string {
  try {
    const url = new URL(base);
    url.searchParams.set("resourceId", resourceId);
    return url.toString();
  } catch {
    return base;
  }
}

function GoneRow({ weekend }: { weekend: WeekendResult }) {
  return (
    <article className="result gone" aria-label="Opening no longer available">
      <div className="result-main">
        <div className="result-title">
          <span className="park">{weekend.parkShortName}</span>
          <span className="stay">{formatStay(weekend)}</span>
          {weekend.driveMinutesFromHome != null ? (
            <span className="drive">
              {formatDuration(weekend.driveMinutesFromHome)}
            </span>
          ) : null}
        </div>
      </div>
      <span className="gone-badge">Gone</span>
    </article>
  );
}

function WeekendRow({
  weekend,
  party,
  excludeDoubles,
  onExpandSites,
}: {
  weekend: WeekendResult;
  party: PartySettings;
  excludeDoubles: boolean;
  onExpandSites: (
    key: string,
    expansion: { openSites: OpenSite[]; sitesCapped: boolean },
  ) => void;
}) {
  const sites = weekend.openSites ?? [];
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const loadMore = async () => {
    if (loadingMore || !weekend.sitesCapped) return;
    const lastNight = weekend.nights[weekend.nights.length - 1]?.date;
    if (!lastNight) {
      setMoreError("Missing night dates");
      return;
    }

    setLoadingMore(true);
    setMoreError(null);

    const params = new URLSearchParams({
      park: weekend.parkShortName,
      arrivalDate: weekend.arrivalDate,
      lastNightDate: lastNight,
      nightCount: String(weekend.nights.length),
      partySize: String(party.partySize),
      tents: String(party.tents),
      excludeDoubles: excludeDoubles ? "1" : "0",
      exclude: sites.map((site) => site.resourceId).join(","),
    });

    try {
      const response = await fetch(`/api/availability/more?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        openSites?: OpenSite[];
        sitesCapped?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      onExpandSites(resultKey(weekend), {
        openSites: data.openSites ?? [],
        sitesCapped: Boolean(data.sitesCapped),
      });
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <article className="result">
      <div className="result-main">
        <div className="result-title">
          <span className="park">{weekend.parkShortName}</span>
          <span className="stay">{formatStay(weekend)}</span>
          {weekend.driveMinutesFromHome != null ? (
            <span className="drive">
              {formatDuration(weekend.driveMinutesFromHome)}
            </span>
          ) : null}
          <span className="site-count">
            {weekend.fullWeekendSites}
            {weekend.sitesCapped ? "+" : ""}{" "}
            {weekend.fullWeekendSites === 1 ? "site" : "sites"}
          </span>
        </div>
        {sites.length > 0 ? (
          <div className="site-ids" aria-label="Open campsites">
            {sites.map((site) => (
              <a
                key={site.resourceId}
                className={`site-id ${site.isDouble ? "double" : ""}`}
                href={bookingUrlForSite(weekend.bookingUrl, site.resourceId)}
                target="_blank"
                rel="noreferrer"
                title={
                  site.isDouble
                    ? `${siteLabel(site)} — half of a double site, must be booked with its other half`
                    : site.name
                      ? `${site.name}`
                      : `Site ${formatSiteId(site.resourceId)}`
                }
              >
                {siteLabel(site)}
                {site.isDouble ? (
                  <span className="site-double" aria-label="double site">
                    ×2
                  </span>
                ) : null}
              </a>
            ))}
            {weekend.sitesCapped ? (
              <button
                type="button"
                className="site-id muted more-sites"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                aria-busy={loadingMore}
                title="Find remaining open campsites"
              >
                {loadingMore ? (
                  <span className="chip-spinner" aria-hidden="true" />
                ) : null}
                {loadingMore ? "finding…" : "more"}
              </button>
            ) : null}
          </div>
        ) : null}
        {moreError ? <p className="more-error">{moreError}</p> : null}
      </div>
      <a
        className="book"
        href={weekend.bookingUrl}
        target="_blank"
        rel="noreferrer"
      >
        Book
      </a>
    </article>
  );
}
