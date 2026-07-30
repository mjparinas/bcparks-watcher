"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AvailabilityReport,
  CheckEvent,
  CheckMeta,
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
  parks: Array<{
    name: string;
    shortName: string;
    driveMinutesFromHome?: number;
  }>;
};

function formatRangeLabel(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T12:00:00Z`);
  const endExclusive = new Date(`${endDate}T12:00:00Z`);
  const endInclusive = new Date(endExclusive);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);

  const fmt = (date: Date) =>
    date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return `${fmt(start)} → ${fmt(endInclusive)}`;
}

function formatCheckedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

function formatPartyLabel(party: PartySettings): string {
  const people = `${party.partySize} ${party.partySize === 1 ? "person" : "people"}`;
  const tentLabel = `${party.tents} tent${party.tents === 1 ? "" : "s"}`;
  return `${people}, ${tentLabel}`;
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
  const [settingsReady, setSettingsReady] = useState(false);
  const previousHits = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const selectedParksRef = useRef(selectedParks);
  const partyRef = useRef(party);
  const datesRef = useRef(dates);
  const skipSettingsReload = useRef(true);

  useEffect(() => {
    selectedParksRef.current = selectedParks;
  }, [selectedParks]);

  useEffect(() => {
    partyRef.current = party;
  }, [party]);

  useEffect(() => {
    datesRef.current = dates;
  }, [dates]);

  const load = useCallback(async (parksOverride?: Set<string>) => {
    const parksToCheck = parksOverride ?? selectedParksRef.current;
    const partyToUse = partyRef.current;
    const datesToUse = datesRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setIsChecking(true);
    setWeekends([]);
    setErrors([]);
    setProgress({ index: 0, total: 0 });
    previousHits.current = new Set();

    if (parksToCheck.size === 0) {
      setIsChecking(false);
      return;
    }

    const params = new URLSearchParams({
      parks: Array.from(parksToCheck).join(","),
      partySize: String(partyToUse.partySize),
      tents: String(partyToUse.tents),
      startDate: datesToUse.startDate,
      endDate: datesToUse.endDate,
    });

    try {
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
      let finalReport: AvailabilityReport | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as CheckEvent;

          if (event.type === "meta") {
            setMeta(event.meta);
            setProgress({ index: 0, total: event.meta.totalChecks });
          } else if (event.type === "result") {
            setProgress({ index: event.index, total: event.total });
            setWeekends((current) =>
              sortWeekends([
                ...current.filter(
                  (item) => resultKey(item) !== resultKey(event.result),
                ),
                event.result,
              ]),
            );

            if (
              event.result.hasFullWeekend &&
              typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              const key = resultKey(event.result);
              if (!previousHits.current.has(key)) {
                previousHits.current.add(key);
                new Notification("BC Parks weekend open", {
                  body: `${event.result.parkShortName}: ${event.result.arrivalDate} → ${event.result.departureDate}`,
                });
              }
            }
          } else if (event.type === "error") {
            setProgress({ index: event.index, total: event.total });
            setErrors((current) => [...current, event.error]);
          } else if (event.type === "done") {
            finalReport = event.report;
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
            setWeekends(event.report.weekends);
            setErrors(event.report.errors);
            setProgress({
              index: event.report.weekends.length + event.report.errors.length,
              total: event.report.weekends.length + event.report.errors.length,
            });

            const hitKeys = event.report.weekends
              .filter((weekend) => weekend.hasFullWeekend)
              .map(resultKey);
            previousHits.current = new Set(hitKeys);
          }
        }
      }

      void finalReport;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (abortRef.current === controller) {
        setIsChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/config")
      .then((response) => response.json())
      .then((data: PublicConfig) => {
        if (cancelled) return;
        const parks = new Set(data.parks.map((park) => park.shortName));
        const nextParty = partyFromConfig(data);
        const nextDates = datesFromConfig(data);
        setConfig(data);
        setSelectedParks(parks);
        setParty(nextParty);
        setDates(nextDates);
        partyRef.current = nextParty;
        datesRef.current = nextDates;
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
    if (!autoRefresh || !config) return;
    const ms = Math.max(config.pollIntervalMinutes, 1) * 60_000;
    const id = window.setInterval(() => {
      void load();
    }, ms);
    return () => window.clearInterval(id);
  }, [autoRefresh, config, load]);

  // Restart search when party or date settings change (after initial load).
  useEffect(() => {
    if (!settingsReady || !config) return;
    if (skipSettingsReload.current) {
      skipSettingsReload.current = false;
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

  const fullHits = weekends.filter((w) => w.hasFullWeekend);
  const progressLabel =
    isChecking && progress.total > 0
      ? `Checking ${progress.index}/${progress.total}`
      : null;

  const activeStart = meta?.startDate ?? dates.startDate;
  const activeEnd = meta?.endDate ?? dates.endDate;
  const selectedCount = selectedParks.size;
  const totalParks = config?.parks.length ?? 0;
  const parkWatchLabel =
    totalParks === 0
      ? "…"
      : selectedCount === totalParks
        ? `${selectedCount}`
        : `${selectedCount} of ${totalParks}`;
  const peopleLabel =
    party.partySize === 1 ? "1 person" : `${party.partySize} people`;
  const tentLabel =
    party.tents === 1 ? "1 tent" : `${party.tents} tents`;

  return (
    <div className="page-shell">
      <header className="hero">
        <p className="brand">BC Parks Watcher</p>
        <h1>
          {config
            ? `Fri–Sun · ${formatRangeLabel(activeStart, activeEnd)}`
            : "Weekend availability"}
        </h1>
        <p className="lede">
          Watching {parkWatchLabel} parks
          {config?.maxDriveMinutesFromHome
            ? ` within ${Math.round(config.maxDriveMinutesFromHome / 60)} hours`
            : ""}{" "}
          of {config?.homeBase || "home"} for Friday→Sunday stays{" "}
          {formatRangeLabel(dates.startDate, dates.endDate)} · {peopleLabel},{" "}
          {tentLabel}. Showing same-site Fri+Sat availability only.
        </p>

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void load()}
            disabled={isChecking}
          >
            {isChecking ? progressLabel || "Checking…" : "Check now"}
          </button>
          <button
            type="button"
            className={`btn ${autoRefresh ? "active" : ""}`}
            onClick={() => setAutoRefresh((value) => !value)}
          >
            Auto-refresh {autoRefresh ? "on" : "off"}
          </button>
          <button
            type="button"
            className={`btn ${notifyPermission === "granted" ? "active" : ""}`}
            onClick={() => void requestNotifications()}
            disabled={
              notifyPermission === "granted" ||
              notifyPermission === "unsupported"
            }
          >
            {notifyPermission === "granted"
              ? "Alerts on"
              : notifyPermission === "denied"
                ? "Alerts blocked"
                : notifyPermission === "unsupported"
                  ? "Alerts unavailable"
                  : "Enable alerts"}
          </button>
        </div>

        <p className="meta">
          {isChecking
            ? `${progressLabel} · bookable stays appear as they’re found`
            : meta
              ? `Last check ${formatCheckedAt(meta.checkedAt)} · every ${meta.pollIntervalMinutes} min`
              : "Waiting for first check…"}
          {` · ${formatPartyLabel(party)}`}
        </p>

        <div className="party-controls" role="group" aria-label="Search settings">
          <DateField
            label="From"
            value={dates.startDate}
            max={dates.endDate}
            onChange={(value) => updateDates("startDate", value)}
          />
          <DateField
            label="Until"
            hint="school start"
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

        {isChecking && progress.total > 0 ? (
          <div
            className="progress-track"
            aria-label={`Progress ${progress.index} of ${progress.total}`}
          >
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, (progress.index / progress.total) * 100)}%`,
              }}
            />
          </div>
        ) : null}

        {config?.parks?.length ? (
          <div className="park-chips" role="group" aria-label="Parks to show">
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
                  {park.shortName}
                  {park.driveMinutesFromHome != null
                    ? ` · ${park.driveMinutesFromHome}m`
                    : ""}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      <section className={`section ${fullHits.length > 0 ? "highlight" : ""}`}>
        <h2>Bookable weekends</h2>
        <p className="section-copy">
          {fullHits.length > 0
            ? "Same campsite online-reservable Friday and Saturday — book quickly."
            : isChecking
              ? "Still scanning… online-reservable Fri+Sat openings will show here."
              : `No online-reservable Fri+Sat openings across ${weekends.length || "checked"} park/weekend combos.`}
        </p>
        {fullHits.length > 0 ? (
          <div className="result-list">
            {fullHits.map((weekend) => (
              <WeekendRow
                key={resultKey(weekend)}
                weekend={weekend}
                featured
              />
            ))}
          </div>
        ) : isChecking ? (
          <div className="skeleton" />
        ) : null}
      </section>

      {errors.length > 0 ? (
        <section className="section">
          <h2>Check errors</h2>
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
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="stepper date-field">
      <span className="stepper-label">
        {label}
        {hint ? <em className="stepper-hint">{hint}</em> : null}
      </span>
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

function WeekendRow({
  weekend,
  featured = false,
}: {
  weekend: WeekendResult;
  featured?: boolean;
}) {
  return (
    <article className={`result ${featured ? "featured" : ""}`}>
      <div className="result-main">
        <div className="result-title">
          <span className="park">{weekend.parkShortName}</span>
          {weekend.driveMinutesFromHome != null ? (
            <span className="drive">~{weekend.driveMinutesFromHome} min</span>
          ) : null}
          <span className="stay">{formatStay(weekend)}</span>
        </div>
        <div className="nights">
          {weekend.nights.map((night) => (
            <span
              key={night.date}
              className={`night ${night.availableSites > 0 ? "open" : "closed"}`}
            >
              <em>{night.dayOfWeek.slice(0, 3)}</em>
              <strong>
                {night.availableSites > 0 ? night.availableSites : "—"}
              </strong>
            </span>
          ))}
          <span
            className={`night sites ${weekend.hasFullWeekend ? "open" : "closed"}`}
          >
            <em>Sites</em>
            <strong>
              {weekend.hasFullWeekend ? weekend.fullWeekendSites : "—"}
            </strong>
          </span>
        </div>
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
