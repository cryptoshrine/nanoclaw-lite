"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/outreach-types";
import { SEGMENT_LABELS, STAGE_LABELS } from "@/lib/outreach-types";
import { ChevronUp, ChevronDown, AlertCircle, Clock } from "lucide-react";

interface LeadTableProps {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
}

type SortField = "name" | "firm" | "segment" | "priority" | "stage" | "lastActivity" | "nextAction" | "due";
type SortDir = "asc" | "desc";

const priorityOrder = { A: 0, B: 1, C: 2 };

const priorityBadgeClass: Record<string, string> = {
  A: "border-alert/40 text-alert bg-alert/5",
  B: "border-amber/40 text-amber bg-amber/5",
  C: "border-border text-muted-foreground",
};

const segmentBadgeClass: Record<string, string> = {
  pe: "border-electric/40 text-electric bg-electric/5",
  corp_ma: "border-cyan/40 text-cyan bg-cyan/5",
  lp: "border-success/40 text-success bg-success/5",
  family_office: "border-amber/40 text-amber bg-amber/5",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "";
  }
}

function getDueDiffDays(nextActionDate: string | undefined): number | null {
  if (!nextActionDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextActionDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function DueCell({ nextActionDate }: { nextActionDate?: string }) {
  if (!nextActionDate) {
    return <span className="text-[11px] text-muted-foreground/50">—</span>;
  }

  const diff = getDueDiffDays(nextActionDate);
  if (diff === null) return <span className="text-[11px] text-muted-foreground/50">—</span>;

  if (diff < 0) {
    const abs = Math.abs(diff);
    return (
      <div className="flex items-center gap-1">
        <AlertCircle className="h-3 w-3 text-alert shrink-0" />
        <div>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-alert/40 text-alert bg-alert/5"
          >
            Overdue
          </Badge>
          <p className="text-[10px] text-alert/70 mt-0.5">
            {abs === 1 ? "yesterday" : `${abs} days ago`}
          </p>
        </div>
      </div>
    );
  }

  if (diff === 0) {
    return (
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3 text-amber shrink-0" />
        <div>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-amber/40 text-amber bg-amber/5"
          >
            Due Today
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-success">{formatDate(nextActionDate)}</p>
      <p className="text-[10px] text-muted-foreground">
        {diff === 1 ? "tomorrow" : `in ${diff} days`}
      </p>
    </div>
  );
}

export function LeadTable({ leads, onSelect }: LeadTableProps) {
  const [sortField, setSortField] = useState<SortField>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sorted = [...leads].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "firm":
        cmp = a.firm.localeCompare(b.firm);
        break;
      case "segment":
        cmp = a.segment.localeCompare(b.segment);
        break;
      case "priority":
        cmp = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
        break;
      case "stage":
        cmp = a.stage.localeCompare(b.stage);
        break;
      case "lastActivity": {
        const aDate = a.activities?.[0]?.date ?? "";
        const bDate = b.activities?.[0]?.date ?? "";
        cmp = bDate.localeCompare(aDate); // most recent first by default
        break;
      }
      case "nextAction":
        cmp = (a.nextAction ?? "").localeCompare(b.nextAction ?? "");
        break;
      case "due": {
        // Overdue first (most overdue at top), then today, then upcoming, then no date
        const aDiff = getDueDiffDays(a.nextActionDate);
        const bDiff = getDueDiffDays(b.nextActionDate);
        // null (no date) sorts last
        if (aDiff === null && bDiff === null) cmp = 0;
        else if (aDiff === null) cmp = 1;
        else if (bDiff === null) cmp = -1;
        else cmp = aDiff - bDiff; // most overdue (most negative) first in asc
        break;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-electric" />
    ) : (
      <ChevronDown className="h-3 w-3 text-electric" />
    );
  }

  function Th({ label, field }: { label: string; field: SortField }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
        onClick={() => handleSort(field)}
      >
        <span className="flex items-center gap-1">
          {label}
          <SortIcon field={field} />
        </span>
      </th>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No leads match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th label="Name" field="name" />
            <Th label="Firm" field="firm" />
            <Th label="Segment" field="segment" />
            <Th label="Priority" field="priority" />
            <Th label="Stage" field="stage" />
            <Th label="Due" field="due" />
            <Th label="Last Activity" field="lastActivity" />
            <Th label="Next Action" field="nextAction" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((lead, i) => {
            const lastAct = lead.activities?.[0];
            return (
              <tr
                key={lead.id}
                className={`border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors ${
                  i % 2 === 0 ? "" : "bg-card/30"
                }`}
                onClick={() => onSelect(lead)}
              >
                <td className="px-3 py-2.5">
                  <div>
                    <p className="font-medium text-foreground">{lead.name}</p>
                    <p className="text-[11px] text-muted-foreground">{lead.title}</p>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-foreground">{lead.firm}</p>
                  {lead.firmAum && (
                    <p className="text-[11px] text-muted-foreground">{lead.firmAum}</p>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${segmentBadgeClass[lead.segment] ?? ""}`}
                  >
                    {SEGMENT_LABELS[lead.segment]}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${priorityBadgeClass[lead.priority] ?? ""}`}
                  >
                    {lead.priority}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    {STAGE_LABELS[lead.stage]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <DueCell nextActionDate={lead.nextActionDate} />
                </td>
                <td className="px-3 py-2.5">
                  {lastAct ? (
                    <div>
                      <p className="text-xs text-foreground truncate max-w-[150px]">
                        {lastAct.action}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(lastAct.date)}
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {lead.nextAction ? (
                    <div>
                      <p className="text-xs text-foreground truncate max-w-[150px]">
                        {lead.nextAction}
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
