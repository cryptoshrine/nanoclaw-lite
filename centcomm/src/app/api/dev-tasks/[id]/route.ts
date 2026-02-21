import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/dev-tasks/[id] — Update a dev task's status and/or summary in its markdown file
 * Body: { source: string, status: "Pending" | "In Progress" | "Completed" | "Blocked", summary?: string }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = parseInt(id);

  try {
    const body = await request.json();
    const { source, status, summary } = body;

    if (!source || !status) {
      return NextResponse.json(
        { error: "Missing required fields: source, status" },
        { status: 400 }
      );
    }

    const validStatuses = ["Pending", "In Progress", "Completed", "Blocked"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Use: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Find the task file in the group's tasks directory
    const tasksDir = path.join(PATHS.groups, source, "tasks");
    if (!fs.existsSync(tasksDir)) {
      return NextResponse.json(
        { error: `Tasks directory not found for group: ${source}` },
        { status: 404 }
      );
    }

    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));

    let updated = false;
    for (const file of files) {
      const filePath = path.join(tasksDir, file);
      let content = fs.readFileSync(filePath, "utf-8");

      // Match "## Task N:" header and find the Status field after it
      const taskHeaderRegex = new RegExp(
        `(## Task ${taskId}:[\\s\\S]*?)(\\*\\*Status:\\*\\*\\s*)(.+)`,
        "m"
      );
      const match = content.match(taskHeaderRegex);

      if (match) {
        // Replace the status value
        const oldStatus = match[3].trim();
        let newStatusText = status;

        // Preserve emoji markers if they existed
        if (status === "Completed" && !oldStatus.includes("✓")) {
          newStatusText = `✓ ${status}`;
        }

        content = content.replace(
          taskHeaderRegex,
          `$1$2${newStatusText}`
        );

        // Update summary if provided
        if (summary) {
          const summaryRegex = new RegExp(
            `(## Task ${taskId}:[\\s\\S]*?)(\\*\\*Summary:\\*\\*\\s*)(.+)`,
            "m"
          );
          if (summaryRegex.test(content)) {
            content = content.replace(summaryRegex, `$1$2${summary}`);
          }
        }

        // If marking as completed, add completion date if not present
        if (status === "Completed") {
          const completedFieldRegex = new RegExp(
            `(## Task ${taskId}:[\\s\\S]*?)(\\*\\*Completed:\\*\\*\\s*)(.+)`,
            "m"
          );
          const today = new Date().toISOString().split("T")[0];
          if (completedFieldRegex.test(content)) {
            content = content.replace(completedFieldRegex, `$1$2${today}`);
          }
        }

        fs.writeFileSync(filePath, content, "utf-8");
        updated = true;
        break;
      }
    }

    if (!updated) {
      return NextResponse.json(
        { error: `Task ${taskId} not found in group ${source}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, taskId, status });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update dev task", detail: String(error) },
      { status: 500 }
    );
  }
}
