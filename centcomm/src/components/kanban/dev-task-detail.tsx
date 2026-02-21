"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DevTask } from "./dev-task-card";
import {
  Circle,
  Loader2,
  CheckCircle2,
  Ban,
  FlaskConical,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  Calendar,
  Package,
  Link2,
  Database,
  Pencil,
  Save,
  X,
} from "lucide-react";

const statusConfig: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  Pending: {
    icon: <Circle className="h-4 w-4" />,
    color: "text-muted-foreground",
    label: "Pending",
  },
  "In Progress": {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-electric",
    label: "In Progress",
  },
  Completed: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-success",
    label: "Completed",
  },
  Blocked: {
    icon: <Ban className="h-4 w-4" />,
    color: "text-alert",
    label: "Blocked",
  },
};

const priorityIcon = (priority: string) => {
  if (priority.includes("P0") || priority.includes("Critical"))
    return <ArrowUpRight className="h-4 w-4 text-alert" />;
  if (priority.includes("P1") || priority.includes("High"))
    return <ArrowUpRight className="h-4 w-4 text-amber" />;
  if (priority.includes("P2") || priority.includes("Medium"))
    return <ArrowRight className="h-4 w-4 text-muted-foreground" />;
  return <ArrowDownRight className="h-4 w-4 text-muted-foreground/60" />;
};

interface DevTaskDetailProps {
  task: DevTask | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: (task: DevTask, updates: Partial<DevTask>) => void;
}

export function DevTaskDetail({ task, open, onClose, onUpdate }: DevTaskDetailProps) {
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState<string>("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);

  if (!task) return null;

  const config = statusConfig[task.status] || statusConfig.Pending;

  function startEditing() {
    setEditStatus(task!.status);
    setEditSummary(task!.summary);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function saveEdits() {
    if (!task || !onUpdate) return;
    setSaving(true);
    try {
      const updates: Partial<DevTask> = {};
      if (editStatus !== task.status) {
        updates.status = editStatus as DevTask["status"];
      }
      if (editSummary !== task.summary) {
        updates.summary = editSummary;
      }
      if (Object.keys(updates).length > 0) {
        onUpdate(task, updates);
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setEditing(false); onClose(); } }}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <span className={config.color}>{config.icon}</span>
              #{task.id} {task.title}
            </DialogTitle>
            {onUpdate && !editing && (
              <button
                onClick={startEditing}
                className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status & Priority row */}
          <div className="flex items-center gap-3 flex-wrap">
            {editing ? (
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="w-[140px] bg-muted border-border text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="outline"
                className={`${config.color} border-current/20 gap-1`}
              >
                {config.icon}
                {config.label}
              </Badge>
            )}
            <Badge variant="outline" className="gap-1 border-border">
              {priorityIcon(task.priority)}
              {task.priority}
            </Badge>
            {task.size && (
              <Badge variant="outline" className="gap-1 border-border">
                <Package className="h-3 w-3" />
                {task.size}
              </Badge>
            )}
            {task.category && (
              <Badge
                variant="outline"
                className="gap-1 border-violet-500/30 text-violet-400"
              >
                <FlaskConical className="h-3 w-3" />
                Experimental
              </Badge>
            )}
          </div>

          <Separator className="bg-border" />

          {/* Summary */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Summary
            </h4>
            {editing ? (
              <Textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                className="bg-muted border-border text-sm min-h-[80px]"
              />
            ) : (
              <p className="text-sm text-foreground leading-relaxed">
                {task.summary}
              </p>
            )}
          </div>

          {/* Edit actions */}
          {editing && (
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdits}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                onClick={cancelEditing}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            {task.added && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Added:</span>
                <span className="text-foreground">{task.added}</span>
              </div>
            )}
            {task.completed && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-muted-foreground">Completed:</span>
                <span className="text-foreground">{task.completed}</span>
              </div>
            )}
            {task.dependsOn && (
              <div className="flex items-center gap-2 text-sm col-span-2">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Depends on:</span>
                <span className="text-foreground">{task.dependsOn}</span>
              </div>
            )}
            {task.keyData && (
              <div className="flex items-center gap-2 text-sm col-span-2">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Key data:</span>
                <span className="text-foreground">{task.keyData}</span>
              </div>
            )}
          </div>

          {/* Source */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Source:</span>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-border font-mono"
            >
              {task.source}
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
