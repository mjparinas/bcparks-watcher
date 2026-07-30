import { NextResponse } from "next/server";
import { getActiveParks, watcherConfig } from "@/config/watcher.config";

export const dynamic = "force-dynamic";

export async function GET() {
  const parks = getActiveParks().map((park) => ({
    name: park.name,
    shortName: park.shortName,
    resourceLocationId: park.resourceLocationId,
    rootMapId: park.rootMapId,
    driveMinutesFromHome: park.driveMinutesFromHome,
  }));

  return NextResponse.json({
    homeBase: watcherConfig.homeBase,
    maxDriveMinutesFromHome: watcherConfig.maxDriveMinutesFromHome,
    excludeFerry: watcherConfig.excludeFerry,
    excludeTollRoads: watcherConfig.excludeTollRoads,
    year: watcherConfig.year,
    month: watcherConfig.month,
    nights: watcherConfig.nights,
    pollIntervalMinutes: watcherConfig.pollIntervalMinutes,
    partySize: watcherConfig.partySize,
    parks,
  });
}
