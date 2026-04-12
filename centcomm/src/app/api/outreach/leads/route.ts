import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { PipelineData, Lead } from "@/lib/outreach-types";

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

export async function GET() {
  try {
    const data = readPipeline();
    return NextResponse.json({ leads: data.leads, batches: data.batches });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = readPipeline();

    const now = new Date().toISOString();
    const lead: Lead = {
      id: crypto.randomUUID(),
      name: body.name,
      title: body.title,
      firm: body.firm,
      firmAum: body.firmAum,
      segment: body.segment,
      priority: body.priority,
      stage: body.stage ?? "identified",
      email: body.email,
      linkedinUrl: body.linkedinUrl,
      activities: [],
      nextAction: body.nextAction,
      nextActionDate: body.nextActionDate,
      notes: body.notes,
      batch: body.batch,
      createdAt: now,
      updatedAt: now,
    };

    data.leads.push(lead);
    writePipeline(data);

    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
