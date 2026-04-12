"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Lead, Segment, Priority, PipelineStage } from "@/lib/outreach-types";
import { SEGMENT_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/outreach-types";

interface AddLeadDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}

export function AddLeadDialog({ open, onClose, onCreated }: AddLeadDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    title: "",
    firm: "",
    firmAum: "",
    segment: "pe" as Segment,
    priority: "B" as Priority,
    stage: "identified" as PipelineStage,
    email: "",
    linkedinUrl: "",
    notes: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.name || !form.title || !form.firm) return;
    setSaving(true);
    try {
      const res = await fetch("/api/outreach/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        onCreated(data.lead);
        setForm({
          name: "",
          title: "",
          firm: "",
          firmAum: "",
          segment: "pe",
          priority: "B",
          stage: "identified",
          email: "",
          linkedinUrl: "",
          notes: "",
        });
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Add Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="John Smith"
                className="bg-muted border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Title *</label>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Managing Partner"
                className="bg-muted border-border"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Firm *</label>
              <Input
                value={form.firm}
                onChange={(e) => set("firm", e.target.value)}
                placeholder="Apex Capital"
                className="bg-muted border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Firm AUM</label>
              <Input
                value={form.firmAum}
                onChange={(e) => set("firmAum", e.target.value)}
                placeholder="$1.2B"
                className="bg-muted border-border"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Segment *</label>
              <Select value={form.segment} onValueChange={(v) => set("segment", v)}>
                <SelectTrigger className="bg-muted border-border text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SEGMENT_LABELS) as [Segment, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Priority *</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger className="bg-muted border-border text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A — High</SelectItem>
                  <SelectItem value="B">B — Medium</SelectItem>
                  <SelectItem value="C">C — Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Stage</label>
              <Select value={form.stage} onValueChange={(v) => set("stage", v)}>
                <SelectTrigger className="bg-muted border-border text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Email</label>
              <Input
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="john@firm.com"
                className="bg-muted border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">LinkedIn URL</label>
              <Input
                value={form.linkedinUrl}
                onChange={(e) => set("linkedinUrl", e.target.value)}
                placeholder="linkedin.com/in/..."
                className="bg-muted border-border"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Background, context, intro source..."
              rows={3}
              className="bg-muted border-border resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !form.name || !form.title || !form.firm}
            className="bg-electric hover:bg-electric/90 text-white"
          >
            {saving ? "Adding..." : "Add Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
