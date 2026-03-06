"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, Users, Eye, Heart, Repeat2, MessageCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { XDashboardData } from "@/lib/distribution-types";

interface LiveTweet {
  id: string;
  text: string;
  created_at: string;
  metrics: {
    impression_count?: number;
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  } | null;
}

interface LiveXData {
  account: {
    name: string;
    username: string;
    description: string;
    profileImage: string;
  };
  followers: number;
  following: number;
  tweetCount: number;
  listedCount: number;
  recentTweets: LiveTweet[];
  recentStats: {
    tweets: number;
    impressions: number;
    likes: number;
    retweets: number;
    replies: number;
    avgImpressions: number;
    avgLikes: number;
  };
  fetchedAt: string;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function XDashboard({ data }: { data: XDashboardData }) {
  const { daily, totals, recentPosts } = data;
  const [live, setLive] = useState<LiveXData | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/distribution/x-live");
        if (res.ok) {
          const d = await res.json();
          if (!d.error) setLive(d);
          else setLiveError(d.error);
        } else {
          setLiveError("API returned " + res.status);
        }
      } catch {
        setLiveError("Failed to fetch live X data");
      } finally {
        setLiveLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      {/* Live Account Stats */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium text-foreground">Live Account</span>
          {liveLoading && <Loader2 className="h-3 w-3 animate-spin text-electric" />}
          {live && (
            <Badge variant="outline" className="text-[9px] border-electric/40 text-electric">
              @{live.account.username}
            </Badge>
          )}
          {live?.fetchedAt && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              Fetched: {new Date(live.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        {liveError && !live && (
          <div className="text-xs text-amber bg-amber/10 rounded-md px-3 py-2 mb-3">
            {liveError} — showing engagement log data only
          </div>
        )}

        {live && (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
            {[
              { label: "Followers", value: formatNum(live.followers), icon: Users, color: "text-electric" },
              { label: "Impressions (last 20)", value: formatNum(live.recentStats.impressions), icon: Eye, color: "text-foreground" },
              { label: "Likes (last 20)", value: formatNum(live.recentStats.likes), icon: Heart, color: "text-success" },
              { label: "RTs (last 20)", value: formatNum(live.recentStats.retweets), icon: Repeat2, color: "text-amber" },
              { label: "Replies (last 20)", value: formatNum(live.recentStats.replies), icon: MessageCircle, color: "text-cyan" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="py-3 px-4 text-center">
                  <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Engagement Log Totals */}
      <div>
        <div className="text-sm font-medium text-foreground mb-3">
          Autonomous Engagement Log
        </div>
        <div className="grid gap-3 grid-cols-4">
          {[
            { label: "Total Posts", value: totals.posts, color: "text-electric" },
            { label: "Total Likes", value: totals.likes, color: "text-success" },
            { label: "Total RTs", value: totals.rts, color: "text-amber" },
            { label: "Follows", value: totals.follows, color: "text-cyan" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="py-3 px-4 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[11px] text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="py-4 px-4">
            <div className="text-sm font-medium text-foreground mb-3">
              Daily Posts
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="posts" fill="hsl(var(--electric))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 px-4">
            <div className="text-sm font-medium text-foreground mb-3">
              Engagement Trend (Likes + RTs)
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="likes"
                  stackId="1"
                  stroke="hsl(var(--success))"
                  fill="hsl(var(--success))"
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="rts"
                  stackId="1"
                  stroke="hsl(var(--amber))"
                  fill="hsl(var(--amber))"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Live Recent Tweets (from API) */}
      {live && live.recentTweets.length > 0 && (
        <Card>
          <CardContent className="py-4 px-4">
            <div className="text-sm font-medium text-foreground mb-3">
              Recent Tweets (Live API)
            </div>
            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {live.recentTweets.map((tweet) => (
                <div
                  key={tweet.id}
                  className="flex items-start justify-between py-2 px-2 rounded-md hover:bg-sidebar-accent/50 text-xs gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground leading-relaxed">
                      {tweet.text}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                      <span>
                        {new Date(tweet.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {tweet.metrics && (
                        <>
                          <span className="flex items-center gap-0.5">
                            <Eye className="h-3 w-3" />
                            {formatNum(tweet.metrics.impression_count ?? 0)}
                          </span>
                          <span className="flex items-center gap-0.5 text-success">
                            <Heart className="h-3 w-3" />
                            {tweet.metrics.like_count ?? 0}
                          </span>
                          <span className="flex items-center gap-0.5 text-amber">
                            <Repeat2 className="h-3 w-3" />
                            {tweet.metrics.retweet_count ?? 0}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <a
                    href={`https://x.com/Ball_AI_Agent/status/${tweet.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-electric hover:text-electric/80 shrink-0 mt-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Engagement Log Posts (fallback / historical) */}
      {recentPosts.length > 0 && (
        <Card>
          <CardContent className="py-4 px-4">
            <div className="text-sm font-medium text-foreground mb-3">
              Engagement Log Posts ({recentPosts.length})
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {recentPosts
                .slice()
                .reverse()
                .map((post, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-sidebar-accent/50 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground shrink-0">
                        {post.date}
                      </span>
                      <span className="text-foreground truncate">
                        {post.title}
                      </span>
                      {post.pillar && (
                        <Badge
                          variant="outline"
                          className="text-[9px] shrink-0"
                        >
                          {post.pillar}
                        </Badge>
                      )}
                    </div>
                    {post.url && (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-electric hover:text-electric/80 shrink-0 ml-2"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
