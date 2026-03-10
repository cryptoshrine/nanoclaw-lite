import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const backtestDir = path.join(PATHS.bettingOutput, "backtest");

    if (!fs.existsSync(backtestDir)) {
      return NextResponse.json({ backtests: [], gridSearches: [] });
    }

    const files = fs.readdirSync(backtestDir).filter(
      (f) =>
        f.endsWith(".json") &&
        !f.startsWith("historical_odds") &&
        !f.startsWith("goals_grid_checkpoint")
    );

    const backtests = files.map((f) => {
      const name = f.replace(".json", "");
      const stat = fs.statSync(path.join(backtestDir, f));
      const isOos = name.startsWith("oos_");

      let league: string;
      let season: string;
      let label: string;

      if (isOos) {
        const match = name.match(/^oos_(\w+)_(.+)_to_(.+)$/);
        if (match) {
          league = match[1];
          season = `${match[2]}_to_${match[3]}`;
          label = `OoS: ${match[2]} \u2192 ${match[3]}`;
        } else {
          league = "unknown";
          season = name;
          label = name;
        }
      } else {
        const parts = name.split("_");
        league = parts[0];
        season = parts.slice(1).join("-");
        label = season;
      }

      return {
        league,
        season,
        filename: f,
        size_kb: Math.round(stat.size / 1024),
        modified: stat.mtime.toISOString(),
        type: isOos ? ("out_of_sample" as const) : ("in_sample" as const),
        label,
      };
    });

    // Detect grid search JSONL files
    const gridFiles = fs.readdirSync(backtestDir).filter((f) =>
      f.endsWith(".jsonl")
    );
    const gridSearches = gridFiles.map((f) => ({
      filename: f,
      size_kb: Math.round(
        fs.statSync(path.join(backtestDir, f)).size / 1024
      ),
    }));

    return NextResponse.json({ backtests, gridSearches });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list backtests", detail: String(error) },
      { status: 500 }
    );
  }
}
