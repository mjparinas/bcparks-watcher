# BC Parks Weekend Watcher

Next.js app that periodically checks [camping.bcparks.ca](https://camping.bcparks.ca) for weekend campsite availability near **Langley, BC**.

Default watch list (≤ ~3 hours, no ferry / no toll):

- Rolley Lake, Golden Ears, Cultus Lake
- Porteau Cove, Sasquatch, Alice Lake
- Silver Lake, Chilliwack Lake, Manning, Skagit Valley, Nairn Falls

Search window: **today → BC school start** (Tue Sep 8, 2026), default **Friday→Sunday** stays.

Defaults sent to the parks API: **party of 4**, **1 tent**.

> **Agents:** read [`AGENTS.md`](AGENTS.md) before changing behavior (architecture, BC Parks quirks, pacing knobs, dashboard rules).

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456). `npm run dev` uses nodemon, so the server restarts when files under `src/` change. The dashboard auto-refreshes on the interval in config (default 5 minutes).

## Adjust locations and times

Edit [`src/config/watcher.config.ts`](src/config/watcher.config.ts):

```ts
export const watcherConfig = {
  homeBase: "Langley, BC",
  maxDriveMinutesFromHome: 180,
  startDate: "2026-07-29",
  endDate: "2026-09-08", // school start (exclusive)
  nights: ["friday", "saturday"], // Fri→Sun
  pollIntervalMinutes: 5,
  excludeDoubleSites: false, // default for the "Hide doubles" chip
  partySize: 4,
  party: { tents: 1 },
  subEquipmentCategoryId: -32768, // 1 Tent
  parks: [
    // ...
  ],
};
```

### Find another park’s IDs

```bash
npm run lookup -- "garibaldi"
# or while the app is running:
# GET /api/parks?q=garibaldi
```

### Change the weekend definition

`nights` is the overnight dates required (must be contiguous). Fri→Sun stays use:

```ts
nights: ["friday", "saturday"] // leave Sunday morning
```

Date range is `startDate` → `endDate` (exclusive). Stays must arrive on/after `startDate` and depart before `endDate`.

### Double sites

Some campsites are half of a **double** — BC Parks only rents the pair together, so one half alone is not really bookable for a single group. The **Hide doubles** chip filters them out; leave it off and doubles show up with an `×2` marker. The setting sticks per browser.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/availability/stream` | SSE — progressive park/weekend results |
| `GET /api/availability/more` | Load remaining sites after the verify cap |
| `GET /api/availability` | Full check as JSON |
| `GET /api/cron` | Same check for schedulers / Vercel Cron |
| `GET /api/parks?q=` | Search park IDs by name |
| `GET /api/config` | Public view of the active config |

## Periodic checks

1. **Dashboard auto-refresh** — `pollIntervalMinutes` (default 5); use locally (see Vercel note below)
2. **`/api/cron`** — optional scheduler endpoint (Hobby cron intervals are limited)
3. **Webhook alerts** — set `NOTIFY_WEBHOOK_URL` in `.env.local`
4. **Browser notifications** — enable alerts on the dashboard

Optional env (see `.env.example`): `NOTIFY_WEBHOOK_URL`, `CRON_SECRET`.

## Notes

- Data comes from the public GoingToCamp API used by camping.bcparks.ca. It can change without notice.
- Be polite with polling; 5 minutes is the current default.
- “Full” means at least one site is open on **every** selected night.
- Book links open the official BC Parks reservation flow.
- **Vercel hosting:** the dashboard can deploy, but BC Parks’ Azure Front Door often **403s Vercel IPs**. Run `npm run dev` locally for real searches / Auto polling.
