import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";
import { LEAGUE_KEYS, LEAGUE_NAMES, type LeagueKey } from "@/lib/betting";

export const dynamic = "force-dynamic";

/**
 * POST /api/betting/run?league=epl
 *
 * Triggers the betting analysis pipeline by writing an IPC task file.
 * NanoClaw picks this up and runs the agent with the given prompt.
 * Supports league parameter for multi-league analysis.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = (searchParams.get("league") || "epl") as LeagueKey;

    if (!LEAGUE_KEYS.includes(league)) {
      return NextResponse.json(
        { error: `Invalid league. Choose from: ${LEAGUE_KEYS.join(", ")}` },
        { status: 400 }
      );
    }

    const leagueName = LEAGUE_NAMES[league];
    const ipcDir = path.join(PATHS.ipc, "main", "tasks");

    // Ensure IPC directory exists
    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true });
    }

    const taskId = `betting_run_${league}_${Date.now()}`;
    const taskFile = path.join(ipcDir, `${taskId}.json`);

    // Schedule a one-time task to run the betting pipeline
    const now = new Date();
    const runAt = new Date(now.getTime() + 5000); // 5 seconds from now

    const task = {
      type: "schedule_task",
      prompt: [
        `Run the betting analysis pipeline for ${leagueName} with auto-fetched odds.`,
        "",
        "Steps:",
        "1. cd /workspace/group/betting",
        `2. Run: PYTHONPATH=. python run_analysis.py --league ${league} --fetch-odds --bankroll 100`,
        "3. Read the output to check if value bets were found",
        "4. Send a brief WhatsApp summary via send_message:",
        `   - League: ${leagueName}`,
        "   - Number of value bets found",
        "   - Top 3 bets by edge (market, odds, edge%, bookmaker)",
        "   - 'Check the Bet Finder dashboard for full analysis'",
        `5. If no value bets, send: '${leagueName} Bet Finder ran - no value bets detected in current odds. Probabilities updated on dashboard.'`,
        "",
        "Use WhatsApp formatting (*bold*, bullets, no ## headings).",
      ].join("\n"),
      schedule_type: "once",
      schedule_value: runAt.toISOString().replace("Z", ""),
      target_group: "main",
      context_mode: "isolated",
      created_at: now.toISOString(),
    };

    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      message: `${leagueName} betting pipeline run scheduled`,
      task_id: taskId,
      league,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to schedule pipeline run", detail: String(error) },
      { status: 500 }
    );
  }
}
