"use client";

import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Timer,
  Repeat,
  Trash2,
  Pencil,
} from "lucide-react";

export interface KanbanTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
  context_mode: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return `in ${Math.abs(seconds)}s`;
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const scheduleIcon = (type: string) => {
  switch (type) {
    case "cron":
      return <Repeat className="h-3 w-3" />;
    case "interval":
      return <Timer className="h-3 w-3" />;
    case "once":
      return <Calendar className="h-3 w-3" />;
    default:
      return <Clock className="h-3 w-3" />;
  }
};

const statusConfig: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string }
> = {
  active: {
    icon: <Play className="h-3 w-3" />,
    color: "text-success",
    bg: "border-success/20",
  },
  paused: {
    icon: <Pause className="h-3 w-3" />,
    color: "text-amber",
    bg: "border-amber/20",
  },
  completed: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: "text-electric",
    bg: "border-electric/20",
  },
  failed: {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "text-alert",
    bg: "border-alert/20",
  },
};

interface TaskCardProps {
  task: KanbanTask;
  onClick: () => void;
  onAction?: (taskId: string, action: "pause" | "resume" | "cancel") => void;
  onEdit?: (task: KanbanTask) => void;
}

export function TaskCard({ task, onClick, onAction, onEdit }: TaskCardProps) {
  const config = statusConfig[task.status] || statusConfig.active;

  return (
    <div
      className={`group w-full rounded-lg border bg-card p-3 text-left transition-all hover:border-electric/30 card-glow ${config.bg}`}
    >
      {/* Clickable content area */}
      <button onClick={onClick} className="w-full text-left">
        {/* Prompt preview */}
        <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
          {task.prompt.slice(0, 120)}
          {task.prompt.length > 120 ? "..." : ""}
        </p>

        {/* Meta info */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-border font-mono"
          >
            {task.group_folder}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {scheduleIcon(task.schedule_type)}
            <span className="font-mono">{task.schedule_value}</span>
          </div>
        </div>

        {/* Timing */}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          {task.next_run && (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              Next: {timeAgo(task.next_run)}
            </span>
          )}
          {task.last_run && (
            <span>Last: {timeAgo(task.last_run)}</span>
          )}
        </div>

        {/* Error indicator */}
        {task.last_error && (
          <div className="mt-2 rounded bg-alert/10 px-2 py-1 text-[10px] text-alert line-clamp-1">
            {task.last_error}
          </div>
        )}
      </button>

      {/* Quick actions — show on hover */}
      {(onAction || onEdit) && (task.status === "active" || task.status === "paused") && (
        <div className="mt-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
              className="flex items-center gap-1 rounded-md border border-electric/20 bg-electric/5 px-2 py-1 text-[10px] text-electric hover:bg-electric/15 transition-colors"
              title="Edit task"
            >
              <Pencil className="h-2.5 w-2.5" />
              Edit
            </button>
          )}
          {onAction && task.status === "active" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(task.id, "pause");
              }}
              className="flex items-center gap-1 rounded-md border border-amber/20 bg-amber/5 px-2 py-1 text-[10px] text-amber hover:bg-amber/15 transition-colors"
              title="Pause task"
            >
              <Pause className="h-2.5 w-2.5" />
              Pause
            </button>
          )}
          {onAction && task.status === "paused" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(task.id, "resume");
              }}
              className="flex items-center gap-1 rounded-md border border-success/20 bg-success/5 px-2 py-1 text-[10px] text-success hover:bg-success/15 transition-colors"
              title="Resume task"
            >
              <Play className="h-2.5 w-2.5" />
              Resume
            </button>
          )}
          {onAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(task.id, "cancel");
              }}
              className="flex items-center gap-1 rounded-md border border-alert/20 bg-alert/5 px-2 py-1 text-[10px] text-alert hover:bg-alert/15 transition-colors"
              title="Cancel task"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
