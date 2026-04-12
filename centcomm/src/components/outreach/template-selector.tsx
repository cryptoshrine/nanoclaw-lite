"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Lead, EmailTemplate, PipelineStage } from "@/lib/outreach-types";
import { STAGE_LABELS } from "@/lib/outreach-types";
import { Copy, Check, Mail } from "lucide-react";

interface TemplateSelectorProps {
  lead: Lead;
}

const sequenceLabels: Record<number, string> = {
  1: "Initial",
  2: "3-Day Nudge",
  3: "7-Day Follow-Up",
  4: "Break-Up",
};

function interpolate(text: string, lead: Lead): string {
  return text
    .replace(/\{\{name\}\}/g, lead.name)
    .replace(/\{\{title\}\}/g, lead.title)
    .replace(/\{\{firm\}\}/g, lead.firm)
    .replace(/\{\{firmAum\}\}/g, lead.firmAum ?? "");
}

export function TemplateSelector({ lead }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">(lead.stage);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/outreach/templates")
      .then((r) => r.json())
      .then((d) => {
        setTemplates(d.templates ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered =
    stageFilter === "all"
      ? templates
      : templates.filter((t) => t.stage === stageFilter);

  const uniqueStages = Array.from(new Set(templates.map((t) => t.stage))) as PipelineStage[];

  function handleCopy(text: string, type: "subject" | "body") {
    navigator.clipboard.writeText(text);
    if (type === "subject") {
      setCopiedSubject(true);
      setTimeout(() => setCopiedSubject(false), 2000);
    } else {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        Loading templates...
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        No templates found.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stage filter */}
      <div className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Select
          value={stageFilter}
          onValueChange={(v) => {
            setStageFilter(v as PipelineStage | "all");
            setSelected(null);
          }}
        >
          <SelectTrigger className="bg-muted border-border text-sm flex-1">
            <SelectValue placeholder="Filter by stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {uniqueStages.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template list */}
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No templates for this stage.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(selected?.id === t.id ? null : t)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                selected?.id === t.id
                  ? "bg-electric/10 border-electric/40 text-electric"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {sequenceLabels[t.sequence] ?? `Seq ${t.sequence}`} — {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Template preview */}
      {selected && (
        <div className="border border-border rounded-md space-y-0 overflow-hidden">
          {/* Subject */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <div className="min-w-0">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-2">
                Subject
              </span>
              <span className="text-xs text-foreground">
                {interpolate(selected.subject, lead)}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleCopy(interpolate(selected.subject, lead), "subject")}
              className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
            >
              {copiedSubject ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>

          {/* Body */}
          <div className="relative">
            <ScrollArea className="max-h-48">
              <pre className="px-3 py-2.5 text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {interpolate(selected.body, lead)}
              </pre>
            </ScrollArea>
            <div className="absolute top-2 right-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(interpolate(selected.body, lead), "body")}
                className="h-6 w-6 p-0 bg-card/80 border border-border text-muted-foreground hover:text-foreground"
              >
                {copiedBody ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {/* Meta */}
          <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-electric/30 text-electric">
              {STAGE_LABELS[selected.stage]}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {sequenceLabels[selected.sequence] ?? `Sequence ${selected.sequence}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
