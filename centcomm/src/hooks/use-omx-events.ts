"use client";

import { useEffect, useState } from "react";

interface OmxEvent {
  type: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export function useOmxEvents(workflowId?: string) {
  const [events, setEvents] = useState<OmxEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:18800";
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "omx:event") {
            const omxEvent = data.payload as OmxEvent;
            if (!workflowId || (omxEvent.data?.workflowId === workflowId)) {
              setEvents((prev) => [omxEvent, ...prev].slice(0, 200));
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };
    } catch {
      /* WebSocket not available */
    }

    return () => {
      if (ws) ws.close();
    };
  }, [workflowId]);

  return { events, connected };
}
