import { NextRequest, NextResponse } from "next/server";
import { notifyIfAvailable, runAvailabilityCheck } from "@/lib/bcparks/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Periodic check endpoint for Vercel Cron / external schedulers.
 * Protect with CRON_SECRET when deployed.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const report = await runAvailabilityCheck();
    await notifyIfAvailable(report);

    return NextResponse.json({
      ok: true,
      checkedAt: report.checkedAt,
      fullWeekendHits: report.weekends.filter((w) => w.hasFullWeekend).length,
      anyHits: report.weekends.filter((w) => w.hasAnyAvailability).length,
      errors: report.errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cron check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
