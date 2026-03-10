import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = searchParams.get("league") || "epl";
    const season = searchParams.get("season") || "2024-25";
    const filename = searchParams.get("filename");

    const backtestDir = path.join(PATHS.bettingOutput, "backtest");

    // If a specific filename is provided, load that directly
    let filePath: string;
    if (filename) {
      // Sanitize: only allow alphanumeric, dash, underscore, dot
      const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, "");
      filePath = path.join(backtestDir, safe);
    } else {
      filePath = path.join(backtestDir, `${league}_${season}.json`);
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "No backtest data found", league, season },
        { status: 404 }
      );
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load backtest data", detail: String(error) },
      { status: 500 }
    );
  }
}
