"use client";

import { useEvents } from "@/lib/use-events";
import {
  MessageSquare,
  Bot,
  ListTodo,
  Users,
  CheckCircle2,
  AlertTriangle,
  Pause,
  Play,
  Wifi,
  WifiOff,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";

interface InitialData {
  groupCount: number;
  groupNames: string;
  messages: number;
  tasks: Record<string, number>;
  teams: Record<string, number>;
  members: Record<string, number>;
}

export function LiveDashboard({ initial }: { initial: InitialData }) {
  const { stats, connected } = useEvents();

  // Use SSE data if available, otherwise fall back to initial server data
  const messages = stats?.messages ?? initial.messages;
  const tasks = stats?.tasks ?? initial.tasks;
  const teams = stats?.teams ?? initial.teams;
  const members = stats?.members ?? initial.members;

  const activeTasks = tasks.active ?? 0;
  const completedTasks = tasks.completed ?? 0;
  const pausedTasks = tasks.paused ?? 0;
  const failedTasks = tasks.failed ?? 0;
  const totalTasks = activeTasks + completedTasks + pausedTasks + failedTasks;

  const activeTeams = teams.active ?? 0;
  const completedTeams = teams.completed ?? 0;
  const activeMembers = members.active ?? 0;

  return (
    <>
      {/* Connection indicator */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            System overview and real-time monitoring
          </p>
        </div>
        <Badge
          variant="outline"
          className={`flex items-center gap-1.5 text-xs ${
            connected
              ? "border-success/30 text-success"
              : "border-alert/30 text-alert"
          }`}
        >
          {connected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {connected ? "Live" : "Reconnecting..."}
        </Badge>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Agent Groups"
          value={initial.groupCount}
          subtitle={initial.groupNames}
          icon={Bot}
          color="blue"
        />
        <StatCard
          title="Messages"
          value={messages.toLocaleString()}
          subtitle="Total across all groups"
          icon={MessageSquare}
          color="cyan"
        />
        <StatCard
          title="Scheduled Tasks"
          value={totalTasks}
          subtitle={`${activeTasks} active, ${completedTasks} completed`}
          icon={ListTodo}
          color="green"
        />
        <StatCard
          title="Teams"
          value={activeTeams + completedTeams}
          subtitle={`${activeTeams} active, ${activeMembers} members running`}
          icon={Users}
          color="purple"
        />
      </div>

      {/* Task breakdown */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Task Status
          </h3>
          <div className="grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <Play className="h-5 w-5 text-success" />
              <div className="flex-1">
                <p className="text-sm font-medium">Active</p>
              </div>
              <span className="text-2xl font-bold tabular-nums">
                {activeTasks}
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <Pause className="h-5 w-5 text-amber" />
              <div className="flex-1">
                <p className="text-sm font-medium">Paused</p>
              </div>
              <span className="text-2xl font-bold tabular-nums">
                {pausedTasks}
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <CheckCircle2 className="h-5 w-5 text-electric" />
              <div className="flex-1">
                <p className="text-sm font-medium">Completed</p>
              </div>
              <span className="text-2xl font-bold tabular-nums">
                {completedTasks}
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <AlertTriangle className="h-5 w-5 text-alert" />
              <div className="flex-1">
                <p className="text-sm font-medium">Failed</p>
              </div>
              <span className="text-2xl font-bold tabular-nums">
                {failedTasks}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
