import { NextResponse } from "next/server";
import { searchMemory } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    const results = searchMemory(query.trim(), limit);
    return NextResponse.json({ query, results, count: results.length });
  } catch (error) {
    return NextResponse.json(
      { error: "Search failed", detail: String(error) },
      { status: 500 }
    );
  }
}
