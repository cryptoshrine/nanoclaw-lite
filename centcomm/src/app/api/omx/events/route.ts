import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), "..", "data", "omx-workflows");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get("workflowId");
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!workflowId) {
    return NextResponse.json(
      { error: "workflowId required" },
      { status: 400 }
    );
  }

  try {
    const eventsPath = path.join(WORKFLOWS_DIR, workflowId, "events.jsonl");
    if (!fs.existsSync(eventsPath)) {
      return NextResponse.json({ events: [] });
    }

    const raw = fs.readFileSync(eventsPath, "utf-8");
    let events = raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (type) {
      events = events.filter(
        (e: Record<string, unknown>) => e.type === type
      );
    }

    // Return most recent first, limited
    events = events.reverse().slice(0, limit);

    return NextResponse.json({ events, total: events.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
