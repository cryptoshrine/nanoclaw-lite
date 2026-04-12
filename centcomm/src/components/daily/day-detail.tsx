"use client";

import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import type { DailyLog, DailySession, ActiveWorkItem } from "@/lib/daily-types";

interface DayDetailProps {
  log: DailyLog;
}

function StatusBadge({ status }: { status: DailySession["status"] }) {
  const config = {
    completed: { color: "text-success bg-success/10", label: "Done" },
    "in-progress": { color: "text-amber bg-amber/10", label: "In Progress" },
    blocked: { color: "text-alert bg-alert/10", label: "Blocked" },
    unknown: { color: "text-muted-foreground bg-muted", label: "—" },
  };
  const c = config[status];
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", c.color)}>
      {c.label}
    </span>
  );
}

function SessionCard({ session }: { session: DailySession }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "border rounded-lg p-3 transition-colors",
        session.isScheduled
          ? "border-border/50 bg-card/50"
          : "border-border bg-card"
      )}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Timeline dot */}
        <div className="flex flex-col items-center pt-1 shrink-0">
          {session.isScheduled ? (
            <Bot className="h-4 w-4 text-muted-foreground" />
          ) : (
            <User className="h-4 w-4 text-electric" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">
              {session.time}
            </span>
            <StatusBadge status={session.status} />
            {session.duration && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {session.duration}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground mt-1 truncate">
            {session.topic || "Untitled session"}
          </p>
          {!expanded && session.summary && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {session.summary}
            </p>
          )}
        </div>

        {/* Expand arrow */}
        <div className="shrink-0 pt-1">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-7 space-y-2 text-sm">
          {session.summary && (
            <div>
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                Summary
              </span>
              <p className="text-foreground mt-0.5">{session.summary}</p>
            </div>
          )}
          {session.pending && (
            <div>
              <span className="text-amber text-xs uppercase tracking-wide">
                Pending
              </span>
              <p className="text-foreground mt-0.5">{session.pending}</p>
            </div>
          )}
          {session.nextStep && (
            <div>
              <span className="text-cyan text-xs uppercase tracking-wide">
                Next Step
              </span>
              <p className="text-foreground mt-0.5">{session.nextStep}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkItemList({
  items,
  label,
}: {
  items: ActiveWorkItem[];
  label: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const completed = items.filter((i) => i.completed).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-card hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground">
            {completed}/{items.length}
          </span>
        </div>
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/50">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-4 py-2 text-sm"
            >
              {item.completed ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <span
                className={cn(
                  item.completed
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DayDetail({ log }: DayDetailProps) {
  const dateObj = new Date(log.date + "T12:00:00");
  const formattedDate = dateObj.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const userSessions = log.sessions.filter((s) => !s.isScheduled);
  const scheduledSessions = log.sessions.filter((s) => s.isScheduled);

  const [showScheduled, setShowScheduled] = useState(false);

  return (
    <div className="space-y-6">
      {/* Day header */}
      <div>
        <h3 className="text-xl font-bold text-foreground">{formattedDate}</h3>
        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
          <span>{log.sessions.length} sessions</span>
          <span>{userSessions.length} user</span>
          <span>{scheduledSessions.length} automated</span>
        </div>
      </div>

      {/* Active Work */}
      <WorkItemList items={log.activeWork} label="Active Work" />
      <WorkItemList items={log.completedYesterday} label="Completed Previous Day" />

      {/* User Sessions */}
      {userSessions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
            <User className="h-4 w-4 text-electric" />
            User Sessions ({userSessions.length})
          </h4>
          <div className="space-y-2">
            {userSessions.map((s, i) => (
              <SessionCard key={`user-${i}`} session={s} />
            ))}
          </div>
        </div>
      )}

      {/* Automated Sessions (collapsed by default) */}
      {scheduledSessions.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowScheduled(!showScheduled)}
            className="text-sm font-medium text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors"
          >
            <Bot className="h-4 w-4" />
            Automated Sessions ({scheduledSessions.length})
            {showScheduled ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
          {showScheduled && (
            <div className="space-y-2">
              {scheduledSessions.map((s, i) => (
                <SessionCard key={`auto-${i}`} session={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
