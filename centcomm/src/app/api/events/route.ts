import { getSystemStats, getRecentMessages, getRecentTaskRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Track last-seen IDs to detect new data
      let lastMessageId = "";
      let lastTaskRunId = 0;

      function sendEvent(type: string, data: object) {
        const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(event));
      }

      function poll() {
        try {
          // Get current stats
          const stats = getSystemStats();
          sendEvent("stats", stats);

          // Check for new messages
          const recentMessages = getRecentMessages(5);
          if (recentMessages.length > 0 && recentMessages[0].id !== lastMessageId) {
            lastMessageId = recentMessages[0].id;
            sendEvent("new_message", {
              message: recentMessages[0],
            });
          }

          // Check for new task runs
          const recentRuns = getRecentTaskRuns(3);
          if (recentRuns.length > 0 && recentRuns[0].id !== lastTaskRunId) {
            lastTaskRunId = recentRuns[0].id;
            sendEvent("task_run", {
              run: recentRuns[0],
            });
          }

          // Heartbeat
          sendEvent("heartbeat", { time: new Date().toISOString() });
        } catch {
          // DB might be locked; skip this poll
        }
      }

      // Initial data push
      poll();

      // Poll every 5 seconds
      const interval = setInterval(poll, 5000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Auto-close after 5 minutes (client will reconnect)
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
