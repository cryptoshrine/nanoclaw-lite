import { NextResponse } from "next/server";
import { getRecentActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "30", 10);

    const activity = getRecentActivity(Math.min(limit, 100));
    return NextResponse.json(activity);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch activity", detail: String(error) },
      { status: 500 }
    );
  }
}
