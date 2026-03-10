"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  RefreshCw,
  Target,
  TrendingUp,
  BarChart3,
  Activity,
  Loader2,
  Calendar,
  Crosshair,
  Shield,
  Grid3X3,
  Zap,
  GitCompare,
  Filter,
} from "lucide-react";
import type {
  BacktestResult,
  BacktestListEntry,
  GridSearchSummary,
} from "@/lib/backtest-types";
import { STRATEGY_LABELS, LEAGUE_CONFIG, MARKET_CATEGORIES } from "@/lib/backtest-types";
import type { LeagueKey } from "@/lib/backtest-types";
import {
  CalibrationChart,
  CalibrationTable,
} from "@/components/betting-model/calibration-chart";
import {
  PnlCumulativeChart,
  PnlMonthlyChart,
  StrategyTable,
} from "@/components/betting-model/pnl-chart";
import { MarketAccuracyTable } from "@/components/betting-model/market-accuracy-table";
import {
  MatchdayLog,
  AccuracyTimeline,
} from "@/components/betting-model/matchday-log";
import { GridSearchView } from "@/components/betting-model/grid-search-view";
import { LivePerformance } from "@/components/betting-model/live-performance";
import { ComparisonView } from "@/components/betting-model/comparison-view";

// ─── Stat Card ───

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

// ─── Market Filter Component ───

function MarketFilter({
  selected,
  onChange,
}: {
  selected: string | null;
  onChange: (val: string | null) => void;
}) {
  const categories = ["All", ...Object.keys(MARKET_CATEGORIES)];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      {categories.map((cat) => (
        <Button
          key={cat}
          size="sm"
          variant={
            (cat === "All" && selected === null) || cat === selected
              ? "default"
              : "outline"
          }
          className="text-[10px] h-6 px-2"
          onClick={() => onChange(cat === "All" ? null : cat)}
        >
          {cat}
        </Button>
      ))}
    </div>
  );
}

// ─── Live Performance Data Shape ───

interface LivePerfData {
  summary: {
    total_bets: number;
    total_wins: number;
    hit_rate: number;
    total_profit: number;
    roi_pct: number;
    longest_win_streak: number;
    longest_loss_streak: number;
    first_date: string;
    last_date: string;
    days_tracked: number;
  };
  daily_pnl: Array<{
    date: string;
    bets: number;
    wins: number;
    profit: number;
    cumulative: number;
  }>;
  market_pnl: Array<{
    market: string;
    bets: number;
    wins: number;
    hit_rate: number;
    roi_pct: number;
    profit: number;
    avg_odds: number;
    avg_edge: number;
  }>;
  by_confidence: Array<{
    confidence: string;
    bets: number;
    wins: number;
    hit_rate: number;
    roi_pct: number;
    profit: number;
  }>;
}

// ─── OoS Market PnL shape ───

interface OosMarketPnlEntry {
  bets: number;
  win_rate: number;
  roi_pct: number;
  profit: number;
  avg_edge?: number;
}

// ─── Main Page ───

export default function BettingModelPage() {
  // Data state
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestList, setBacktestList] = useState<BacktestListEntry[]>([]);
  const [gridSearch, setGridSearch] = useState<GridSearchSummary | null>(null);
  const [livePerf, setLivePerf] = useState<LivePerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Selector state
  const [selectedLeague, setSelectedLeague] = useState<LeagueKey>("epl");
  const [selectedBacktest, setSelectedBacktest] = useState<string>("");
  const [marketFilter, setMarketFilter] = useState<string | null>(null);
  const [hasGridSearch, setHasGridSearch] = useState(false);

  // Load backtest list on mount
  useEffect(() => {
    async function loadList() {
      try {
        const res = await fetch("/api/betting/backtest/list");
        if (res.ok) {
          const data = await res.json();
          setBacktestList(data.backtests || []);
          setHasGridSearch((data.gridSearches?.length ?? 0) > 0);
          const defaultBt = data.backtests?.find(
            (b: BacktestListEntry) =>
              b.league === "epl" && b.type === "in_sample"
          );
          if (defaultBt) {
            setSelectedBacktest(defaultBt.filename);
          }
        }
      } catch {
        // silent
      }
    }
    loadList();
  }, []);

  // Load backtest data when selection changes
  const loadBacktest = useCallback(async () => {
    if (!selectedBacktest) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/betting/backtest?filename=${selectedBacktest}`
      );
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setBacktest(data);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedBacktest]);

  useEffect(() => {
    if (selectedBacktest) {
      loadBacktest();
    }
  }, [selectedBacktest, loadBacktest]);

  // Load grid search data lazily
  const loadGridSearch = useCallback(async () => {
    if (gridSearch) return;
    try {
      const res = await fetch("/api/betting/backtest/grid-search");
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setGridSearch(data);
        }
      }
    } catch {
      // silent
    }
  }, [gridSearch]);

  // Load live performance data lazily
  const loadLivePerf = useCallback(async () => {
    if (livePerf) return;
    try {
      const res = await fetch("/api/betting/backtest/live-performance");
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setLivePerf(data);
        }
      }
    } catch {
      // silent
    }
  }, [livePerf]);

  const handleRefresh = () => {
    setRefreshing(true);
    setGridSearch(null);
    setLivePerf(null);
    loadBacktest();
  };

  // Filter backtests by league
  const leagueBacktests = backtestList.filter(
    (b) => b.league === selectedLeague
  );

  // Handle league change
  const handleLeagueChange = (league: LeagueKey) => {
    setSelectedLeague(league);
    const first = backtestList.find((b) => b.league === league);
    if (first) {
      setSelectedBacktest(first.filename);
    }
  };

  if (loading && !backtest) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-electric" />
      </div>
    );
  }

  if (!backtest) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Brain className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No backtest data available</p>
        <p className="text-sm mt-1">
          Run the backtest engine to generate model performance data.
        </p>
      </div>
    );
  }

  // Support both in-sample and OoS structures
  const bt = backtest as unknown as Record<string, unknown>;
  const metadata = (bt.metadata || {}) as BacktestResult["metadata"];
  const accuracy = (bt.accuracy || { "1x2_correct": 0, "1x2_total": 1, "1x2_accuracy": 0 }) as BacktestResult["accuracy"];
  const scoring = (bt.scoring || {}) as BacktestResult["scoring"];
  const pnl = (bt.pnl || {}) as BacktestResult["pnl"];
  const market_accuracy = bt.market_accuracy as BacktestResult["market_accuracy"] | undefined;
  const matchday_results = (bt.matchday_results || []) as BacktestResult["matchday_results"];

  // Detect OoS
  const isOos = !!(bt.market_pnl);
  const oosMarketPnl = isOos
    ? bt.market_pnl as Record<string, OosMarketPnlEntry>
    : null;

  const runAt = metadata?.run_at
    ? new Date(metadata.run_at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  // Key stats
  const acc1x2 = (accuracy["1x2_accuracy"] || 0) * 100;
  const brierAll = scoring?.all_markets?.brier ?? (scoring as unknown as Record<string, { brier?: number }>)?.all?.brier ?? 0;
  const bestStrategy =
    pnl && Object.keys(pnl).length > 0
      ? Object.entries(pnl).reduce(
          (best, [key, s]) =>
            s.roi_pct > (best[1]?.roi_pct ?? -Infinity) ? [key, s] : best,
          ["", pnl[Object.keys(pnl)[0]]] as [string, (typeof pnl)[string]]
        )
      : null;

  const flatStrategies = Object.keys(pnl || {}).filter(
    (k) => k.includes("flat") || k === "flat"
  );
  const hasMatchdays = matchday_results && matchday_results.length > 0;

  const filteredMatchdays = marketFilter
    ? matchday_results?.map((day) => ({
        ...day,
        predictions: day.predictions.filter((p) => {
          const marketKeys = MARKET_CATEGORIES[marketFilter] || [];
          return (
            marketKeys.length === 0 ||
            Object.keys(p.outcomes || {}).some((k) => marketKeys.includes(k))
          );
        }),
      }))
    : matchday_results;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-electric" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Betting Model
            </h2>
            <p className="text-sm text-muted-foreground">
              Dixon-Coles Backtest Performance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {metadata?.calibration_method && (
            <Badge
              variant="outline"
              className="text-[10px] border-electric/40 text-electric"
            >
              {metadata.calibration_method}
            </Badge>
          )}
          {isOos && (
            <Badge variant="outline" className="text-[10px] border-amber/40 text-amber">
              Out-of-Sample
            </Badge>
          )}
          {metadata?.odds_source && (
            <Badge variant="outline" className="text-[10px]">
              {metadata.odds_source}
            </Badge>
          )}
          {runAt && (
            <span className="text-xs text-muted-foreground">Run: {runAt}</span>
          )}
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
      </div>

      {/* League Tabs + Season Selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-md p-1">
          {(Object.keys(LEAGUE_CONFIG) as LeagueKey[]).map((league) => {
            const config = LEAGUE_CONFIG[league];
            const hasData = backtestList.some((b) => b.league === league);
            return (
              <button
                key={league}
                onClick={() => handleLeagueChange(league)}
                disabled={!hasData}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  selectedLeague === league
                    ? "bg-background text-foreground shadow-sm"
                    : hasData
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40 cursor-not-allowed"
                }`}
              >
                {config.flag} {config.name}
              </button>
            );
          })}
        </div>

        {leagueBacktests.length > 0 && (
          <select
            className="bg-background border border-border rounded-md px-3 py-1.5 text-xs"
            value={selectedBacktest}
            onChange={(e) => setSelectedBacktest(e.target.value)}
          >
            {leagueBacktests.map((b) => (
              <option key={b.filename} value={b.filename}>
                {b.label}{" "}
                {b.type === "out_of_sample" ? "(OoS)" : "(In-Sample)"} —{" "}
                {b.size_kb}KB
              </option>
            ))}
          </select>
        )}

        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="1X2 Accuracy"
          value={`${acc1x2.toFixed(1)}%`}
          sub={`${accuracy["1x2_correct"]}/${accuracy["1x2_total"]} correct`}
          color="electric"
          icon={Target}
        />
        <StatCard
          label="Matches Predicted"
          value={metadata?.matches_predicted ?? accuracy["1x2_total"]}
          sub={
            metadata?.total_season_matches
              ? `of ${metadata.total_season_matches} total`
              : undefined
          }
          color="cyan"
          icon={Calendar}
        />
        <StatCard
          label="Brier Score"
          value={brierAll.toFixed(4)}
          sub="all markets combined"
          color="amber"
          icon={Crosshair}
        />
        {bestStrategy && (
          <StatCard
            label="Best ROI"
            value={`${bestStrategy[1].roi_pct > 0 ? "+" : ""}${bestStrategy[1].roi_pct.toFixed(1)}%`}
            sub={STRATEGY_LABELS[bestStrategy[0]] || bestStrategy[0]}
            color="success"
            icon={TrendingUp}
          />
        )}
        {pnl && Object.keys(pnl).length > 0 && (
          <StatCard
            label="Max Drawdown"
            value={`${Math.min(...Object.values(pnl).map((s) => s.max_drawdown_pct)).toFixed(1)}%`}
            sub="best strategy"
            color="alert"
            icon={Shield}
          />
        )}
      </div>

      {/* OoS Market P&L cards */}
      {oosMarketPnl && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {Object.entries(oosMarketPnl)
            .sort(([, a], [, b]) => b.roi_pct - a.roi_pct)
            .map(([market, m]) => (
              <Card key={market}>
                <CardContent className="py-2 px-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    {market.replace(/_/g, " ")}
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>
                      ROI:{" "}
                      <span
                        className={`font-medium ${m.roi_pct > 0 ? "text-success" : "text-alert"}`}
                      >
                        {m.roi_pct > 0 ? "+" : ""}
                        {m.roi_pct}%
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {m.bets} bets
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Scoring summary (in-sample only) */}
      {!isOos && scoring && Object.keys(scoring).length > 0 && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Object.entries(scoring).map(([key, s]) => (
            <Card key={key}>
              <CardContent className="py-2 px-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  {key.replace("_", " ")}
                </div>
                <div className="flex justify-between text-xs">
                  <span>
                    Brier:{" "}
                    <span className="font-medium text-foreground">
                      {s.brier.toFixed(4)}
                    </span>
                  </span>
                  <span>
                    LogLoss:{" "}
                    <span className="font-medium text-foreground">
                      {s.log_loss.toFixed(4)}
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="text-xs">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="calibration" className="text-xs">
            <Crosshair className="h-3.5 w-3.5 mr-1.5" />
            Calibration
          </TabsTrigger>
          <TabsTrigger value="pnl" className="text-xs">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            P&L
          </TabsTrigger>
          <TabsTrigger value="markets" className="text-xs">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
            Markets
          </TabsTrigger>
          {hasMatchdays && (
            <TabsTrigger value="matches" className="text-xs">
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Match Log ({matchday_results.length})
            </TabsTrigger>
          )}
          {hasGridSearch && (
            <TabsTrigger
              value="grid-search"
              className="text-xs"
              onClick={loadGridSearch}
            >
              <Grid3X3 className="h-3.5 w-3.5 mr-1.5" />
              Grid Search
            </TabsTrigger>
          )}
          <TabsTrigger
            value="live"
            className="text-xs"
            onClick={loadLivePerf}
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            Live
          </TabsTrigger>
          {backtestList.length >= 2 && (
            <TabsTrigger value="compare" className="text-xs">
              <GitCompare className="h-3.5 w-3.5 mr-1.5" />
              Compare
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {hasMatchdays && (
            <div className="grid gap-4 lg:grid-cols-2">
              <AccuracyTimeline matchdays={matchday_results} />
              {flatStrategies.length > 0 && (
                <PnlCumulativeChart
                  strategies={pnl}
                  selectedStrategies={flatStrategies}
                />
              )}
            </div>
          )}
          {!hasMatchdays && flatStrategies.length > 0 && (
            <PnlCumulativeChart
              strategies={pnl}
              selectedStrategies={flatStrategies}
            />
          )}
          {pnl && Object.keys(pnl).length > 0 && (
            <StrategyTable strategies={pnl} />
          )}
        </TabsContent>

        {/* Calibration Tab */}
        <TabsContent value="calibration" className="mt-4 space-y-4">
          {backtest.calibration_raw && backtest.calibration_calibrated ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <CalibrationChart
                  raw={backtest.calibration_raw}
                  calibrated={backtest.calibration_calibrated}
                  title="All Markets — Raw vs Calibrated"
                />
                {backtest.calibration_1x2_calibrated && (
                  <CalibrationChart
                    raw={backtest.calibration_raw}
                    calibrated={backtest.calibration_1x2_calibrated}
                    title="1X2 Markets — Calibrated"
                  />
                )}
              </div>
              <CalibrationTable
                raw={backtest.calibration_raw}
                calibrated={backtest.calibration_calibrated}
              />
            </>
          ) : (bt.calibration as unknown[])?.length ? (
            <Card>
              <CardContent className="py-4">
                <div className="text-sm font-medium mb-3">
                  OoS Calibration (10 buckets)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 px-2">Bucket</th>
                        <th className="text-right py-2 px-2">Predicted</th>
                        <th className="text-right py-2 px-2">Actual</th>
                        <th className="text-right py-2 px-2">Gap</th>
                        <th className="text-right py-2 px-2">Samples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bt.calibration as Array<{ bucket: string; predicted_avg: number; actual_rate: number; gap: number; count: number }>).map((b) => (
                        <tr key={b.bucket} className="border-b border-border/50">
                          <td className="py-1.5 px-2 font-medium">{b.bucket}</td>
                          <td className="text-right py-1.5 px-2">{(b.predicted_avg * 100).toFixed(1)}%</td>
                          <td className="text-right py-1.5 px-2">{(b.actual_rate * 100).toFixed(1)}%</td>
                          <td className={`text-right py-1.5 px-2 ${Math.abs(b.gap) > 0.1 ? "text-alert" : "text-success"}`}>
                            {b.gap > 0 ? "+" : ""}{(b.gap * 100).toFixed(1)}pp
                          </td>
                          <td className="text-right py-1.5 px-2 text-muted-foreground">{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No calibration data available for this backtest.
            </div>
          )}
        </TabsContent>

        {/* P&L Tab */}
        <TabsContent value="pnl" className="mt-4 space-y-4">
          <MarketFilter selected={marketFilter} onChange={setMarketFilter} />
          {flatStrategies.length > 0 && (
            <PnlCumulativeChart
              strategies={pnl}
              selectedStrategies={flatStrategies}
            />
          )}
          {flatStrategies.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {flatStrategies.map((key) => (
                <PnlMonthlyChart
                  key={key}
                  strategies={pnl}
                  selectedStrategies={[key]}
                />
              ))}
            </div>
          )}
          {pnl && Object.keys(pnl).length > 0 && (
            <StrategyTable strategies={pnl} />
          )}
        </TabsContent>

        {/* Markets Tab */}
        <TabsContent value="markets" className="mt-4 space-y-4">
          <MarketFilter selected={marketFilter} onChange={setMarketFilter} />
          {market_accuracy ? (
            <MarketAccuracyTable
              markets={
                marketFilter
                  ? Object.fromEntries(
                      Object.entries(market_accuracy).filter(([key]) => {
                        const cats = MARKET_CATEGORIES[marketFilter] || [];
                        return cats.length === 0 || cats.includes(key);
                      })
                    )
                  : market_accuracy
              }
            />
          ) : oosMarketPnl ? (
            <Card>
              <CardContent className="py-4">
                <div className="text-sm font-medium mb-3">OoS Market Performance</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 px-2">Market</th>
                        <th className="text-right py-2 px-2">Bets</th>
                        <th className="text-right py-2 px-2">Win Rate</th>
                        <th className="text-right py-2 px-2">ROI</th>
                        <th className="text-right py-2 px-2">Profit</th>
                        <th className="text-right py-2 px-2">Avg Edge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(oosMarketPnl)
                        .filter(([key]) => {
                          if (!marketFilter) return true;
                          const cats = MARKET_CATEGORIES[marketFilter] || [];
                          return cats.length === 0 || cats.includes(key);
                        })
                        .sort(([, a], [, b]) => b.roi_pct - a.roi_pct)
                        .map(([market, m]) => (
                          <tr key={market} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-1.5 px-2 font-medium">{market.replace(/_/g, " ")}</td>
                            <td className="text-right py-1.5 px-2">{m.bets}</td>
                            <td className="text-right py-1.5 px-2">{m.win_rate.toFixed(1)}%</td>
                            <td className={`text-right py-1.5 px-2 font-medium ${m.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                              {m.roi_pct > 0 ? "+" : ""}{m.roi_pct.toFixed(1)}%
                            </td>
                            <td className={`text-right py-1.5 px-2 ${m.profit > 0 ? "text-success" : "text-alert"}`}>
                              {m.profit > 0 ? "+" : ""}{m.profit.toFixed(1)}u
                            </td>
                            <td className="text-right py-1.5 px-2 text-muted-foreground">
                              {m.avg_edge ? `${m.avg_edge.toFixed(1)}%` : "\u2014"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No market accuracy data available.
            </div>
          )}
        </TabsContent>

        {/* Match Log Tab */}
        {hasMatchdays && (
          <TabsContent value="matches" className="mt-4 space-y-4">
            <MarketFilter selected={marketFilter} onChange={setMarketFilter} />
            <AccuracyTimeline matchdays={filteredMatchdays || matchday_results} />
            <MatchdayLog matchdays={filteredMatchdays || matchday_results} />
          </TabsContent>
        )}

        {/* Grid Search Tab */}
        {hasGridSearch && (
          <TabsContent value="grid-search" className="mt-4">
            {gridSearch ? (
              <GridSearchView data={gridSearch} />
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading grid search data (324 combos)...
              </div>
            )}
          </TabsContent>
        )}

        {/* Live Performance Tab */}
        <TabsContent value="live" className="mt-4">
          {livePerf ? (
            <LivePerformance data={livePerf} />
          ) : (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading live performance data...
            </div>
          )}
        </TabsContent>

        {/* Comparison Tab */}
        {backtestList.length >= 2 && (
          <TabsContent value="compare" className="mt-4">
            <ComparisonView backtests={backtestList} />
          </TabsContent>
        )}
      </Tabs>

      {/* Footer */}
      <div className="text-[10px] text-muted-foreground bg-card rounded-md px-4 py-2 border border-border">
        Dixon-Coles model
        {metadata?.calibration_method ? ` with ${metadata.calibration_method} calibration` : ""}.{" "}
        {metadata?.odds_source ? `${metadata.odds_source} odds` : ""}
        {metadata?.margin_fair ? ` (fair margin: ${metadata.margin_fair * 100}%, sharp margin: ${(metadata.margin_sharp ?? 0) * 100}%)` : ""}.
        Min edge threshold: {metadata?.min_edge ?? 3}%.{" "}
        {metadata?.events_loaded ? "StatsBomb xG events loaded." : ""}
      </div>
    </div>
  );
}
