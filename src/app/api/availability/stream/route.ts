import {
  notifyIfAvailable,
  streamAvailabilityCheck,
} from "@/lib/bcparks/check";
import type { AvailabilityReport, CheckEvent } from "@/lib/bcparks/types";
import type { PartyOverrides } from "@/config/watcher.config";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function encodeSse(event: CheckEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function parseIntParam(
  value: string | null,
): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePartyOverrides(
  searchParams: URLSearchParams,
): PartyOverrides | undefined {
  const adults = parseIntParam(searchParams.get("adults"));
  const kids = parseIntParam(searchParams.get("kids"));
  const tents = parseIntParam(searchParams.get("tents"));
  const cars = parseIntParam(searchParams.get("cars"));

  if (
    adults == null &&
    kids == null &&
    tents == null &&
    cars == null
  ) {
    return undefined;
  }

  return { adults, kids, tents, cars };
}

export async function GET(request: NextRequest) {
  const parksParam = request.nextUrl.searchParams.get("parks");
  const shortNames = parksParam
    ? parksParam
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined;

  const partyOverrides = parsePartyOverrides(request.nextUrl.searchParams);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reportForNotify: AvailabilityReport | null = null;

      try {
        for await (const event of streamAvailabilityCheck(
          partyOverrides ? { partyOverrides } : undefined,
          { shortNames },
        )) {
          controller.enqueue(encoder.encode(encodeSse(event)));
          if (event.type === "done") {
            reportForNotify = event.report;
          }
        }

        if (reportForNotify) {
          await notifyIfAvailable(reportForNotify);
        }

        controller.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Availability check failed";
        controller.enqueue(
          encoder.encode(
            encodeSse({
              type: "error",
              index: 0,
              total: 0,
              error: message,
            }),
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
