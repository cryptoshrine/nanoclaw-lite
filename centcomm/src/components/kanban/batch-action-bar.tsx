"use client";

import {
  Play,
  Pause,
  Trash2,
  X,
  CheckSquare,
  Circle,
  Loader2,
  CheckCircle2,
  Ban,
} from "lucide-react";

interface BatchActionBarProps {
  selectedCount: number;
  tab: "dev" | "scheduled";
  onAction: (action: string) => void;
  onClearSelection: () => void;
}

export function BatchActionBar({
  selectedCount,
  tab,
  onAction,
  onClearSelection,
}: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border border-electric/30 bg-card/95 backdrop-blur-sm px-5 py-3 shadow-2xl shadow-electric/10">
      <div className="flex items-center gap-2 text-sm">
        <CheckSquare className="h-4 w-4 text-electric" />
        <span className="text-foreground font-medium">
          {selectedCount} selected
        </span>
      </div>

      <div className="h-5 w-px bg-border" />

      {tab === "scheduled" ? (
        <>
          <button
            onClick={() => onAction("pause")}
            className="flex items-center gap-1.5 rounded-md border border-amber/20 bg-amber/5 px-3 py-1.5 text-xs text-amber hover:bg-amber/15 transition-colors"
          >
            <Pause className="h-3.5 w-3.5" />
            Pause All
          </button>
          <button
            onClick={() => onAction("resume")}
            className="flex items-center gap-1.5 rounded-md border border-success/20 bg-success/5 px-3 py-1.5 text-xs text-success hover:bg-success/15 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            Resume All
          </button>
          <button
            onClick={() => onAction("cancel")}
            className="flex items-center gap-1.5 rounded-md border border-alert/20 bg-alert/5 px-3 py-1.5 text-xs text-alert hover:bg-alert/15 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Cancel All
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => onAction("Pending")}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Circle className="h-3.5 w-3.5" />
            Pending
          </button>
          <button
            onClick={() => onAction("In Progress")}
            className="flex items-center gap-1.5 rounded-md border border-electric/20 bg-electric/5 px-3 py-1.5 text-xs text-electric hover:bg-electric/15 transition-colors"
          >
            <Loader2 className="h-3.5 w-3.5" />
            In Progress
          </button>
          <button
            onClick={() => onAction("Completed")}
            className="flex items-center gap-1.5 rounded-md border border-success/20 bg-success/5 px-3 py-1.5 text-xs text-success hover:bg-success/15 transition-colors"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done
          </button>
          <button
            onClick={() => onAction("Blocked")}
            className="flex items-center gap-1.5 rounded-md border border-alert/20 bg-alert/5 px-3 py-1.5 text-xs text-alert hover:bg-alert/15 transition-colors"
          >
            <Ban className="h-3.5 w-3.5" />
            Blocked
          </button>
        </>
      )}

      <div className="h-5 w-px bg-border" />

      <button
        onClick={onClearSelection}
        className="flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        Clear
      </button>
    </div>
  );
}
