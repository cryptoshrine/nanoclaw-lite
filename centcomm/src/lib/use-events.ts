"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SystemStats {
  messages: number;
  tasks: Record<string, number>;
  teams: Record<string, number>;
  members: Record<string, number>;
}

interface EventData {
  stats: SystemStats | null;
  lastMessage: { id: string; sender_name: string; content: string } | null;
  lastTaskRun: { id: number; status: string; task_id: string } | null;
  connected: boolean;
}

export function useEvents(): EventData {
  const [data, setData] = useState<EventData>({
    stats: null,
    lastMessage: null,
    lastTaskRun: null,
    connected: false,
  });
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    const source = new EventSource("/api/events");
    sourceRef.current = source;

    source.addEventListener("stats", (e) => {
      try {
        const stats = JSON.parse(e.data);
        setData((prev) => ({ ...prev, stats, connected: true }));
      } catch {
        // ignore parse errors
      }
    });

    source.addEventListener("new_message", (e) => {
      try {
        const { message } = JSON.parse(e.data);
        setData((prev) => ({ ...prev, lastMessage: message }));
      } catch {
        // ignore
      }
    });

    source.addEventListener("task_run", (e) => {
      try {
        const { run } = JSON.parse(e.data);
        setData((prev) => ({ ...prev, lastTaskRun: run }));
      } catch {
        // ignore
      }
    });

    source.addEventListener("heartbeat", () => {
      setData((prev) => ({ ...prev, connected: true }));
    });

    source.onerror = () => {
      setData((prev) => ({ ...prev, connected: false }));
      source.close();

      // Reconnect after 3s
      reconnectTimeout.current = setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [connect]);

  return data;
}
