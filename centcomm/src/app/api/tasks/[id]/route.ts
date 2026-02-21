import { NextResponse } from "next/server";
import { getTaskRunLogs } from "@/lib/db";
import { pauseTask, resumeTask, cancelTask } from "@/lib/ipc";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const logs = getTaskRunLogs(id);
    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch task logs", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { action } = body;

    let filePath: string;
    switch (action) {
      case "pause":
        filePath = pauseTask(id);
        break;
      case "resume":
        filePath = resumeTask(id);
        break;
      case "cancel":
        filePath = cancelTask(id);
        break;
      default:
        return NextResponse.json(
          { error: "Invalid action. Use: pause, resume, cancel" },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, action, ipcFile: filePath });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update task", detail: String(error) },
      { status: 500 }
    );
  }
}
