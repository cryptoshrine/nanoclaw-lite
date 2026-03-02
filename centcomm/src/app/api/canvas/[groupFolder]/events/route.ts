import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupFolder: string }> }
) {
  const { groupFolder } = await params;
  const eventsPath = path.join(PATHS.canvas, groupFolder, "events.json");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastSeq = 0;

      function sendEvent(type: string, data: object) {
        const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(event));
      }

      function poll() {
        try {
          if (fs.existsSync(eventsPath)) {
            const events = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
            const newEvents = events.filter(
              (e: { seq: number }) => e.seq > lastSeq
            );

            for (const event of newEvents) {
              sendEvent("canvas_event", event);
              lastSeq = event.seq;
            }
          }
          sendEvent("heartbeat", { time: new Date().toISOString() });
        } catch {
          // File might be locked during write; skip this tick
        }
      }

      // Initial push
      poll();

      // Poll every 1 second for near-real-time updates
      const interval = setInterval(poll, 1000);

      const cleanup = () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Auto-close after 5 minutes
      setTimeout(cleanup, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
