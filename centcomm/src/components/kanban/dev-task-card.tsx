"use client";

import { Badge } from "@/components/ui/badge";
import {
  Circle,
  Loader2,
  CheckCircle2,
  Ban,
  FlaskConical,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
} from "lucide-react";

export interface DevTask {
  id: number;
  title: string;
  status: "Pending" | "In Progress" | "Completed" | "Blocked";
  priority: string;
  size: string;
  added: string;
  completed: string | null;
  summary: string;
  category: string | null;
  dependsOn: string | null;
  keyData: string | null;
  source: string;
}

const statusConfig: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string }
> = {
  Pending: {
    icon: <Circle className="h-3 w-3" />,
    color: "text-muted-foreground",
    bg: "border-border",
  },
  "In Progress": {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    color: "text-electric",
    bg: "border-electric/30",
  },
  Completed: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: "text-success",
    bg: "border-success/30",
  },
  Blocked: {
    icon: <Ban className="h-3 w-3" />,
    color: "text-alert",
    bg: "border-alert/30",
  },
};

const quickStatusOptions: {
  status: DevTask["status"];
  icon: React.ReactNode;
  color: string;
  label: string;
}[] = [
  {
    status: "Pending",
    icon: <Circle className="h-2.5 w-2.5" />,
    color: "text-muted-foreground border-border hover:bg-muted",
    label: "Pending",
  },
  {
    status: "In Progress",
    icon: <Loader2 className="h-2.5 w-2.5" />,
    color: "text-electric border-electric/20 hover:bg-electric/10",
    label: "Start",
  },
  {
    status: "Completed",
    icon: <CheckCircle2 className="h-2.5 w-2.5" />,
    color: "text-success border-success/20 hover:bg-success/10",
    label: "Done",
  },
  {
    status: "Blocked",
    icon: <Ban className="h-2.5 w-2.5" />,
    color: "text-alert border-alert/20 hover:bg-alert/10",
    label: "Block",
  },
];

const priorityIcon = (priority: string) => {
  if (priority.includes("P0") || priority.includes("Critical"))
    return <ArrowUpRight className="h-3 w-3 text-alert" />;
  if (priority.includes("P1") || priority.includes("High"))
    return <ArrowUpRight className="h-3 w-3 text-amber" />;
  if (priority.includes("P2") || priority.includes("Medium"))
    return <ArrowRight className="h-3 w-3 text-muted-foreground" />;
  return <ArrowDownRight className="h-3 w-3 text-muted-foreground/60" />;
};

const sizeColor = (size: string) => {
  if (size.includes("Large")) return "text-alert border-alert/30";
  if (size.includes("Medium")) return "text-amber border-amber/30";
  if (size.includes("Small")) return "text-success border-success/30";
  return "text-muted-foreground border-border";
};

interface DevTaskCardProps {
  task: DevTask;
  onClick: () => void;
  onStatusChange?: (task: DevTask, newStatus: DevTask["status"]) => void;
}

export function DevTaskCard({ task, onClick, onStatusChange }: DevTaskCardProps) {
  const config = statusConfig[task.status] || statusConfig.Pending;

  return (
    <div
      className={`group w-full rounded-lg border bg-card p-3 text-left transition-all hover:border-electric/30 card-glow ${config.bg}`}
    >
      {/* Clickable content area */}
      <button onClick={onClick} className="w-full text-left">
        {/* Title with task number */}
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 shrink-0 ${config.color}`}>{config.icon}</span>
          <p className="text-sm font-medium text-foreground leading-snug">
            #{task.id} {task.title}
          </p>
        </div>

        {/* Summary */}
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 pl-5">
          {task.summary}
        </p>

        {/* Badges */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap pl-5">
          {/* Priority */}
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-border gap-0.5"
          >
            {priorityIcon(task.priority)}
            {task.priority.replace(/\s*—.*$/, "").replace(/\(|\)/g, "")}
          </Badge>

          {/* Size */}
          {task.size && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${sizeColor(task.size)}`}
            >
              {task.size}
            </Badge>
          )}

          {/* Category */}
          {task.category && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-400 gap-0.5"
            >
              <FlaskConical className="h-2.5 w-2.5" />
              Experimental
            </Badge>
          )}

          {/* Source group */}
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-border font-mono"
          >
            {task.source}
          </Badge>
        </div>

        {/* Dependencies */}
        {task.dependsOn && (
          <div className="mt-2 pl-5 text-[10px] text-muted-foreground/70">
            Depends on: {task.dependsOn}
          </div>
        )}
      </button>

      {/* Quick status actions — show on hover */}
      {onStatusChange && (
        <div className="mt-2 flex items-center gap-1 pl-5 opacity-0 group-hover:opacity-100 transition-opacity">
          {quickStatusOptions
            .filter((opt) => opt.status !== task.status)
            .map((opt) => (
              <button
                key={opt.status}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(task, opt.status);
                }}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${opt.color}`}
                title={`Set status to ${opt.status}`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
