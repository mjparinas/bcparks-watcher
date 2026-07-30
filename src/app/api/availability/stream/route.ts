import {
  notifyIfAvailable,
  streamAvailabilityCheck,
} from "@/lib/bcparks/check";
import type { AvailabilityReport, CheckEvent } from "@/lib/bcparks/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function encodeSse(event: CheckEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest) {
  const parksParam = request.nextUrl.searchParams.get("parks");
  const shortNames = parksParam
    ? parksParam
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reportForNotify: AvailabilityReport | null = null;

      try {
        for await (const event of streamAvailabilityCheck(undefined, {
          shortNames,
        })) {
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
