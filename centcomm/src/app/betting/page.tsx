"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp,
  RefreshCw,
  Target,
  Crosshair,
  Layers,
  BarChart3,
  Loader2,
  Play,
  Zap,
  Globe,
  Filter,
  Square,
  CornerDownRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FixtureGrid } from "@/components/betting/fixture-grid";
import { OddsInputForm } from "@/components/betting/odds-input-form";
import { ValueBetTable } from "@/components/betting/value-bet-table";
import { AccumulatorList } from "@/components/betting/accumulator-card";
import { TeamStatsTable } from "@/components/betting/team-stats-table";
import type { Analysis, TeamStatsData, LeagueKey, MarketFilter } from "@/lib/betting-types";
import { LEAGUE_LABELS, LEAGUE_FLAGS, MARKET_FILTER_OPTIONS } from "@/lib/betting-types";

const ALL_LEAGUES: LeagueKey[] = ["epl", "bundesliga", "laliga"];

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ElementType;
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

export default function BettingPage() {
  const [activeLeague, setActiveLeague] = useState<LeagueKey>("epl");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<string | null>(null);
  const [oddsInfo, setOddsInfo] = useState<{
    source?: string;
    fetched_at?: string;
    auto_fetched?: boolean;
    credits_remaining?: number;
  } | null>(null);

  const loadData = useCallback(async (league: LeagueKey) => {
    try {
      const [analysisRes, statsRes] = await Promise.all([
        fetch(`/api/betting/analysis?league=${league}`),
        fetch(`/api/betting/team-stats?league=${league}`),
      ]);

      if (analysisRes.ok) {
        const data = await analysisRes.json();
        if (!data.error) {
          setAnalysis(data);
        } else {
          setAnalysis(null);
        }
      } else {
        setAnalysis(null);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        if (!data.error) {
          setTeamStats(data);
        } else {
          setTeamStats(null);
        }
      } else {
        setTeamStats(null);
      }

      // Also fetch odds info
      try {
        const oddsRes = await fetch(`/api/betting/odds?league=${league}`);
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          if (!oddsData.error && oddsData.source) {
            setOddsInfo({
              source: oddsData.source,
              fetched_at: oddsData.fetched_at,
              auto_fetched: oddsData.auto_fetched,
              credits_remaining: oddsData.credits_remaining,
            });
          } else {
            setOddsInfo(null);
          }
        }
      } catch {
        // ignore
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadData(activeLeague);
  }, [activeLeague, loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData(activeLeague);
  };

  const handleRunPipeline = useCallback(async () => {
    setRunningPipeline(true);
    setPipelineResult(null);
    try {
      const res = await fetch(`/api/betting/run?league=${activeLeague}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPipelineResult(
          `${data.message}! It will fetch odds, run analysis, and send you a WhatsApp summary. Refresh in a few minutes.`
        );
      } else {
        const err = await res.json();
        setPipelineResult(`Error: ${err.error}`);
      }
    } catch (error) {
      setPipelineResult(`Error: ${String(error)}`);
    } finally {
      setRunningPipeline(false);
    }
  }, [activeLeague]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-electric" />
      </div>
    );
  }

  const fixtures = analysis?.fixtures ?? [];
  const valueBets = analysis?.value_bets ?? {};
  const accumulators = analysis?.accumulators ?? [];
  const valueBetCount = analysis?.value_bet_count ?? 0;
  const bankroll = analysis?.bankroll ?? 100;
  const leagueName = LEAGUE_LABELS[activeLeague];

  // Find best edge
  let bestEdge = 0;
  for (const group of Object.values(valueBets)) {
    for (const vb of group.value_bets) {
      if (vb.edge_percent > bestEdge) bestEdge = vb.edge_percent;
    }
  }

  const generatedAt = analysis?.generated_at
    ? new Date(analysis.generated_at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-electric" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Bet Value Finder
            </h2>
            <p className="text-sm text-muted-foreground">
              Alternative Markets — Cards, Corners, Goals O/U, BTTS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {oddsInfo?.auto_fetched && oddsInfo.credits_remaining != null && (
            <Badge variant="outline" className="text-[10px] border-electric/40 text-electric">
              <Zap className="h-3 w-3 mr-1" />
              {oddsInfo.credits_remaining} API credits
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            Updated: {generatedAt}
          </span>
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
          <Button
            size="sm"
            onClick={handleRunPipeline}
            disabled={runningPipeline}
            className="bg-electric hover:bg-electric/90 text-white"
          >
            {runningPipeline ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            Run Analysis
          </Button>
        </div>
      </div>

      {/* League Selector */}
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1">
          {ALL_LEAGUES.map((league) => (
            <Button
              key={league}
              size="sm"
              variant={activeLeague === league ? "default" : "outline"}
              className={
                activeLeague === league
                  ? "bg-electric hover:bg-electric/90 text-white text-xs"
                  : "text-xs"
              }
              onClick={() => setActiveLeague(league)}
            >
              <span className="mr-1.5">{LEAGUE_FLAGS[league]}</span>
              {LEAGUE_LABELS[league]}
            </Button>
          ))}
        </div>
      </div>

      {/* Odds source info */}
      {oddsInfo?.auto_fetched && oddsInfo.fetched_at && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-electric/5 rounded-md px-3 py-1.5 border border-electric/10">
          <Zap className="h-3 w-3 text-electric" />
          <span>
            Odds auto-fetched from{" "}
            <span className="text-foreground font-medium">{oddsInfo.source}</span>
            {" | Last fetched: "}
            <span className="text-foreground">
              {new Date(oddsInfo.fetched_at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
      )}

      {/* Pipeline run result */}
      {pipelineResult && (
        <div
          className={`text-xs px-3 py-2 rounded-md ${
            pipelineResult.startsWith("Error")
              ? "bg-alert/10 text-alert"
              : "bg-success/10 text-success"
          }`}
        >
          {pipelineResult}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Fixtures"
          value={fixtures.length}
          sub={analysis ? `${analysis.days_ahead} day window` : undefined}
          color="electric"
          icon={Target}
        />
        <StatCard
          label="Value Bets"
          value={valueBetCount}
          sub={valueBetCount > 0 ? "edges found" : "run analysis to detect"}
          color="success"
          icon={Crosshair}
        />
        <StatCard
          label="Best Edge"
          value={bestEdge > 0 ? `+${bestEdge.toFixed(1)}%` : "--"}
          color="amber"
          icon={TrendingUp}
        />
        <StatCard
          label="Accumulators"
          value={accumulators.length}
          sub={
            accumulators.length > 0
              ? `best: ${accumulators[0]?.combined_odds.toFixed(1)}x`
              : undefined
          }
          color="cyan"
          icon={Layers}
        />
      </div>

      {/* No data message for non-EPL leagues */}
      {!analysis && activeLeague !== "epl" && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Globe className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">No {leagueName} data available yet.</p>
          <p className="text-xs mt-1">
            Click &quot;Run Analysis&quot; to fetch {leagueName} data for the first time.
          </p>
        </div>
      )}

      {/* Tabs */}
      {(analysis || activeLeague === "epl") && (
        <Tabs defaultValue="fixtures">
          <TabsList>
            <TabsTrigger value="fixtures" className="text-xs">
              <Target className="h-3.5 w-3.5 mr-1.5" />
              Fixtures ({fixtures.length})
            </TabsTrigger>
            <TabsTrigger value="odds" className="text-xs">
              <Crosshair className="h-3.5 w-3.5 mr-1.5" />
              Odds Input
            </TabsTrigger>
            <TabsTrigger value="accumulators" className="text-xs">
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Accumulators
              {accumulators.length > 0 && ` (${accumulators.length})`}
            </TabsTrigger>
            <TabsTrigger value="stats" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Team Stats
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fixtures" className="mt-4">
            {/* Market filter */}
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Market:</span>
              <div className="flex gap-1">
                {MARKET_FILTER_OPTIONS.map((opt) => {
                  const isActive = marketFilter === opt.key;
                  const activeClass = isActive
                    ? "bg-electric hover:bg-electric/90 text-white"
                    : "";
                  return (
                    <Button
                      key={opt.key}
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      className={`text-xs h-7 px-2.5 ${activeClass}`}
                      onClick={() => setMarketFilter(opt.key)}
                    >
                      {opt.key === "cards" && <Square className="h-3 w-3 mr-1" />}
                      {opt.key === "corners" && <CornerDownRight className="h-3 w-3 mr-1" />}
                      {(opt.key === "goals" || opt.key === "btts") && <Target className="h-3 w-3 mr-1" />}
                      {opt.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Value bets summary if any */}
            {valueBetCount > 0 && (
              <div className="mb-4">
                <ValueBetTable valueBets={valueBets} marketFilter={marketFilter} />
              </div>
            )}
            <FixtureGrid fixtures={fixtures} valueBets={valueBets} marketFilter={marketFilter} />
          </TabsContent>

          <TabsContent value="odds" className="mt-4">
            <OddsInputForm fixtures={fixtures} onSaved={handleRefresh} />
          </TabsContent>

          <TabsContent value="accumulators" className="mt-4">
            <AccumulatorList accumulators={accumulators} bankroll={bankroll} />
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            {teamStats ? (
              <TeamStatsTable
                teams={teamStats.teams}
                fetchedAt={teamStats.fetched_at}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No team stats available.</p>
                <p className="text-xs mt-1">
                  Run the betting pipeline to fetch team data.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Risk warning footer */}
      <div className="text-[10px] text-muted-foreground bg-card rounded-md px-4 py-2 border border-border">
        Statistical estimates only. Poisson models have limitations for
        football. Never stake more than you can afford to lose. Past data may
        not predict future outcomes. Always gamble responsibly.
      </div>
    </div>
  );
}
