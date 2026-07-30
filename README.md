# BC Parks Weekend Watcher

Next.js app that periodically checks [camping.bcparks.ca](https://camping.bcparks.ca) for weekend campsite availability.

Default watch list:

- **E. C. Manning Provincial Park**
- **Sasquatch Provincial Park**
- **August 2026** Friday / Saturday / Sunday nights

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
  year: 2026,
  month: 8, // August
  nights: ["friday", "saturday", "sunday"],
  pollIntervalMinutes: 5,
  partySize: 2,
  parks: [
    {
      name: "E. C. Manning Provincial Park",
      shortName: "Manning",
      resourceLocationId: -2147483618,
      rootMapId: -2147483601,
      enabled: true,
    },
    // add / disable parks here
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

`nights` is the list of overnight dates to require. Examples:

- Fri–Sun: `["friday", "saturday", "sunday"]`
- Sat only: `["saturday"]`
- Thu–Sat: `["thursday", "friday", "saturday"]`

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
