import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { PipelineData, PipelineStage, Segment } from "@/lib/outreach-types";
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

    // Count by stage
    const countByStage = Object.fromEntries(
      STAGE_ORDER.map((s) => [s, 0])
    ) as Record<PipelineStage, number>;

    // Count by segment
    const countBySegment: Record<Segment, number> = {
      pe: 0,
      corp_ma: 0,
      lp: 0,
      family_office: 0,
    };

    for (const lead of leads) {
      countByStage[lead.stage] = (countByStage[lead.stage] ?? 0) + 1;
      countBySegment[lead.segment] = (countBySegment[lead.segment] ?? 0) + 1;
    }

    const connectionSent = countByStage.connection_sent;
    const connected = countByStage.connected;
    const messageSent = countByStage.message_sent;
    const replied = countByStage.replied;

    const connectionTotal = connectionSent + connected;
    const connectionRate = connectionTotal > 0 ? Math.round((connected / connectionTotal) * 100) : 0;

    const messageTotal = messageSent + replied;
    const replyRate = messageTotal > 0 ? Math.round((replied / messageTotal) * 100) : 0;

    const meetingStages: PipelineStage[] = ["meeting", "case_study_shared", "proposal", "won"];
    const meetingsBooked = meetingStages.reduce((acc, s) => acc + (countByStage[s] ?? 0), 0);

    return NextResponse.json({
      countByStage,
      countBySegment,
      totalLeads: leads.length,
      connectionRate,
      replyRate,
      meetingsBooked,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
