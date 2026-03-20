"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Target,
  Loader2,
  RefreshCw,
  Plus,
  LayoutGrid,
  Table,
  Search,
  Download,
} from "lucide-react";
import { PipelineStats } from "@/components/outreach/pipeline-stats";
import { PipelineBoard } from "@/components/outreach/pipeline-board";
import { LeadTable } from "@/components/outreach/lead-table";
import { AddLeadDialog } from "@/components/outreach/add-lead-dialog";
import { LeadDetailDialog } from "@/components/outreach/lead-detail-dialog";
import type { Lead, PipelineStage, Segment, Priority } from "@/lib/outreach-types";
import { SEGMENT_LABELS } from "@/lib/outreach-types";

interface StatsData {
  totalLeads: number;
  connectionRate: number;
  replyRate: number;
  meetingsBooked: number;
}

export default function OutreachPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  // View toggle
  const [view, setView] = useState<"board" | "table">("board");

  // Inbound import
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [leadsRes, statsRes] = await Promise.all([
        fetch("/api/outreach/leads"),
        fetch("/api/outreach/stats"),
      ]);

      if (leadsRes.ok) {
        const data = await leadsRes.json();
        if (!data.error) setLeads(data.leads ?? []);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        if (!data.error) setStats(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleRefresh() {
    setRefreshing(true);
    loadData();
  }

  function handleLeadClick(lead: Lead) {
    setDetailLead(lead);
    setDetailOpen(true);
  }

  function handleLeadCreated(lead: Lead) {
    setLeads((prev) => [...prev, lead]);
    loadData(); // refresh stats
  }

  function handleLeadUpdated(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDetailLead(updated);
    loadData(); // refresh stats
  }

  function handleLeadDeleted(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    loadData(); // refresh stats
  }

  async function handleImportInbound() {
    setImporting(true);
    try {
      const res = await fetch("/api/outreach/import", { method: "POST" });
      const data = await res.json() as { imported?: number; message?: string; error?: string };
      if (data.error) {
        alert(`Import failed: ${data.error}`);
      } else if (data.imported === 0) {
        alert(data.message ?? "No new leads to import.");
      } else {
        alert(`Imported ${data.imported} new lead${data.imported === 1 ? "" : "s"} from basecasedd.com`);
        loadData();
      }
    } catch (err) {
      alert(`Import error: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleStageChange(leadId: string, newStage: PipelineStage) {
    try {
      const res = await fetch(`/api/outreach/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        const data = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === leadId ? data.lead : l)));
        loadData(); // refresh stats
      }
    } catch {
      // silently fail
    }
  }

  // Apply filters
  const filtered = leads.filter((lead) => {
    if (segmentFilter !== "all" && lead.segment !== segmentFilter) return false;
    if (priorityFilter !== "all" && lead.priority !== priorityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.firm.toLowerCase().includes(q) ||
        lead.title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-electric" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="h-6 w-6 text-electric" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">Outreach Pipeline</h2>
            <p className="text-sm text-muted-foreground">
              PE/VC lead tracking and outreach management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleImportInbound}
            disabled={importing}
            title="Import inbound leads from basecasedd.com case study gate"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Import Inbound
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-electric hover:bg-electric/90 text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Stats */}
      <PipelineStats stats={stats} />

      {/* Filters + View Toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads..."
            className="pl-9 bg-muted border-border text-sm"
          />
        </div>

        <Select value={segmentFilter} onValueChange={setSegmentFilter}>
          <SelectTrigger className="w-[150px] bg-muted border-border text-sm">
            <SelectValue placeholder="Segment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Segments</SelectItem>
            {(Object.entries(SEGMENT_LABELS) as [Segment, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px] bg-muted border-border text-sm">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="A">A — High</SelectItem>
            <SelectItem value="B">B — Medium</SelectItem>
            <SelectItem value="C">C — Low</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center border border-border rounded-md">
          <button
            onClick={() => setView("board")}
            className={`p-2 rounded-l-md transition-colors ${
              view === "board"
                ? "bg-electric/10 text-electric"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("table")}
            className={`p-2 rounded-r-md transition-colors ${
              view === "table"
                ? "bg-electric/10 text-electric"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Table className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "board" ? (
        <PipelineBoard
          leads={filtered}
          onLeadClick={handleLeadClick}
          onStageChange={handleStageChange}
        />
      ) : (
        <LeadTable leads={filtered} onSelect={handleLeadClick} />
      )}

      {/* Dialogs */}
      <AddLeadDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleLeadCreated}
      />
      <LeadDetailDialog
        lead={detailLead}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailLead(null);
        }}
        onUpdated={handleLeadUpdated}
        onDeleted={handleLeadDeleted}
      />
    </div>
  );
}
