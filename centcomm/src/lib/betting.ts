/**
 * Betting data access layer — SERVER ONLY.
 * Reads/writes JSON files from the betting analysis output directory.
 * Supports league-specific file reading (EPL, Bundesliga, La Liga).
 *
 * Client components should import types/constants from "@/lib/betting-types" instead.
 */
import fs from "fs";
import path from "path";
import { PATHS } from "./paths";

// Re-export all types and constants so server code can import from either file
export * from "./betting-types";

import type { Analysis, TeamStatsData, OddsInput } from "./betting-types";

// ── League configuration ─────────────────────────────────────────────────

export const LEAGUE_KEYS = ["epl", "bundesliga", "laliga"] as const;
export type LeagueKey = (typeof LEAGUE_KEYS)[number];

export const LEAGUE_NAMES: Record<LeagueKey, string> = {
  epl: "Premier League",
  bundesliga: "Bundesliga",
  laliga: "La Liga",
};

function getLeagueOutputDir(league: LeagueKey = "epl"): string {
  if (league === "epl") {
    return PATHS.bettingOutput;
  }
  return path.join(PATHS.bettingOutput, league);
}

// ── File readers ───────────────────────────────────────────────────────

function readJsonFile<T>(filename: string, league: LeagueKey = "epl"): T | null {
  try {
    const dir = getLeagueOutputDir(league);
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getAnalysis(league: LeagueKey = "epl"): Analysis | null {
  return readJsonFile<Analysis>("latest_analysis.json", league);
}

export function getTeamStats(league: LeagueKey = "epl"): TeamStatsData | null {
  return readJsonFile<TeamStatsData>("team_stats.json", league);
}

export function getOddsInput(league: LeagueKey = "epl"): OddsInput | null {
  return readJsonFile<OddsInput>("odds_input.json", league);
}

export function saveOddsInput(odds: OddsInput, league: LeagueKey = "epl"): void {
  const dir = getLeagueOutputDir(league);
  const filePath = path.join(dir, "odds_input.json");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(odds, null, 2), "utf-8");
}

/**
 * Get list of available leagues (those with analysis data).
 */
export function getAvailableLeagues(): LeagueKey[] {
  const available: LeagueKey[] = [];
  for (const league of LEAGUE_KEYS) {
    const analysis = getAnalysis(league);
    if (analysis) {
      available.push(league);
    }
  }
  // Always include EPL even without data (it's the default)
  if (!available.includes("epl")) {
    available.unshift("epl");
  }
  return available;
}
