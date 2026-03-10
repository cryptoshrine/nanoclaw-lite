"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketAccuracyEntry } from "@/lib/backtest-types";

interface MarketAccuracyTableProps {
  markets: Record<string, MarketAccuracyEntry>;
}

const MARKET_DISPLAY_NAMES: Record<string, string> = {
  home_win: "Home Win",
  draw: "Draw",
  away_win: "Away Win",
  home_or_draw: "Home or Draw (DC)",
  away_or_draw: "Away or Draw (DC)",
  ah_minus_0_5_home: "AH -0.5 Home",
  ah_minus_1_5_home: "AH -1.5 Home",
  goals_over_0_5: "Over 0.5 Goals",
  goals_over_1_5: "Over 1.5 Goals",
  goals_over_2_5: "Over 2.5 Goals",
  goals_over_3_5: "Over 3.5 Goals",
  goals_over_4_5: "Over 4.5 Goals",
  goals_under_0_5: "Under 0.5 Goals",
  goals_under_1_5: "Under 1.5 Goals",
  goals_under_2_5: "Under 2.5 Goals",
  goals_under_3_5: "Under 3.5 Goals",
  goals_under_4_5: "Under 4.5 Goals",
  btts_yes: "BTTS Yes",
  btts_no: "BTTS No",
  top_correct_score: "Correct Score (Top)",
};

function getCategory(key: string): string {
  if (["home_win", "draw", "away_win"].includes(key)) return "1X2";
  if (key.includes("or_draw")) return "Double Chance";
  if (key.startsWith("ah_")) return "Asian Handicap";
  if (key.startsWith("goals_over") || key.startsWith("goals_under")) return "Goals O/U";
  if (key.startsWith("btts")) return "BTTS";
  if (key.startsWith("top_correct")) return "Correct Score";
  return "Other";
}

export function MarketAccuracyTable({ markets }: MarketAccuracyTableProps) {
  const entries = Object.entries(markets).sort(([, a], [, b]) => b.hit_rate - a.hit_rate);

  // Group by category
  const categories = new Map<string, [string, MarketAccuracyEntry][]>();
  for (const entry of entries) {
    const cat = getCategory(entry[0]);
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(entry);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Market Accuracy Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2">Market</th>
                <th className="text-right py-2 px-2">Total</th>
                <th className="text-right py-2 px-2">Correct</th>
                <th className="text-right py-2 px-2">Hit Rate</th>
                <th className="text-right py-2 px-2">Brier</th>
                <th className="text-right py-2 px-2">Log Loss</th>
                <th className="py-2 px-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(categories.entries()).map(([cat, items]) => (
                <>
                  <tr key={`cat-${cat}`} className="bg-muted/20">
                    <td colSpan={7} className="py-1.5 px-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                      {cat}
                    </td>
                  </tr>
                  {items.map(([key, m]) => (
                    <tr key={key} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-medium pl-4">
                        {MARKET_DISPLAY_NAMES[key] || key}
                      </td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{m.total}</td>
                      <td className="text-right py-1.5 px-2">{m.correct}</td>
                      <td className={`text-right py-1.5 px-2 font-medium ${m.hit_rate > 0.6 ? "text-success" : m.hit_rate > 0.4 ? "text-foreground" : "text-amber"}`}>
                        {(m.hit_rate * 100).toFixed(1)}%
                      </td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{m.brier.toFixed(4)}</td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">{m.log_loss.toFixed(4)}</td>
                      <td className="py-1.5 px-2">
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${m.hit_rate > 0.6 ? "bg-success" : m.hit_rate > 0.4 ? "bg-electric" : "bg-amber"}`}
                            style={{ width: `${m.hit_rate * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
