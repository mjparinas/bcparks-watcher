import { NextRequest, NextResponse } from "next/server";
import { searchParks } from "@/lib/bcparks/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json(
      { error: "Provide ?q= with at least 2 characters" },
      { status: 400 },
    );
  }

  try {
    const parks = await searchParks(query);
    return NextResponse.json({ query, parks });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Park lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
