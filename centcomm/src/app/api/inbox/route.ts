import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";
import { getRegisteredGroups } from "@/lib/config";

export const dynamic = "force-dynamic";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  message: string;
  inReplyTo: string | null;
  timestamp: string;
  status: "pending" | "processed";
}

export interface GroupInbox {
  folder: string;
  name: string;
  pending: AgentMessage[];
  processed: AgentMessage[];
}

function readInboxDir(dir: string, status: "pending" | "processed"): AgentMessage[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const messages: AgentMessage[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const msg = JSON.parse(raw);
      messages.push({ ...msg, status });
    } catch {
      // skip corrupt files
    }
  }
  // Sort newest first
  return messages.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function GET() {
  try {
    const groups = getRegisteredGroups();
    const result: GroupInbox[] = [];

    for (const group of groups) {
      const inboxDir = path.join(PATHS.ipc, group.folder, "agent-inbox");
      const processedDir = path.join(inboxDir, "processed");

      const pending = readInboxDir(inboxDir, "pending");
      const processed = readInboxDir(processedDir, "processed");

      // Only include groups that have had any inbox activity
      if (pending.length > 0 || processed.length > 0) {
        result.push({
          folder: group.folder,
          name: group.name,
          pending,
          processed,
        });
      }
    }

    // Also include groups with zero messages (so they show in the UI)
    for (const group of groups) {
      if (!result.find((r) => r.folder === group.folder)) {
        result.push({
          folder: group.folder,
          name: group.name,
          pending: [],
          processed: [],
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read inbox", detail: String(error) },
      { status: 500 }
    );
  }
}
