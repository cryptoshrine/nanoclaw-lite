"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Megaphone,
  Radio,
  Users,
  CalendarDays,
  Target,
  TrendingUp,
  RefreshCw,
  Loader2,
  Heart,
  Repeat2,
  FileText,
} from "lucide-react";
import { ChannelHealthCards } from "@/components/distribution/channel-health-cards";
import { XDashboard } from "@/components/distribution/x-dashboard";
import { WaitlistFunnel } from "@/components/distribution/waitlist-funnel";
import { ContentCalendar } from "@/components/distribution/content-calendar";
import { CreatorOutreachTable } from "@/components/distribution/creator-outreach-table";
import { GrowthTargets } from "@/components/distribution/growth-targets";
import type {
  DistributionOverview,
  WaitlistData,
  ContentEntry,
  Creator,
} from "@/lib/distribution-types";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
            {sub && (
              <div className="text-[10px] text-muted-foreground">{sub}</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DistributionPage() {
  const [overview, setOverview] = useState<DistributionOverview | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistData | null>(null);
  const [calendar, setCalendar] = useState<ContentEntry[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, calendarRes, creatorsRes] = await Promise.all([
        fetch("/api/distribution/overview"),
        fetch("/api/distribution/calendar"),
        fetch("/api/distribution/creators"),
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        if (!data.error) setOverview(data);
      }
      if (calendarRes.ok) {
        const data = await calendarRes.json();
        if (!data.error) setCalendar(data.entries ?? []);
      }
      if (creatorsRes.ok) {
        const data = await creatorsRes.json();
        if (!data.error) setCreators(data.creators ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadWaitlist = useCallback(async () => {
    setWaitlistLoading(true);
    try {
      const res = await fetch("/api/distribution/waitlist");
      if (res.ok) {
        const data = await res.json();
        if (!data.error) setWaitlist(data);
        else setWaitlist(data); // still set default values
      }
    } catch {
      // ignore
    } finally {
      setWaitlistLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadWaitlist();
  }, [loadData, loadWaitlist]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
    loadWaitlist();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-electric" />
      </div>
    );
  }

  const xData = overview?.xDashboard;
  const channels = overview?.channels ?? [];
  const targets = overview?.growthTargets ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-electric" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">Distribution</h2>
            <p className="text-sm text-muted-foreground">
              Growth channels, content, and outreach tracking
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Top stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Posts"
          value={xData?.totals.posts ?? 0}
          sub={`${xData?.daysActive ?? 0} days active`}
          icon={FileText}
          color="electric"
        />
        <StatCard
          label="Total Likes"
          value={xData?.totals.likes ?? 0}
          icon={Heart}
          color="success"
        />
        <StatCard
          label="Total RTs"
          value={xData?.totals.rts ?? 0}
          icon={Repeat2}
          color="amber"
        />
        <StatCard
          label="Waitlist Signups"
          value={waitlistLoading ? "..." : (waitlist?.totalSignups ?? 0)}
          sub={
            waitlist
              ? `${waitlist.spotsRemaining} spots left`
              : undefined
          }
          icon={Users}
          color="cyan"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="text-xs">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="x-dashboard" className="text-xs">
            <Radio className="h-3.5 w-3.5 mr-1.5" />
            X Dashboard
          </TabsTrigger>
          <TabsTrigger value="waitlist" className="text-xs">
            <Target className="h-3.5 w-3.5 mr-1.5" />
            Waitlist
          </TabsTrigger>
          <TabsTrigger value="content" className="text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
            Content
          </TabsTrigger>
          <TabsTrigger value="creators" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Creators ({creators.length})
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <ChannelHealthCards channels={channels} />
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              Growth Targets
            </h3>
            <GrowthTargets targets={targets} />
          </div>
        </TabsContent>

        {/* X Dashboard Tab */}
        <TabsContent value="x-dashboard" className="mt-4">
          {xData ? (
            <XDashboard data={xData} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Radio className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No X engagement data available.</p>
              <p className="text-xs mt-1">
                Engagement data is parsed from the X engagement log.
              </p>
            </div>
          )}
        </TabsContent>

        {/* Waitlist Tab */}
        <TabsContent value="waitlist" className="mt-4">
          <WaitlistFunnel data={waitlist} loading={waitlistLoading} />
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="mt-4">
          <ContentCalendar entries={calendar} />
        </TabsContent>

        {/* Creators Tab */}
        <TabsContent value="creators" className="mt-4">
          <CreatorOutreachTable creators={creators} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
