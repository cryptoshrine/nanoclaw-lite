import { NextResponse } from "next/server";
import { getAnalysis, LEAGUE_KEYS, type LeagueKey } from "@/lib/betting";

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

    const analysis = getAnalysis(league);
    if (!analysis) {
      return NextResponse.json(
        { error: `No analysis data found for ${league}. Run the betting pipeline first.` },
        { status: 404 }
      );
    }
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read analysis data", detail: String(error) },
      { status: 500 }
    );
  }
}
