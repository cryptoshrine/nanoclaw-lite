import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

interface ResolvedBet {
  market: string;
  market_key: string;
  our_probability: number;
  implied_probability: number;
  edge_percent: number;
  decimal_odds: number;
  kelly_stake_pct: number;
  confidence: string;
  fixture: string;
  won: boolean;
  date: string;
}

export function GET() {
  try {
    const historyDir = path.join(PATHS.bettingOutput, "history");

    if (!fs.existsSync(historyDir)) {
      return NextResponse.json({ error: "No history data" }, { status: 404 });
    }

    const files = fs.readdirSync(historyDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    const allBets: ResolvedBet[] = [];

    for (const file of files) {
      const date = file.replace(".json", "");
      const raw = fs.readFileSync(path.join(historyDir, file), "utf-8");
      const data = JSON.parse(raw);

      const results = data.results || {};
      for (const fixtureData of Object.values(results) as Array<{ bets?: Array<Record<string, unknown>> }>) {
        const bets = fixtureData.bets || [];
        for (const bet of bets) {
          if (bet.won === null || bet.won === undefined) continue;
          allBets.push({
            market: (bet.market as string) || "",
            market_key: (bet.market_key as string) || "",
            our_probability: (bet.our_probability as number) || 0,
            implied_probability: (bet.implied_probability as number) || 0,
            edge_percent: (bet.edge_percent as number) || 0,
            decimal_odds: (bet.decimal_odds as number) || 1,
            kelly_stake_pct: (bet.kelly_stake_pct as number) || 0,
            confidence: (bet.confidence as string) || "UNKNOWN",
            fixture: (bet.fixture as string) || "",
            won: bet.won as boolean,
            date,
          });
        }
      }
    }

    // Aggregate by date
    const dailyMap = new Map<string, { bets: number; wins: number; profit: number }>();
    for (const bet of allBets) {
      const existing = dailyMap.get(bet.date) || { bets: 0, wins: 0, profit: 0 };
      existing.bets++;
      if (bet.won) {
        existing.wins++;
        existing.profit += bet.decimal_odds - 1;
      } else {
        existing.profit -= 1;
      }
      dailyMap.set(bet.date, existing);
    }

    const dailyPnl = Array.from(dailyMap.entries())
      .map(([date, d]) => ({ date, ...d, profit: Math.round(d.profit * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Cumulative P&L
    let cumulative = 0;
    const cumulativePnl = dailyPnl.map((d) => {
      cumulative += d.profit;
      return { ...d, cumulative: Math.round(cumulative * 100) / 100 };
    });

    // Aggregate by market
    const marketMap = new Map<string, { bets: number; wins: number; profit: number; avgOdds: number; avgEdge: number }>();
    for (const bet of allBets) {
      const key = bet.market_key || bet.market;
      const existing = marketMap.get(key) || { bets: 0, wins: 0, profit: 0, avgOdds: 0, avgEdge: 0 };
      existing.bets++;
      if (bet.won) {
        existing.wins++;
        existing.profit += bet.decimal_odds - 1;
      } else {
        existing.profit -= 1;
      }
      existing.avgOdds += bet.decimal_odds;
      existing.avgEdge += bet.edge_percent;
      marketMap.set(key, existing);
    }

    const marketPnl = Array.from(marketMap.entries())
      .map(([market, m]) => ({
        market,
        bets: m.bets,
        wins: m.wins,
        hit_rate: m.bets > 0 ? Math.round((m.wins / m.bets) * 1000) / 10 : 0,
        roi_pct: m.bets > 0 ? Math.round((m.profit / m.bets) * 10000) / 100 : 0,
        profit: Math.round(m.profit * 100) / 100,
        avg_odds: m.bets > 0 ? Math.round((m.avgOdds / m.bets) * 100) / 100 : 0,
        avg_edge: m.bets > 0 ? Math.round((m.avgEdge / m.bets) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.roi_pct - a.roi_pct);

    // By confidence
    const confMap = new Map<string, { bets: number; wins: number; profit: number }>();
    for (const bet of allBets) {
      const existing = confMap.get(bet.confidence) || { bets: 0, wins: 0, profit: 0 };
      existing.bets++;
      if (bet.won) {
        existing.wins++;
        existing.profit += bet.decimal_odds - 1;
      } else {
        existing.profit -= 1;
      }
      confMap.set(bet.confidence, existing);
    }

    const byConfidence = Array.from(confMap.entries()).map(([conf, c]) => ({
      confidence: conf,
      bets: c.bets,
      wins: c.wins,
      hit_rate: c.bets > 0 ? Math.round((c.wins / c.bets) * 1000) / 10 : 0,
      roi_pct: c.bets > 0 ? Math.round((c.profit / c.bets) * 10000) / 100 : 0,
      profit: Math.round(c.profit * 100) / 100,
    }));

    // Streaks
    const sortedBets = [...allBets].sort((a, b) => a.date.localeCompare(b.date));
    let maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0;
    for (const bet of sortedBets) {
      if (bet.won) {
        curWin++;
        curLoss = 0;
        if (curWin > maxWin) maxWin = curWin;
      } else {
        curLoss++;
        curWin = 0;
        if (curLoss > maxLoss) maxLoss = curLoss;
      }
    }

    // Summary
    const totalBets = allBets.length;
    const totalWins = allBets.filter((b) => b.won).length;
    const totalProfit = allBets.reduce(
      (s, b) => s + (b.won ? b.decimal_odds - 1 : -1),
      0
    );

    return NextResponse.json({
      summary: {
        total_bets: totalBets,
        total_wins: totalWins,
        hit_rate: totalBets > 0 ? Math.round((totalWins / totalBets) * 1000) / 10 : 0,
        total_profit: Math.round(totalProfit * 100) / 100,
        roi_pct: totalBets > 0 ? Math.round((totalProfit / totalBets) * 10000) / 100 : 0,
        longest_win_streak: maxWin,
        longest_loss_streak: maxLoss,
        first_date: dailyPnl[0]?.date || "",
        last_date: dailyPnl[dailyPnl.length - 1]?.date || "",
        days_tracked: dailyPnl.length,
      },
      daily_pnl: cumulativePnl,
      market_pnl: marketPnl,
      by_confidence: byConfidence,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load live performance", detail: String(error) },
      { status: 500 }
    );
  }
}
