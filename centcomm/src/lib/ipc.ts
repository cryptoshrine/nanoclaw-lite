import fs from "fs";
import path from "path";
import { PATHS } from "./paths";

// ── IPC Writer ──────────────────────────────────────────────────────────
// Writes task/message files to NanoClaw's IPC directory.
// NanoClaw watches per-group namespaced directories: data/ipc/{groupFolder}/{type}/
// Files MUST be written to the correct group subdirectory to be picked up.

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Write an IPC file to a global subdirectory (e.g. tasks, teams). */
function writeIpcFile(subdir: string, filename: string, data: object) {
  const dir = path.join(PATHS.ipc, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/** Write an IPC file to a group-namespaced subdirectory (e.g. {group}/messages). */
function writeGroupIpcFile(groupFolder: string, subdir: string, filename: string, data: object) {
  const dir = path.join(PATHS.ipc, groupFolder, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/**
 * Resolve a group folder name to its WhatsApp JID.
 * Reads registered_groups.json where keys are JIDs and values have { folder }.
 */
function resolveGroupJid(groupFolder: string): string | null {
  try {
    const raw = fs.readFileSync(PATHS.registeredGroups, "utf-8");
    const groups = JSON.parse(raw) as Record<string, { folder: string }>;
    for (const [jid, group] of Object.entries(groups)) {
      if (group.folder === groupFolder) return jid;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Task operations ─────────────────────────────────────────────────────

export interface ScheduleTaskParams {
  prompt: string;
  schedule_type: "cron" | "interval" | "once";
  schedule_value: string;
  target_group?: string;
  context_mode?: "group" | "isolated";
}

/**
 * Schedule a task via IPC. Routes to the target group's IPC directory
 * (defaults to "main" if no target_group specified).
 */
export function scheduleTask(params: ScheduleTaskParams): string {
  const groupFolder = params.target_group || "main";
  const filename = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  const data = {
    type: "schedule_task",
    ...params,
    created_at: new Date().toISOString(),
  };
  return writeGroupIpcFile(groupFolder, "tasks", filename, data);
}

export function pauseTask(taskId: string, groupFolder = "main"): string {
  const filename = `pause_${Date.now()}.json`;
  const data = {
    type: "pause_task",
    task_id: taskId,
    created_at: new Date().toISOString(),
  };
  return writeGroupIpcFile(groupFolder, "tasks", filename, data);
}

export function resumeTask(taskId: string, groupFolder = "main"): string {
  const filename = `resume_${Date.now()}.json`;
  const data = {
    type: "resume_task",
    task_id: taskId,
    created_at: new Date().toISOString(),
  };
  return writeGroupIpcFile(groupFolder, "tasks", filename, data);
}

export function cancelTask(taskId: string, groupFolder = "main"): string {
  const filename = `cancel_${Date.now()}.json`;
  const data = {
    type: "cancel_task",
    task_id: taskId,
    created_at: new Date().toISOString(),
  };
  return writeGroupIpcFile(groupFolder, "tasks", filename, data);
}

export interface EditTaskParams {
  task_id: string;
  prompt?: string;
  schedule_type?: "cron" | "interval" | "once";
  schedule_value?: string;
  context_mode?: "group" | "isolated";
}

export function editTask(params: EditTaskParams, groupFolder = "main"): string {
  const filename = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  const data = {
    type: "edit_task",
    ...params,
    created_at: new Date().toISOString(),
  };
  return writeGroupIpcFile(groupFolder, "tasks", filename, data);
}

// ── Message operations ──────────────────────────────────────────────────

export interface SendMessageParams {
  text: string;
  target_group: string;
}

/**
 * Send a message via IPC to a specific group.
 * Writes to data/ipc/{groupFolder}/messages/ with the format NanoClaw expects:
 *   { type: "message", chatJid: "...", text: "...", groupFolder: "..." }
 */
export function sendMessage(params: SendMessageParams): string {
  const chatJid = resolveGroupJid(params.target_group);
  if (!chatJid) {
    throw new Error(`Cannot resolve JID for group folder: ${params.target_group}`);
  }

  const filename = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  const data = {
    type: "message",
    chatJid,
    text: params.text,
    groupFolder: params.target_group,
    timestamp: new Date().toISOString(),
    source: "centcomm",
  };
  return writeGroupIpcFile(params.target_group, "messages", filename, data);
}

// ── Steering operations ────────────────────────────────────────────────

export interface SteerAgentParams {
  groupFolder: string;
  command: string;
}

/**
 * Send a steering command to a running agent.
 * Routes as a regular message through the group's IPC messages directory,
 * which NanoClaw delivers to the Telegram/WhatsApp group. The agent sees
 * it as a user message on its next turn.
 */
export function steerAgent(params: SteerAgentParams): string {
  const chatJid = resolveGroupJid(params.groupFolder);
  if (!chatJid) {
    throw new Error(`Cannot resolve JID for group folder: ${params.groupFolder}`);
  }

  const filename = `steer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  const data = {
    type: "message",
    chatJid,
    text: `[CENTCOMM Steering] ${params.command}`,
    groupFolder: params.groupFolder,
    timestamp: new Date().toISOString(),
    source: "centcomm-steering",
  };
  return writeGroupIpcFile(params.groupFolder, "messages", filename, data);
}

// ── Team operations ─────────────────────────────────────────────────────

export interface CreateTeamParams {
  name: string;
}

export function createTeam(params: CreateTeamParams): string {
  const filename = `team_${Date.now()}.json`;
  const data = {
    type: "create_team",
    ...params,
    created_at: new Date().toISOString(),
  };
  return writeIpcFile("teams", filename, data);
}

export interface SpawnTeammateParams {
  team_id: string;
  name: string;
  prompt: string;
  model?: string;
}

export function spawnTeammate(params: SpawnTeammateParams): string {
  const filename = `teammate_${Date.now()}.json`;
  const data = {
    type: "spawn_teammate",
    ...params,
    created_at: new Date().toISOString(),
  };
  return writeIpcFile("teams", filename, data);
}

export interface SendTeamMessageParams {
  team_id: string;
  content: string;
  to_member?: string;
}

export function sendTeamMessage(params: SendTeamMessageParams): string {
  const filename = `team_msg_${Date.now()}.json`;
  const data = {
    type: "send_team_message",
    ...params,
    created_at: new Date().toISOString(),
  };
  return writeIpcFile("teams", filename, data);
}
