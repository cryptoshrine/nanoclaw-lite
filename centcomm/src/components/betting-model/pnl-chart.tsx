"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";
import type { PnlStrategy } from "@/lib/backtest-types";
import { STRATEGY_LABELS, STRATEGY_COLORS } from "@/lib/backtest-types";

interface PnlChartProps {
  strategies: Record<string, PnlStrategy>;
  selectedStrategies?: string[];
}

export function PnlCumulativeChart({ strategies, selectedStrategies }: PnlChartProps) {
  const keys = selectedStrategies || Object.keys(strategies);

  // Build cumulative data from monthly P&L
  const allMonths = new Set<string>();
  for (const key of keys) {
    const s = strategies[key];
    if (s?.monthly_pnl) {
      Object.keys(s.monthly_pnl).forEach((m) => allMonths.add(m));
    }
  }
  const sortedMonths = Array.from(allMonths).sort();

  const data = sortedMonths.map((month) => {
    const row: Record<string, number | string> = { month: month.substring(2) }; // "24-09" format
    for (const key of keys) {
      const s = strategies[key];
      if (!s?.monthly_pnl) continue;
      // Calculate cumulative up to this month
      let cumulative = s.starting_bankroll;
      for (const m of sortedMonths) {
        if (m > month) break;
        cumulative += (s.monthly_pnl[m] ?? 0);
      }
      row[key] = Math.round(cumulative);
    }
    return row;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cumulative Bankroll</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="month"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `$${(value ?? 0).toLocaleString()}`,
                STRATEGY_LABELS[name ?? ""] || name,
              ]}
            />
            <Legend
              verticalAlign="top"
              height={30}
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => STRATEGY_LABELS[value] || value}
            />
            <ReferenceLine y={1000} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "Start", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
            {keys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={STRATEGY_COLORS[key] || "#888"}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function PnlMonthlyChart({ strategies, selectedStrategies }: PnlChartProps) {
  const keys = selectedStrategies || Object.keys(strategies);
  // Use first strategy for monthly bars — show flat strategies only
  const flatKeys = keys.filter((k) => k.includes("flat"));
  const primaryKey = flatKeys[0] || keys[0];
  const s = strategies[primaryKey];
  if (!s?.monthly_pnl) return null;

  const data = Object.entries(s.monthly_pnl)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({
      month: month.substring(2),
      pnl: Math.round(pnl),
      positive: pnl >= 0,
    }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Monthly P&L — {STRATEGY_LABELS[primaryKey] || primaryKey}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="month"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                fontSize: 12,
              }}
              formatter={(value) => [`$${(value ?? 0).toLocaleString()}`, "P&L"]}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <Bar
              dataKey="pnl"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface StrategyTableProps {
  strategies: Record<string, PnlStrategy>;
}

export function StrategyTable({ strategies }: StrategyTableProps) {
  const entries = Object.entries(strategies);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Strategy Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2">Strategy</th>
                <th className="text-right py-2 px-2">ROI</th>
                <th className="text-right py-2 px-2">Final</th>
                <th className="text-right py-2 px-2">Bets</th>
                <th className="text-right py-2 px-2">Win Rate</th>
                <th className="text-right py-2 px-2">Yield</th>
                <th className="text-right py-2 px-2">Max DD</th>
                <th className="text-right py-2 px-2">Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, s]) => (
                <tr key={key} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: STRATEGY_COLORS[key] || "#888" }}
                      />
                      <span className="font-medium">{STRATEGY_LABELS[key] || key}</span>
                    </div>
                  </td>
                  <td className={`text-right py-1.5 px-2 font-medium ${s.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                    {s.roi_pct > 0 ? "+" : ""}{s.roi_pct.toFixed(1)}%
                  </td>
                  <td className="text-right py-1.5 px-2">
                    ${s.final_bankroll >= 1000000
                      ? `${(s.final_bankroll / 1000000).toFixed(1)}M`
                      : s.final_bankroll >= 1000
                      ? `${(s.final_bankroll / 1000).toFixed(1)}k`
                      : s.final_bankroll.toFixed(0)}
                  </td>
                  <td className="text-right py-1.5 px-2">{s.bet_count}</td>
                  <td className="text-right py-1.5 px-2">{s.hit_rate_pct.toFixed(1)}%</td>
                  <td className="text-right py-1.5 px-2">{s.yield_pct.toFixed(1)}%</td>
                  <td className="text-right py-1.5 px-2 text-amber">{s.max_drawdown_pct.toFixed(1)}%</td>
                  <td className="text-right py-1.5 px-2">{s.sharpe_ratio.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
