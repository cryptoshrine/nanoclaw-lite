"use client";

import { useState, useEffect, useCallback } from "react";
import { Swords } from "lucide-react";
import { AdmiralCard } from "@/components/council/admiral-card";
import { SessionLauncher } from "@/components/council/session-launcher";
import { DebateViewer } from "@/components/council/debate-viewer";
import { SessionList } from "@/components/council/session-list";

interface Admiral {
  id: string;
  name: string;
  rank: string;
  model: string;
  provider: string;
  strengths: string[];
}

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

export default function CouncilPage() {
  const [admirals, setAdmirals] = useState<Admiral[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [activeSessionPhase, setActiveSessionPhase] = useState<string | null>(
    null
  );

  // Fetch admirals
  useEffect(() => {
    fetch("/api/council/admirals")
      .then((r) => r.json())
      .then(setAdmirals)
      .catch(console.error);
  }, []);

  // Fetch sessions and poll for updates
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/council");
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data);

      // Auto-select the best session on first load (no selection yet)
      if (!selectedSessionId && data.length > 0) {
        // Prefer: active session > latest completed > latest failed
        const active = data.find((s: SessionSummary) => s.status === "active");
        const completed = data.find((s: SessionSummary) => s.status === "complete");
        const best = active || completed || data[0];
        if (best) {
          setSelectedSessionId(best.id);
        }
      }

      // Track active session phase for admiral speaking indicators
      const activeSession = data.find(
        (s: SessionSummary) => s.id === selectedSessionId && s.status === "active"
      );
      setActiveSessionPhase(activeSession?.phase || null);
    } catch {
      // Silently retry
    }
  }, [selectedSessionId]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  function handleSessionStart(sessionId: string) {
    setSelectedSessionId(sessionId);
    fetchSessions();
  }

  // Determine which admirals are "speaking" (active session in progress)
  const speakingAdmiral: string | null = null; // Could be enhanced with SSE

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/10">
          <Swords className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Supreme Governing Council
          </h2>
          <p className="text-sm text-muted-foreground">
            Three admirals deliberate to produce the best implementation plans
          </p>
        </div>
      </div>

      {/* Admiral cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {admirals.map((admiral) => (
          <AdmiralCard
            key={admiral.id}
            admiral={admiral}
            isActive={activeSessionPhase !== null}
            isSpeaking={speakingAdmiral === admiral.id}
          />
        ))}
      </div>

      {/* Main content: session list + viewer */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: Session launcher + list */}
        <div className="space-y-4">
          <SessionLauncher onSessionStart={handleSessionStart} />

          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Past Sessions
            </h3>
            <SessionList
              sessions={sessions}
              selectedId={selectedSessionId}
              onSelect={setSelectedSessionId}
            />
          </div>
        </div>

        {/* Right: Debate viewer */}
        <div>
          {selectedSessionId ? (
            <DebateViewer sessionId={selectedSessionId} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-16 text-muted-foreground">
              <Swords className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-sm font-medium">No session selected</p>
              <p className="text-xs mt-1">
                Summon the council or select a past session to view
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
