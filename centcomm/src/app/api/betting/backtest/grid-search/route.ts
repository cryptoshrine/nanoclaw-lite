import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import readline from "readline";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

interface GridBet {
  match_id: number;
  match_date: string;
  market_key: string;
  predicted_prob: number;
  decimal_odds: number;
  edge_pct: number;
  won: boolean;
}

interface GridComboRaw {
  combo_idx: number;
  params: {
    lambda_boost: number;
    rho: number;
    home_advantage: number;
    min_edge: number;
    regression_weight: number;
  };
  bets: GridBet[];
}

export async function GET() {
  try {
    const backtestDir = path.join(PATHS.bettingOutput, "backtest");
    const jsonlFiles = fs.readdirSync(backtestDir).filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) {
      return NextResponse.json({ error: "No grid search data found" }, { status: 404 });
    }

    const filePath = path.join(backtestDir, jsonlFiles[0]);
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const results: Array<{
      combo_idx: number;
      params: GridComboRaw["params"];
      bet_count: number;
      win_count: number;
      hit_rate: number;
      roi_pct: number;
      profit: number;
      market_breakdown: Record<string, { bets: number; wins: number; roi_pct: number; profit: number }>;
    }> = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const combo: GridComboRaw = JSON.parse(line);
        const bets = combo.bets;
        const betCount = bets.length;
        const winCount = bets.filter((b) => b.won).length;

        // Calculate P&L (flat staking, 1 unit per bet)
        let profit = 0;
        const marketMap = new Map<string, { bets: number; wins: number; profit: number }>();

        for (const bet of bets) {
          const betProfit = bet.won ? bet.decimal_odds - 1 : -1;
          profit += betProfit;

          const existing = marketMap.get(bet.market_key) || { bets: 0, wins: 0, profit: 0 };
          existing.bets++;
          if (bet.won) existing.wins++;
          existing.profit += betProfit;
          marketMap.set(bet.market_key, existing);
        }

        const roi = betCount > 0 ? (profit / betCount) * 100 : 0;

        const marketBreakdown: Record<string, { bets: number; wins: number; roi_pct: number; profit: number }> = {};
        for (const [key, m] of marketMap) {
          marketBreakdown[key] = {
            bets: m.bets,
            wins: m.wins,
            roi_pct: m.bets > 0 ? (m.profit / m.bets) * 100 : 0,
            profit: Math.round(m.profit * 100) / 100,
          };
        }

        results.push({
          combo_idx: combo.combo_idx,
          params: combo.params,
          bet_count: betCount,
          win_count: winCount,
          hit_rate: betCount > 0 ? (winCount / betCount) * 100 : 0,
          roi_pct: Math.round(roi * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          market_breakdown: marketBreakdown,
        });
      } catch {
        // Skip malformed lines
      }
    }

    // Sort by ROI descending
    results.sort((a, b) => b.roi_pct - a.roi_pct);

    const roiValues = results.map((r) => r.roi_pct).sort((a, b) => a - b);
    const medianRoi = roiValues.length > 0
      ? roiValues[Math.floor(roiValues.length / 2)]
      : 0;

    const summary = {
      total_combos: results.length,
      profitable_combos: results.filter((r) => r.roi_pct > 0).length,
      mean_roi: results.length > 0
        ? Math.round((results.reduce((s, r) => s + r.roi_pct, 0) / results.length) * 100) / 100
        : 0,
      median_roi: Math.round(medianRoi * 100) / 100,
      best_roi: results.length > 0 ? results[0].roi_pct : 0,
      worst_roi: results.length > 0 ? results[results.length - 1].roi_pct : 0,
      results,
    };

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to aggregate grid search", detail: String(error) },
      { status: 500 }
    );
  }
}
