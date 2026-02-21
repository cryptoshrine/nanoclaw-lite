"use client";

import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trophy,
  Skull,
  Anchor,
  Compass,
} from "lucide-react";

interface SessionSummary {
  id: string;
  topic: string;
  status: "active" | "complete" | "failed";
  phase: string;
  messageCount: number;
  createdAt: string;
  completedAt: string | null;
  winner?: string;
}

interface SessionListProps {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const winnerMeta: Record<string, { name: string; color: string }> = {
  blackthorn: { name: "Blackthorn", color: "text-amber-400" },
  ironhook: { name: "Ironhook", color: "text-emerald-400" },
  stormcrest: { name: "Stormcrest", color: "text-blue-400" },
};

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No council sessions yet</p>
        <p className="text-xs mt-1">Summon the council to begin deliberations</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const isSelected = session.id === selectedId;
        const winner = session.winner ? winnerMeta[session.winner] : null;

        return (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={cn(
              "w-full text-left rounded-lg border p-3 transition-all",
              isSelected
                ? "border-electric bg-electric/5"
                : "border-border bg-card hover:bg-card/80"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={cn(
                  "text-sm font-medium line-clamp-2",
                  isSelected ? "text-electric" : "text-foreground"
                )}
              >
                {session.topic}
              </p>
              {session.status === "active" && (
                <Loader2 className="h-4 w-4 animate-spin text-electric shrink-0" />
              )}
              {session.status === "complete" && (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              )}
              {session.status === "failed" && (
                <AlertCircle className="h-4 w-4 text-alert shrink-0" />
              )}
            </div>

            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span>{new Date(session.createdAt).toLocaleDateString()}</span>
              <span>{session.messageCount} messages</span>
              {winner && (
                <span className={cn("flex items-center gap-1", winner.color)}>
                  <Trophy className="h-3 w-3" />
                  {winner.name}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
