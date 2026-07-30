"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { AvailabilityReport, WeekendResult } from "@/lib/bcparks/types";

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

export function Dashboard() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [report, setReport] = useState<AvailabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const previousHits = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/availability", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Request failed (${response.status})`);
      }
      const next = (await response.json()) as AvailabilityReport;

      const hitKeys = next.weekends
        .filter((weekend) => weekend.hasFullWeekend)
        .map(
          (weekend) =>
            `${weekend.parkShortName}:${weekend.arrivalDate}:${weekend.departureDate}`,
        );

      const isNewHit = hitKeys.some((key) => !previousHits.current.has(key));
      previousHits.current = new Set(hitKeys);

      if (
        isNewHit &&
        hitKeys.length > 0 &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("BC Parks weekend open", {
          body: `${hitKeys.length} full weekend(s) available — open the watcher to book.`,
        });
      }

      startTransition(() => {
        setReport(next);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/config")
      .then((response) => response.json())
      .then((data: PublicConfig) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });

    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
    await Notification.requestPermission();
  };

  const fullHits = report?.weekends.filter((w) => w.hasFullWeekend) ?? [];
  const partialHits =
    report?.weekends.filter(
      (w) => w.hasAnyAvailability && !w.hasFullWeekend,
    ) ?? [];
  const empty =
    report?.weekends.filter((w) => !w.hasAnyAvailability) ?? [];

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
          {config?.endDateLabel ? ` until ${config.endDateLabel}` : ""}. Edit{" "}
          <code>src/config/watcher.config.ts</code> to change parks or times.
        </p>

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void load()}
            disabled={isPending}
          >
            {isPending || !report ? "Checking…" : "Check now"}
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
            className="btn"
            onClick={() => void requestNotifications()}
          >
            Enable alerts
          </button>
        </div>

        <p className="meta">
          {report
            ? `Last check ${formatCheckedAt(report.checkedAt)} · every ${report.pollIntervalMinutes} min`
            : "Waiting for first check…"}
          {config?.party
            ? ` · ${config.party.adults} adults, kids ${config.party.kidsAges.join(" & ")}, ${config.party.tents} tent, ${config.party.cars} car`
            : config
              ? ` · party of ${config.partySize}`
              : null}
        </p>

        {config?.parks?.length ? (
          <ul className="park-chips">
            {config.parks.map((park) => (
              <li key={park.shortName}>
                {park.shortName}
                {park.driveMinutesFromHome != null
                  ? ` · ${park.driveMinutesFromHome}m`
                  : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      {fullHits.length > 0 ? (
        <section className="section highlight">
          <h2>Open full weekends</h2>
          <p className="section-copy">
            Every selected night has at least one matching site — book quickly.
          </p>
          <div className="result-list">
            {fullHits.map((weekend) => (
              <WeekendRow key={`${weekend.parkShortName}-${weekend.arrivalDate}`} weekend={weekend} featured />
            ))}
          </div>
        </section>
      ) : null}

      {partialHits.length > 0 ? (
        <section className="section">
          <h2>Partial nights</h2>
          <p className="section-copy">
            Some nights are open, but not the full{" "}
            {config?.nights.map((night) => night.slice(0, 3)).join("–") ||
              "weekend"}{" "}
            stretch.
          </p>
          <div className="result-list">
            {partialHits.map((weekend) => (
              <WeekendRow
                key={`${weekend.parkShortName}-${weekend.arrivalDate}`}
                weekend={weekend}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <h2>All scanned weekends</h2>
        <p className="section-copy">
          {report
            ? `${report.weekends.length} park/weekend combinations checked.`
            : "Loading live availability from camping.bcparks.ca…"}
        </p>
        {report ? (
          <div className="result-list muted">
            {(fullHits.length + partialHits.length > 0
              ? empty
              : report.weekends
            ).map((weekend) => (
              <WeekendRow
                key={`${weekend.parkShortName}-${weekend.arrivalDate}-all`}
                weekend={weekend}
              />
            ))}
          </div>
        ) : (
          <div className="skeleton" />
        )}
      </section>

      {report?.errors?.length ? (
        <section className="section">
          <h2>Check errors</h2>
          <ul className="error-list">
            {report.errors.map((item) => (
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
            className={`night full ${weekend.hasFullWeekend ? "open" : "closed"}`}
          >
            <em>Full</em>
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
