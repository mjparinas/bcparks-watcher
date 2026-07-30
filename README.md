# BC Parks Weekend Watcher

Next.js app that periodically checks [camping.bcparks.ca](https://camping.bcparks.ca) for weekend campsite availability.

Default watch list (≤ ~3 hours from **Langley, BC**, no ferry / no toll roads):

- Rolley Lake, Golden Ears, Cultus Lake
- Porteau Cove, Sasquatch, Alice Lake
- Silver Lake, Chilliwack Lake, Manning, Skagit Valley, Nairn Falls

Search window: **today → BC school start** (Tue Sep 8, 2026), **Friday→Sunday** stays only.

Party defaults: **2 adults + kids (4 & 6)**, **1 tent**, **1 car**.

Sunshine Coast and Island parks are excluded because they need BC Ferries.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard auto-refreshes on the interval in config.

## Adjust locations and times

Edit one file: [`src/config/watcher.config.ts`](src/config/watcher.config.ts)

```ts
export const watcherConfig = {
  homeBase: "Langley, BC",
  maxDriveMinutesFromHome: 180, // 3 hours
  startDate: "2026-07-29",
  endDate: "2026-09-08", // school start (exclusive)
  nights: ["friday", "saturday"], // Fri→Sun
  partySize: 4,
  party: { adults: 2, kidsAges: [4, 6], tents: 1, cars: 1 },
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

Copy the printed object into `parks`.

### Change the weekend definition

`nights` is the overnight dates required. Fri→Sun stays use:

```ts
nights: ["friday", "saturday"] // leave Sunday morning
```

Date range is `startDate` → `endDate` (exclusive). Stays must arrive on/after `startDate` and depart before `endDate`.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/availability` | Run a live check and return the full report |
| `GET /api/cron` | Same check for schedulers / Vercel Cron |
| `GET /api/parks?q=` | Search park IDs by name |
| `GET /api/config` | Public view of the active config |

## Periodic checks

1. **Dashboard auto-refresh** — controlled by `pollIntervalMinutes`
2. **Vercel Cron** — [`vercel.json`](vercel.json) hits `/api/cron` every 5 minutes
3. **Webhook alerts** — set `NOTIFY_WEBHOOK_URL` in `.env.local` (Slack/Discord-compatible JSON `{ text }` / `{ content }`)
4. **Browser notifications** — click **Enable alerts** on the dashboard

Optional env vars (see `.env.example`):

- `NOTIFY_WEBHOOK_URL`
- `CRON_SECRET` — require `Authorization: Bearer <secret>` on `/api/cron`

## Notes

- Data comes from the public GoingToCamp API used by camping.bcparks.ca. It can change without notice.
- Be polite with polling frequency; 5+ minutes is recommended.
- “Full” means at least one site is open on **every** selected night for that weekend.
- Book links open the official BC Parks reservation flow.
