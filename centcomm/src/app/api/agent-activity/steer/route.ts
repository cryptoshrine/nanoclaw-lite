/**
 * Steering Command API — sends real-time direction to running agents.
 *
 * Routes the command as a message through NanoClaw's IPC message pipeline,
 * which delivers it to the group's chat. The agent sees it as a user message.
 */
import { NextResponse } from "next/server";
import { steerAgent } from "@/lib/ipc";

export const dynamic = "force-dynamic";

interface SteerRequest {
  groupFolder: string;
  command: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SteerRequest;

    if (!body.groupFolder || !body.command) {
      return NextResponse.json(
        { error: "Missing groupFolder or command" },
        { status: 400 }
      );
    }

    const filePath = steerAgent({
      groupFolder: body.groupFolder,
      command: body.command,
    });

    return NextResponse.json({
      success: true,
      message: `Steering command sent to ${body.groupFolder}`,
      ipcFile: filePath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to send steering command", detail: String(error) },
      { status: 500 }
    );
  }
}
