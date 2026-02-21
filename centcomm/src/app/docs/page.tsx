"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  BookOpen,
  Filter,
  Loader2,
  ArrowLeft,
  Clock,
  FolderOpen,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocEntry {
  title: string;
  relativePath: string;
  group: string;
  groupName: string;
  category: string;
  size: number;
  mtime: string;
  excerpt: string;
}

interface DocsResponse {
  docs: DocEntry[];
  categories: Record<string, number>;
  total: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);

  if (diffHrs < 1) return `${Math.round(diffMs / (1000 * 60))}m ago`;
  if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`;
  if (diffHrs < 48) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

const CATEGORY_COLORS: Record<string, string> = {
  Reports: "text-electric border-electric/30",
  "Test Results": "text-success border-success/30",
  "Research & Briefs": "text-cyan border-cyan/30",
  "Task Reports": "text-amber border-amber/30",
  Plans: "text-purple-400 border-purple-400/30",
  "Betting Analysis": "text-amber border-amber/30",
  "Bug Reports": "text-alert border-alert/30",
  "Agent Docs": "text-electric border-electric/30",
  "Business Strategy": "text-cyan border-cyan/30",
  Infrastructure: "text-muted-foreground border-border",
  General: "text-muted-foreground border-border",
};

export default function DocsPage() {
  const [data, setData] = useState<DocsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<DocEntry | null>(null);
  const [docContent, setDocContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  async function openDoc(doc: DocEntry) {
    setSelectedDoc(doc);
    setLoadingContent(true);
    try {
      const res = await fetch(
        `/api/docs/${doc.group}/${doc.relativePath}`
      );
      if (res.ok) {
        const json = await res.json();
        setDocContent(json.content);
      } else {
        setDocContent("Failed to load document.");
      }
    } catch {
      setDocContent("Error loading document.");
    } finally {
      setLoadingContent(false);
    }
  }

  function closeDoc() {
    setSelectedDoc(null);
    setDocContent("");
  }

  // Filter docs
  const filteredDocs = data?.docs.filter((doc) => {
    if (activeCategory && doc.category !== activeCategory) return false;
    if (activeGroup && doc.group !== activeGroup) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.excerpt.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.groupName.toLowerCase().includes(q)
      );
    }
    return true;
  }) ?? [];

  // Unique groups from docs
  const groups = data
    ? Array.from(new Set(data.docs.map((d) => d.group))).map((g) => ({
        folder: g,
        name: data.docs.find((d) => d.group === g)?.groupName ?? g,
      }))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Document viewer ──
  if (selectedDoc) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={closeDoc}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to docs
          </button>
          <span className="text-muted-foreground/40">|</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              CATEGORY_COLORS[selectedDoc.category] ?? CATEGORY_COLORS.General
            )}
          >
            {selectedDoc.category}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-border text-muted-foreground"
          >
            {selectedDoc.groupName}
          </Badge>
        </div>

        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
                  <BookOpen className="h-5 w-5 text-electric" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {selectedDoc.title}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {selectedDoc.group}/{selectedDoc.relativePath}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(selectedDoc.mtime)}
                <span className="text-muted-foreground/40">·</span>
                {formatSize(selectedDoc.size)}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 border-t border-border">
            <ScrollArea className="h-[calc(100vh-260px)]">
              {loadingContent ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="p-6 prose prose-invert prose-sm max-w-none
                  prose-headings:text-foreground prose-headings:font-bold
                  prose-h1:text-2xl prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h1:mb-4
                  prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3
                  prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
                  prose-p:text-foreground/90 prose-p:leading-relaxed
                  prose-a:text-electric prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-foreground prose-strong:font-semibold
                  prose-code:text-electric prose-code:bg-electric/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-[''] prose-code:after:content-['']
                  prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:overflow-x-auto
                  prose-pre:prose-code:bg-transparent prose-pre:prose-code:px-0 prose-pre:prose-code:py-0 prose-pre:prose-code:text-foreground/90
                  prose-blockquote:border-l-electric prose-blockquote:bg-electric/5 prose-blockquote:rounded-r prose-blockquote:py-1 prose-blockquote:text-muted-foreground
                  prose-table:border-collapse prose-table:w-full
                  prose-th:bg-card prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-th:text-foreground
                  prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-xs prose-td:text-foreground/80
                  prose-tr:even:bg-muted/30
                  prose-li:text-foreground/90 prose-li:marker:text-electric
                  prose-hr:border-border
                  prose-img:rounded-lg prose-img:border prose-img:border-border
                ">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {docContent}
                  </ReactMarkdown>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Document listing ──
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Docs</h2>
        <p className="text-sm text-muted-foreground">
          Reports, analysis, and documents prepared by agents
        </p>
      </div>

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric/10">
                <BookOpen className="h-4 w-4 text-electric" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {data?.total ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Total documents
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan/10">
                <Filter className="h-4 w-4 text-cyan" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {Object.keys(data?.categories ?? {}).length}
                </p>
                <p className="text-[11px] text-muted-foreground">Categories</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10">
                <FolderOpen className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {groups.length}
                </p>
                <p className="text-[11px] text-muted-foreground">Groups</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber/10">
                <Clock className="h-4 w-4 text-amber" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {data?.docs[0] ? formatDate(data.docs[0].mtime) : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Last updated
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-electric focus:outline-none focus:ring-1 focus:ring-electric"
          />
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
              !activeCategory
                ? "bg-electric/10 text-electric border-electric/30"
                : "text-muted-foreground border-border hover:border-electric/30 hover:text-foreground"
            )}
          >
            All
          </button>
          {Object.entries(data?.categories ?? {})
            .sort(([, a], [, b]) => b - a)
            .map(([cat, count]) => (
              <button
                key={cat}
                onClick={() =>
                  setActiveCategory(activeCategory === cat ? null : cat)
                }
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
                  activeCategory === cat
                    ? CATEGORY_COLORS[cat] ??
                        "text-foreground border-foreground/30"
                    : "text-muted-foreground border-border hover:border-electric/30 hover:text-foreground"
                )}
              >
                {cat}{" "}
                <span className="opacity-60">{count}</span>
              </button>
            ))}
        </div>

        {/* Group filter */}
        {groups.length > 1 && (
          <div className="flex gap-1.5">
            <span className="text-[10px] text-muted-foreground self-center mr-1">
              Group:
            </span>
            <button
              onClick={() => setActiveGroup(null)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
                !activeGroup
                  ? "bg-electric/10 text-electric border-electric/30"
                  : "text-muted-foreground border-border hover:text-foreground"
              )}
            >
              All
            </button>
            {groups.map((g) => (
              <button
                key={g.folder}
                onClick={() =>
                  setActiveGroup(activeGroup === g.folder ? null : g.folder)
                }
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
                  activeGroup === g.folder
                    ? "bg-electric/10 text-electric border-electric/30"
                    : "text-muted-foreground border-border hover:text-foreground"
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Document list */}
      {filteredDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BookOpen className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">No documents found</p>
          {(activeCategory || activeGroup || searchQuery) && (
            <button
              onClick={() => {
                setActiveCategory(null);
                setActiveGroup(null);
                setSearchQuery("");
              }}
              className="text-xs text-electric mt-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredDocs.map((doc) => (
            <Card
              key={`${doc.group}/${doc.relativePath}`}
              className="border-border bg-card card-glow cursor-pointer transition-all hover:border-electric/30"
              onClick={() => openDoc(doc)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-electric/10 mt-0.5">
                    <FileText className="h-4 w-4 text-electric" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-sm text-foreground truncate">
                      {doc.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0",
                          CATEGORY_COLORS[doc.category] ??
                            CATEGORY_COLORS.General
                        )}
                      >
                        {doc.category}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {doc.groupName}
                      </span>
                    </div>
                    {doc.excerpt && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                        {doc.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(doc.mtime)}
                      <span className="opacity-40">·</span>
                      {formatSize(doc.size)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
