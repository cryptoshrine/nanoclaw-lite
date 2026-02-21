import { NextResponse } from "next/server";
import { getTeamStats, LEAGUE_KEYS, type LeagueKey } from "@/lib/betting";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = (searchParams.get("league") || "epl") as LeagueKey;

    if (!LEAGUE_KEYS.includes(league)) {
      return NextResponse.json(
        { error: `Invalid league. Choose from: ${LEAGUE_KEYS.join(", ")}` },
        { status: 400 }
      );
    }

    const stats = getTeamStats(league);
    if (!stats) {
      return NextResponse.json(
        { error: `No team stats found for ${league}. Run the betting pipeline first.` },
        { status: 404 }
      );
    }
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read team stats", detail: String(error) },
      { status: 500 }
    );
  }
}
