"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from "recharts";
import type { BacktestListEntry, CalibrationBucket } from "@/lib/backtest-types";

interface ComparisonDataset {
  label: string;
  filename: string;
  type: string;
  accuracy: { "1x2_correct": number; "1x2_total": number; "1x2_accuracy": number };
  scoring: Record<string, { brier: number; log_loss: number }>;
  calibration: CalibrationBucket[];
  pnl: Record<string, {
    roi_pct: number;
    bet_count: number;
    win_count: number;
    hit_rate_pct: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    total_profit: number;
    monthly_pnl: Record<string, number>;
  }>;
  market_pnl?: Record<string, { bets: number; win_rate: number; roi_pct: number; profit: number }>;
}

interface ComparisonViewProps {
  backtests: BacktestListEntry[];
}

export function ComparisonView({ backtests }: ComparisonViewProps) {
  const [leftFilename, setLeftFilename] = useState(backtests[0]?.filename || "");
  const [rightFilename, setRightFilename] = useState(backtests[1]?.filename || "");
  const [leftData, setLeftData] = useState<ComparisonDataset | null>(null);
  const [rightData, setRightData] = useState<ComparisonDataset | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadBoth() {
      if (!leftFilename || !rightFilename) return;
      setLoading(true);
      try {
        const [leftRes, rightRes] = await Promise.all([
          fetch(`/api/betting/backtest?filename=${leftFilename}`),
          fetch(`/api/betting/backtest?filename=${rightFilename}`),
        ]);
        if (leftRes.ok) {
          const d = await leftRes.json();
          const entry = backtests.find((b) => b.filename === leftFilename);
          setLeftData({
            label: entry?.label || leftFilename,
            filename: leftFilename,
            type: entry?.type || "in_sample",
            accuracy: d.accuracy,
            scoring: d.scoring,
            calibration: d.calibration_calibrated || d.calibration || [],
            pnl: d.pnl,
            market_pnl: d.market_pnl,
          });
        }
        if (rightRes.ok) {
          const d = await rightRes.json();
          const entry = backtests.find((b) => b.filename === rightFilename);
          setRightData({
            label: entry?.label || rightFilename,
            filename: rightFilename,
            type: entry?.type || "out_of_sample",
            accuracy: d.accuracy,
            scoring: d.scoring,
            calibration: d.calibration_calibrated || d.calibration || [],
            pnl: d.pnl,
            market_pnl: d.market_pnl,
          });
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadBoth();
  }, [leftFilename, rightFilename, backtests]);

  const comparisonMetrics = leftData && rightData ? [
    {
      metric: "1X2 Accuracy",
      left: `${(leftData.accuracy["1x2_accuracy"] * 100).toFixed(1)}%`,
      right: `${(rightData.accuracy["1x2_accuracy"] * 100).toFixed(1)}%`,
      leftValue: leftData.accuracy["1x2_accuracy"],
      rightValue: rightData.accuracy["1x2_accuracy"],
    },
    {
      metric: "Brier Score (All)",
      left: (leftData.scoring.all_markets?.brier ?? leftData.scoring.all?.brier ?? 0).toFixed(4),
      right: (rightData.scoring.all_markets?.brier ?? rightData.scoring.all?.brier ?? 0).toFixed(4),
      leftValue: leftData.scoring.all_markets?.brier ?? leftData.scoring.all?.brier ?? 0,
      rightValue: rightData.scoring.all_markets?.brier ?? rightData.scoring.all?.brier ?? 0,
      lowerBetter: true,
    },
    {
      metric: "Brier Score (1X2)",
      left: (leftData.scoring["1x2"]?.brier ?? 0).toFixed(4),
      right: (rightData.scoring["1x2"]?.brier ?? 0).toFixed(4),
      leftValue: leftData.scoring["1x2"]?.brier ?? 0,
      rightValue: rightData.scoring["1x2"]?.brier ?? 0,
      lowerBetter: true,
    },
    ...(() => {
      const leftPnl = leftData.pnl.flat || leftData.pnl.fair_odds_flat || leftData.pnl.sharp_odds_flat;
      const rightPnl = rightData.pnl.flat || rightData.pnl.fair_odds_flat || rightData.pnl.sharp_odds_flat;
      if (!leftPnl || !rightPnl) return [];
      return [
        {
          metric: "ROI (Flat)",
          left: `${leftPnl.roi_pct > 0 ? "+" : ""}${leftPnl.roi_pct.toFixed(2)}%`,
          right: `${rightPnl.roi_pct > 0 ? "+" : ""}${rightPnl.roi_pct.toFixed(2)}%`,
          leftValue: leftPnl.roi_pct,
          rightValue: rightPnl.roi_pct,
        },
        {
          metric: "Bet Count",
          left: `${leftPnl.bet_count}`,
          right: `${rightPnl.bet_count}`,
          leftValue: leftPnl.bet_count,
          rightValue: rightPnl.bet_count,
        },
        {
          metric: "Hit Rate",
          left: `${leftPnl.hit_rate_pct.toFixed(1)}%`,
          right: `${rightPnl.hit_rate_pct.toFixed(1)}%`,
          leftValue: leftPnl.hit_rate_pct,
          rightValue: rightPnl.hit_rate_pct,
        },
        {
          metric: "Max Drawdown",
          left: `${leftPnl.max_drawdown_pct.toFixed(1)}%`,
          right: `${rightPnl.max_drawdown_pct.toFixed(1)}%`,
          leftValue: leftPnl.max_drawdown_pct,
          rightValue: rightPnl.max_drawdown_pct,
          lowerBetter: true,
        },
        {
          metric: "Sharpe Ratio",
          left: leftPnl.sharpe_ratio.toFixed(3),
          right: rightPnl.sharpe_ratio.toFixed(3),
          leftValue: leftPnl.sharpe_ratio,
          rightValue: rightPnl.sharpe_ratio,
        },
      ];
    })(),
  ] : [];

  // Market comparison (for OoS files with market_pnl)
  const marketComparison = leftData?.market_pnl && rightData?.market_pnl
    ? (() => {
        const allMarkets = new Set([
          ...Object.keys(leftData.market_pnl || {}),
          ...Object.keys(rightData.market_pnl || {}),
        ]);
        return Array.from(allMarkets).map((m) => ({
          market: m.replace(/_/g, " "),
          leftRoi: leftData.market_pnl?.[m]?.roi_pct ?? null,
          rightRoi: rightData.market_pnl?.[m]?.roi_pct ?? null,
          leftBets: leftData.market_pnl?.[m]?.bets ?? 0,
          rightBets: rightData.market_pnl?.[m]?.bets ?? 0,
        }));
      })()
    : null;

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="py-3 px-4">
            <label className="text-xs text-muted-foreground block mb-1">Left (A)</label>
            <select
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm"
              value={leftFilename}
              onChange={(e) => setLeftFilename(e.target.value)}
            >
              {backtests.map((b) => (
                <option key={b.filename} value={b.filename}>
                  {b.label} ({b.type === "out_of_sample" ? "OoS" : "In-Sample"})
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <label className="text-xs text-muted-foreground block mb-1">Right (B)</label>
            <select
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm"
              value={rightFilename}
              onChange={(e) => setRightFilename(e.target.value)}
            >
              {backtests.map((b) => (
                <option key={b.filename} value={b.filename}>
                  {b.label} ({b.type === "out_of_sample" ? "OoS" : "In-Sample"})
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="text-center text-sm text-muted-foreground py-8">Loading comparison data...</div>
      )}

      {leftData && rightData && !loading && (
        <>
          {/* Metrics Comparison Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Side-by-Side Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-2">Metric</th>
                      <th className="text-right py-2 px-2">
                        <Badge variant="outline" className="text-[10px]">{leftData.label}</Badge>
                      </th>
                      <th className="text-right py-2 px-2">
                        <Badge variant="outline" className="text-[10px]">{rightData.label}</Badge>
                      </th>
                      <th className="text-center py-2 px-2">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonMetrics.map((m) => {
                      const leftBetter = m.lowerBetter
                        ? m.leftValue < m.rightValue
                        : m.leftValue > m.rightValue;
                      const tied = m.leftValue === m.rightValue;
                      return (
                        <tr key={m.metric} className="border-b border-border/50">
                          <td className="py-1.5 px-2 font-medium">{m.metric}</td>
                          <td className={`text-right py-1.5 px-2 ${leftBetter && !tied ? "text-success font-medium" : ""}`}>
                            {m.left}
                          </td>
                          <td className={`text-right py-1.5 px-2 ${!leftBetter && !tied ? "text-success font-medium" : ""}`}>
                            {m.right}
                          </td>
                          <td className="text-center py-1.5 px-2 text-muted-foreground">
                            {tied ? "—" : leftBetter ? "A" : "B"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Calibration Comparison */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Calibration Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    dataKey="predicted"
                    domain={[0, 100]}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    label={{ value: "Predicted %", position: "bottom", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="actual"
                    domain={[0, 100]}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    label={{ value: "Actual %", angle: -90, position: "insideLeft", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: 12,
                    }}
                  />
                  <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />
                  <Scatter
                    name="Perfect"
                    data={[{ predicted: 0, actual: 0 }, { predicted: 100, actual: 100 }]}
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="5 5"
                    line
                    shape={() => null}
                    legendType="line"
                  />
                  <Scatter
                    name={leftData.label}
                    data={leftData.calibration.map((b) => ({
                      predicted: Math.round(b.predicted_avg * 100),
                      actual: Math.round(b.actual_rate * 100),
                    }))}
                    fill="#3b82f6"
                    fillOpacity={0.7}
                    shape="circle"
                    r={5}
                  />
                  <Scatter
                    name={rightData.label}
                    data={rightData.calibration.map((b) => ({
                      predicted: Math.round(b.predicted_avg * 100),
                      actual: Math.round(b.actual_rate * 100),
                    }))}
                    fill="#f59e0b"
                    fillOpacity={0.7}
                    shape="diamond"
                    r={5}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Market P&L Comparison */}
          {marketComparison && marketComparison.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Market ROI Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={marketComparison.filter((m) => m.leftRoi !== null || m.rightRoi !== null)}
                    margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="market"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        fontSize: 12,
                      }}
                    />
                    <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="leftRoi" name={leftData.label} fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={25} />
                    <Bar dataKey="rightRoi" name={rightData.label} fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={25} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
