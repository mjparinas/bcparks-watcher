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
    startDate: watcherConfig.startDate,
    endDate: watcherConfig.endDate,
    endDateLabel: watcherConfig.endDateLabel,
    nights: watcherConfig.nights,
    pollIntervalMinutes: watcherConfig.pollIntervalMinutes,
    party: watcherConfig.party,
    partySize: watcherConfig.partySize,
    equipment: {
      tents: watcherConfig.party.tents,
      cars: watcherConfig.party.cars,
      subEquipmentCategoryId: watcherConfig.subEquipmentCategoryId,
      label: "1 Tent",
    },
    parks,
  });
}
