"use client";

import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Lead, PipelineStage } from "@/lib/outreach-types";
import { STAGE_ORDER, STAGE_LABELS, STAGE_COLORS } from "@/lib/outreach-types";
import { PipelineColumn } from "./pipeline-column";
import { SortableLead } from "./sortable-lead";
import { LeadCard } from "./lead-card";
import {
  Circle,
  CheckCircle,
  Send,
  Wifi,
  MessageSquare,
  Reply,
  Calendar,
  FileText,
  FileCheck,
  Trophy,
  XCircle,
} from "lucide-react";
import { useState } from "react";

const stageIcons: Record<PipelineStage, React.ReactNode> = {
  identified: <Circle className="h-3 w-3" />,
  verified: <CheckCircle className="h-3 w-3" />,
  connection_sent: <Send className="h-3 w-3" />,
  connected: <Wifi className="h-3 w-3" />,
  message_sent: <MessageSquare className="h-3 w-3" />,
  replied: <Reply className="h-3 w-3" />,
  meeting: <Calendar className="h-3 w-3" />,
  case_study_shared: <FileText className="h-3 w-3" />,
  proposal: <FileCheck className="h-3 w-3" />,
  won: <Trophy className="h-3 w-3" />,
  lost: <XCircle className="h-3 w-3" />,
};

const stageHeaderBg: Record<PipelineStage, string> = {
  identified: "border-border",
  verified: "border-cyan/30",
  connection_sent: "border-electric/30",
  connected: "border-electric/30",
  message_sent: "border-amber/30",
  replied: "border-amber/30",
  meeting: "border-success/30",
  case_study_shared: "border-success/30",
  proposal: "border-success/30",
  won: "border-success/40",
  lost: "border-alert/30",
};

const stageColorClass: Record<PipelineStage, string> = {
  identified: "text-muted-foreground",
  verified: "text-cyan",
  connection_sent: "text-electric",
  connected: "text-electric",
  message_sent: "text-amber",
  replied: "text-amber",
  meeting: "text-success",
  case_study_shared: "text-success",
  proposal: "text-success",
  won: "text-success",
  lost: "text-alert",
};

interface PipelineBoardProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onStageChange: (leadId: string, newStage: PipelineStage) => void;
}

export function PipelineBoard({ leads, onLeadClick, onStageChange }: PipelineBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function getLeadsForStage(stage: PipelineStage) {
    return leads.filter((l) => l.stage === stage);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeIdStr = String(active.id);
    const overId = String(over.id);

    // Find the lead being dragged
    const lead = leads.find((l) => `lead-${l.id}` === activeIdStr);
    if (!lead) return;

    // Determine target stage
    let targetStage: PipelineStage | null = null;

    // Check if dropped on a column
    const colMatch = STAGE_ORDER.find((s) => s === overId);
    if (colMatch) {
      targetStage = colMatch;
    } else {
      // Dropped on another lead card
      const overLead = leads.find((l) => `lead-${l.id}` === overId);
      if (overLead) {
        targetStage = overLead.stage;
      }
    }

    if (targetStage && targetStage !== lead.stage) {
      onStageChange(lead.id, targetStage);
    }
  }

  const activeLead = activeId ? leads.find((l) => `lead-${l.id}` === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-2 overflow-x-auto pb-4 snap-x snap-mandatory" style={{ scrollbarWidth: 'thin' }}>
        {STAGE_ORDER.map((stage) => {
          const colLeads = getLeadsForStage(stage);
          const leadIds = colLeads.map((l) => `lead-${l.id}`);

          return (
            <PipelineColumn
              key={stage}
              id={stage}
              label={STAGE_LABELS[stage]}
              icon={stageIcons[stage]}
              color={stageColorClass[stage]}
              headerBg={stageHeaderBg[stage]}
              items={leadIds}
              count={colLeads.length}
            >
              {colLeads.map((lead) => (
                <SortableLead key={`lead-${lead.id}`} id={`lead-${lead.id}`}>
                  <LeadCard lead={lead} onClick={() => onLeadClick(lead)} />
                </SortableLead>
              ))}
            </PipelineColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeLead ? (
          <div className="opacity-90 rotate-2 scale-105 shadow-2xl shadow-electric/20">
            <LeadCard lead={activeLead} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
