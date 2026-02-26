"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Pause,
  Trash2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Pencil,
} from "lucide-react";
import type { KanbanTask } from "./task-card";

interface TaskRunLog {
  id: number;
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

interface TaskDetailProps {
  task: KanbanTask | null;
  open: boolean;
  onClose: () => void;
  onAction: (taskId: string, action: "pause" | "resume" | "cancel") => void;
  onEdit?: (task: KanbanTask) => void;
}

export function TaskDetail({ task, open, onClose, onAction, onEdit }: TaskDetailProps) {
  const [logs, setLogs] = useState<TaskRunLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (task && open) {
      setLoadingLogs(true);
      fetch(`/api/tasks/${task.id}`)
        .then((res) => res.json())
        .then((data) => setLogs(data.logs || []))
        .catch(() => setLogs([]))
        .finally(() => setLoadingLogs(false));
    }
  }, [task, open]);

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Task Detail</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Prompt
            </p>
            <p className="text-sm text-foreground bg-muted rounded-lg p-3 whitespace-pre-wrap">
              {task.prompt}
            </p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Schedule
              </p>
              <p className="text-sm font-mono text-foreground">
                {task.schedule_type}: {task.schedule_value}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Group
              </p>
              <Badge variant="outline" className="border-border font-mono">
                {task.group_folder}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Context Mode
              </p>
              <p className="text-sm text-foreground">{task.context_mode}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Retries
              </p>
              <p className="text-sm text-foreground">
                {task.retry_count} / {task.max_retries}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {onEdit && (task.status === "active" || task.status === "paused") && (
              <button
                onClick={() => {
                  onClose();
                  onEdit(task);
                }}
                className="flex items-center gap-1.5 rounded-md bg-electric/10 border border-electric/20 px-3 py-1.5 text-sm text-electric hover:bg-electric/20 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            {task.status === "active" && (
              <button
                onClick={() => onAction(task.id, "pause")}
                className="flex items-center gap-1.5 rounded-md bg-amber/10 border border-amber/20 px-3 py-1.5 text-sm text-amber hover:bg-amber/20 transition-colors"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
            )}
            {task.status === "paused" && (
              <button
                onClick={() => onAction(task.id, "resume")}
                className="flex items-center gap-1.5 rounded-md bg-success/10 border border-success/20 px-3 py-1.5 text-sm text-success hover:bg-success/20 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </button>
            )}
            {(task.status === "active" || task.status === "paused") && (
              <button
                onClick={() => onAction(task.id, "cancel")}
                className="flex items-center gap-1.5 rounded-md bg-alert/10 border border-alert/20 px-3 py-1.5 text-sm text-alert hover:bg-alert/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Cancel
              </button>
            )}
          </div>

          {/* Run history */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Run History
            </p>
            <ScrollArea className="h-[200px]">
              {loadingLogs ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No runs yet
                </p>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-lg border border-border bg-muted/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {log.status === "completed" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : log.status === "failed" ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-alert" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {log.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{(log.duration_ms / 1000).toFixed(1)}s</span>
                          <span>
                            {new Date(log.run_at).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                      {log.result && (
                        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                          {log.result.slice(0, 200)}
                        </p>
                      )}
                      {log.error && (
                        <p className="mt-1.5 text-xs text-alert line-clamp-2">
                          {log.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
