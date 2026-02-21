"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  Activity,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { KanbanTask } from "./task-card";
import type { DevTask } from "./dev-task-card";

interface KanbanAnalyticsProps {
  tasks: KanbanTask[];
  devTasks: DevTask[];
  tab: "dev" | "scheduled";
}

const STATUS_COLORS: Record<string, string> = {
  // Scheduled
  active: "#22c55e",
  paused: "#f59e0b",
  completed: "#3b82f6",
  failed: "#ef4444",
  cancelled: "#6b7280",
  // Dev
  Pending: "#6b7280",
  "In Progress": "#3b82f6",
  Completed: "#22c55e",
  Blocked: "#ef4444",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#ef4444",
  P1: "#f59e0b",
  P2: "#6b7280",
  P3: "#6b7280",
};

export function KanbanAnalytics({ tasks, devTasks, tab }: KanbanAnalyticsProps) {
  const [expanded, setExpanded] = useState(false);

  // ── Scheduled task stats ──
  const scheduledStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byGroup: Record<string, number> = {};
    let totalRetries = 0;
    let failedCount = 0;

    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byType[t.schedule_type] = (byType[t.schedule_type] || 0) + 1;
      byGroup[t.group_folder] = (byGroup[t.group_folder] || 0) + 1;
      totalRetries += t.retry_count;
      if (t.status === "failed") failedCount++;
    }

    const statusData = Object.entries(byStatus).map(([name, value]) => ({
      name,
      value,
      fill: STATUS_COLORS[name] || "#6b7280",
    }));

    const typeData = Object.entries(byType).map(([name, value]) => ({
      name,
      value,
    }));

    const groupData = Object.entries(byGroup)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    return {
      total: tasks.length,
      active: byStatus["active"] || 0,
      failed: failedCount,
      totalRetries,
      statusData,
      typeData,
      groupData,
      successRate:
        tasks.length > 0
          ? Math.round(
              ((tasks.length - failedCount) / tasks.length) * 100
            )
          : 100,
    };
  }, [tasks]);

  // ── Dev task stats ──
  const devStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const bySize: Record<string, number> = {};

    for (const t of devTasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      const pKey = t.priority.match(/P\d/)?.[0] || "Other";
      byPriority[pKey] = (byPriority[pKey] || 0) + 1;
      if (t.size) bySize[t.size] = (bySize[t.size] || 0) + 1;
    }

    const statusData = Object.entries(byStatus).map(([name, value]) => ({
      name,
      value,
      fill: STATUS_COLORS[name] || "#6b7280",
    }));

    const priorityData = Object.entries(byPriority)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, value]) => ({
        name,
        value,
        fill: PRIORITY_COLORS[name] || "#6b7280",
      }));

    const completedCount = byStatus["Completed"] || 0;

    return {
      total: devTasks.length,
      pending: byStatus["Pending"] || 0,
      inProgress: byStatus["In Progress"] || 0,
      completed: completedCount,
      blocked: byStatus["Blocked"] || 0,
      statusData,
      priorityData,
      completionRate:
        devTasks.length > 0
          ? Math.round((completedCount / devTasks.length) * 100)
          : 0,
    };
  }, [devTasks]);

  if (tab === "dev" && devTasks.length === 0) return null;
  if (tab === "scheduled" && tasks.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Summary strip — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full"
      >
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-4 py-2.5">
          <Activity className="h-4 w-4 text-electric shrink-0" />

          {tab === "dev" ? (
            <div className="flex items-center gap-4 flex-1 text-xs">
              <span className="text-foreground font-medium">
                {devStats.total} tasks
              </span>
              <span className="flex items-center gap-1 text-electric">
                <Clock className="h-3 w-3" />
                {devStats.inProgress} in progress
              </span>
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3 w-3" />
                {devStats.completed} done
              </span>
              {devStats.blocked > 0 && (
                <span className="flex items-center gap-1 text-alert">
                  <AlertTriangle className="h-3 w-3" />
                  {devStats.blocked} blocked
                </span>
              )}
              <span className="flex items-center gap-1 text-muted-foreground ml-auto">
                <TrendingUp className="h-3 w-3" />
                {devStats.completionRate}% complete
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-1 text-xs">
              <span className="text-foreground font-medium">
                {scheduledStats.total} tasks
              </span>
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3 w-3" />
                {scheduledStats.active} active
              </span>
              {scheduledStats.failed > 0 && (
                <span className="flex items-center gap-1 text-alert">
                  <AlertTriangle className="h-3 w-3" />
                  {scheduledStats.failed} failed
                </span>
              )}
              <span className="flex items-center gap-1 text-muted-foreground ml-auto">
                <TrendingUp className="h-3 w-3" />
                {scheduledStats.successRate}% health
              </span>
            </div>
          )}

          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded charts */}
      {expanded && (
        <div className="grid grid-cols-3 gap-3">
          {tab === "dev" ? (
            <>
              {/* Status distribution */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Status Distribution
                  </p>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie
                        data={devStats.statusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        strokeWidth={0}
                      >
                        {devStats.statusData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-3 mt-1 flex-wrap">
                    {devStats.statusData.map((d) => (
                      <span
                        key={d.name}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: d.fill }}
                        />
                        {d.name} ({d.value})
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Priority breakdown */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    By Priority
                  </p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={devStats.priorityData}>
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {devStats.priorityData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Quick stats */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4 flex flex-col justify-center h-full">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                    Quick Stats
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Completion Rate
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs border-success/30 text-success"
                      >
                        {devStats.completionRate}%
                      </Badge>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-success rounded-full h-2 transition-all"
                        style={{ width: `${devStats.completionRate}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Pending
                      </span>
                      <span className="text-xs text-foreground font-mono">
                        {devStats.pending}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Blocked
                      </span>
                      <span className="text-xs text-alert font-mono">
                        {devStats.blocked}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {/* Status distribution */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Status Distribution
                  </p>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie
                        data={scheduledStats.statusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        strokeWidth={0}
                      >
                        {scheduledStats.statusData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-3 mt-1 flex-wrap">
                    {scheduledStats.statusData.map((d) => (
                      <span
                        key={d.name}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: d.fill }}
                        />
                        {d.name} ({d.value})
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Schedule type breakdown */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    By Schedule Type
                  </p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={scheduledStats.typeData}>
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Quick stats */}
              <Card className="border-border bg-card/50">
                <CardContent className="p-4 flex flex-col justify-center h-full">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                    Quick Stats
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Health Rate
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          scheduledStats.successRate >= 90
                            ? "border-success/30 text-success"
                            : scheduledStats.successRate >= 70
                            ? "border-amber/30 text-amber"
                            : "border-alert/30 text-alert"
                        }`}
                      >
                        {scheduledStats.successRate}%
                      </Badge>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`rounded-full h-2 transition-all ${
                          scheduledStats.successRate >= 90
                            ? "bg-success"
                            : scheduledStats.successRate >= 70
                            ? "bg-amber"
                            : "bg-alert"
                        }`}
                        style={{ width: `${scheduledStats.successRate}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Total Retries
                      </span>
                      <span className="text-xs text-foreground font-mono">
                        {scheduledStats.totalRetries}
                      </span>
                    </div>
                    {scheduledStats.groupData.length > 1 && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          By Group:
                        </span>
                        <div className="mt-1 space-y-1">
                          {scheduledStats.groupData.slice(0, 3).map((g) => (
                            <div
                              key={g.name}
                              className="flex items-center justify-between text-[10px]"
                            >
                              <span className="text-muted-foreground font-mono">
                                {g.name}
                              </span>
                              <span className="text-foreground">{g.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
