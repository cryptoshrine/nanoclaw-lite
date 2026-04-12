"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/outreach-types";
import { SEGMENT_LABELS, STAGE_LABELS } from "@/lib/outreach-types";
import { Building2, CalendarClock, AlertCircle, Clock } from "lucide-react";

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
}

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

function getDueInfo(nextActionDate: string | undefined): {
  label: string;
  status: "overdue" | "today" | "upcoming" | null;
  relativeText: string;
} {
  if (!nextActionDate) return { label: "", status: null, relativeText: "" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextActionDate);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return {
      label: "Overdue",
      status: "overdue",
      relativeText: abs === 1 ? "yesterday" : `${abs} days ago`,
    };
  }
  if (diffDays === 0) {
    return { label: "Due Today", status: "today", relativeText: "today" };
  }
  if (diffDays === 1) {
    return { label: "", status: "upcoming", relativeText: "tomorrow" };
  }
  return { label: "", status: "upcoming", relativeText: `in ${diffDays} days` };
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const lastActivity = lead.activities?.[0];
  const due = getDueInfo(lead.nextActionDate);

  return (
    <Card
      className="border-border bg-card hover:border-electric/40 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{lead.title}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {due.status === "overdue" && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-alert/40 text-alert bg-alert/5 flex items-center gap-0.5"
              >
                <AlertCircle className="h-2.5 w-2.5" />
                Overdue
              </Badge>
            )}
            {due.status === "today" && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-amber/40 text-amber bg-amber/5 flex items-center gap-0.5"
              >
                <Clock className="h-2.5 w-2.5" />
                Due Today
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${priorityBadgeClass[lead.priority] ?? ""}`}
            >
              {lead.priority}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{lead.firm}</span>
          {lead.firmAum && (
            <span className="text-muted-foreground/60 shrink-0">· {lead.firmAum}</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${segmentBadgeClass[lead.segment] ?? ""}`}
          >
            {SEGMENT_LABELS[lead.segment]}
          </Badge>
          <span className="text-[10px] text-muted-foreground truncate">
            {STAGE_LABELS[lead.stage]}
          </span>
        </div>

        {due.status && due.relativeText && (
          <div
            className={`flex items-center gap-1 text-[10px] ${
              due.status === "overdue"
                ? "text-alert"
                : due.status === "today"
                ? "text-amber"
                : "text-muted-foreground"
            }`}
          >
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {lead.nextAction ? `${lead.nextAction} · ` : ""}
              {due.relativeText}
            </span>
          </div>
        )}

        {!due.status && lastActivity && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span className="truncate">{lastActivity.action}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
