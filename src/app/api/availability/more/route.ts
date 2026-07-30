import { findRemainingOpenSites } from "@/lib/bcparks/check";
import { isIsoDate, type PartyOverrides } from "@/config/watcher.config";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parseIntParam(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePartyOverrides(
  searchParams: URLSearchParams,
): PartyOverrides | undefined {
  const partySize = parseIntParam(searchParams.get("partySize"));
  const tents = parseIntParam(searchParams.get("tents"));
  if (partySize == null && tents == null) return undefined;
  return { partySize, tents };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const park = params.get("park")?.trim();
  const arrivalDate = params.get("arrivalDate");
  const lastNightDate = params.get("lastNightDate");
  const nightCount = parseIntParam(params.get("nightCount"));
  const exclude = (params.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!park) {
    return NextResponse.json({ error: "park is required" }, { status: 400 });
  }
  if (!isIsoDate(arrivalDate) || !isIsoDate(lastNightDate)) {
    return NextResponse.json(
      { error: "arrivalDate and lastNightDate must be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (nightCount == null || nightCount < 1) {
    return NextResponse.json(
      { error: "nightCount must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await findRemainingOpenSites({
      shortName: park,
      arrivalDate,
      lastNightDate,
      nightCount,
      excludeResourceIds: exclude,
      partyOverrides: parsePartyOverrides(params),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to find more sites";
    const status = message.startsWith("Unknown or inactive") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
