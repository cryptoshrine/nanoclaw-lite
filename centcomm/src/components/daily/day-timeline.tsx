"use client";

import { cn } from "@/lib/utils";
import type { DailyLogSummary } from "@/lib/daily-types";

interface DayTimelineProps {
  summaries: DailyLogSummary[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

const PROJECT_COLORS: Record<string, string> = {
  "Ball-AI": "bg-electric",
  "PE/VC": "bg-amber",
  NanoClaw: "bg-cyan",
  "X/Twitter": "bg-sky-400",
  Content: "bg-purple-400",
  Betting: "bg-success",
};

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return {
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    month: d.toLocaleDateString("en-GB", { month: "short" }),
  };
}

export function DayTimeline({
  summaries,
  selectedDate,
  onSelectDate,
}: DayTimelineProps) {
  return (
    <div className="space-y-1">
      {summaries.map((s) => {
        const { day, weekday, month } = formatDateShort(s.date);
        const isSelected = s.date === selectedDate;
        const isToday =
          s.date === new Date().toISOString().split("T")[0];

        return (
          <button
            key={s.date}
            onClick={() => onSelectDate(s.date)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
              isSelected
                ? "bg-electric/15 border border-electric/30"
                : "hover:bg-muted border border-transparent"
            )}
          >
            {/* Date badge */}
            <div
              className={cn(
                "flex flex-col items-center justify-center w-12 h-12 rounded-lg shrink-0",
                isSelected
                  ? "bg-electric text-white"
                  : isToday
                    ? "bg-electric/20 text-electric"
                    : "bg-muted text-muted-foreground"
              )}
            >
              <span className="text-[10px] font-medium uppercase leading-none">
                {weekday}
              </span>
              <span className="text-lg font-bold leading-tight">{day}</span>
              <span className="text-[9px] uppercase leading-none">{month}</span>
            </div>

            {/* Summary info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium truncate",
                    isSelected ? "text-electric" : "text-foreground"
                  )}
                >
                  {s.totalSessions} session{s.totalSessions !== 1 ? "s" : ""}
                </span>
                {isToday && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-electric/20 text-electric font-medium">
                    TODAY
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.userSessions} user · {s.scheduledSessions} auto ·{" "}
                {s.completedItems} done
              </div>
              {/* Project pills */}
              <div className="flex gap-1 mt-1 flex-wrap">
                {s.projects.slice(0, 4).map((p) => (
                  <span
                    key={p}
                    className={cn(
                      "inline-block w-2 h-2 rounded-full",
                      PROJECT_COLORS[p] ?? "bg-muted-foreground"
                    )}
                    title={p}
                  />
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
