"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ValueBet, ValueBetGroup, MarketFilter } from "@/lib/betting-types";
import { marketKeyMatchesFilter } from "@/lib/betting-types";

interface ValueBetTableProps {
  valueBets: Record<string, ValueBetGroup>;
  marketFilter?: MarketFilter;
}

function confidenceBadge(confidence: string) {
  switch (confidence) {
    case "HIGH":
      return (
        <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
          HIGH
        </Badge>
      );
    case "MEDIUM":
      return (
        <Badge className="bg-amber/20 text-amber border-amber/30 text-[10px]">
          MED
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground"
        >
          LOW
        </Badge>
      );
  }
}

export function ValueBetTable({ valueBets, marketFilter = "all" }: ValueBetTableProps) {
  const allBets: (ValueBet & { fixtureLabel: string })[] = [];

  for (const [fixtureLabel, group] of Object.entries(valueBets)) {
    for (const bet of group.value_bets) {
      if (marketKeyMatchesFilter(bet.market_key, marketFilter)) {
        allBets.push({ ...bet, fixtureLabel });
      }
    }
  }

  // Sort by edge descending
  allBets.sort((a, b) => b.edge_percent - a.edge_percent);

  if (allBets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No value bets detected.</p>
        <p className="text-xs mt-1">
          Submit bookmaker odds in the &quot;Odds Input&quot; tab, then re-run
          the analysis pipeline.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Value Bets ({allBets.length} found{marketFilter !== "all" ? ` — ${marketFilter.charAt(0).toUpperCase() + marketFilter.slice(1)}` : ""})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Fixture
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Market
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Our Prob
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Implied
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Edge
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Odds
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Kelly %
                </th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                  Conf
                </th>
              </tr>
            </thead>
            <tbody>
              {allBets.map((bet, i) => (
                <tr
                  key={`${bet.fixtureLabel}-${bet.market_key}-${i}`}
                  className="border-b border-border/50 hover:bg-card-hover transition-colors"
                >
                  <td className="px-3 py-2 text-foreground max-w-[180px] truncate">
                    {bet.fixtureLabel}
                  </td>
                  <td className="px-3 py-2 text-foreground font-medium">
                    {bet.market}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-electric">
                    {(bet.our_probability * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {(bet.implied_probability * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-success font-medium">
                    +{bet.edge_percent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {bet.decimal_odds.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber">
                    {bet.kelly_stake_pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-center">
                    {confidenceBadge(bet.confidence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
