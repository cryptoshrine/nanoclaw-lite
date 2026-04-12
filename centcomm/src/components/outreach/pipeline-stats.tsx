"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, Link2, MessageSquare, CalendarCheck } from "lucide-react";

interface PipelineStatsData {
  totalLeads: number;
  connectionRate: number;
  replyRate: number;
  meetingsBooked: number;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md bg-${color}/10`}>
            <Icon className={`h-4 w-4 text-${color}`} />
          </div>
          <div>
            <div className="text-xl font-bold text-foreground">{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface PipelineStatsProps {
  stats: PipelineStatsData | null;
}

export function PipelineStats({ stats }: PipelineStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Total Leads"
        value={stats?.totalLeads ?? 0}
        icon={Users}
        color="electric"
      />
      <StatCard
        label="Connection Rate"
        value={`${stats?.connectionRate ?? 0}%`}
        icon={Link2}
        color="cyan"
      />
      <StatCard
        label="Reply Rate"
        value={`${stats?.replyRate ?? 0}%`}
        icon={MessageSquare}
        color="amber"
      />
      <StatCard
        label="Meetings Booked"
        value={stats?.meetingsBooked ?? 0}
        icon={CalendarCheck}
        color="success"
      />
    </div>
  );
}
