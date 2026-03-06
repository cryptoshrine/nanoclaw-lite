export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getContentCalendar } from "@/lib/distribution";

export function GET() {
  try {
    const entries = getContentCalendar();
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load content calendar", detail: String(error) },
      { status: 500 }
    );
  }
}
