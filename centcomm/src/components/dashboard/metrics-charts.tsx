"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { BarChart3, Loader2 } from "lucide-react";

interface Metrics {
  messagesPerDay: { day: string; count: number }[];
  messagesPerGroup: { chat_jid: string; count: number }[];
  taskRunsByDay: { day: string; status: string; count: number }[];
  taskDurations: { bucket: string; count: number }[];
  taskStatusDist: { status: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  completed: "#3b82f6",
  paused: "#f59e0b",
  failed: "#ef4444",
  cancelled: "#64748b",
};

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#06b6d4", "#a855f7"];

export function MetricsCharts() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const res = await fetch("/api/metrics");
        if (res.ok) {
          setMetrics(await res.json());
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    loadMetrics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Unable to load metrics
      </div>
    );
  }

  // Format day labels (show only day/month)
  const messagesData = metrics.messagesPerDay.map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    }),
  }));

  // Aggregate task runs by day (completed vs failed)
  const taskRunDays = new Map<string, { day: string; completed: number; failed: number }>();
  for (const run of metrics.taskRunsByDay) {
    if (!taskRunDays.has(run.day)) {
      taskRunDays.set(run.day, { day: run.day, completed: 0, failed: 0 });
    }
    const entry = taskRunDays.get(run.day)!;
    if (run.status === "completed") entry.completed += run.count;
    else if (run.status === "failed") entry.failed += run.count;
  }
  const taskRunData = Array.from(taskRunDays.values()).map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    }),
  }));

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        <BarChart3 className="h-4 w-4 text-electric" />
        Analytics
      </h3>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Messages per day */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Messages (14 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {messagesData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={messagesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111118",
                        border: "1px solid #1e293b",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No message data
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Task success rate */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Task Runs (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {taskRunData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskRunData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111118",
                        border: "1px solid #1e293b",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                      }}
                    />
                    <Bar
                      dataKey="completed"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                      name="Completed"
                    />
                    <Bar
                      dataKey="failed"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                      name="Failed"
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No task run data
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Task status distribution */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Task Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {metrics.taskStatusDist.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.taskStatusDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="count"
                      nameKey="status"
                    >
                      {metrics.taskStatusDist.map((entry, index) => (
                        <Cell
                          key={entry.status}
                          fill={
                            STATUS_COLORS[entry.status] ||
                            CHART_COLORS[index % CHART_COLORS.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111118",
                        border: "1px solid #1e293b",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No tasks
                </div>
              )}
              {/* Legend */}
              <div className="flex items-center justify-center gap-4 mt-2">
                {metrics.taskStatusDist.map((entry) => (
                  <div key={entry.status} className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          STATUS_COLORS[entry.status] || "#64748b",
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {entry.status} ({entry.count})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Task run duration distribution */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Task Duration Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {metrics.taskDurations.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.taskDurations}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={{ stroke: "#1e293b" }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111118",
                        border: "1px solid #1e293b",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="#06b6d4"
                      radius={[4, 4, 0, 0]}
                      name="Tasks"
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No duration data
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
