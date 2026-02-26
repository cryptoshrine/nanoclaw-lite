import { getSystemStats } from "@/lib/db";
import { getRegisteredGroups } from "@/lib/config";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { MetricsCharts } from "@/components/dashboard/metrics-charts";
import { HealthCards } from "@/components/dashboard/health-cards";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const stats = getSystemStats();
  const groups = getRegisteredGroups();

  const initial = {
    groupCount: groups.length,
    groupNames: groups.map((g) => g.name).join(", "),
    messages: stats.messages,
    tasks: stats.tasks,
    teams: stats.teams,
    members: stats.members,
  };

  return (
    <div className="space-y-6">
      {/* Live-updating stats via SSE */}
      <LiveDashboard initial={initial} />

      {/* System Health */}
      <HealthCards />

      {/* Activity feed */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <ActivityFeed />
        </div>
      </div>

      {/* Metrics charts */}
      <MetricsCharts />
    </div>
  );
}
