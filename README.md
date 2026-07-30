# BC Parks Weekend Watcher

Next.js app that polls the public GoingToCamp API behind [camping.bcparks.ca](https://camping.bcparks.ca) for campsite openings near **Langley, BC**.

Dev server: **http://localhost:3456** (`npm run dev` via nodemon).

> **For agents:** read this whole file before changing behavior. Key decisions, API quirks, and file ownership live below so you do not need prior chat history.

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456).

---

## What it does (product)

- Watches mainland frontcountry parks ≤ ~3 hours from Langley (**no ferry, no toll**).
- Default stay: contiguous nights (UI chips; default **Fri+Sat** → leave Sunday).
- Default window: **today (America/Vancouver) → BC school start** (`endDate` exclusive, currently `2026-09-08`).
- Default party: **4 people, 1 tent** (only fields that affect the BC Parks API).
- A hit means **one campsite** is online-reservable for **every** selected night (`processedAvailability === 0`). Code `3` (often FCFS) is never a hit.
- UI: filters in `localStorage`, sticky results while refreshing, campsite labels (e.g. `B59`), **more** loads remaining sites, sort by date/distance, **Gone** flash when openings disappear, browser alerts + optional webhook.

---

## Architecture (important)

```
Browser Dashboard
  → GET /api/availability/stream?…   (SSE)
      → streamAvailabilityCheck()     (src/lib/bcparks/check.ts)
          → fetchParkAvailability()   (one map-tree walk per park for full date range)
          → slice weekends in memory
          → verify ≤5 sites via processedAvailability
          → optional site names via /api/resourceLocation/resources
```

- **BC Parks HTTP runs on the Next.js server only.** The browser never calls camping.bcparks.ca directly.
- Progressive SSE: `meta` → many `result` / `error` → `done`.
- Manual Search and Auto both hit the stream route. Auto interval = `pollIntervalMinutes` (default **10**).

### Key files

| Path | Role |
| --- | --- |
| `src/config/watcher.config.ts` | Parks list, defaults, party/date helpers |
| `src/lib/bcparks/client.ts` | Headers, pacing, short cache, map walk, names, verifies |
| `src/lib/bcparks/check.ts` | Orchestration: one walk/park, weekend slice, SSE events |
| `src/lib/bcparks/weekends.ts` | Contiguous nights, stay windows |
| `src/lib/bcparks/types.ts` | API + report types (`OpenSite.name`, etc.) |
| `src/components/Dashboard.tsx` | UI, filters, sticky results, Gone, sleep/wake resume |
| `src/app/globals.css` | Moss/Fraunces visual language — preserve it |
| `src/app/api/availability/stream/route.ts` | SSE entry |
| `src/app/api/availability/more/route.ts` | Expand capped site list for one park/stay |
| `scripts/lookup-parks.mjs` | CLI park ID lookup |

### API routes

| Route | Purpose |
| --- | --- |
| `GET /api/availability/stream` | SSE progressive check (primary UI path) |
| `GET /api/availability/more` | Verify remaining sites after cap (`park`, `arrivalDate`, `lastNightDate`, `nightCount`, `exclude`, party) |
| `GET /api/availability` | Full JSON check |
| `GET /api/cron` | Scheduler / Vercel Cron |
| `GET /api/parks?q=` | Park ID search |
| `GET /api/config` | Public config for the dashboard |

---

## BC Parks / GoingToCamp notes

- **No published rate limits.** Edge is Azure Front Door / WAF. Custom bot UAs get **403**. Bursts can get **429** or HTML block pages.
- Client uses a **Chrome-like UA** + `Origin` / `Referer` to camping.bcparks.ca.
- Availability codes we care about: `0` open/reservable, `1` booked, `3` not online-reservable (FCFS), `5` closed/out of season.
- Site **labels** (B59, D7) come from `GET /api/resourceLocation/resources?resourceLocationId=…` → `localizedValues[0].name`. Map availability only has numeric `resourceId`s.
- Holiday / min-stay rules (e.g. Labour Day 3-night) are **not** modeled yet — those weekends can look empty when searching 2 nights.

### Politeness / speed knobs (`client.ts` + `check.ts`)

| Knob | Current | Intent |
| --- | --- | --- |
| `MAX_IN_FLIGHT` | 4 | Concurrent outbound BC Parks calls |
| `MIN_START_GAP_MS` | 225 | Gap between request starts |
| `RESPONSE_TTL_MS` | 25s | Reuse identical URLs (personal snappy re-search) |
| Circuit breaker | 3× 403/429 → 60s cooldown | Back off when blocked; honors `Retry-After` |
| Park concurrency | 4 | Parks processed in parallel |
| `MAX_VERIFY_SITES` | 5 | Cap per park/weekend; UI **more** loads the rest |
| Map strategy | **One walk per park** for full From→Until, slice weekends in memory | Far fewer map calls than park×weekend walks |
| Resource names | 6h cache | Names don’t change when sites book |
| `pollIntervalMinutes` | 10 | Auto + Vercel cron |

Do **not** reintroduce a long cross-search availability TTL (e.g. 45s+) without an explicit fresh-search bypass — it made re-Search look like a no-op.

---

## Dashboard behavior (agents)

- Filters persisted under `localStorage` key `bcparks-watcher-filters-v1` (parks, party, dates, nights, auto, sort).
- Sticky openings kept while refreshing; pruned when parks/dates/nights no longer match. Party/tents change clears all.
- Site chips show **names** when known; fallback numeric ID.
- **more** → `/api/availability/more` verifies remaining candidates for that row.
- Sort: Date vs Distance (segmented control).
- **Gone** rows: openings that disappeared on the latest search flash ~12s; status may show `· N gone`.
- Sleep / network: interrupted SSE → friendly message, keep sticky results, Auto retries on `online` / wake. **Auto keeps polling while the tab is hidden** (only gated on `navigator.onLine`). Browsers may still throttle background timers; visibility/pageshow catch up when due.
- Alerts: browser Notification + tone on **new** hit keys; optional `NOTIFY_WEBHOOK_URL`.

### Design constraints (from product prefs)

- Brand-first, not dashboard clutter; moss / Fraunces look in `globals.css`.
- Avoid generic AI aesthetics (purple gradients, cream+terracotta, etc.).
- Prefer fewer cards/pills; results are compact rows.

---

## Config

Edit [`src/config/watcher.config.ts`](src/config/watcher.config.ts):

```ts
export const watcherConfig = {
  homeBase: "Langley, BC",
  maxDriveMinutesFromHome: 180,
  startDate: "2026-07-29",
  endDate: "2026-09-08", // exclusive
  nights: ["friday", "saturday"],
  pollIntervalMinutes: 10,
  partySize: 4,
  party: { tents: 1 },
  subEquipmentCategoryId: -32768, // 1 Tent
  parks: [/* … */],
};
```

```bash
npm run lookup -- "garibaldi"
# or GET /api/parks?q=garibaldi
```

`nights` must be contiguous (wrap OK, e.g. Sat–Mon). Date range: arrive ≥ `startDate`, depart before `endDate`.

Env (see `.env.example`):

- `NOTIFY_WEBHOOK_URL` — Slack/Discord-style `{ text }` / `{ content }`
- `CRON_SECRET` — Bearer auth for `/api/cron`

---

## Git / environment notes

- Feature work has lived on branch `cursor/bcparks-weekend-watcher-0926`.
- This environment often has **no git remote** — commits may be local only; don’t assume push/PR works.
- Next.js **16** — see `AGENTS.md` / `node_modules/next/dist/docs/` before assuming older Next APIs.

---

## Ideas not built (if asked)

1. **Near-misses** — e.g. Fri open / Sat booked.
2. **Reliable phone push** when tab closed (Telegram/Pushover/etc.).
3. **Min-stay / holiday calendar** — flag Labour Day-style 3-night rules; optional longer-stay check.
4. **Equipment toggle** — tent vs trailer.
5. **Copy link / site list**.
6. Public multi-user: would need a **shared** short server cache and stricter global budget — current pacing is tuned for **personal** use.

---

## Periodic checks

1. Dashboard Auto — `pollIntervalMinutes` (default 10)
2. Vercel Cron — `vercel.json` → `/api/cron` every 10 minutes
3. Webhook + browser notifications as above
