"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, FileText, Loader2 } from "lucide-react";

interface SearchResult {
  id: string;
  path: string;
  group_folder: string;
  source: string;
  start_line: number;
  end_line: number;
  text: string;
}

interface MemorySearchProps {
  onResultClick?: (groupFolder: string, path: string) => void;
}

export function MemorySearch({ onResultClick }: MemorySearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const res = await fetch(
        `/api/memory/search?q=${encodeURIComponent(q)}&limit=20`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results);
      }
    } catch {
      // silently fail
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-electric" />
          Memory Search
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doSearch(query);
          }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all agent memories..."
            className="bg-muted border-border text-sm"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="flex items-center gap-1.5 rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </button>
        </form>

        {searched && (
          <ScrollArea className="h-[400px]">
            {results.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {searching ? "Searching..." : "No results found"}
              </div>
            ) : (
              <div className="space-y-2">
                {results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() =>
                      onResultClick?.(result.group_folder, result.path)
                    }
                    className="w-full rounded-lg border border-border bg-muted/50 p-3 text-left hover:border-electric/30 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-3.5 w-3.5 text-electric shrink-0" />
                      <span className="text-xs font-mono text-foreground truncate">
                        {result.path}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-border shrink-0"
                      >
                        {result.group_folder}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        L{result.start_line}-{result.end_line}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {result.text}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
