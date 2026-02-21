"use client";

import { Badge } from "@/components/ui/badge";

interface ProbabilityBarProps {
  label: string;
  probability: number;
  edgePercent?: number;
  compact?: boolean;
}

function getBarColor(probability: number): string {
  if (probability >= 0.65) return "bg-success";
  if (probability >= 0.35) return "bg-amber";
  return "bg-alert";
}

function getBarTextColor(probability: number): string {
  if (probability >= 0.65) return "text-success";
  if (probability >= 0.35) return "text-amber";
  return "text-alert";
}

export function ProbabilityBar({
  label,
  probability,
  edgePercent,
  compact = false,
}: ProbabilityBarProps) {
  const pct = Math.round(probability * 100);
  const barWidth = Math.max(2, Math.min(100, pct));

  return (
    <div className={`flex items-center gap-2 ${compact ? "py-0.5" : "py-1"}`}>
      <span className="w-20 text-xs text-muted-foreground shrink-0 truncate">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-border/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getBarColor(probability)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span
        className={`w-10 text-xs font-mono text-right shrink-0 ${getBarTextColor(probability)}`}
      >
        {pct}%
      </span>
      {edgePercent !== undefined && edgePercent > 0 && (
        <Badge
          variant="outline"
          className="text-[10px] px-1 py-0 border-success/50 text-success shrink-0"
        >
          +{edgePercent.toFixed(0)}%
        </Badge>
      )}
    </div>
  );
}
