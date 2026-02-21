"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Zap, Clock } from "lucide-react";

interface ActivityItem {
  type: string;
  id: string;
  source: string;
  actor: string;
  detail: string;
  time: string;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityFeed() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch("/api/activity?limit=30");
        if (res.ok) {
          const data = await res.json();
          setActivity(data);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchActivity();
    const interval = setInterval(fetchActivity, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Zap className="h-4 w-4 text-electric" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Loading activity...
            </div>
          ) : activity.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No recent activity
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activity.map((item, i) => (
                <div
                  key={`${item.type}-${item.id}-${i}`}
                  className="flex items-start gap-3 px-6 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="mt-0.5">
                    {item.type === "message" ? (
                      <MessageSquare className="h-4 w-4 text-electric" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-border"
                      >
                        {item.source}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(item.time)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground truncate">
                      {item.type === "message" ? (
                        <>
                          <span className="text-muted-foreground">
                            {item.actor}:{" "}
                          </span>
                          {item.detail}
                        </>
                      ) : (
                        <>
                          Task run:{" "}
                          <span className="text-muted-foreground">
                            {item.detail}
                          </span>{" "}
                          - {item.actor?.slice(0, 60)}
                          {(item.actor?.length ?? 0) > 60 ? "..." : ""}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
