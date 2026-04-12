import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { PipelineData, Activity } from "@/lib/outreach-types";
import { STAGE_CADENCES } from "@/lib/outreach-types";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "..", "groups", "main", "pe-vc-outreach");
const PIPELINE_FILE = path.join(DATA_DIR, "pipeline.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readPipeline(): PipelineData {
  ensureDataDir();
  if (!existsSync(PIPELINE_FILE)) {
    const empty: PipelineData = { leads: [], batches: [], updatedAt: new Date().toISOString() };
    writeFileSync(PIPELINE_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(PIPELINE_FILE, "utf-8"));
}

function writePipeline(data: PipelineData) {
  ensureDataDir();
  data.updatedAt = new Date().toISOString();
  writeFileSync(PIPELINE_FILE, JSON.stringify(data, null, 2));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = readPipeline();
    const lead = data.leads.find((l) => l.id === id);
    if (!lead) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ lead });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data = readPipeline();

    const idx = data.leads.findIndex((l) => l.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const lead = { ...data.leads[idx] };

    // Handle addActivity
    if (body.addActivity) {
      const activity: Activity = {
        date: body.addActivity.date ?? new Date().toISOString(),
        channel: body.addActivity.channel,
        action: body.addActivity.action,
        notes: body.addActivity.notes,
      };
      lead.activities = [activity, ...(lead.activities ?? [])];
      delete body.addActivity;
    }

    // Track if stage is changing for auto follow-up + activity logging
    const oldStage = lead.stage;
    const newStage = body.stage as typeof lead.stage | undefined;
    const stageChanging = newStage !== undefined && newStage !== oldStage;

    // Apply other field updates
    const allowedFields = [
      "name", "title", "firm", "firmAum", "segment", "priority", "stage",
      "email", "linkedinUrl", "nextAction", "nextActionDate", "notes", "batch",
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lead as any)[field] = body[field];
      }
    }

    // Auto follow-up scheduling when stage changes
    if (stageChanging && newStage) {
      const cadence = STAGE_CADENCES[newStage];
      // Only auto-set if the request didn't explicitly provide these fields
      if (cadence !== null) {
        if (body.nextAction === undefined) {
          lead.nextAction = cadence.action;
        }
        if (body.nextActionDate === undefined) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + cadence.days);
          lead.nextActionDate = dueDate.toISOString().slice(0, 10);
        }
      } else {
        // won / lost — clear next action if not explicitly set
        if (body.nextAction === undefined) lead.nextAction = undefined;
        if (body.nextActionDate === undefined) lead.nextActionDate = undefined;
      }

      // Auto-log stage change activity
      const stageActivity: Activity = {
        date: new Date().toISOString(),
        channel: "other",
        action: `Stage changed from ${oldStage.replace(/_/g, " ")} to ${newStage.replace(/_/g, " ")}`,
      };
      lead.activities = [stageActivity, ...(lead.activities ?? [])];
    }

    lead.updatedAt = new Date().toISOString();
    data.leads[idx] = lead;
    writePipeline(data);

    return NextResponse.json({ lead });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = readPipeline();

    const idx = data.leads.findIndex((l) => l.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    data.leads.splice(idx, 1);
    writePipeline(data);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
