export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCreators } from "@/lib/distribution";

export function GET() {
  try {
    const creators = getCreators();
    return NextResponse.json({ creators, total: creators.length });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load creator data", detail: String(error) },
      { status: 500 }
    );
  }
}
