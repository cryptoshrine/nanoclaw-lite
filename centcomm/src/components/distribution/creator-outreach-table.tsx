"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ExternalLink, Users } from "lucide-react";
import type { Creator, OutreachStage } from "@/lib/distribution-types";
import { OUTREACH_STAGE_COLORS, OUTREACH_STAGE_LABELS } from "@/lib/distribution-types";

type SortKey = "followers" | "channelName" | "outreachStage";

const STAGE_ORDER: Record<OutreachStage, number> = {
  partner: 4,
  contacted: 3,
  engaging: 2,
  following: 1,
  identified: 0,
};

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CreatorOutreachTable({
  creators,
}: {
  creators: Creator[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("followers");
  const [sortAsc, setSortAsc] = useState(false);
  const [stageFilter, setStageFilter] = useState<OutreachStage | "all">("all");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered =
    stageFilter === "all"
      ? creators
      : creators.filter((c) => c.outreachStage === stageFilter);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "followers") cmp = a.followers - b.followers;
    else if (sortKey === "channelName")
      cmp = a.channelName.localeCompare(b.channelName);
    else cmp = STAGE_ORDER[a.outreachStage] - STAGE_ORDER[b.outreachStage];
    return sortAsc ? cmp : -cmp;
  });

  if (creators.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Users className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No creator data loaded.</p>
        <p className="text-xs mt-1">
          Ensure Ball_AI_Lead_List_Clean.csv exists at the expected path.
        </p>
      </div>
    );
  }

  // Stage counts
  const stageCounts: Record<string, number> = { all: creators.length };
  for (const c of creators) {
    stageCounts[c.outreachStage] = (stageCounts[c.outreachStage] ?? 0) + 1;
  }

  return (
    <div className="space-y-4">
      {/* Stage filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "identified", "following", "engaging", "contacted", "partner"] as const).map(
          (stage) => {
            const count = stageCounts[stage] ?? 0;
            if (stage !== "all" && count === 0) return null;
            const isActive = stageFilter === stage;
            return (
              <Button
                key={stage}
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={`text-xs h-7 ${
                  isActive ? "bg-electric hover:bg-electric/90 text-white" : ""
                }`}
                onClick={() => setStageFilter(stage)}
              >
                {stage === "all"
                  ? "All"
                  : OUTREACH_STAGE_LABELS[stage as OutreachStage]}{" "}
                ({count})
              </Button>
            );
          }
        )}
      </div>

      <Card>
        <CardContent className="py-4 px-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                    #
                  </th>
                  <th
                    className="text-left py-2 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("channelName")}
                  >
                    <span className="flex items-center gap-1">
                      Creator
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                    Platform
                  </th>
                  <th
                    className="text-right py-2 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("followers")}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Followers
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                    Focus
                  </th>
                  <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                    X Handle
                  </th>
                  <th
                    className="text-left py-2 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("outreachStage")}
                  >
                    <span className="flex items-center gap-1">
                      Stage
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((creator, idx) => {
                  const stageColor =
                    OUTREACH_STAGE_COLORS[creator.outreachStage];
                  return (
                    <tr
                      key={creator.handle}
                      className="border-b border-border/50 hover:bg-sidebar-accent/30"
                    >
                      <td className="py-2 px-4 text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-4 text-foreground font-medium">
                        {creator.channelName}
                      </td>
                      <td className="py-2 px-4 text-muted-foreground">
                        {creator.platform}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-foreground">
                        {formatFollowers(creator.followers)}
                      </td>
                      <td className="py-2 px-4 text-muted-foreground max-w-[200px] truncate">
                        {creator.contentFocus}
                      </td>
                      <td className="py-2 px-4">
                        {creator.twitterHandle ? (
                          <a
                            href={`https://x.com/${creator.twitterHandle.replace("@", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-electric hover:text-electric/80 flex items-center gap-1"
                          >
                            {creator.twitterHandle}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-4">
                        <Badge
                          variant="outline"
                          className={`text-[9px] bg-${stageColor}/10 text-${stageColor} border-${stageColor}/30`}
                        >
                          {OUTREACH_STAGE_LABELS[creator.outreachStage]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
