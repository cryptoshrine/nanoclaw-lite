import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

export interface DevTask {
  id: number;
  title: string;
  status: "Pending" | "In Progress" | "Completed" | "Blocked";
  priority: string;
  size: string;
  added: string;
  completed: string | null;
  summary: string;
  category: string | null;
  dependsOn: string | null;
  keyData: string | null;
  source: string; // which group's task file
}

/**
 * Parse a markdown task list file into structured DevTask objects.
 * Expects format:
 *   ## Task N: Title
 *   **Status:** ...
 *   **Priority:** ...
 *   etc.
 */
function parseTaskFile(content: string, source: string): DevTask[] {
  const tasks: DevTask[] = [];

  // Split on task headers: ## Task N: Title
  const taskBlocks = content.split(/^## Task \d+:/m);

  for (let i = 1; i < taskBlocks.length; i++) {
    const block = taskBlocks[i];
    const lines = block.split("\n");

    // First line is the title (rest of the header after "## Task N:")
    const title = lines[0].trim();

    // Extract fields
    const getField = (name: string): string | null => {
      const regex = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m");
      const match = block.match(regex);
      return match ? match[1].trim() : null;
    };

    const statusRaw = getField("Status") || "Pending";
    let status: DevTask["status"] = "Pending";
    if (statusRaw.includes("Completed") || statusRaw.includes("✓")) {
      status = "Completed";
    } else if (statusRaw.includes("In Progress")) {
      status = "In Progress";
    } else if (statusRaw.includes("Blocked")) {
      status = "Blocked";
    }

    // Extract the task number from original content
    const numMatch = taskBlocks
      .slice(0, i + 1)
      .join("## Task ")
      .match(/## Task (\d+):/g);
    const taskNum = numMatch ? parseInt(numMatch[numMatch.length - 1].match(/\d+/)![0]) : i;

    // Extract summary - look for the **Summary:** field or take first paragraph after fields
    let summary = getField("Summary") || "";
    if (!summary) {
      // Try to find summary in the block text after the metadata fields
      const summaryMatch = block.match(
        new RegExp("\\*\\*Summary:\\*\\*\\s*\\n([\\s\\S]+?)(?=\\n\\n|\\n\\*\\*|---)")
      );
      if (summaryMatch) {
        summary = summaryMatch[1].trim();
      }
    }

    tasks.push({
      id: taskNum,
      title,
      status,
      priority: getField("Priority") || "Medium",
      size: getField("Size") || "",
      added: getField("Added") || "",
      completed: getField("Completed") || null,
      summary,
      category: getField("Category") || null,
      dependsOn: getField("Depends on") || null,
      keyData: getField("Key data") || null,
      source,
    });
  }

  return tasks;
}

export async function GET() {
  try {
    const allTasks: DevTask[] = [];

    // Scan all group directories for task files
    const groupsDir = PATHS.groups;
    if (fs.existsSync(groupsDir)) {
      const groups = fs.readdirSync(groupsDir, { withFileTypes: true });

      for (const group of groups) {
        if (!group.isDirectory()) continue;

        const tasksDir = path.join(groupsDir, group.name, "tasks");
        if (!fs.existsSync(tasksDir)) continue;

        const files = fs.readdirSync(tasksDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const filePath = path.join(tasksDir, file);
          const content = fs.readFileSync(filePath, "utf-8");
          const tasks = parseTaskFile(content, group.name);
          allTasks.push(...tasks);
        }
      }
    }

    return NextResponse.json({ tasks: allTasks });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to parse dev tasks", detail: String(error) },
      { status: 500 }
    );
  }
}
