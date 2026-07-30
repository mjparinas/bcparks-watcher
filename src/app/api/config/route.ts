import { NextResponse } from "next/server";
import { watcherConfig } from "@/config/watcher.config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    year: watcherConfig.year,
    month: watcherConfig.month,
    nights: watcherConfig.nights,
    pollIntervalMinutes: watcherConfig.pollIntervalMinutes,
    partySize: watcherConfig.partySize,
    parks: watcherConfig.parks
      .filter((park) => park.enabled)
      .map((park) => ({
        name: park.name,
        shortName: park.shortName,
        resourceLocationId: park.resourceLocationId,
        rootMapId: park.rootMapId,
      })),
  });
}
