"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useOmxEvents } from "@/hooks/use-omx-events";

interface OmxEvent {
  type: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

const eventColors: Record<string, string> = {
  workflow_started: "bg-electric",
  step_started: "bg-amber-400",
  step_completed: "bg-emerald-400",
  step_failed: "bg-red-400",
  specialist_spawned: "bg-blue-400",
  specialist_completed: "bg-emerald-400",
  specialist_failed: "bg-red-400",
  workflow_completed: "bg-emerald-400",
  workflow_failed: "bg-red-400",
  gate_passed: "bg-emerald-400",
  gate_failed: "bg-red-400",
  heartbeat_stale: "bg-orange-400",
  stuck_loop: "bg-red-400",
};

const EVENT_TYPES = [
  "all",
  "workflow_started",
  "workflow_completed",
  "workflow_failed",
  "step_started",
  "step_completed",
  "step_failed",
  "specialist_spawned",
  "specialist_completed",
  "specialist_failed",
  "gate_passed",
  "gate_failed",
  "heartbeat_stale",
  "stuck_loop",
] as const;

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summarizeData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const parts: string[] = [];
  if (data.stepIndex !== undefined) parts.push(`step ${Number(data.stepIndex) + 1}`);
  if (data.specialistName) parts.push(String(data.specialistName));
  if (data.error) parts.push(String(data.error).slice(0, 80));
  if (data.result) parts.push(String(data.result).slice(0, 80));
  return parts.join(" — ");
}

interface EventTimelineProps {
  workflowId: string;
}

export function EventTimeline({ workflowId }: EventTimelineProps) {
  const [polledEvents, setPolledEvents] = useState<OmxEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const { events: wsEvents, connected } = useOmxEvents(workflowId);

  const load = useCallback(async () => {
    try {
      const url =
        filter === "all"
          ? `/api/omx/events?workflowId=${workflowId}&limit=100`
          : `/api/omx/events?workflowId=${workflowId}&type=${filter}&limit=100`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPolledEvents(data.events || []);
      }
    } catch {
      /* silent */
    }
  }, [workflowId, filter]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  // Merge polled + WebSocket events, dedupe by timestamp+type, sort newest first
  const events = useMemo(() => {
    const seen = new Set<string>();
    const merged: OmxEvent[] = [];
    for (const ev of [...wsEvents, ...polledEvents]) {
      const key = `${ev.type}:${ev.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(ev);
      }
    }
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    // Apply client-side filter for WS events
    if (filter !== "all") {
      return merged.filter((ev) => ev.type === filter);
    }
    return merged;
  }, [wsEvents, polledEvents, filter]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">Event Timeline</h3>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              connected ? "bg-emerald-400" : "bg-muted-foreground"
            )}
            title={connected ? "WebSocket connected" : "Polling only"}
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-electric"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "All events" : t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[400px] overflow-y-auto px-5 py-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No events recorded
          </p>
        ) : (
          <div className="space-y-0">
            {events.map((ev, i) => {
              const dotColor = eventColors[ev.type] || "bg-muted-foreground";
              const summary = summarizeData(ev.data);

              return (
                <div key={`${ev.type}-${ev.timestamp}-${i}`} className="flex gap-3 py-2">
                  <div className="flex flex-col items-center">
                    <div className={cn("h-2.5 w-2.5 rounded-full shrink-0 mt-1.5", dotColor)} />
                    {i < events.length - 1 && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">
                        {ev.type.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTimestamp(ev.timestamp)}
                      </span>
                    </div>
                    {summary && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {summary}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
