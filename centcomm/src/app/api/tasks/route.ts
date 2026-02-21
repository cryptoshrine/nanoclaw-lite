import { NextResponse } from "next/server";
import { getAllTasks, getRecentTaskRuns } from "@/lib/db";
import { scheduleTask } from "@/lib/ipc";

export async function GET() {
  try {
    const tasks = getAllTasks();
    const recentRuns = getRecentTaskRuns(50);
    return NextResponse.json({ tasks, recentRuns });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch tasks", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, schedule_type, schedule_value, target_group, context_mode } = body;

    if (!prompt || !schedule_type || !schedule_value) {
      return NextResponse.json(
        { error: "Missing required fields: prompt, schedule_type, schedule_value" },
        { status: 400 }
      );
    }

    const filePath = scheduleTask({
      prompt,
      schedule_type,
      schedule_value,
      target_group,
      context_mode,
    });

    return NextResponse.json({ success: true, ipcFile: filePath });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to schedule task", detail: String(error) },
      { status: 500 }
    );
  }
}
