import {
  notifyIfAvailable,
  streamAvailabilityCheck,
} from "@/lib/bcparks/check";
import type { AvailabilityReport, CheckEvent } from "@/lib/bcparks/types";
import {
  isIsoDate,
  type DateOverrides,
  type DayOfWeek,
  type PartyOverrides,
} from "@/config/watcher.config";
import {
  areNightsContiguous,
  isDayOfWeek,
  orderContiguousNights,
} from "@/lib/bcparks/weekends";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function encodeSse(event: CheckEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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

  if (partySize == null && tents == null) {
    return undefined;
  }

  return { partySize, tents };
}

function parseDateOverrides(
  searchParams: URLSearchParams,
): DateOverrides | undefined {
  const startDateRaw = searchParams.get("startDate");
  const endDateRaw = searchParams.get("endDate");
  const startDate = isIsoDate(startDateRaw) ? startDateRaw : undefined;
  const endDate = isIsoDate(endDateRaw) ? endDateRaw : undefined;

  if (startDate == null && endDate == null) return undefined;
  return { startDate, endDate };
}

function parseBoolParam(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function parseNights(searchParams: URLSearchParams): DayOfWeek[] | undefined {
  const raw = searchParams.get("nights");
  if (!raw) return undefined;
  const nights = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(isDayOfWeek);
  if (nights.length === 0) return undefined;
  if (!areNightsContiguous(nights)) return undefined;
  return orderContiguousNights(nights);
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
  const dateOverrides = parseDateOverrides(request.nextUrl.searchParams);
  const nights = parseNights(request.nextUrl.searchParams);
  const excludeDoubleSites = parseBoolParam(
    request.nextUrl.searchParams.get("excludeDoubles"),
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reportForNotify: AvailabilityReport | null = null;

      try {
        for await (const event of streamAvailabilityCheck(
          {
            ...(partyOverrides ? { partyOverrides } : {}),
            dateOverrides: dateOverrides ?? {},
            ...(nights ? { nights } : {}),
            ...(excludeDoubleSites != null ? { excludeDoubleSites } : {}),
          },
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
