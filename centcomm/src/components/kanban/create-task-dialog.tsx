"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";

interface GroupInfo {
  name: string;
  folder: string;
  jid: string;
}

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  groups: GroupInfo[];
  onCreated: () => void;
}

export function CreateTaskDialog({
  open,
  onClose,
  groups,
  onCreated,
}: CreateTaskDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState("once");
  const [scheduleValue, setScheduleValue] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [contextMode, setContextMode] = useState("group");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!prompt.trim() || !scheduleValue.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          schedule_type: scheduleType,
          schedule_value: scheduleValue.trim(),
          target_group: targetGroup || undefined,
          context_mode: contextMode,
        }),
      });

      if (res.ok) {
        setPrompt("");
        setScheduleValue("");
        setTargetGroup("");
        onCreated();
        onClose();
      }
    } catch {
      // silently fail
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Schedule New Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Prompt
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              className="mt-1 bg-muted border-border min-h-[80px]"
            />
          </div>

          {/* Schedule type + value */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Schedule Type
              </label>
              <Select value={scheduleType} onValueChange={setScheduleType}>
                <SelectTrigger className="mt-1 bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="interval">Interval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Schedule Value
              </label>
              <Input
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                placeholder={
                  scheduleType === "cron"
                    ? "0 9 * * *"
                    : scheduleType === "interval"
                    ? "3600000"
                    : "2026-02-15T10:00:00"
                }
                className="mt-1 bg-muted border-border font-mono text-sm"
              />
            </div>
          </div>

          {/* Target group + context mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Target Group
              </label>
              <Select value={targetGroup} onValueChange={setTargetGroup}>
                <SelectTrigger className="mt-1 bg-muted border-border">
                  <SelectValue placeholder="Default (main)" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.folder} value={g.folder}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Context Mode
              </label>
              <Select value={contextMode} onValueChange={setContextMode}>
                <SelectTrigger className="mt-1 bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Group (with history)</SelectItem>
                  <SelectItem value="isolated">Isolated (clean)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={creating || !prompt.trim() || !scheduleValue.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-electric px-4 py-2.5 text-sm font-medium text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Schedule Task
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
