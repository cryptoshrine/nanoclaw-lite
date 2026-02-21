"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Search } from "lucide-react";
import type { TeamStats } from "@/lib/betting-types";

interface TeamStatsTableProps {
  teams: Record<string, TeamStats>;
  fetchedAt: string;
}

type SortKey = keyof TeamStats | "name";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; format?: (v: number) => string }[] = [
  { key: "name", label: "Team" },
  { key: "xg_pg", label: "xG PG", format: (v) => v.toFixed(2) },
  { key: "goals_pg", label: "Goals PG", format: (v) => v.toFixed(2) },
  { key: "xg_conceded_pg", label: "xGA PG", format: (v) => v.toFixed(2) },
  { key: "goals_conceded_pg", label: "GA PG", format: (v) => v.toFixed(2) },
  { key: "yellow_cards_pg", label: "Cards PG", format: (v) => v.toFixed(1) },
  { key: "corners_won_pg", label: "Corners PG", format: (v) => v.toFixed(1) },
  { key: "fouls_committed_pg", label: "Fouls PG", format: (v) => v.toFixed(1) },
  { key: "btts_rate", label: "BTTS %", format: (v) => `${(v * 100).toFixed(0)}%` },
  { key: "clean_sheet_rate", label: "CS %", format: (v) => `${(v * 100).toFixed(0)}%` },
];

export function TeamStatsTable({ teams, fetchedAt }: TeamStatsTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("xg_pg");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const entries = useMemo(() => {
    const arr = Object.entries(teams).map(([name, stats]) => ({
      name,
      ...stats,
    }));

    // Filter
    const filtered = search
      ? arr.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
      : arr;

    // Sort
    filtered.sort((a, b) => {
      const aVal = sortKey === "name" ? a.name : (a[sortKey as keyof TeamStats] as number);
      const bVal = sortKey === "name" ? b.name : (b[sortKey as keyof TeamStats] as number);

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return filtered;
  }, [teams, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Team Season Stats ({Object.keys(teams).length} teams)
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Updated: {new Date(fetchedAt).toLocaleDateString("en-GB")}
          </span>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors ${
                      col.key === "name" ? "sticky left-0 bg-card z-10" : ""
                    }`}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && (
                        <ArrowUpDown className="h-3 w-3 text-electric" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((team) => (
                <tr
                  key={team.name}
                  className="border-b border-border/50 hover:bg-card-hover transition-colors"
                >
                  {COLUMNS.map((col) => {
                    const val =
                      col.key === "name"
                        ? team.name
                        : (team[col.key as keyof TeamStats] as number);
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 ${
                          col.key === "name"
                            ? "sticky left-0 bg-card font-medium text-foreground"
                            : "text-muted-foreground font-mono"
                        }`}
                      >
                        {col.key === "name"
                          ? (val as string)
                          : col.format
                            ? col.format(val as number)
                            : val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
