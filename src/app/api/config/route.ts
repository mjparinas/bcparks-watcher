import { NextResponse } from "next/server";
import { watcherConfig } from "@/config/watcher.config";

export const dynamic = "force-dynamic";

function isWithinDriveLimit(driveMinutes?: number): boolean {
  const max = watcherConfig.maxDriveMinutesFromHome;
  if (max == null || driveMinutes == null) return true;
  return driveMinutes <= max;
}

export async function GET() {
  const parks = watcherConfig.parks
    .filter((park) => park.enabled && isWithinDriveLimit(park.driveMinutesFromHome))
    .sort(
      (a, b) =>
        (a.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER) -
        (b.driveMinutesFromHome ?? Number.MAX_SAFE_INTEGER),
    )
    .map((park) => ({
      name: park.name,
      shortName: park.shortName,
      resourceLocationId: park.resourceLocationId,
      rootMapId: park.rootMapId,
      driveMinutesFromHome: park.driveMinutesFromHome,
    }));

  return NextResponse.json({
    homeBase: watcherConfig.homeBase,
    maxDriveMinutesFromHome: watcherConfig.maxDriveMinutesFromHome,
    year: watcherConfig.year,
    month: watcherConfig.month,
    nights: watcherConfig.nights,
    pollIntervalMinutes: watcherConfig.pollIntervalMinutes,
    partySize: watcherConfig.partySize,
    parks,
  });
}
