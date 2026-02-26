"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from "lucide-react";
import type { KanbanTask } from "./task-card";

interface EditTaskDialogProps {
  task: KanbanTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (taskId: string, updates: {
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
  }) => Promise<void>;
}

export function EditTaskDialog({ task, open, onClose, onSave }: EditTaskDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState("");
  const [scheduleValue, setScheduleValue] = useState("");
  const [contextMode, setContextMode] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form when task changes
  if (task && prompt === "" && !saving) {
    setPrompt(task.prompt);
    setScheduleType(task.schedule_type);
    setScheduleValue(task.schedule_value);
    setContextMode(task.context_mode);
  }

  const handleClose = () => {
    setPrompt("");
    setScheduleType("");
    setScheduleValue("");
    setContextMode("");
    onClose();
  };

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (prompt !== task.prompt) updates.prompt = prompt;
      if (scheduleType !== task.schedule_type) updates.schedule_type = scheduleType;
      if (scheduleValue !== task.schedule_value) updates.schedule_value = scheduleValue;
      if (contextMode !== task.context_mode) updates.context_mode = contextMode;

      if (Object.keys(updates).length > 0) {
        await onSave(task.id, updates);
      }
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  if (!task) return null;

  const scheduleHelp: Record<string, string> = {
    cron: 'Cron expression, e.g. "0 9 * * *" (daily at 9am)',
    interval: "Milliseconds between runs, e.g. 3600000 (1 hour)",
    once: 'Local timestamp, e.g. "2026-02-26T15:30:00"',
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-2xl border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Edit Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
              Prompt
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] bg-muted border-border font-mono text-sm"
            />
          </div>

          {/* Schedule Type + Value */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                Schedule Type
              </label>
              <Select value={scheduleType} onValueChange={setScheduleType}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="once">Once</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                Schedule Value
              </label>
              <Input
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                className="bg-muted border-border font-mono"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">
            {scheduleHelp[scheduleType] || "Select a schedule type"}
          </p>

          {/* Context Mode */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
              Context Mode
            </label>
            <Select value={contextMode} onValueChange={setContextMode}>
              <SelectTrigger className="bg-muted border-border w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group">Group (with chat history)</SelectItem>
                <SelectItem value="isolated">Isolated (fresh session)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Save */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handleClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-electric/10 border border-electric/20 px-4 py-2 text-sm text-electric hover:bg-electric/20 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
