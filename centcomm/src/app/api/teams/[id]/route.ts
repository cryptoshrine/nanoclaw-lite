import { NextResponse } from "next/server";
import { getTeamMembers, getTeamTasks, getTeamMessages } from "@/lib/db";
import { spawnTeammate, sendTeamMessage } from "@/lib/ipc";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const members = getTeamMembers(id);
    const tasks = getTeamTasks(id);
    const messages = getTeamMessages(id);
    return NextResponse.json({ members, tasks, messages });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch team details", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "spawn_teammate") {
      const { name, prompt, model } = body;
      if (!name || !prompt) {
        return NextResponse.json(
          { error: "Missing required fields: name, prompt" },
          { status: 400 }
        );
      }
      const filePath = spawnTeammate({ team_id: id, name, prompt, model });
      return NextResponse.json({ success: true, action, ipcFile: filePath });
    }

    if (action === "send_message") {
      const { content, to_member } = body;
      if (!content) {
        return NextResponse.json(
          { error: "Missing required field: content" },
          { status: 400 }
        );
      }
      const filePath = sendTeamMessage({ team_id: id, content, to_member });
      return NextResponse.json({ success: true, action, ipcFile: filePath });
    }

    return NextResponse.json(
      { error: "Invalid action. Use: spawn_teammate, send_message" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to perform team action", detail: String(error) },
      { status: 500 }
    );
  }
}
