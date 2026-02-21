"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Skull,
  Anchor,
  Compass,
  ChevronDown,
  ChevronRight,
  Vote,
  Trophy,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface CouncilMessage {
  admiralId: string;
  phase: string;
  content: string;
  timestamp: string;
  thinkingTokens?: number;
  completionTokens?: number;
}

interface CouncilSessionData {
  id: string;
  topic: string;
  status: "active" | "complete" | "failed";
  phase: string;
  messages: CouncilMessage[];
  finalPlan: string | null;
  votes: Record<string, { choice: string; rationale: string }> | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

interface DebateViewerProps {
  sessionId: string;
}

const phaseLabels: Record<string, string> = {
  opening: "Opening Proposals",
  critique: "Critique & Challenge",
  synthesis: "Final Synthesis",
  vote: "Council Vote",
  complete: "Session Complete",
};

const phaseOrder = ["opening", "critique", "synthesis", "vote"];

const admiralMeta: Record<
  string,
  { name: string; icon: typeof Skull; color: string; bgColor: string }
> = {
  blackthorn: {
    name: "Fleet Admiral Blackthorn",
    icon: Skull,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
  },
  ironhook: {
    name: "Vice Admiral Ironhook",
    icon: Anchor,
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
  },
  stormcrest: {
    name: "Rear Admiral Stormcrest",
    icon: Compass,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
  },
};

export function DebateViewer({ sessionId }: DebateViewerProps) {
  const [session, setSession] = useState<CouncilSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(
    new Set(["opening"])
  );
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set()
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll for updates while session is active
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    async function fetchSession() {
      try {
        const res = await fetch(`/api/council/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        setSession(data);
        setLoading(false);

        // Auto-expand the current phase
        if (data.phase) {
          setExpandedPhases((prev) => new Set([...prev, data.phase]));
        }

        // Stop polling when complete or failed
        if (data.status === "complete" || data.status === "failed") {
          clearInterval(intervalId);
        }
      } catch {
        // Silently retry
      }
    }

    fetchSession();
    intervalId = setInterval(fetchSession, 3000);

    return () => clearInterval(intervalId);
  }, [sessionId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-electric" />
        <span className="ml-3 text-muted-foreground">
          Loading council session...
        </span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center p-12 text-alert">
        <AlertCircle className="h-5 w-5 mr-2" />
        Session not found
      </div>
    );
  }

  function togglePhase(phase: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function toggleMessage(key: string) {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Group messages by phase
  const messagesByPhase: Record<string, CouncilMessage[]> = {};
  for (const msg of session.messages) {
    if (!messagesByPhase[msg.phase]) messagesByPhase[msg.phase] = [];
    messagesByPhase[msg.phase].push(msg);
  }

  const isActive = session.status === "active";

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              {session.topic}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Session {session.id.slice(0, 8)} &middot;{" "}
              {new Date(session.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="flex items-center gap-1.5 rounded-full bg-electric/10 px-2.5 py-1 text-xs font-medium text-electric">
                <span className="h-1.5 w-1.5 rounded-full bg-electric animate-pulse" />
                {phaseLabels[session.phase] || session.phase}
              </span>
            )}
            {session.status === "complete" && (
              <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <Trophy className="h-3 w-3" />
                Complete
              </span>
            )}
            {session.status === "failed" && (
              <span className="flex items-center gap-1.5 rounded-full bg-alert/10 px-2.5 py-1 text-xs font-medium text-alert">
                <AlertCircle className="h-3 w-3" />
                Failed
              </span>
            )}
          </div>
        </div>

        {session.error && (
          <div className="mt-3 rounded-md bg-alert/10 border border-alert/30 p-3">
            <p className="text-xs text-alert">{session.error}</p>
          </div>
        )}
      </div>

      {/* Phase timeline */}
      {phaseOrder.map((phase) => {
        const messages = messagesByPhase[phase] || [];
        const isCurrentPhase = session.phase === phase && isActive;
        const isExpanded = expandedPhases.has(phase);
        const hasMessages = messages.length > 0;
        const phaseIndex = phaseOrder.indexOf(phase);
        const currentPhaseIndex = phaseOrder.indexOf(session.phase);
        const isPast = phaseIndex < currentPhaseIndex || session.status !== "active";
        const isFuture = phaseIndex > currentPhaseIndex && isActive;

        return (
          <div key={phase} className="relative">
            {/* Phase header */}
            <button
              onClick={() => togglePhase(phase)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 transition-colors text-left",
                isCurrentPhase
                  ? "border-electric/50 bg-electric/5"
                  : isPast && hasMessages
                  ? "border-border bg-card hover:bg-card/80"
                  : "border-border/50 bg-card/50",
                isFuture && "opacity-40"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                  isCurrentPhase
                    ? "bg-electric text-white"
                    : isPast && hasMessages
                    ? "bg-success/20 text-success"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {phaseIndex + 1}
              </div>
              <div className="flex-1">
                <span
                  className={cn(
                    "text-sm font-medium",
                    isCurrentPhase ? "text-electric" : "text-foreground"
                  )}
                >
                  {phaseLabels[phase]}
                </span>
                {hasMessages && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({messages.length} response{messages.length !== 1 ? "s" : ""})
                  </span>
                )}
              </div>
              {isCurrentPhase && !hasMessages && (
                <Loader2 className="h-4 w-4 animate-spin text-electric" />
              )}
              {hasMessages &&
                (isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ))}
            </button>

            {/* Phase messages */}
            {isExpanded && hasMessages && (
              <div className="mt-2 space-y-2 pl-4 border-l-2 border-border/50 ml-[18px]">
                {messages.map((msg, idx) => {
                  const meta = admiralMeta[msg.admiralId];
                  if (!meta) return null;
                  const msgKey = `${phase}-${msg.admiralId}-${idx}`;
                  const isMsgExpanded = expandedMessages.has(msgKey);
                  const Icon = meta.icon;
                  const preview = msg.content.slice(0, 200);
                  const isLong = msg.content.length > 200;

                  return (
                    <div
                      key={msgKey}
                      className={cn(
                        "rounded-lg border border-border bg-card p-4 transition-all"
                      )}
                    >
                      {/* Admiral header */}
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-md",
                            meta.bgColor
                          )}
                        >
                          <Icon className={cn("h-4 w-4", meta.color)} />
                        </div>
                        <span className={cn("text-sm font-bold", meta.color)}>
                          {meta.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                          {msg.completionTokens && (
                            <span className="ml-2">
                              {msg.completionTokens.toLocaleString()} tokens
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Message content */}
                      <div className="text-sm text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed">
                        {isMsgExpanded || !isLong ? msg.content : preview + "..."}
                      </div>

                      {isLong && (
                        <button
                          onClick={() => toggleMessage(msgKey)}
                          className="mt-2 text-xs text-electric hover:text-electric-dim transition-colors"
                        >
                          {isMsgExpanded ? "Show less" : "Show full response"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Vote results */}
      {session.votes && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Vote className="h-5 w-5 text-amber-400" />
            <h4 className="text-sm font-bold text-amber-400">
              Council Vote Results
            </h4>
          </div>
          <div className="space-y-2">
            {Object.entries(session.votes).map(([admiralId, vote]) => {
              const meta = admiralMeta[admiralId];
              if (!meta) return null;
              const votedFor = admiralMeta[vote.choice];

              return (
                <div
                  key={admiralId}
                  className="flex items-start gap-2 text-sm"
                >
                  <span className={cn("font-medium", meta.color)}>
                    {meta.name}
                  </span>
                  <span className="text-muted-foreground">voted for</span>
                  <span
                    className={cn("font-medium", votedFor?.color || "text-foreground")}
                  >
                    {votedFor?.name || vote.choice}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto max-w-[40%] text-right">
                    {vote.rationale}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Final plan */}
      {session.finalPlan && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-5 w-5 text-success" />
            <h4 className="text-sm font-bold text-success">
              Winning Plan
            </h4>
          </div>
          <div className="text-sm text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed max-h-[500px] overflow-y-auto">
            {session.finalPlan}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
