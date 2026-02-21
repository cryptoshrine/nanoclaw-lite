import { NextResponse } from "next/server";
import { getOddsInput, saveOddsInput, LEAGUE_KEYS, type LeagueKey, type OddsInput } from "@/lib/betting";

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

    const odds = getOddsInput(league);
    return NextResponse.json(odds ?? { fixtures: [] });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read odds data", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = (searchParams.get("league") || "epl") as LeagueKey;

    const body = (await request.json()) as OddsInput;

    if (!body.source || !body.fixtures || !Array.isArray(body.fixtures)) {
      return NextResponse.json(
        { error: "Invalid odds format. Required: source, fixtures[]" },
        { status: 400 }
      );
    }

    // Validate each fixture has markets
    for (const fixture of body.fixtures) {
      if (!fixture.home_team || !fixture.away_team) {
        return NextResponse.json(
          { error: "Each fixture must have home_team and away_team" },
          { status: 400 }
        );
      }
    }

    // Add timestamp and default format
    const odds: OddsInput = {
      source: body.source,
      fetched_at: new Date().toISOString(),
      odds_format: body.odds_format || "decimal",
      fixtures: body.fixtures,
    };

    saveOddsInput(odds, league);

    return NextResponse.json({
      success: true,
      message: `Saved odds for ${body.fixtures.length} fixtures from ${body.source}`,
      fixture_count: body.fixtures.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save odds", detail: String(error) },
      { status: 500 }
    );
  }
}
