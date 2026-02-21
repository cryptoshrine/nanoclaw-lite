"use client";

import { FixtureCard } from "./fixture-card";
import type { FixtureProbability, ValueBetGroup, MarketFilter } from "@/lib/betting-types";
import { marketKeyMatchesFilter } from "@/lib/betting-types";

interface FixtureGridProps {
  fixtures: FixtureProbability[];
  valueBets: Record<string, ValueBetGroup>;
  marketFilter?: MarketFilter;
}

function groupByDate(
  fixtures: FixtureProbability[]
): Record<string, FixtureProbability[]> {
  const groups: Record<string, FixtureProbability[]> = {};
  for (const f of fixtures) {
    const date = f.match_date;
    if (!groups[date]) groups[date] = [];
    groups[date].push(f);
  }
  return groups;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function FixtureGrid({ fixtures, valueBets, marketFilter = "all" }: FixtureGridProps) {
  // When filtering by market, only show fixtures that have value bets in that market
  // (or show all fixtures when filter is "all")
  const filteredFixtures = marketFilter === "all"
    ? fixtures
    : fixtures.filter((fixture) => {
        const key = `${fixture.home_team} vs ${fixture.away_team}`;
        const vbGroup = valueBets[key];
        if (!vbGroup) return false;
        return vbGroup.value_bets.some((vb) => marketKeyMatchesFilter(vb.market_key, marketFilter));
      });

  const grouped = groupByDate(filteredFixtures);
  const sortedDates = Object.keys(grouped).sort();

  if (fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No fixture data available.</p>
        <p className="text-xs mt-1">Run the betting analysis pipeline first.</p>
      </div>
    );
  }

  if (filteredFixtures.length === 0 && marketFilter !== "all") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No fixtures with value bets in this market.</p>
        <p className="text-xs mt-1">Try selecting &quot;All&quot; to see all fixtures.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sortedDates.map((date) => (
        <div key={date}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            {formatDate(date)}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[date].map((fixture) => {
              const key = `${fixture.home_team} vs ${fixture.away_team}`;
              const vbGroup = valueBets[key];
              // Filter value bets by market when a filter is active
              const filteredBets = marketFilter === "all"
                ? vbGroup?.value_bets
                : vbGroup?.value_bets.filter((vb) => marketKeyMatchesFilter(vb.market_key, marketFilter));
              return (
                <FixtureCard
                  key={fixture.match_id}
                  fixture={fixture}
                  valueBets={filteredBets}
                  marketFilter={marketFilter}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
