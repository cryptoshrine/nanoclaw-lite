"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface Workflow {
  id: string;
  taskDescription: string;
  status: string;
  mode: string;
  steps: number;
  completedSteps: number;
  failedSteps: number;
  createdAt: string;
  updatedAt: string;
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "active",
    className: "border-amber-400/30 text-amber-400",
  },
  completed: {
    label: "done",
    className: "border-emerald-400/30 text-emerald-400",
  },
  failed: { label: "failed", className: "border-red-400/30 text-red-400" },
};

interface WorkflowListProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function WorkflowList({ selectedId, onSelect }: WorkflowListProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/omx/workflows?status=all");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">Workflows</h3>
        <button
          onClick={() => load()}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[600px] overflow-y-auto">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading...</p>
        ) : workflows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">
            No workflows yet
          </p>
        ) : (
          workflows.map((w) => {
            const sc = statusConfig[w.status] || statusConfig.active;
            const isSelected = selectedId === w.id;

            return (
              <button
                key={w.id}
                onClick={() => onSelect(isSelected ? null : w.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border last:border-b-0 transition-colors",
                  isSelected
                    ? "bg-electric/10"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-medium line-clamp-2",
                      isSelected ? "text-electric" : "text-foreground"
                    )}
                  >
                    {w.taskDescription}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0 shrink-0", sc.className)}
                  >
                    {sc.label}
                  </Badge>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>
                    {w.completedSteps}/{w.steps} steps
                  </span>
                  <span>{w.mode}</span>
                  <span>{timeAgo(w.updatedAt || w.createdAt)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
