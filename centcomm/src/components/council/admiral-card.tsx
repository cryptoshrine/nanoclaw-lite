"use client";

import { cn } from "@/lib/utils";
import { Skull, Anchor, Compass } from "lucide-react";

interface AdmiralCardProps {
  admiral: {
    id: string;
    name: string;
    rank: string;
    model: string;
    provider: string;
    strengths: string[];
  };
  isActive?: boolean;
  isSpeaking?: boolean;
}

const providerColors: Record<string, { text: string; bg: string; border: string }> = {
  anthropic: {
    text: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
  },
  openai: {
    text: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  google: {
    text: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
  },
};

const providerIcons: Record<string, typeof Skull> = {
  anthropic: Skull,
  openai: Anchor,
  google: Compass,
};

export function AdmiralCard({ admiral, isActive, isSpeaking }: AdmiralCardProps) {
  const colors = providerColors[admiral.provider] || providerColors.anthropic;
  const Icon = providerIcons[admiral.provider] || Skull;

  return (
    <div
      className={cn(
        "relative rounded-lg border p-4 transition-all duration-300",
        colors.border,
        isActive ? colors.bg : "bg-card",
        isSpeaking && "ring-2 ring-offset-1 ring-offset-background",
        isSpeaking && admiral.provider === "anthropic" && "ring-amber-400",
        isSpeaking && admiral.provider === "openai" && "ring-emerald-400",
        isSpeaking && admiral.provider === "google" && "ring-blue-400"
      )}
    >
      {/* Speaking indicator */}
      {isSpeaking && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span
              className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                admiral.provider === "anthropic" && "bg-amber-400",
                admiral.provider === "openai" && "bg-emerald-400",
                admiral.provider === "google" && "bg-blue-400"
              )}
            />
            <span
              className={cn(
                "relative inline-flex rounded-full h-3 w-3",
                admiral.provider === "anthropic" && "bg-amber-400",
                admiral.provider === "openai" && "bg-emerald-400",
                admiral.provider === "google" && "bg-blue-400"
              )}
            />
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            colors.bg
          )}
        >
          <Icon className={cn("h-5 w-5", colors.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn("text-sm font-bold", colors.text)}>
            {admiral.name}
          </h3>
          <p className="text-xs text-muted-foreground">{admiral.rank}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {admiral.model}
          </p>
        </div>
      </div>

      {/* Strengths */}
      <div className="mt-3 flex flex-wrap gap-1">
        {admiral.strengths.map((s) => (
          <span
            key={s}
            className={cn(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              colors.bg,
              colors.text
            )}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
