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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Lead, Activity, Segment, Priority, PipelineStage } from "@/lib/outreach-types";
import {
  SEGMENT_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/outreach-types";
import {
  Linkedin,
  Mail,
  Phone,
  Video,
  MessageSquare,
  CalendarDays,
  Trash2,
  Plus,
  Building2,
  ExternalLink,
} from "lucide-react";
import { TemplateSelector } from "@/components/outreach/template-selector";

interface LeadDetailDialogProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onDeleted: (id: string) => void;
}

const channelIcons: Record<string, React.ReactNode> = {
  linkedin: <Linkedin className="h-3 w-3" />,
  email: <Mail className="h-3 w-3" />,
  call: <Phone className="h-3 w-3" />,
  meeting: <Video className="h-3 w-3" />,
  other: <MessageSquare className="h-3 w-3" />,
};

const priorityBadgeClass: Record<string, string> = {
  A: "border-alert/40 text-alert bg-alert/5",
  B: "border-amber/40 text-amber bg-amber/5",
  C: "border-border text-muted-foreground",
};

export function LeadDetailDialog({
  lead,
  open,
  onClose,
  onUpdated,
  onDeleted,
}: LeadDetailDialogProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit form state
  const [stage, setStage] = useState<PipelineStage>(lead?.stage ?? "identified");
  const [nextAction, setNextAction] = useState(lead?.nextAction ?? "");
  const [nextActionDate, setNextActionDate] = useState(lead?.nextActionDate ?? "");
  const [notes, setNotes] = useState(lead?.notes ?? "");

  // Add activity form
  const [actChannel, setActChannel] = useState<Activity["channel"]>("linkedin");
  const [actAction, setActAction] = useState("");
  const [actNotes, setActNotes] = useState("");
  const [addingActivity, setAddingActivity] = useState(false);

  // Sync state when lead changes
  useState(() => {
    if (lead) {
      setStage(lead.stage);
      setNextAction(lead.nextAction ?? "");
      setNextActionDate(lead.nextActionDate ?? "");
      setNotes(lead.notes ?? "");
      setConfirmDelete(false);
    }
  });

  if (!lead) return null;

  async function handleSave() {
    if (!lead) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/outreach/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, nextAction, nextActionDate, notes }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated(data.lead);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddActivity() {
    if (!lead || !actAction.trim()) return;
    setAddingActivity(true);
    try {
      const res = await fetch(`/api/outreach/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addActivity: {
            channel: actChannel,
            action: actAction,
            notes: actNotes || undefined,
            date: new Date().toISOString(),
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated(data.lead);
        setActAction("");
        setActNotes("");
      }
    } finally {
      setAddingActivity(false);
    }
  }

  async function handleDelete() {
    if (!lead) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/outreach/leads/${lead.id}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted(lead.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-foreground flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-lg font-semibold truncate">{lead.name}</p>
              <p className="text-sm text-muted-foreground font-normal truncate">
                {lead.title} · {lead.firm}
                {lead.firmAum && <span className="text-muted-foreground/60"> · {lead.firmAum}</span>}
              </p>
            </div>
            <Badge
              variant="outline"
              className={`ml-2 shrink-0 ${priorityBadgeClass[lead.priority] ?? ""}`}
            >
              Priority {lead.priority}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-5 pr-4 pb-2">
            {/* Contact info */}
            <div className="flex flex-wrap gap-3 text-sm">
              {lead.email && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {lead.email}
                </span>
              )}
              {lead.linkedinUrl && (
                <a
                  href={lead.linkedinUrl.startsWith("http") ? lead.linkedinUrl : `https://${lead.linkedinUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-electric hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Linkedin className="h-3.5 w-3.5" />
                  LinkedIn
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <span className="flex items-center gap-1 text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                {SEGMENT_LABELS[lead.segment]}
              </span>
            </div>

            {/* Stage + fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stage</label>
                <Select value={stage} onValueChange={(v) => setStage(v as PipelineStage)}>
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
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Next Action Date</label>
                <Input
                  type="date"
                  value={nextActionDate ? nextActionDate.slice(0, 10) : ""}
                  onChange={(e) => setNextActionDate(e.target.value)}
                  className="bg-muted border-border text-sm"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">Next Action</label>
                <Input
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="e.g. Follow up with case study PDF"
                  className="bg-muted border-border text-sm"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="bg-muted border-border resize-none text-sm"
                />
              </div>
            </div>

            {/* Email Templates */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email Templates
              </p>
              <TemplateSelector lead={lead} />
            </div>

            {/* Add Activity */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Add Activity
              </p>
              <div className="flex gap-2">
                <Select value={actChannel} onValueChange={(v) => setActChannel(v as Activity["channel"])}>
                  <SelectTrigger className="w-[130px] bg-muted border-border text-sm shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={actAction}
                  onChange={(e) => setActAction(e.target.value)}
                  placeholder="e.g. Sent connection request"
                  className="bg-muted border-border text-sm flex-1"
                />
                <Button
                  onClick={handleAddActivity}
                  disabled={addingActivity || !actAction.trim()}
                  size="sm"
                  className="bg-electric hover:bg-electric/90 text-white shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                value={actNotes}
                onChange={(e) => setActNotes(e.target.value)}
                placeholder="Optional notes..."
                className="bg-muted border-border text-sm"
              />
            </div>

            {/* Activity timeline */}
            {lead.activities && lead.activities.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Activity Timeline
                </p>
                <div className="space-y-2">
                  {lead.activities.map((act, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm border border-border rounded-md px-3 py-2"
                    >
                      <span className="text-muted-foreground mt-0.5 shrink-0">
                        {channelIcons[act.channel]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground text-xs">{act.action}</p>
                        {act.notes && (
                          <p className="text-muted-foreground text-[11px]">{act.notes}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {formatDate(act.date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 flex items-center justify-between gap-2">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-alert">Confirm delete?</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-alert hover:bg-alert/90 text-white text-xs"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-alert border-alert/30 hover:bg-alert/5"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-electric hover:bg-electric/90 text-white"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
