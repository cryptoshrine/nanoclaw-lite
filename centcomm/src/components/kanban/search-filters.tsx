"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, X, SlidersHorizontal } from "lucide-react";

export interface SearchFiltersState {
  query: string;
  priority: string;
  size: string;
  scheduleType: string;
}

interface SearchFiltersProps {
  filters: SearchFiltersState;
  onFiltersChange: (filters: SearchFiltersState) => void;
  tab: "dev" | "scheduled";
  resultCount: number;
  totalCount: number;
}

export const defaultFilters: SearchFiltersState = {
  query: "",
  priority: "all",
  size: "all",
  scheduleType: "all",
};

export function hasActiveFilters(filters: SearchFiltersState): boolean {
  return (
    filters.query !== "" ||
    filters.priority !== "all" ||
    filters.size !== "all" ||
    filters.scheduleType !== "all"
  );
}

export function SearchFilters({
  filters,
  onFiltersChange,
  tab,
  resultCount,
  totalCount,
}: SearchFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const active = hasActiveFilters(filters);

  function updateFilter(key: keyof SearchFiltersState, value: string) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function clearAll() {
    onFiltersChange(defaultFilters);
  }

  return (
    <div className="space-y-2">
      {/* Search bar row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => updateFilter("query", e.target.value)}
            placeholder={
              tab === "dev"
                ? "Search tasks by title, summary, category..."
                : "Search by prompt, group, schedule..."
            }
            className="pl-9 pr-8 bg-muted border-border text-sm h-9"
          />
          {filters.query && (
            <button
              onClick={() => updateFilter("query", "")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors h-9 ${
            active
              ? "border-electric/30 bg-electric/10 text-electric"
              : "border-border bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {active && (
            <Badge className="bg-electric/20 text-electric text-[10px] px-1 py-0 ml-0.5">
              {[
                filters.priority !== "all" ? 1 : 0,
                filters.size !== "all" ? 1 : 0,
                filters.scheduleType !== "all" ? 1 : 0,
              ].reduce((a, b) => a + b, 0)}
            </Badge>
          )}
        </button>

        {active && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 rounded-md border border-alert/20 bg-alert/5 px-2.5 py-2 text-xs text-alert hover:bg-alert/10 transition-colors h-9"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Expanded filters row */}
      {expanded && (
        <div className="flex items-center gap-2 pl-1">
          {tab === "dev" ? (
            <>
              <Select
                value={filters.priority}
                onValueChange={(v) => updateFilter("priority", v)}
              >
                <SelectTrigger className="w-[130px] bg-muted border-border text-xs h-8">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="P0">P0 Critical</SelectItem>
                  <SelectItem value="P1">P1 High</SelectItem>
                  <SelectItem value="P2">P2 Medium</SelectItem>
                  <SelectItem value="P3">P3 Low</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.size}
                onValueChange={(v) => updateFilter("size", v)}
              >
                <SelectTrigger className="w-[110px] bg-muted border-border text-xs h-8">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sizes</SelectItem>
                  <SelectItem value="Small">Small</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Large">Large</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : (
            <Select
              value={filters.scheduleType}
              onValueChange={(v) => updateFilter("scheduleType", v)}
            >
              <SelectTrigger className="w-[130px] bg-muted border-border text-xs h-8">
                <SelectValue placeholder="Schedule" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="cron">Cron</SelectItem>
                <SelectItem value="interval">Interval</SelectItem>
                <SelectItem value="once">Once</SelectItem>
              </SelectContent>
            </Select>
          )}

          {active && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {resultCount} of {totalCount} tasks
            </span>
          )}
        </div>
      )}
    </div>
  );
}
