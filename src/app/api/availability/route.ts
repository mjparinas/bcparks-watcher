import { NextResponse } from "next/server";
import { notifyIfAvailable, runAvailabilityCheck } from "@/lib/bcparks/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const report = await runAvailabilityCheck();
    await notifyIfAvailable(report);
    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Availability check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
