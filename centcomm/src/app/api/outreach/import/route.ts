import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { Lead, PipelineData, Activity } from "@/lib/outreach-types";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "..", "groups", "main", "pe-vc-outreach");
const PIPELINE_FILE = path.join(DATA_DIR, "pipeline.json");

const BASECASEDD_LEADS_URL = "https://basecasedd.com/api/case-study-lead";

interface InboundLead {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  source: string;
  timestamp: string;
  receivedAt: string;
}

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
  return JSON.parse(readFileSync(PIPELINE_FILE, "utf-8")) as PipelineData;
}

function writePipeline(data: PipelineData) {
  ensureDataDir();
  data.updatedAt = new Date().toISOString();
  writeFileSync(PIPELINE_FILE, JSON.stringify(data, null, 2));
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function mapInboundToPipelineLead(inbound: InboundLead): Lead {
  const now = new Date().toISOString();
  const activity: Activity = {
    date: inbound.receivedAt ?? inbound.timestamp ?? now,
    channel: "other",
    action: "Accessed MedFlow case study via NDA gate",
  };

  return {
    id: crypto.randomUUID(),
    name: inbound.name || "Unknown",
    title: inbound.role || "Unknown",
    firm: inbound.company || "Unknown",
    segment: "pe",
    priority: "A",
    stage: "case_study_shared",
    email: inbound.email || undefined,
    activities: [activity],
    nextAction: "Follow up on case study and propose next steps",
    nextActionDate: addDays(3),
    notes: "Source: Case study gate form. NDA acknowledged.",
    batch: "inbound-case-study",
    createdAt: now,
    updatedAt: now,
  };
}

// GET — fetch + preview inbound leads without importing
export async function GET() {
  try {
    const res = await fetch(BASECASEDD_LEADS_URL, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `basecasedd.com returned ${res.status}` },
        { status: 502 }
      );
    }

    const json = (await res.json()) as { leads: InboundLead[] };
    const inbound: InboundLead[] = json.leads ?? [];

    const pipeline = readPipeline();
    const existingEmails = new Set(pipeline.leads.map((l) => l.email?.toLowerCase()).filter(Boolean));

    const newLeads = inbound.filter(
      (l) => l.email && !existingEmails.has(l.email.toLowerCase())
    );

    return NextResponse.json({
      total: inbound.length,
      new: newLeads.length,
      duplicates: inbound.length - newLeads.length,
      preview: newLeads,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — actually import new inbound leads into pipeline
export async function POST() {
  try {
    const res = await fetch(BASECASEDD_LEADS_URL, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `basecasedd.com returned ${res.status}` },
        { status: 502 }
      );
    }

    const json = (await res.json()) as { leads: InboundLead[] };
    const inbound: InboundLead[] = json.leads ?? [];

    const pipeline = readPipeline();
    const existingEmails = new Set(pipeline.leads.map((l) => l.email?.toLowerCase()).filter(Boolean));

    const newLeads = inbound
      .filter((l) => l.email && !existingEmails.has(l.email.toLowerCase()))
      .map(mapInboundToPipelineLead);

    if (newLeads.length === 0) {
      return NextResponse.json({
        imported: 0,
        message: "No new leads to import — all already in pipeline",
      });
    }

    // Ensure the inbound-case-study batch exists
    const batchId = "inbound-case-study";
    const existingBatch = pipeline.batches.find((b) => b.id === batchId);
    if (existingBatch) {
      existingBatch.leadIds.push(...newLeads.map((l) => l.id));
    } else {
      pipeline.batches.push({
        id: batchId,
        name: "Inbound — Case Study Gate",
        createdAt: new Date().toISOString(),
        leadIds: newLeads.map((l) => l.id),
      });
    }

    pipeline.leads.push(...newLeads);
    writePipeline(pipeline);

    return NextResponse.json({
      imported: newLeads.length,
      skipped: inbound.length - newLeads.length,
      leads: newLeads,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
