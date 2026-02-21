import { NextResponse } from "next/server";
import { getAvailableLeagues, LEAGUE_NAMES } from "@/lib/betting";

export const dynamic = "force-dynamic";

/**
 * GET /api/betting/leagues
 *
 * Returns available leagues and their display names.
 */
export function GET() {
  try {
    const available = getAvailableLeagues();
    const leagues = available.map((key) => ({
      key,
      name: LEAGUE_NAMES[key],
    }));

    return NextResponse.json({ leagues });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get leagues", detail: String(error) },
      { status: 500 }
    );
  }
}
