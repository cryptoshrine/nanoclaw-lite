"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProbabilityBar } from "./probability-bar";
import {
  Target,
  Square,
  CornerDownRight,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";
import type { FixtureProbability, ValueBet, MarketFilter } from "@/lib/betting-types";

interface FixtureCardProps {
  fixture: FixtureProbability;
  valueBets?: ValueBet[];
  marketFilter?: MarketFilter;
}

function MarketSection({
  title,
  icon: Icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-border/50 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon className="h-3 w-3" />
        <span>{title}</span>
        {open ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

export function FixtureCard({ fixture, valueBets = [], marketFilter = "all" }: FixtureCardProps) {
  const hasValue = valueBets.length > 0;
  const bestEdge = valueBets.length
    ? Math.max(...valueBets.map((b) => b.edge_percent))
    : 0;

  // Build edge lookup by market key
  const edgeByKey: Record<string, number> = {};
  for (const vb of valueBets) {
    edgeByKey[vb.market_key] = vb.edge_percent;
  }

  const kickoff = fixture.kick_off
    ? fixture.kick_off.replace(/\.000$/, "").slice(0, 5)
    : "";

  return (
    <Card
      className={`transition-all ${hasValue ? "border-success/40 shadow-[0_0_15px_rgba(34,197,94,0.1)]" : ""}`}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {fixture.home_team}
            </div>
            <div className="text-xs text-muted-foreground">vs</div>
            <div className="text-sm font-semibold text-foreground truncate">
              {fixture.away_team}
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            <div className="text-xs text-muted-foreground">
              {fixture.match_date}
            </div>
            {kickoff && (
              <div className="text-xs text-muted-foreground">{kickoff}</div>
            )}
            {hasValue && (
              <Badge className="mt-1 bg-success/20 text-success border-success/30 text-[10px]">
                {valueBets.length} value
              </Badge>
            )}
          </div>
        </div>

        {/* Referee */}
        {fixture.referee && (
          <div className="flex items-center gap-1 mt-1.5">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {fixture.referee}
            </span>
            {fixture.referee_profile?.tendency && (
              <Badge
                variant="outline"
                className={`text-[10px] px-1 py-0 ${
                  fixture.referee_profile.tendency === "STRICT"
                    ? "border-alert/50 text-alert"
                    : fixture.referee_profile.tendency === "LENIENT"
                      ? "border-success/50 text-success"
                      : "border-amber/50 text-amber"
                }`}
              >
                {fixture.referee_profile.tendency}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-2">
        {/* Goals — open by default, or when filtering goals/btts */}
        {(marketFilter === "all" || marketFilter === "goals" || marketFilter === "btts") && (
          <MarketSection
            title={`Goals (exp: ${fixture.goals.total_expected.toFixed(1)})`}
            icon={Target}
            defaultOpen={marketFilter === "all" || marketFilter === "goals" || marketFilter === "btts"}
          >
            {(marketFilter === "all" || marketFilter === "goals") && (
              <>
                <ProbabilityBar label="O 1.5" probability={fixture.goals.over_1_5} edgePercent={edgeByKey["goals_over_1_5"]} compact />
                <ProbabilityBar label="O 2.5" probability={fixture.goals.over_2_5} edgePercent={edgeByKey["goals_over_2_5"]} compact />
                <ProbabilityBar label="O 3.5" probability={fixture.goals.over_3_5} edgePercent={edgeByKey["goals_over_3_5"]} compact />
              </>
            )}
            {(marketFilter === "all" || marketFilter === "btts") && (
              <ProbabilityBar label="BTTS" probability={fixture.goals.btts_yes} edgePercent={edgeByKey["btts_yes"]} compact />
            )}
            {(marketFilter === "all" || marketFilter === "goals") && (
              <ProbabilityBar label="1H O 0.5" probability={fixture.goals.first_half_over_0_5} edgePercent={edgeByKey["first_half_over_0_5"]} compact />
            )}
          </MarketSection>
        )}

        {/* Cards — open when filtering cards */}
        {(marketFilter === "all" || marketFilter === "cards") && (
          <MarketSection
            title={`Cards (exp: ${fixture.cards.total_expected.toFixed(1)})`}
            icon={Square}
            defaultOpen={marketFilter === "cards"}
          >
            <ProbabilityBar label="O 2.5" probability={fixture.cards.over_2_5} edgePercent={edgeByKey["cards_over_2_5"]} compact />
            <ProbabilityBar label="O 3.5" probability={fixture.cards.over_3_5} edgePercent={edgeByKey["cards_over_3_5"]} compact />
            <ProbabilityBar label="O 4.5" probability={fixture.cards.over_4_5} edgePercent={edgeByKey["cards_over_4_5"]} compact />
            <ProbabilityBar label="O 5.5" probability={fixture.cards.over_5_5} edgePercent={edgeByKey["cards_over_5_5"]} compact />
          </MarketSection>
        )}

        {/* Corners — open when filtering corners */}
        {(marketFilter === "all" || marketFilter === "corners") && (
          <MarketSection
            title={`Corners (exp: ${fixture.corners.total_expected.toFixed(1)})`}
            icon={CornerDownRight}
            defaultOpen={marketFilter === "corners"}
          >
            <ProbabilityBar label="O 8.5" probability={fixture.corners.over_8_5} edgePercent={edgeByKey["corners_over_8_5"]} compact />
            <ProbabilityBar label="O 9.5" probability={fixture.corners.over_9_5} edgePercent={edgeByKey["corners_over_9_5"]} compact />
            <ProbabilityBar label="O 10.5" probability={fixture.corners.over_10_5} edgePercent={edgeByKey["corners_over_10_5"]} compact />
            <ProbabilityBar label="O 11.5" probability={fixture.corners.over_11_5} edgePercent={edgeByKey["corners_over_11_5"]} compact />
          </MarketSection>
        )}

        {/* Best edge summary */}
        {hasValue && bestEdge > 0 && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <span className="text-[10px] text-success font-medium">
              Best edge: +{bestEdge.toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground">
              ({valueBets[0]?.market})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
