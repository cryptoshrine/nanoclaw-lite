import { NextResponse } from "next/server";
import { getAdmirals } from "@/lib/council";

// GET /api/council/admirals — Get information about all admirals
export async function GET() {
  try {
    const admirals = getAdmirals();
    return NextResponse.json(admirals);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch admirals", detail: String(error) },
      { status: 500 }
    );
  }
}
