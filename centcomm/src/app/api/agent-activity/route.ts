/**
 * Agent Activity API — reads real-time progress from agent containers.
 *
 * Each active agent writes a progress.json file to its IPC directory.
 * This endpoint aggregates them across all registered groups.
 */
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getRegisteredGroups } from "@/lib/config";
import { PATHS } from "@/lib/paths";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface AgentProgress {
  groupFolder: string;
  groupName: string;
  sessionId: string;
  status: "running" | "completed" | "error" | "idle";
  startedAt: string;
  lastUpdate: string;
  prompt: string;
  steps: StepInfo[];
  currentStep: string | null;
  logs: LogEntry[];
  error: string | null;
}

interface StepInfo {
  id: number;
  label: string;
  status: "pending" | "in_progress" | "completed";
}

interface LogEntry {
  time: string;
  level: "info" | "debug" | "warn" | "error";
  text: string;
}

function readProgressFile(groupFolder: string): AgentProgress | null {
  const progressPath = path.join(PATHS.ipc, groupFolder, "progress.json");
  try {
    if (!fs.existsSync(progressPath)) return null;
    const raw = fs.readFileSync(progressPath, "utf-8");
    const data = JSON.parse(raw) as AgentProgress;

    // Check if progress is stale (older than 10 minutes = agent probably done)
    const lastUpdate = new Date(data.lastUpdate).getTime();
    const age = Date.now() - lastUpdate;
    if (age > 10 * 60 * 1000) {
      // Mark as completed if it was running
      if (data.status === "running") {
        data.status = "completed";
      }
    }

    return data;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const groups = getRegisteredGroups();
    const db = getDb();

    const activities: AgentProgress[] = [];

    for (const group of groups) {
      const progress = readProgressFile(group.folder);

      if (progress) {
        // Enrich with group name
        progress.groupName = group.name;
        progress.groupFolder = group.folder;
        activities.push(progress);
      } else {
        // No active progress — check last message time for idle status
        const lastMsg = db
          .prepare(
            "SELECT timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 1"
          )
          .get(group.jid) as { timestamp: string } | undefined;

        activities.push({
          groupFolder: group.folder,
          groupName: group.name,
          sessionId: "",
          status: "idle",
          startedAt: "",
          lastUpdate: lastMsg?.timestamp || "",
          prompt: "",
          steps: [],
          currentStep: null,
          logs: [],
          error: null,
        });
      }
    }

    // Sort: running first, then by last update (most recent first)
    activities.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return (
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime()
      );
    });

    return NextResponse.json(activities);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch agent activity", detail: String(error) },
      { status: 500 }
    );
  }
}
