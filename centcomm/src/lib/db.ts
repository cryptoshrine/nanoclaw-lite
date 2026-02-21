import Database from "better-sqlite3";
import { PATHS } from "./paths";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(PATHS.database, { readonly: true });
    // WAL mode is set by NanoClaw's writer — we just need busy_timeout for read access
    _db.pragma("busy_timeout = 5000");
  }
  return _db;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface DbMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

export interface DbScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
  context_mode: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
}

export interface DbTaskRunLog {
  id: number;
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

export interface DbTeam {
  id: string;
  name: string;
  lead_group: string;
  status: string;
  created_at: string;
}

export interface DbTeamMember {
  id: string;
  team_id: string;
  name: string;
  model: string;
  role: string;
  status: string;
  container_id: string | null;
  session_id: string | null;
  prompt: string;
  created_at: string;
}

export interface DbTeamTask {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  depends_on: string | null;
  priority: number;
  created_at: string;
  completed_at: string | null;
}

export interface DbTeamMessage {
  id: number;
  team_id: string;
  from_member: string;
  to_member: string | null;
  content: string;
  read: number;
  created_at: string;
}

// ── Queries ────────────────────────────────────────────────────────────

export function getSystemStats() {
  const db = getDb();

  const messageCount = db
    .prepare("SELECT COUNT(*) as count FROM messages")
    .get() as { count: number };

  const taskCounts = db
    .prepare(
      "SELECT status, COUNT(*) as count FROM scheduled_tasks GROUP BY status"
    )
    .all() as { status: string; count: number }[];

  const teamCounts = db
    .prepare("SELECT status, COUNT(*) as count FROM teams GROUP BY status")
    .all() as { status: string; count: number }[];

  const memberCounts = db
    .prepare(
      "SELECT status, COUNT(*) as count FROM team_members GROUP BY status"
    )
    .all() as { status: string; count: number }[];

  return {
    messages: messageCount.count,
    tasks: Object.fromEntries(taskCounts.map((r) => [r.status, r.count])),
    teams: Object.fromEntries(teamCounts.map((r) => [r.status, r.count])),
    members: Object.fromEntries(memberCounts.map((r) => [r.status, r.count])),
  };
}

export function getRecentMessages(limit = 20): DbMessage[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?"
    )
    .all(limit) as DbMessage[];
}

export function getMessagesByGroup(chatJid: string, limit = 50): DbMessage[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?"
    )
    .all(chatJid, limit) as DbMessage[];
}

export function getMessageCountByGroup(): { chat_jid: string; count: number }[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT chat_jid, COUNT(*) as count FROM messages GROUP BY chat_jid ORDER BY count DESC"
    )
    .all() as { chat_jid: string; count: number }[];
}

export function getAllTasks(): DbScheduledTask[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC")
    .all() as DbScheduledTask[];
}

export function getTaskRunLogs(taskId: string): DbTaskRunLog[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC"
    )
    .all(taskId) as DbTaskRunLog[];
}

export function getRecentTaskRuns(limit = 20): DbTaskRunLog[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM task_run_logs ORDER BY run_at DESC LIMIT ?")
    .all(limit) as DbTaskRunLog[];
}

export function getAllTeams(): DbTeam[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM teams ORDER BY created_at DESC")
    .all() as DbTeam[];
}

export function getTeamMembers(teamId: string): DbTeamMember[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? ORDER BY created_at")
    .all(teamId) as DbTeamMember[];
}

export function getTeamTasks(teamId: string): DbTeamTask[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM team_tasks WHERE team_id = ? ORDER BY priority DESC, created_at"
    )
    .all(teamId) as DbTeamTask[];
}

export function getTeamMessages(teamId: string): DbTeamMessage[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM team_messages WHERE team_id = ? ORDER BY created_at"
    )
    .all(teamId) as DbTeamMessage[];
}

export function searchMemory(query: string, limit = 10) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, path, group_folder, source, start_line, end_line, text
       FROM memory_chunks_fts
       WHERE memory_chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as {
    id: string;
    path: string;
    group_folder: string;
    source: string;
    start_line: number;
    end_line: number;
    text: string;
  }[];
}

export function getRecentActivity(limit = 30) {
  const db = getDb();

  const messages = db
    .prepare(
      `SELECT 'message' as type, id, chat_jid as source, sender_name as actor,
              content as detail, timestamp as time
       FROM messages
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(limit) as {
    type: string;
    id: string;
    source: string;
    actor: string;
    detail: string;
    time: string;
  }[];

  const taskRuns = db
    .prepare(
      `SELECT 'task_run' as type, trl.id, st.group_folder as source,
              st.prompt as actor, trl.status as detail, trl.run_at as time
       FROM task_run_logs trl
       JOIN scheduled_tasks st ON trl.task_id = st.id
       ORDER BY trl.run_at DESC LIMIT ?`
    )
    .all(limit) as {
    type: string;
    id: number;
    source: string;
    actor: string;
    detail: string;
    time: string;
  }[];

  // Merge and sort by time
  const all = [
    ...messages.map((m) => ({ ...m, id: String(m.id) })),
    ...taskRuns.map((t) => ({ ...t, id: String(t.id) })),
  ];
  all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return all.slice(0, limit);
}
