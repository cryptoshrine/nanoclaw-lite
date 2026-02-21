import { NextResponse } from "next/server";
import { getCouncilSession } from "@/lib/council";

// GET /api/council/[id] — Get a specific council session with all messages
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getCouncilSession(id);

    if (!session) {
      return NextResponse.json(
        { error: "Council session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch council session", detail: String(error) },
      { status: 500 }
    );
  }
}
