export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { parseEngagementLog } from "@/lib/distribution";
import { CHANNELS, GROWTH_TARGETS } from "@/lib/distribution-types";

export function GET() {
  try {
    const xDashboard = parseEngagementLog();

    return NextResponse.json({
      channels: CHANNELS,
      xDashboard,
      growthTargets: GROWTH_TARGETS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load distribution overview", detail: String(error) },
      { status: 500 }
    );
  }
}
