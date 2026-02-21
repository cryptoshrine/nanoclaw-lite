"use client";

import { useState } from "react";
import { Swords, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionLauncherProps {
  onSessionStart: (sessionId: string) => void;
}

export function SessionLauncher({ onSessionStart }: SessionLauncherProps) {
  const [topic, setTopic] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    if (!topic.trim()) return;

    setIsLaunching(true);
    setError(null);

    try {
      const res = await fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start session");
      }

      const data = await res.json();
      setTopic("");
      onSessionStart(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLaunching(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
          <Swords className="h-5 w-5 text-electric" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">
            Summon the Council
          </h3>
          <p className="text-xs text-muted-foreground">
            Present a topic for the admirals to deliberate
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Describe the task or architectural decision for the council to debate..."
          className={cn(
            "w-full rounded-md border border-border bg-background px-3 py-2",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-electric/50",
            "min-h-[100px] resize-y"
          )}
          disabled={isLaunching}
        />

        {error && (
          <p className="text-xs text-alert">{error}</p>
        )}

        <button
          onClick={handleLaunch}
          disabled={isLaunching || !topic.trim()}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            "bg-electric text-white hover:bg-electric-dim",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isLaunching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Summoning...
            </>
          ) : (
            <>
              <Swords className="h-4 w-4" />
              Summon Council
            </>
          )}
        </button>
      </div>
    </div>
  );
}
