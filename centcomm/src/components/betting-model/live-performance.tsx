"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";

interface DailyPnl {
  date: string;
  bets: number;
  wins: number;
  profit: number;
  cumulative: number;
}

interface MarketPnl {
  market: string;
  bets: number;
  wins: number;
  hit_rate: number;
  roi_pct: number;
  profit: number;
  avg_odds: number;
  avg_edge: number;
}

interface ConfidencePnl {
  confidence: string;
  bets: number;
  wins: number;
  hit_rate: number;
  roi_pct: number;
  profit: number;
}

interface LivePerformanceData {
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
  daily_pnl: DailyPnl[];
  market_pnl: MarketPnl[];
  by_confidence: ConfidencePnl[];
}

interface LivePerformanceProps {
  data: LivePerformanceData;
}

function StatCard({ label, value, sub, positive }: { label: string; value: string | number; sub?: string; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className={`text-xl font-bold ${positive === true ? "text-success" : positive === false ? "text-alert" : "text-foreground"}`}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function LivePerformance({ data }: LivePerformanceProps) {
  const { summary, daily_pnl, market_pnl, by_confidence } = data;

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <StatCard label="Total Bets" value={summary.total_bets} sub={`${summary.days_tracked} days tracked`} />
        <StatCard label="Win Rate" value={`${summary.hit_rate}%`} sub={`${summary.total_wins} wins`} />
        <StatCard
          label="Total P&L"
          value={`${summary.total_profit > 0 ? "+" : ""}${summary.total_profit.toFixed(1)}u`}
          positive={summary.total_profit > 0}
        />
        <StatCard
          label="ROI"
          value={`${summary.roi_pct > 0 ? "+" : ""}${summary.roi_pct.toFixed(2)}%`}
          positive={summary.roi_pct > 0}
        />
        <StatCard label="Win Streak" value={summary.longest_win_streak} sub="longest consecutive" />
        <StatCard label="Loss Streak" value={summary.longest_loss_streak} sub="longest consecutive" />
      </div>

      {/* Cumulative P&L Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Cumulative P&L — {summary.first_date} to {summary.last_date}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={daily_pnl} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={(v) => v.substring(5)}
                interval={Math.max(1, Math.floor(daily_pnl.length / 10))}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v) => `${v}u`}
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
                  const d = payload[0]?.payload as DailyPnl | undefined;
                  if (!d) return null;
                  return (
                    <div className="bg-card border border-border rounded-md p-2 text-xs space-y-1">
                      <div className="font-medium">{d.date}</div>
                      <div>Day P&L: <span className={d.profit > 0 ? "text-success" : "text-alert"}>{d.profit > 0 ? "+" : ""}{d.profit}u</span></div>
                      <div>Cumulative: <span className={d.cumulative > 0 ? "text-success" : "text-alert"}>{d.cumulative > 0 ? "+" : ""}{d.cumulative}u</span></div>
                      <div className="text-muted-foreground">{d.bets} bets, {d.wins} wins</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#3b82f6" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Win Rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Daily Win Rate & Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={daily_pnl.map((d) => ({
                ...d,
                winRate: d.bets > 0 ? Math.round((d.wins / d.bets) * 100) : 0,
              }))}
              margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={(v) => v.substring(5)}
                interval={Math.max(1, Math.floor(daily_pnl.length / 10))}
              />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="bets" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={20} name="Total Bets" />
              <Bar dataKey="wins" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} name="Wins" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Market Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Live Performance by Market</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Market</th>
                    <th className="text-right py-2 px-2">Bets</th>
                    <th className="text-right py-2 px-2">Hit %</th>
                    <th className="text-right py-2 px-2">ROI</th>
                    <th className="text-right py-2 px-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {market_pnl.map((m) => (
                    <tr key={m.market} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-medium">{m.market.replace(/_/g, " ")}</td>
                      <td className="text-right py-1.5 px-2">{m.bets}</td>
                      <td className="text-right py-1.5 px-2">{m.hit_rate}%</td>
                      <td className={`text-right py-1.5 px-2 font-medium ${m.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                        {m.roi_pct > 0 ? "+" : ""}{m.roi_pct}%
                      </td>
                      <td className={`text-right py-1.5 px-2 ${m.profit > 0 ? "text-success" : "text-alert"}`}>
                        {m.profit > 0 ? "+" : ""}{m.profit}u
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Confidence Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performance by Confidence Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Confidence</th>
                    <th className="text-right py-2 px-2">Bets</th>
                    <th className="text-right py-2 px-2">Hit %</th>
                    <th className="text-right py-2 px-2">ROI</th>
                    <th className="text-right py-2 px-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {by_confidence.map((c) => (
                    <tr key={c.confidence} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-medium">{c.confidence}</td>
                      <td className="text-right py-1.5 px-2">{c.bets}</td>
                      <td className="text-right py-1.5 px-2">{c.hit_rate}%</td>
                      <td className={`text-right py-1.5 px-2 font-medium ${c.roi_pct > 0 ? "text-success" : "text-alert"}`}>
                        {c.roi_pct > 0 ? "+" : ""}{c.roi_pct}%
                      </td>
                      <td className={`text-right py-1.5 px-2 ${c.profit > 0 ? "text-success" : "text-alert"}`}>
                        {c.profit > 0 ? "+" : ""}{c.profit}u
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
