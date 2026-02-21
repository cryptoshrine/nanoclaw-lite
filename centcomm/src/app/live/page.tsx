"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Radio,
  RefreshCw,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Moon,
  Send,
  ChevronDown,
  ChevronUp,
  Terminal,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface StepInfo {
  id: number;
  label: string;
  status: "pending" | "in_progress" | "completed";
}

interface LogEntry {
  time: string;
  level: "info" | "debug" | "warn" | "error";
  text: string;
}

interface AgentProgress {
  groupFolder: string;
  groupName: string;
  sessionId: string;
  status: "running" | "completed" | "error" | "idle";
  startedAt: string;
  lastUpdate: string;
  prompt: string;
  steps: StepInfo[];
  currentStep: string | null;
  logs: LogEntry[];
  error: string | null;
}

// ── Status Helpers ─────────────────────────────────────────────────────

function statusIcon(status: string) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-electric" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "error":
      return <AlertTriangle className="h-4 w-4 text-alert" />;
    default:
      return <Moon className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    running: "border-electric/30 text-electric",
    completed: "border-success/30 text-success",
    error: "border-alert/30 text-alert",
    idle: "border-muted-foreground/30 text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${styles[status] || styles.idle}`}
    >
      {status}
    </Badge>
  );
}

function stepIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-electric" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function timeAgo(timestamp: string): string {
  if (!timestamp) return "—";
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function logLevelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-alert";
    case "warn":
      return "text-amber";
    case "info":
      return "text-electric";
    default:
      return "text-muted-foreground";
  }
}

// ── Agent Card ─────────────────────────────────────────────────────────

function AgentCard({
  agent,
  isExpanded,
  onToggle,
  onSteer,
}: {
  agent: AgentProgress;
  isExpanded: boolean;
  onToggle: () => void;
  onSteer: (command: string) => void;
}) {
  const [steerInput, setSteerInput] = useState("");
  const [sending, setSending] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isExpanded, agent.logs.length]);

  const handleSteer = async () => {
    if (!steerInput.trim()) return;
    setSending(true);
    await onSteer(steerInput.trim());
    setSteerInput("");
    setSending(false);
  };

  const completedSteps = agent.steps.filter(
    (s) => s.status === "completed"
  ).length;
  const totalSteps = agent.steps.length;
  const progressPct =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <Card
      className={`border-border bg-card transition-all ${
        agent.status === "running" ? "card-glow ring-1 ring-electric/20" : ""
      }`}
    >
      {/* Header — always visible */}
      <CardHeader
        className="pb-3 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {statusIcon(agent.status)}
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">
                {agent.groupName}
              </CardTitle>
              {agent.status === "running" && agent.currentStep && (
                <CardDescription className="text-xs mt-0.5">
                  {agent.currentStep}
                </CardDescription>
              )}
              {agent.status === "idle" && agent.lastUpdate && (
                <CardDescription className="text-xs mt-0.5">
                  Last active {timeAgo(agent.lastUpdate)}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(agent.status)}
            {agent.status === "running" && totalSteps > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {completedSteps}/{totalSteps}
              </Badge>
            )}
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        {agent.status === "running" && totalSteps > 0 && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-electric transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </CardHeader>

      {/* Expanded content */}
      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Prompt */}
          {agent.prompt && (
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                Prompt
              </p>
              <p className="text-xs text-foreground leading-relaxed">
                {agent.prompt.length > 300
                  ? agent.prompt.slice(0, 300) + "..."
                  : agent.prompt}
              </p>
            </div>
          )}

          {/* Steps checklist */}
          {agent.steps.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Steps
              </p>
              <div className="space-y-1.5">
                {agent.steps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    {stepIcon(step.status)}
                    <span
                      className={
                        step.status === "completed"
                          ? "text-muted-foreground line-through"
                          : step.status === "in_progress"
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs */}
          {agent.logs.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Terminal className="h-3 w-3" /> Activity Log
              </p>
              <ScrollArea className="h-40 rounded-md bg-[#0d0d14] border border-border p-2">
                <div className="space-y-1 font-mono text-[11px]">
                  {agent.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {log.time}
                      </span>
                      <span
                        className={`shrink-0 uppercase text-[9px] font-bold ${logLevelColor(
                          log.level
                        )}`}
                      >
                        {log.level}
                      </span>
                      <span className="text-foreground/80">{log.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Error display */}
          {agent.error && (
            <div className="rounded-md bg-alert/10 border border-alert/20 p-3">
              <p className="text-xs text-alert font-medium">{agent.error}</p>
            </div>
          )}

          {/* Steering input */}
          {agent.status === "running" && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Steer Agent
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={steerInput}
                  onChange={(e) => setSteerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSteer();
                  }}
                  placeholder="Give direction, e.g. 'focus on defensive stats'..."
                  className="flex-1 rounded-md bg-muted border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-electric"
                />
                <button
                  onClick={handleSteer}
                  disabled={!steerInput.trim() || sending}
                  className="flex items-center gap-1.5 rounded-md bg-electric px-3 py-2 text-xs font-medium text-white hover:bg-electric-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="h-3 w-3" />
                  Send
                </button>
              </div>
            </div>
          )}

          {/* Timing info */}
          {agent.startedAt && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border">
              <span>Started: {new Date(agent.startedAt).toLocaleTimeString()}</span>
              <span>Updated: {timeAgo(agent.lastUpdate)}</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function LiveDashboardPage() {
  const [activities, setActivities] = useState<AgentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(
    new Set()
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-activity");
      if (res.ok) {
        const data = (await res.json()) as AgentProgress[];
        setActivities(data);

        // Auto-expand any running agents
        setExpandedAgents((prev) => {
          const next = new Set(prev);
          for (const a of data) {
            if (a.status === "running") {
              next.add(a.groupFolder);
            }
          }
          return next;
        });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000); // Poll every 3s for real-time feel
    return () => clearInterval(interval);
  }, [loadData]);

  const toggleAgent = (folder: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const handleSteer = async (groupFolder: string, command: string) => {
    try {
      await fetch("/api/agent-activity/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupFolder, command }),
      });
    } catch {
      // silently fail
    }
  };

  const runningCount = activities.filter((a) => a.status === "running").length;
  const idleCount = activities.filter((a) => a.status === "idle").length;
  const errorCount = activities.filter((a) => a.status === "error").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
          <Radio
            className={`h-5 w-5 text-electric ${
              runningCount > 0 ? "status-pulse" : ""
            }`}
          />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Live Agent Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Real-time progress tracking and agent steering
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Loader2
            className={`h-3.5 w-3.5 ${
              runningCount > 0 ? "animate-spin text-electric" : "text-muted-foreground"
            }`}
          />
          <span className="text-foreground font-medium">{runningCount}</span>
          <span className="text-muted-foreground">running</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Moon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-foreground font-medium">{idleCount}</span>
          <span className="text-muted-foreground">idle</span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-3.5 w-3.5 text-alert" />
            <span className="text-alert font-medium">{errorCount}</span>
            <span className="text-muted-foreground">error</span>
          </div>
        )}

        <div className="flex-1" />

        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Agent cards */}
      {loading && activities.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-electric" />
        </div>
      ) : activities.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              No registered agents found
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activities.map((agent) => (
            <AgentCard
              key={agent.groupFolder}
              agent={agent}
              isExpanded={expandedAgents.has(agent.groupFolder)}
              onToggle={() => toggleAgent(agent.groupFolder)}
              onSteer={(cmd) => handleSteer(agent.groupFolder, cmd)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
