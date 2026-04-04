import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), "..", "data", "omx-workflows");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // active, completed, failed, all

  try {
    if (!fs.existsSync(WORKFLOWS_DIR)) {
      return NextResponse.json({ workflows: [] });
    }

    const files = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));

    const workflows = [];
    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf-8")
        );
        if (!status || status === "all" || data.status === status) {
          workflows.push({
            id: data.id,
            taskDescription: data.taskDescription,
            status: data.status,
            mode: data.mode || "workflow",
            steps: data.steps?.length || 0,
            completedSteps:
              data.steps?.filter(
                (s: Record<string, unknown>) => s.status === "completed"
              ).length || 0,
            failedSteps:
              data.steps?.filter(
                (s: Record<string, unknown>) => s.status === "failed"
              ).length || 0,
            specialistsSpawned: data.specialistsSpawned,
            currentStepIndex: data.currentStepIndex,
            branch: data.branch,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            completedAt: data.completedAt,
          });
        }
      } catch {
        /* skip corrupt files */
      }
    }

    // Sort by updatedAt descending (most recent first)
    workflows.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return NextResponse.json({ workflows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
