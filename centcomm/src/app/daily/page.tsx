"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CalendarDays,
  Search,
  Loader2,
  RefreshCw,
  BarChart3,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DayTimeline } from "@/components/daily/day-timeline";
import { DayDetail } from "@/components/daily/day-detail";
import { SearchResults } from "@/components/daily/search-results";
import type {
  DailyLogSummary,
  DailyLog,
  SearchResult,
} from "@/lib/daily-types";
import { PROJECT_TAGS } from "@/lib/daily-types";

export default function DailyMemoryPage() {
  const [summaries, setSummaries] = useState<DailyLogSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Filter
  const [projectFilter, setProjectFilter] = useState("all");

  const loadSummaries = useCallback(async () => {
    try {
      const res = await fetch("/api/daily");
      if (res.ok) {
        const data = await res.json();
        setSummaries(data.summaries ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  // Auto-select today on first load
  useEffect(() => {
    if (summaries.length > 0 && !selectedDate) {
      setSelectedDate(summaries[0].date);
    }
  }, [summaries, selectedDate]);

  // Load day detail when date changes
  useEffect(() => {
    if (!selectedDate) return;
    setLoadingDay(true);
    setSearchResults(null);
    fetch(`/api/daily?date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.log) setSelectedLog(data.log);
      })
      .catch(() => {})
      .finally(() => setLoadingDay(false));
  }, [selectedDate]);

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setActiveSearch("");
      return;
    }
    setSearching(true);
    setActiveSearch(searchQuery);
    try {
      const params = new URLSearchParams({ q: searchQuery });
      if (projectFilter !== "all") params.set("project", projectFilter);
      const res = await fetch(`/api/daily?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results ?? []);
      }
    } catch {
      // silent
    } finally {
      setSearching(false);
    }
  }

  function handleSearchDateClick(date: string) {
    setSelectedDate(date);
    setSearchResults(null);
    setActiveSearch("");
    setSearchQuery("");
  }

  // Filter summaries by project
  const filteredSummaries =
    projectFilter === "all"
      ? summaries
      : summaries.filter((s) => s.projects.includes(projectFilter));

  // Stats
  const totalSessions = summaries.reduce((a, s) => a + s.totalSessions, 0);
  const totalUserSessions = summaries.reduce((a, s) => a + s.userSessions, 0);
  const totalCompleted = summaries.reduce((a, s) => a + s.completedItems, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-electric" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-electric" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">Daily Memory</h2>
            <p className="text-sm text-muted-foreground">
              Session logs, work tracking, and project history
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true);
            loadSummaries();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Days Logged", value: summaries.length, color: "text-electric" },
          { label: "Total Sessions", value: totalSessions, color: "text-foreground" },
          { label: "User Sessions", value: totalUserSessions, color: "text-cyan" },
          { label: "Items Completed", value: totalCompleted, color: "text-success" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="border border-border rounded-lg bg-card px-4 py-3"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filter bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search across all daily logs..."
            className="pl-9 bg-muted border-border text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSearch}
          disabled={searching}
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[160px] bg-muted border-border text-sm">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {Object.keys(PROJECT_TAGS).map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main content: sidebar + detail */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Timeline sidebar */}
        <div className="w-72 shrink-0 overflow-y-auto pr-2 border-r border-border">
          <DayTimeline
            summaries={filteredSummaries}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        {/* Detail pane */}
        <div className="flex-1 overflow-y-auto">
          {searchResults !== null ? (
            <SearchResults
              results={searchResults}
              query={activeSearch}
              onDateClick={handleSearchDateClick}
            />
          ) : loadingDay ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-electric" />
            </div>
          ) : selectedLog ? (
            <DayDetail log={selectedLog} />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <BarChart3 className="h-10 w-10 mb-3" />
              <p className="text-sm">Select a day to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
