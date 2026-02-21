import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  listCouncilSessions,
  saveCouncilSession,
} from "@/lib/council";
import type { CouncilSessionFull } from "@/lib/council";
import { PATHS } from "@/lib/paths";
import { randomUUID } from "crypto";

// GET /api/council — List all council sessions
export async function GET() {
  try {
    const sessions = listCouncilSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch council sessions", detail: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/council — Start a new council session
// Creates the session record and triggers the council orchestrator via IPC.
// NanoClaw picks up the IPC file and runs the actual multi-LLM debate.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic } = body;

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing required field: topic" },
        { status: 400 }
      );
    }

    const sessionId = randomUUID();

    // Create a new session in "active" state
    const session: CouncilSessionFull = {
      id: sessionId,
      topic: topic.trim(),
      status: "active",
      phase: "opening",
      messages: [],
      finalPlan: null,
      votes: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };

    // Save the initial session to disk
    saveCouncilSession(session);

    // Trigger the council via IPC — NanoClaw watches this directory
    const ipcDir = path.join(PATHS.ipc, "council");
    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true });
    }

    const filename = `council_${Date.now()}_${sessionId.slice(0, 8)}.json`;
    fs.writeFileSync(
      path.join(ipcDir, filename),
      JSON.stringify({
        type: "run_council",
        session_id: sessionId,
        topic: topic.trim(),
        created_at: new Date().toISOString(),
      }),
      "utf-8"
    );

    return NextResponse.json({
      success: true,
      sessionId,
      message: "Council session started. The admirals are deliberating...",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start council session", detail: String(error) },
      { status: 500 }
    );
  }
}
