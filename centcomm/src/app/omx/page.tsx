"use client";

import { useState } from "react";
import { WorkflowList } from "@/components/omx/workflow-list";
import { WorkflowDetail } from "@/components/omx/workflow-detail";
import { EventTimeline } from "@/components/omx/event-timeline";
import { OmxStats } from "@/components/omx/omx-stats";

export default function OmxPage() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">OmX Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Autonomous workflow orchestration
          </p>
        </div>
      </div>

      <OmxStats />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <WorkflowList
            selectedId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
          />
        </div>
        <div className="lg:col-span-2 space-y-6">
          {selectedWorkflowId ? (
            <>
              <WorkflowDetail workflowId={selectedWorkflowId} />
              <EventTimeline workflowId={selectedWorkflowId} />
            </>
          ) : (
            <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground">
              Select a workflow to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
