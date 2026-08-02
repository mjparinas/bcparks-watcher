<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# BC Parks Weekend Watcher — agent context

Read this before changing behavior. It captures product decisions, API quirks, and file ownership so prior chat history is not required.

Human-facing setup lives in [`README.md`](README.md).

---

## Product

- Next.js app that polls GoingToCamp behind [camping.bcparks.ca](https://camping.bcparks.ca) for openings near **Langley, BC**.
- Dev: **http://localhost:3456** (`npm run dev` / nodemon).
- Mainland frontcountry only, ≤ ~3 hours, **no ferry / no toll**.
- Default stay: contiguous nights (UI chips; default **Fri+Sat** → leave Sunday).
- Default window: today (America/Vancouver) → BC school start (`endDate` exclusive, currently `2026-09-08`).
- Default party: **4 people, 1 tent** (only API-relevant fields).
- A **hit** = one campsite online-reservable for **every** selected night (`processedAvailability === 0`). Code `3` (often FCFS) is never a hit.
- UI: `localStorage` filters, sticky results, site labels (e.g. `B59`), **more** for remaining sites, sort date/distance, **Gone** flash, browser alerts + optional webhook.

---

## Architecture

```
Browser Dashboard
  → GET /api/availability/stream?…   (SSE)
      → streamAvailabilityCheck()     (src/lib/bcparks/check.ts)
          → fetchParkAvailability()   (one map-tree walk per park for full date range)
          → slice weekends in memory
          → verify ≤5 sites via processedAvailability
          → optional site names via /api/resourceLocation/resources
```

- **BC Parks HTTP runs on the Next.js server only.** The browser never calls camping.bcparks.ca.
- SSE: `meta` → many `result` / `error` → `done`.
- Search and Auto both use the stream. Auto = `pollIntervalMinutes` (default **5**).

### Key files

| Path | Role |
| --- | --- |
| `src/config/watcher.config.ts` | Parks list, defaults, party/date helpers |
| `src/lib/bcparks/client.ts` | Headers, pacing, short cache, map walk, site meta (names + doubles), verifies |
| `src/lib/bcparks/check.ts` | One walk/park, weekend slice, SSE events |
| `src/lib/bcparks/weekends.ts` | Contiguous nights, stay windows |
| `src/lib/bcparks/types.ts` | API + report types (`OpenSite.name`, etc.) |
| `src/components/Dashboard.tsx` | UI, sticky results, Gone, sleep/wake resume |
| `src/app/globals.css` | Moss/Fraunces look — preserve it |
| `src/app/api/availability/stream/route.ts` | SSE entry |
| `src/app/api/availability/more/route.ts` | Expand capped sites for one park/stay |
| `scripts/lookup-parks.mjs` | CLI park ID lookup |

### API routes

| Route | Purpose |
| --- | --- |
| `GET /api/availability/stream` | SSE progressive check (primary UI) |
| `GET /api/availability/more` | Remaining sites after cap |
| `GET /api/availability` | Full JSON check |
| `GET /api/cron` | Vercel Cron / schedulers |
| `GET /api/parks?q=` | Park ID search |
| `GET /api/config` | Public config for dashboard |

---

## BC Parks / GoingToCamp

- **No published rate limits.** Azure Front Door / WAF. Custom bot UAs → **403**. Bursts → **429** or HTML blocks.
- **Vercel / cloud egress:** Azure Front Door often **403s datacenter IPs** even with a Chrome-like UA. Local/residential Next.js works; production on Vercel typically cannot reach camping.bcparks.ca. Fail fast on 403 (don’t retry into the 120s `maxDuration`). Dashboard shows `bcParksEgressBlocked` when `VERCEL` is set.
- Use **Chrome-like UA** + `Origin` / `Referer` to camping.bcparks.ca (`client.ts`).
- Codes: `0` open, `1` booked, `3` not online-reservable (FCFS), `5` closed/out of season.
- Site **labels** from `GET /api/resourceLocation/resources?resourceLocationId=…` → `localizedValues[0].name`. Map availability only has numeric `resourceId`s.
- **Double sites**: same payload, `linkedResources` non-empty (`linkedResourceType: 2`) = half of a double that must be booked with its other half. Use this, **not** the English `description` — the text wording varies ("Half of a double site with X", "Double with 39", or blank for `M24a`/`M24b` pairs) and misses real doubles. Both are surfaced by `fetchResourceMeta` (6h cache, same request that provides names).
- Holiday / min-stay (e.g. Labour Day 3-night) **not modeled** — 2-night searches can look empty.

### Politeness / speed knobs

| Knob | Current | Intent |
| --- | --- | --- |
| `MAX_IN_FLIGHT_FAST` / `_SAFE` | 6 / 4 | Concurrent BC Parks calls |
| `MIN_START_GAP_FAST_MS` / `_SAFE_MS` | 150 / 225 | Gap between request starts |
| Adaptive pacing | Any 403/429 → safe values; back to fast after 40 clean responses | Fast by default, polite under pressure |
| `RESPONSE_TTL_MS` | 25s | Reuse identical URLs (personal snappy re-search) |
| Circuit breaker | 3× 403/429 → 60s cooldown | Honors `Retry-After` |
| Park concurrency | 6 | Parks in parallel |
| Stay windows | All windows for a park verified in parallel | Shares the single map walk |
| `MAX_VERIFY_SITES` | 4 | Cap; UI **more** loads rest |
| Map strategy | **One walk per park** for From→Until, slice weekends in memory | Avoids park×weekend map walks |
| Resource names | 6h cache | Names don’t change when sites book |
| `pollIntervalMinutes` | 5 | Auto + Vercel cron |

Do **not** reintroduce a long cross-search availability TTL (e.g. 45s+) without a fresh-search bypass — it made re-Search look like a no-op.

Pacing is tuned for **personal** use. Public multi-user would need a shared short server cache and a stricter global budget.

---

## Dashboard rules

- Filters: `localStorage` key `bcparks-watcher-filters-v1` (parks, party, dates, nights, auto, sort, `excludeDoubles`).
- Sticky openings while refreshing; prune on parks/dates/nights mismatch. Party/tents **or Hide doubles** change clears all (see `resultsSignature`).
- **Hide doubles** chip → `excludeDoubles=1` on the stream / more routes → server drops doubles *before* verifying, so `MAX_VERIFY_SITES` is spent on bookable singles. When doubles are shown they get an `×2` marker.
- Site chips prefer **names**; fallback numeric ID.
- **more** → `/api/availability/more`.
- Sort: Date vs Distance segmented control.
- **Gone** rows ~12s when openings disappear; status may show `· N gone`.
- Sleep / network: interrupted SSE → friendly message, keep sticky; Auto retries on `online` / wake. **Auto keeps polling while the tab is hidden** (only gated on `navigator.onLine`). Browsers may throttle background timers; visibility/pageshow catch up when due.
- Alerts: Notification + tone on **new** hit keys only; optional `NOTIFY_WEBHOOK_URL`. The first completed scan for a given `filterSignature` (parks + party + doubles + dates + nights) is a **silent baseline**, so page loads and filter changes never re-announce openings that were already there. Openings that disappear are dropped from `previousHits`, so they alert again if they come back.
- Keep `resultsPartyKey` writes going through `resultsSignature` — writing a hand-built string there desynced the signature and made every poll wipe sticky results and re-alert.

### Design

- Brand-first; moss / Fraunces in `globals.css`.
- Avoid generic AI aesthetics (purple gradients, cream+terracotta, broadsheet, etc.).
- Prefer compact rows over card clutter.

---

## Config touchpoints

- Defaults / parks: `src/config/watcher.config.ts`
- Lookup: `npm run lookup -- "garibaldi"` or `GET /api/parks?q=`
- `nights` must be contiguous (wrap OK). Arrive ≥ `startDate`, depart before exclusive `endDate`.
- `excludeDoubleSites` is the server default for the **Hide doubles** chip; the UI's saved value wins once set.
- Env: `NOTIFY_WEBHOOK_URL`, `CRON_SECRET` (see `.env.example`)

---

## Git / env

- Branch used for this work: `cursor/bcparks-weekend-watcher-0926`.
- Often **no git remote** here — commits may be local only.
- Next.js **16** — see rules at top of this file.

---

## Not built (if asked)

1. Near-misses (Fri open / Sat booked).
2. Phone push when tab closed (Telegram/Pushover/etc.).
3. Min-stay / holiday calendar.
4. Tent vs trailer equipment toggle.
5. Copy link / site list.
6. Public multi-tenant rate budgeting.
