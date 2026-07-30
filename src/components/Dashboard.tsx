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
  party?: {
    adults: number;
    kidsAges: number[];
    tents: number;
    cars: number;
  };
  equipment?: {
    tents: number;
    cars: number;
    label: string;
  };
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
  const previousHits = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const selectedParksRef = useRef(selectedParks);

  useEffect(() => {
    selectedParksRef.current = selectedParks;
  }, [selectedParks]);

  const load = useCallback(async (parksOverride?: Set<string>) => {
    const parksToCheck = parksOverride ?? selectedParksRef.current;

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
        setConfig(data);
        setSelectedParks(parks);
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

  const fullHits = weekends.filter((w) => w.hasFullWeekend);
  const progressLabel =
    isChecking && progress.total > 0
      ? `Checking ${progress.index}/${progress.total}`
      : null;

  return (
    <div className="page-shell">
      <header className="hero">
        <p className="brand">BC Parks Watcher</p>
        <h1>
          {config
            ? `Fri–Sun · ${formatRangeLabel(config.startDate, config.endDate)}`
            : "Weekend availability"}
        </h1>
        <p className="lede">
          Watching {config?.parks.length ?? "…"} parks within{" "}
          {config?.maxDriveMinutesFromHome
            ? `${Math.round(config.maxDriveMinutesFromHome / 60)} hours`
            : "range"}{" "}
          of {config?.homeBase || "home"} for Friday→Sunday stays
          {config?.endDateLabel ? ` until ${config.endDateLabel}` : ""}.
          Showing same-site Fri+Sat availability only. Edit{" "}
          <code>src/config/watcher.config.ts</code> to change parks or times.
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
          {config?.party
            ? ` · ${config.party.adults} adults, kids ${config.party.kidsAges.join(" & ")}, ${config.party.tents} tent, ${config.party.cars} car`
            : config
              ? ` · party of ${config.partySize}`
              : null}
        </p>

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
