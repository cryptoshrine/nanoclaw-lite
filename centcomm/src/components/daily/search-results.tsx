"use client";

import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import type { SearchResult } from "@/lib/daily-types";

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  onDateClick: (date: string) => void;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <span className="bg-electric/30 text-electric font-medium">{match}</span>
      {after}
    </>
  );
}

export function SearchResults({
  results,
  query,
  onDateClick,
}: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FileText className="h-10 w-10 mb-3" />
        <p className="text-sm">No results found for &quot;{query}&quot;</p>
      </div>
    );
  }

  // Group by date
  const grouped = results.reduce(
    (acc, r) => {
      if (!acc[r.date]) acc[r.date] = [];
      acc[r.date].push(r);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {results.length} result{results.length !== 1 ? "s" : ""} across{" "}
        {Object.keys(grouped).length} day{Object.keys(grouped).length !== 1 ? "s" : ""}
      </p>

      {Object.entries(grouped).map(([date, hits]) => (
        <div key={date} className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => onDateClick(date)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-card hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-electric">{date}</span>
            <span className="text-xs text-muted-foreground">
              {hits.length} match{hits.length !== 1 ? "es" : ""}
            </span>
          </button>
          <div className="divide-y divide-border/50">
            {hits.slice(0, 5).map((hit, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    L{hit.lineNumber}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {hit.section}
                  </span>
                </div>
                <p className="text-sm text-foreground">
                  {highlightMatch(hit.line, query)}
                </p>
              </div>
            ))}
            {hits.length > 5 && (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                +{hits.length - 5} more matches
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
