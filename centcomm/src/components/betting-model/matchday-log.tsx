"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, CheckCircle, XCircle } from "lucide-react";
import type { MatchdayResult } from "@/lib/backtest-types";

interface MatchdayLogProps {
  matchdays: MatchdayResult[];
}

export function MatchdayLog({ matchdays }: MatchdayLogProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sortedDays = [...matchdays].sort((a, b) => b.date.localeCompare(a.date));
  const displayDays = showAll ? sortedDays : sortedDays.slice(0, 15);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Matchday Results ({matchdays.length} days)</CardTitle>
          {matchdays.length > 15 && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show Recent" : `Show All (${matchdays.length})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {displayDays.map((day) => {
            const isExpanded = expandedDay === day.date;
            const accPct = day.accuracy_1x2 * 100;

            return (
              <div key={day.date} className="border border-border/50 rounded-md overflow-hidden">
                <button
                  onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium w-20">{day.date}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${accPct >= 60 ? "border-success/50 text-success" : accPct >= 40 ? "border-electric/50 text-electric" : "border-alert/50 text-alert"}`}
                    >
                      {day.correct_1x2}/{day.matches} correct ({accPct.toFixed(0)}%)
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {day.predictions.slice(0, 8).map((p, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${p.correct_1x2 ? "bg-success" : "bg-alert"}`}
                        />
                      ))}
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 px-3 py-2 bg-muted/10">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left py-1">Match</th>
                          <th className="text-center py-1">Score</th>
                          <th className="text-center py-1">Predicted</th>
                          <th className="text-center py-1">Actual</th>
                          <th className="text-center py-1">1X2</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.predictions.map((p) => (
                          <tr key={p.match_id} className="border-t border-border/20">
                            <td className="py-1">
                              <span className="font-medium">{p.home_team}</span>
                              <span className="text-muted-foreground"> vs </span>
                              <span className="font-medium">{p.away_team}</span>
                            </td>
                            <td className="text-center py-1 font-mono">{p.home_score}-{p.away_score}</td>
                            <td className="text-center py-1">
                              <span className="capitalize">{p.predicted_1x2.replace("_", " ")}</span>
                            </td>
                            <td className="text-center py-1">
                              <span className="capitalize">{p.actual_1x2}</span>
                            </td>
                            <td className="text-center py-1">
                              {p.correct_1x2 ? (
                                <CheckCircle className="h-3.5 w-3.5 text-success inline" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-alert inline" />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface AccuracyTimelineProps {
  matchdays: MatchdayResult[];
}

export function AccuracyTimeline({ matchdays }: AccuracyTimelineProps) {
  // Rolling 5-matchday average
  const sorted = [...matchdays].sort((a, b) => a.date.localeCompare(b.date));
  const data = sorted.map((day, i) => {
    const windowStart = Math.max(0, i - 4);
    const window = sorted.slice(windowStart, i + 1);
    const totalCorrect = window.reduce((acc, d) => acc + d.correct_1x2, 0);
    const totalMatches = window.reduce((acc, d) => acc + d.matches, 0);
    const rollingAcc = totalMatches > 0 ? (totalCorrect / totalMatches) * 100 : 0;

    return {
      date: day.date.substring(5), // MM-DD
      accuracy: Math.round(day.accuracy_1x2 * 100),
      rolling: Math.round(rollingAcc),
      matches: day.matches,
    };
  });

  // Import recharts dynamically only if needed
  const {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    ReferenceLine,
  } = require("recharts");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">1X2 Accuracy Over Season</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              interval={Math.floor(data.length / 10)}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                `${value}%`,
                name === "rolling" ? "5-day rolling" : "Day accuracy",
              ]}
            />
            <ReferenceLine y={33} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "Random (33%)", fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "right" }} />
            <Area
              type="monotone"
              dataKey="rolling"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
