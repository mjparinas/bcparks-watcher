import { NextResponse } from "next/server";
import {
  applyDateOverrides,
  getActiveParks,
  watcherConfig,
} from "@/config/watcher.config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = applyDateOverrides(watcherConfig);
  const parks = getActiveParks(config).map((park) => ({
    name: park.name,
    shortName: park.shortName,
    resourceLocationId: park.resourceLocationId,
    rootMapId: park.rootMapId,
    driveMinutesFromHome: park.driveMinutesFromHome,
  }));

  const onVercel =
    process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

  return NextResponse.json({
    homeBase: config.homeBase,
    maxDriveMinutesFromHome: config.maxDriveMinutesFromHome,
    excludeFerry: config.excludeFerry,
    excludeTollRoads: config.excludeTollRoads,
    startDate: config.startDate,
    endDate: config.endDate,
    endDateLabel: config.endDateLabel,
    nights: config.nights,
    pollIntervalMinutes: config.pollIntervalMinutes,
    partySize: config.partySize,
    tents: config.party.tents,
    parks,
    /**
     * BC Parks Azure Front Door often 403s Vercel/datacenter egress.
     * Searches work from local/residential IPs; the hosted UI alone is not enough.
     */
    bcParksEgressBlocked: onVercel,
  });
}
