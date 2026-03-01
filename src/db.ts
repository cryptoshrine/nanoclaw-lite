import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { initMemorySchema } from './memory/schema.js';
import {
  NewMessage,
  ScheduledTask,
  TaskRunLog,
  Team,
  TeamMember,
  TeamTask,
  TeamMessage,
} from './types.js';

let db: Database.Database;

/**
 * Get the database instance. Must call initDatabase() first.
 */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
  `);

  // Add sender_name column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  } catch {
    /* column already exists */
  }

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add retry columns if they don't exist (migration for existing DBs)
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN retry_count INTEGER DEFAULT 0`,
    );
  } catch {
    /* column already exists */
  }
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN max_retries INTEGER DEFAULT 3`,
    );
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN last_error TEXT`);
  } catch {
    /* column already exists */
  }

  // Discord draft persistence (survives restarts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_drafts (
      message_id TEXT PRIMARY KEY,
      tweet_text TEXT NOT NULL,
      image_path TEXT,
      research_context TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Post queue — approved tweets awaiting publishing
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_text TEXT NOT NULL,
      image_path TEXT,
      research_context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at TEXT NOT NULL,
      published_at TEXT,
      tweet_url TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      discord_approved_msg_id TEXT
    );
  `);

  // Memory system tables
  initMemorySchema(db);

  // Agent Teams tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      lead_group TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT DEFAULT 'claude-sonnet-4-20250514',
      role TEXT DEFAULT 'teammate',
      status TEXT DEFAULT 'pending',
      container_id TEXT,
      session_id TEXT,
      prompt TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

    CREATE TABLE IF NOT EXISTS team_tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      assigned_to TEXT,
      depends_on TEXT,
      priority INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_tasks_team ON team_tasks(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status);

    CREATE TABLE IF NOT EXISTS team_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      from_member TEXT NOT NULL,
      to_member TEXT,
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_messages_team ON team_messages(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_messages_to ON team_messages(to_member);
  `);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(params: {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id,
    params.chatJid,
    params.sender,
    params.senderName,
    params.content,
    params.timestamp,
    params.isFromMe ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result' | 'last_error'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at, retry_count, max_retries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
    task.retry_count || 0,
    task.max_retries || 3,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'prompt'
      | 'schedule_type'
      | 'schedule_value'
      | 'next_run'
      | 'status'
      | 'context_mode'
      | 'max_retries'
      | 'retry_count'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.context_mode !== undefined) {
    fields.push('context_mode = ?');
    values.push(updates.context_mode);
  }
  if (updates.max_retries !== undefined) {
    fields.push('max_retries = ?');
    values.push(updates.max_retries);
  }
  if (updates.retry_count !== undefined) {
    fields.push('retry_count = ?');
    values.push(updates.retry_count);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, retry_count = 0, last_error = NULL,
        status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function updateTaskRetry(
  id: string,
  retryCount: number,
  nextRun: string,
  lastError: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET retry_count = ?, next_run = ?, last_run = ?, last_error = ?
    WHERE id = ?
  `,
  ).run(retryCount, nextRun, now, lastError, id);
}

export function markTaskFailed(id: string, lastError: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET status = 'failed', last_run = ?, last_error = ?, next_run = NULL
    WHERE id = ?
  `,
  ).run(now, lastError, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

// ============ Agent Teams CRUD ============

// Teams
export function createTeam(team: Team): void {
  db.prepare(
    `INSERT INTO teams (id, name, lead_group, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(team.id, team.name, team.lead_group, team.status, team.created_at);
}

export function getTeam(id: string): Team | undefined {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as
    | Team
    | undefined;
}

export function getTeamByName(name: string): Team | undefined {
  return db.prepare('SELECT * FROM teams WHERE name = ?').get(name) as
    | Team
    | undefined;
}

export function getActiveTeams(): Team[] {
  return db
    .prepare("SELECT * FROM teams WHERE status = 'active' ORDER BY created_at DESC")
    .all() as Team[];
}

export function updateTeamStatus(
  id: string,
  status: Team['status'],
): void {
  db.prepare('UPDATE teams SET status = ? WHERE id = ?').run(status, id);
}

// Team Members
export function createTeamMember(member: TeamMember): void {
  db.prepare(
    `INSERT INTO team_members (id, team_id, name, model, role, status, container_id, session_id, prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    member.id,
    member.team_id,
    member.name,
    member.model,
    member.role,
    member.status,
    member.container_id,
    member.session_id,
    member.prompt,
    member.created_at,
  );
}

export function getTeamMember(id: string): TeamMember | undefined {
  return db.prepare('SELECT * FROM team_members WHERE id = ?').get(id) as
    | TeamMember
    | undefined;
}

export function getTeamMembers(teamId: string): TeamMember[] {
  return db
    .prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY created_at')
    .all(teamId) as TeamMember[];
}

export function updateTeamMember(
  id: string,
  updates: Partial<Pick<TeamMember, 'status' | 'container_id' | 'session_id'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.container_id !== undefined) {
    fields.push('container_id = ?');
    values.push(updates.container_id);
  }
  if (updates.session_id !== undefined) {
    fields.push('session_id = ?');
    values.push(updates.session_id);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE team_members SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

// Team Tasks
export function createTeamTask(task: TeamTask): void {
  db.prepare(
    `INSERT INTO team_tasks (id, team_id, title, description, status, assigned_to, depends_on, priority, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.team_id,
    task.title,
    task.description,
    task.status,
    task.assigned_to,
    task.depends_on,
    task.priority,
    task.created_at,
    task.completed_at,
  );
}

export function getTeamTask(id: string): TeamTask | undefined {
  return db.prepare('SELECT * FROM team_tasks WHERE id = ?').get(id) as
    | TeamTask
    | undefined;
}

export function getTeamTasks(teamId: string): TeamTask[] {
  return db
    .prepare(
      'SELECT * FROM team_tasks WHERE team_id = ? ORDER BY priority DESC, created_at',
    )
    .all(teamId) as TeamTask[];
}

export function getPendingTeamTasks(teamId: string): TeamTask[] {
  return db
    .prepare(
      `SELECT * FROM team_tasks
       WHERE team_id = ? AND status = 'pending' AND assigned_to IS NULL
       ORDER BY priority DESC, created_at`,
    )
    .all(teamId) as TeamTask[];
}

/**
 * Atomically claim a team task. Returns the task if claimed, null if already taken.
 */
export function claimTeamTask(
  taskId: string,
  memberId: string,
): TeamTask | null {
  const result = db
    .prepare(
      `UPDATE team_tasks
       SET status = 'in_progress', assigned_to = ?
       WHERE id = ? AND status = 'pending' AND assigned_to IS NULL
       RETURNING *`,
    )
    .get(memberId, taskId) as TeamTask | undefined;

  return result || null;
}

export function completeTeamTask(taskId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE team_tasks SET status = 'completed', completed_at = ? WHERE id = ?`,
  ).run(now, taskId);
}

export function updateTeamTask(
  id: string,
  updates: Partial<Pick<TeamTask, 'status' | 'assigned_to' | 'description'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.assigned_to !== undefined) {
    fields.push('assigned_to = ?');
    values.push(updates.assigned_to);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE team_tasks SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

// Team Messages
export function createTeamMessage(
  message: Omit<TeamMessage, 'id' | 'read'>,
): number {
  const result = db
    .prepare(
      `INSERT INTO team_messages (team_id, from_member, to_member, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      message.team_id,
      message.from_member,
      message.to_member,
      message.content,
      message.created_at,
    );
  return result.lastInsertRowid as number;
}

export function getUnreadTeamMessages(
  teamId: string,
  memberId: string,
): TeamMessage[] {
  return db
    .prepare(
      `SELECT id, team_id, from_member, to_member, content, read, created_at
       FROM team_messages
       WHERE team_id = ? AND read = 0 AND (to_member IS NULL OR to_member = ?)
       ORDER BY created_at`,
    )
    .all(teamId, memberId) as TeamMessage[];
}

export function getTeamMessages(
  teamId: string,
  limit = 50,
): TeamMessage[] {
  return db
    .prepare(
      `SELECT id, team_id, from_member, to_member, content, read, created_at
       FROM team_messages
       WHERE team_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(teamId, limit) as TeamMessage[];
}

export function markTeamMessagesRead(
  teamId: string,
  memberId: string,
  upToId: number,
): void {
  db.prepare(
    `UPDATE team_messages
     SET read = 1
     WHERE team_id = ? AND id <= ? AND (to_member IS NULL OR to_member = ?)`,
  ).run(teamId, upToId, memberId);
}

// ============ Discord Draft Persistence ============

export interface DiscordDraft {
  message_id: string;
  tweet_text: string;
  image_path: string | null;
  research_context: string;
  created_at: string;
}

export function saveDraft(messageId: string, tweetText: string, imagePath: string | undefined, researchContext: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO discord_drafts (message_id, tweet_text, image_path, research_context, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(messageId, tweetText, imagePath || null, researchContext, new Date().toISOString());
}

export function getDraft(messageId: string): DiscordDraft | undefined {
  return db.prepare('SELECT * FROM discord_drafts WHERE message_id = ?').get(messageId) as DiscordDraft | undefined;
}

export function deleteDraft(messageId: string): void {
  db.prepare('DELETE FROM discord_drafts WHERE message_id = ?').run(messageId);
}

// ── Post Queue ────────────────────────────────────────────────────────────────

export interface PostQueueItem {
  id: number;
  tweet_text: string;
  image_path: string | null;
  research_context: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string;
  published_at: string | null;
  tweet_url: string | null;
  retry_count: number;
  last_error: string | null;
  discord_approved_msg_id: string | null;
}

export function enqueuePost(
  tweetText: string,
  imagePath: string | undefined,
  researchContext: string | undefined,
  approvedBy: string,
  discordMsgId?: string,
): number {
  const result = db.prepare(
    `INSERT INTO post_queue (tweet_text, image_path, research_context, approved_by, approved_at, discord_approved_msg_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(tweetText, imagePath || null, researchContext || null, approvedBy, new Date().toISOString(), discordMsgId || null);
  return Number(result.lastInsertRowid);
}

export function getPendingPosts(): PostQueueItem[] {
  return db.prepare(
    `SELECT * FROM post_queue WHERE status = 'pending' AND retry_count < 3 ORDER BY approved_at ASC`,
  ).all() as PostQueueItem[];
}

export function markPostPublished(id: number, tweetUrl: string): void {
  db.prepare(
    `UPDATE post_queue SET status = 'published', published_at = ?, tweet_url = ? WHERE id = ?`,
  ).run(new Date().toISOString(), tweetUrl, id);
}

export function markPostFailed(id: number, error: string): void {
  db.prepare(
    `UPDATE post_queue SET retry_count = retry_count + 1, last_error = ?,
     status = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END
     WHERE id = ?`,
  ).run(error, id);
}

export function getQueueStats(): { pending: number; published: number; failed: number } {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM post_queue
  `).get() as { pending: number; published: number; failed: number } | undefined;
  return row || { pending: 0, published: 0, failed: 0 };
}

// Cleanup
export function deleteTeam(teamId: string): void {
  db.prepare('DELETE FROM team_messages WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM team_tasks WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
}
