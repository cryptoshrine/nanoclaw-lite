import { NextRequest, NextResponse } from "next/server";
import { getAllSummaries, getDailyLog, searchLogs } from "@/lib/daily";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const query = searchParams.get("q");
  const project = searchParams.get("project");

  try {
    // Search mode
    if (query) {
      const results = searchLogs(query, project ?? undefined);
      return NextResponse.json({ results });
    }

    // Single day
    if (date) {
      const log = getDailyLog(date);
      if (!log) {
        return NextResponse.json({ error: "Log not found" }, { status: 404 });
      }
      return NextResponse.json({ log });
    }

    // List all summaries
    const summaries = getAllSummaries();
    return NextResponse.json({ summaries });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
