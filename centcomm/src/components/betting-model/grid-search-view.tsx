"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ScatterChart,
  Scatter,
  Cell,
} from "recharts";
import type { GridSearchComboResult, GridSearchSummary } from "@/lib/backtest-types";

interface GridSearchViewProps {
  data: GridSearchSummary;
}

// Color scale: red → yellow → green
function roiColor(roi: number): string {
  if (roi < 0) return "#ef4444";
  if (roi < 3) return "#f59e0b";
  if (roi < 6) return "#22c55e";
  return "#10b981";
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xl font-bold text-foreground">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function GridSearchView({ data }: GridSearchViewProps) {
  const [selectedCombo, setSelectedCombo] = useState<GridSearchComboResult | null>(
    data.results[0] || null
  );

  // Parameter sensitivity: mean ROI per unique value of each parameter
  const sensitivities = useMemo(() => {
    const params: Array<{ key: keyof GridSearchComboResult["params"]; label: string }> = [
      { key: "lambda_boost", label: "Lambda Boost" },
      { key: "home_advantage", label: "Home Advantage" },
      { key: "rho", label: "Rho" },
      { key: "min_edge", label: "Min Edge %" },
      { key: "regression_weight", label: "Regression Weight" },
    ];

    return params.map(({ key, label }) => {
      const grouped = new Map<number, number[]>();
      for (const r of data.results) {
        const val = r.params[key];
        const existing = grouped.get(val) || [];
        existing.push(r.roi_pct);
        grouped.set(val, existing);
      }

      const points = Array.from(grouped.entries())
        .map(([val, rois]) => ({
          value: val,
          meanRoi: Math.round((rois.reduce((s, r) => s + r, 0) / rois.length) * 100) / 100,
          count: rois.length,
        }))
        .sort((a, b) => a.value - b.value);

      return { key, label, points };
    });
  }, [data.results]);

  // Heat map data: lambda_boost vs home_advantage (mean ROI)
  const heatMapData = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const r of data.results) {
      const key = `${r.params.lambda_boost}_${r.params.home_advantage}`;
      const existing = grouped.get(key) || [];
      existing.push(r.roi_pct);
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries()).map(([key, rois]) => {
      const [lambda, home] = key.split("_").map(Number);
      return {
        lambda,
        home,
        roi: Math.round((rois.reduce((s, r) => s + r, 0) / rois.length) * 100) / 100,
        count: rois.length,
      };
    });
  }, [data.results]);

  // ROI distribution histogram
  const roiDistribution = useMemo(() => {
    const buckets = new Map<string, number>();
    const step = 1;
    for (const r of data.results) {
      const bucket = Math.floor(r.roi_pct / step) * step;
      const key = `${bucket}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([k, count]) => ({ roi: Number(k), count }))
      .sort((a, b) => a.roi - b.roi);
  }, [data.results]);

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <StatCard label="Total Combos" value={data.total_combos} />
        <StatCard
          label="Profitable"
          value={`${data.profitable_combos}/${data.total_combos}`}
          sub={`${((data.profitable_combos / data.total_combos) * 100).toFixed(1)}%`}
        />
        <StatCard label="Mean ROI" value={`${data.mean_roi > 0 ? "+" : ""}${data.mean_roi}%`} />
        <StatCard label="Median ROI" value={`${data.median_roi > 0 ? "+" : ""}${data.median_roi}%`} />
        <StatCard label="Best ROI" value={`+${data.best_roi}%`} />
        <StatCard label="Worst ROI" value={`${data.worst_roi}%`} />
      </div>

      {/* ROI Distribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">ROI Distribution Across All Combos</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={roiDistribution} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="roi"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                }}
                formatter={(value) => [`${value ?? 0} combos`, "Count"]}
                labelFormatter={(label) => `ROI: ${label}% to ${Number(label) + 1}%`}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={30}>
                {roiDistribution.map((entry, i) => (
                  <Cell key={i} fill={roiColor(entry.roi)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Heat Map: Lambda vs Home Advantage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Heat Map: Lambda Boost × Home Advantage (Mean ROI)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                dataKey="lambda"
                name="Lambda"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                label={{ value: "Lambda Boost", position: "bottom", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="home"
                name="Home Adv"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                label={{ value: "Home Advantage", angle: -90, position: "insideLeft", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                }}
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="bg-card border border-border rounded-md p-2 text-xs space-y-1">
                      <div className="font-medium">Lambda: {d.lambda} | Home: {d.home}</div>
                      <div>Mean ROI: <span className={d.roi > 0 ? "text-success" : "text-alert"}>{d.roi > 0 ? "+" : ""}{d.roi}%</span></div>
                      <div className="text-muted-foreground">{d.count} combos</div>
                    </div>
                  );
                }}
              />
              <Scatter data={heatMapData}>
                {heatMapData.map((entry, i) => (
                  <Cell key={i} fill={roiColor(entry.roi)} r={Math.max(8, entry.count * 2)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Parameter Sensitivity */}
      <div className="grid gap-4 lg:grid-cols-3">
        {sensitivities.slice(0, 3).map(({ key, label, points }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{label} Sensitivity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={points} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="value"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: 12,
                    }}
                    formatter={(value) => [`${value ?? 0}%`, "Mean ROI"]}
                  />
                  <Bar dataKey="meanRoi" radius={[3, 3, 0, 0]} maxBarSize={30}>
                    {points.map((p, i) => (
                      <Cell key={i} fill={roiColor(p.meanRoi)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Parameter Sets Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top 20 Parameter Sets (by ROI)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-right py-2 px-2">ROI</th>
                  <th className="text-right py-2 px-2">Hit Rate</th>
                  <th className="text-right py-2 px-2">Bets</th>
                  <th className="text-right py-2 px-2">Profit</th>
                  <th className="text-right py-2 px-2">Lambda</th>
                  <th className="text-right py-2 px-2">Rho</th>
                  <th className="text-right py-2 px-2">Home</th>
                  <th className="text-right py-2 px-2">Edge</th>
                  <th className="text-right py-2 px-2">Reg</th>
                </tr>
              </thead>
              <tbody>
                {data.results.slice(0, 20).map((r, i) => (
                  <tr
                    key={r.combo_idx}
                    className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer ${selectedCombo?.combo_idx === r.combo_idx ? "bg-electric/10" : ""}`}
                    onClick={() => setSelectedCombo(r)}
                  >
                    <td className="py-1.5 px-2 font-medium">{i + 1}</td>
                    <td className={`text-right py-1.5 px-2 font-medium ${r.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                      {r.roi_pct > 0 ? "+" : ""}{r.roi_pct.toFixed(2)}%
                    </td>
                    <td className="text-right py-1.5 px-2">{r.hit_rate.toFixed(1)}%</td>
                    <td className="text-right py-1.5 px-2">{r.bet_count}</td>
                    <td className={`text-right py-1.5 px-2 ${r.profit > 0 ? "text-success" : "text-alert"}`}>
                      {r.profit > 0 ? "+" : ""}{r.profit.toFixed(1)}u
                    </td>
                    <td className="text-right py-1.5 px-2">{r.params.lambda_boost}</td>
                    <td className="text-right py-1.5 px-2">{r.params.rho}</td>
                    <td className="text-right py-1.5 px-2">{r.params.home_advantage}</td>
                    <td className="text-right py-1.5 px-2">{r.params.min_edge}%</td>
                    <td className="text-right py-1.5 px-2">{r.params.regression_weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Selected Combo Market Breakdown */}
      {selectedCombo && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Market Breakdown — Combo #{selectedCombo.combo_idx}
              </CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[10px]">
                  λ={selectedCombo.params.lambda_boost}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  ρ={selectedCombo.params.rho}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  home={selectedCombo.params.home_advantage}
                </Badge>
                <Badge variant="outline" className="text-[10px] border-electric/40 text-electric">
                  ROI: {selectedCombo.roi_pct > 0 ? "+" : ""}{selectedCombo.roi_pct}%
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Market</th>
                    <th className="text-right py-2 px-2">Bets</th>
                    <th className="text-right py-2 px-2">Wins</th>
                    <th className="text-right py-2 px-2">Hit Rate</th>
                    <th className="text-right py-2 px-2">ROI</th>
                    <th className="text-right py-2 px-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(selectedCombo.market_breakdown)
                    .sort(([, a], [, b]) => b.roi_pct - a.roi_pct)
                    .map(([market, m]) => (
                      <tr key={market} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-1.5 px-2 font-medium">{market.replace(/_/g, " ")}</td>
                        <td className="text-right py-1.5 px-2">{m.bets}</td>
                        <td className="text-right py-1.5 px-2">{m.wins}</td>
                        <td className="text-right py-1.5 px-2">
                          {m.bets > 0 ? ((m.wins / m.bets) * 100).toFixed(1) : 0}%
                        </td>
                        <td className={`text-right py-1.5 px-2 font-medium ${m.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                          {m.roi_pct > 0 ? "+" : ""}{m.roi_pct.toFixed(1)}%
                        </td>
                        <td className={`text-right py-1.5 px-2 ${m.profit > 0 ? "text-success" : "text-alert"}`}>
                          {m.profit > 0 ? "+" : ""}{m.profit.toFixed(1)}u
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
