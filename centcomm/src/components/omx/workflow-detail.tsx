"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Loader2,
  Pause,
  XCircle,
  Clock,
  GitBranch,
  Users,
} from "lucide-react";

interface WorkflowFull {
  id: string;
  taskDescription: string;
  status: string;
  mode: string;
  steps: number;
  completedSteps: number;
  failedSteps: number;
  specialistsSpawned: number;
  currentStepIndex: number;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const stepIcons: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="h-4 w-4 text-emerald-400" />,
  in_progress: <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />,
  pending: <Pause className="h-4 w-4 text-muted-foreground" />,
  failed: <XCircle className="h-4 w-4 text-red-400" />,
};

function formatTime(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString();
}

function duration(start: string, end: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const mins = Math.floor((e - s) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

interface WorkflowDetailProps {
  workflowId: string;
}

export function WorkflowDetail({ workflowId }: WorkflowDetailProps) {
  const [workflow, setWorkflow] = useState<WorkflowFull | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/omx/workflows?status=all");
      if (res.ok) {
        const data = await res.json();
        const found = (data.workflows || []).find(
          (w: WorkflowFull) => w.id === workflowId
        );
        setWorkflow(found || null);
      }
    } catch {
      /* silent */
    }
  }, [workflowId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  if (!workflow) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading workflow...
      </div>
    );
  }

  // Build step display from counts
  const steps: { index: number; status: string }[] = [];
  for (let i = 0; i < workflow.steps; i++) {
    let status = "pending";
    if (i < workflow.completedSteps) status = "completed";
    else if (i < workflow.completedSteps + workflow.failedSteps)
      status = "failed";
    else if (i === workflow.currentStepIndex) status = "in_progress";
    steps.push({ index: i, status });
  }

  const statusColors: Record<string, string> = {
    active: "border-amber-400/30 text-amber-400",
    completed: "border-emerald-400/30 text-emerald-400",
    failed: "border-red-400/30 text-red-400",
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {workflow.taskDescription}
            </h3>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  statusColors[workflow.status] || statusColors.active
                )}
              >
                {workflow.status}
              </Badge>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {duration(workflow.createdAt, workflow.completedAt)}
              </span>
              {workflow.branch && (
                <span className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {workflow.branch}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {workflow.specialistsSpawned || 0} specialists
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Steps
        </h4>
        <div className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.index}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                step.status === "in_progress" && "bg-amber-400/5",
                step.status === "completed" && "opacity-70"
              )}
            >
              {stepIcons[step.status] || stepIcons.pending}
              <span className="text-foreground">Step {step.index + 1}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {step.status.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground flex items-center gap-4">
        <span>Created: {formatTime(workflow.createdAt)}</span>
        <span>Updated: {formatTime(workflow.updatedAt)}</span>
        {workflow.completedAt && (
          <span>Completed: {formatTime(workflow.completedAt)}</span>
        )}
        <span>Mode: {workflow.mode}</span>
      </div>
    </div>
  );
}
