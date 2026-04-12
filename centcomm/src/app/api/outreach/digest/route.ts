import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { PipelineData, PipelineStage } from "@/lib/outreach-types";
import { STAGE_ORDER } from "@/lib/outreach-types";

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

export async function GET() {
  try {
    const data = readPipeline();
    const leads = data.leads;

    const todayStr = new Date().toISOString().slice(0, 10);

    const dueToday = leads.filter(
      (l) => l.nextActionDate && l.nextActionDate.slice(0, 10) === todayStr
    );

    const overdue = leads.filter(
      (l) => l.nextActionDate && l.nextActionDate.slice(0, 10) < todayStr
    );

    const stageBreakdown = Object.fromEntries(
      STAGE_ORDER.map((s) => [s, 0])
    ) as Record<PipelineStage, number>;

    for (const lead of leads) {
      stageBreakdown[lead.stage] = (stageBreakdown[lead.stage] ?? 0) + 1;
    }

    const totalActive = leads.filter(
      (l) => l.stage !== "won" && l.stage !== "lost"
    ).length;

    const needsAttention = leads.filter(
      (l) => !l.nextActionDate && l.stage !== "won" && l.stage !== "lost"
    );

    return NextResponse.json({
      dueToday,
      overdue,
      stageBreakdown,
      totalActive,
      needsAttention,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
