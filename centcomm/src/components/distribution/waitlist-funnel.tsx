"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, Target } from "lucide-react";
import type { WaitlistData } from "@/lib/distribution-types";

export function WaitlistFunnel({
  data,
  loading,
}: {
  data: WaitlistData | null;
  loading: boolean;
}) {
  const total = data?.totalSignups ?? 0;
  const spots = data?.totalSpots ?? 100;
  const remaining = data?.spotsRemaining ?? spots;
  const claimed = spots - remaining;
  const pct = spots > 0 ? Math.round((claimed / spots) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="py-4 px-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Users className="h-4 w-4 text-electric" />
            </div>
            <div className="text-3xl font-bold text-electric">
              {loading ? "..." : total}
            </div>
            <div className="text-xs text-muted-foreground">Total Signups</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 px-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Target className="h-4 w-4 text-success" />
            </div>
            <div className="text-3xl font-bold text-success">
              {loading ? "..." : remaining}
            </div>
            <div className="text-xs text-muted-foreground">Spots Remaining</div>
          </CardContent>
        </Card>

        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="py-4 px-4 text-center">
            <div className="text-3xl font-bold text-amber">
              {loading ? "..." : `${pct}%`}
            </div>
            <div className="text-xs text-muted-foreground">Claimed</div>
          </CardContent>
        </Card>
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="py-4 px-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Waitlist Progress
            </span>
            <span className="text-xs text-muted-foreground">
              {claimed} / {spots} spots
            </span>
          </div>
          <div className="h-4 bg-sidebar-accent rounded-full overflow-hidden">
            <div
              className="h-full bg-electric rounded-full transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="text-[11px] text-muted-foreground bg-card rounded-md px-4 py-3 border border-border">
        Waitlist data is fetched live from{" "}
        <span className="text-electric">app.ball-ai.xyz</span> with a 5-minute
        cache. If the API is unreachable, cached or default values are shown.
      </div>
    </div>
  );
}
