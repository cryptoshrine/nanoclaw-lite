"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, TrendingUp } from "lucide-react";
import type { Accumulator } from "@/lib/betting-types";

interface AccumulatorCardProps {
  accumulator: Accumulator;
  index: number;
  bankroll: number;
}

export function AccumulatorCard({
  accumulator,
  index,
  bankroll,
}: AccumulatorCardProps) {
  const minKelly = Math.min(
    ...accumulator.legs.map((l) => l.kelly_stake_pct)
  );
  const suggestedStake = Math.round((bankroll * minKelly) / 100 * 100) / 100;
  const potentialReturn = Math.round(suggestedStake * accumulator.combined_odds * 100) / 100;

  const confColor =
    accumulator.confidence === "HIGH"
      ? "border-success/40 text-success"
      : accumulator.confidence === "MEDIUM"
        ? "border-amber/40 text-amber"
        : "border-border text-muted-foreground";

  return (
    <Card className={`border-l-2 ${confColor.split(" ")[0]}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-electric" />
            <span className="text-sm font-semibold text-foreground">
              Acca #{index + 1}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {accumulator.n_legs} legs
            </Badge>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] ${confColor}`}
          >
            {accumulator.confidence}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Legs */}
        <div className="space-y-1.5">
          {accumulator.legs.map((leg, i) => (
            <div
              key={`${leg.fixture}-${leg.market_key}-${i}`}
              className="flex items-center justify-between text-xs"
            >
              <div className="min-w-0 flex-1">
                <span className="text-muted-foreground">Leg {i + 1}: </span>
                <span className="text-foreground font-medium">
                  {leg.market}
                </span>
                <span className="text-muted-foreground ml-1">
                  ({leg.fixture})
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="font-mono text-foreground">
                  {leg.decimal_odds.toFixed(2)}
                </span>
                <span className="font-mono text-success text-[10px]">
                  +{leg.edge_percent.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Combined odds: </span>
            <span className="font-mono font-semibold text-foreground">
              {accumulator.combined_odds.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Edge: </span>
            <span className="font-mono font-semibold text-success">
              +{accumulator.combined_edge_percent.toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Our prob: </span>
            <span className="font-mono text-electric">
              {(accumulator.combined_probability * 100).toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Implied: </span>
            <span className="font-mono text-muted-foreground">
              {(accumulator.implied_combined_probability * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Stake suggestion */}
        <div className="flex items-center gap-2 bg-electric/5 rounded-md px-3 py-2">
          <TrendingUp className="h-3.5 w-3.5 text-electric" />
          <span className="text-xs text-muted-foreground">
            Stake:{" "}
            <span className="text-foreground font-medium">
              {"\u00A3"}{suggestedStake.toFixed(2)}
            </span>
            {" -> "}
            <span className="text-success font-medium">
              {"\u00A3"}{potentialReturn.toFixed(2)}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

interface AccumulatorListProps {
  accumulators: Accumulator[];
  bankroll: number;
}

export function AccumulatorList({
  accumulators,
  bankroll,
}: AccumulatorListProps) {
  if (accumulators.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Layers className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No accumulator suggestions yet.</p>
        <p className="text-xs mt-1">
          Submit odds and run the analysis to generate accumulators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        {accumulators.length} accumulator suggestion
        {accumulators.length !== 1 ? "s" : ""} (bankroll: {"\u00A3"}
        {bankroll.toFixed(0)})
      </div>
      {accumulators.map((acca, i) => (
        <AccumulatorCard
          key={i}
          accumulator={acca}
          index={i}
          bankroll={bankroll}
        />
      ))}
      <div className="text-[10px] text-muted-foreground bg-alert/5 rounded-md px-3 py-2">
        Warning: Accumulators are high-risk. Each leg must win.
        Only stake what you can afford to lose.
      </div>
    </div>
  );
}
