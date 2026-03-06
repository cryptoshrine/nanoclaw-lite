export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getWaitlistStats } from "@/lib/distribution";

export async function GET() {
  try {
    const stats = await getWaitlistStats();

    if (!stats) {
      return NextResponse.json({
        totalSignups: 0,
        spotsRemaining: 100,
        totalSpots: 100,
        error: "Could not reach Ball-AI API — showing cached or default data",
      });
    }

    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch waitlist stats", detail: String(error) },
      { status: 500 }
    );
  }
}
