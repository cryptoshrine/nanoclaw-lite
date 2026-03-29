/**
 * KlawHQ WebSocket Event Server
 *
 * Emits real-time NanoClaw events over WebSocket for the 3D office visualization.
 * Singleton pattern — import { broadcast, getEventServer } from './ws-server.js'
 * and call broadcast() from anywhere in the codebase.
 */

import fs from 'fs';
import path from 'path';

import { WebSocketServer, WebSocket } from 'ws';

import crypto from 'crypto';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, PROJECT_ROOT, GROUPS_DIR, TIMEZONE } from './config.js';
import {
  storeMessage,
  storeChatMetadata,
  getAllTasks,
  getTaskById,
  createTask,
  deleteTask,
  updateTask,
  getDb,
} from './db.js';
import { respondToApproval } from './inline-keyboards.js';
import { logger } from './logger.js';
import type { ScheduledTask } from './types.js';

// ── Skill Types (matching KlawHQ's SkillStatusReport) ─────────────

interface SkillRequirementSet {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

interface SkillStatusConfigCheck {
  path: string;
  satisfied: boolean;
}

interface SkillInstallOption {
  id: string;
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
}

interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: SkillRequirementSet;
  missing: SkillRequirementSet;
  configChecks: SkillStatusConfigCheck[];
  install: SkillInstallOption[];
}

interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
}

// ── Skill Config (persisted enable/disable state) ─────────────────

const SKILL_CONFIG_PATH = path.join(DATA_DIR, 'skill-config.json');

interface SkillConfig {
  disabled: string[];  // skillKeys that are disabled
}

function loadSkillConfig(): SkillConfig {
  try {
    if (fs.existsSync(SKILL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(SKILL_CONFIG_PATH, 'utf-8'));
    }
  } catch {
    logger.debug('Failed to read skill-config.json');
  }
  return { disabled: [] };
}

function saveSkillConfig(config: SkillConfig): void {
  fs.writeFileSync(SKILL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── Skill Scanner ─────────────────────────────────────────────────

const EMPTY_REQUIREMENTS: SkillRequirementSet = {
  bins: [],
  anyBins: [],
  env: [],
  config: [],
  os: [],
};

/**
 * Parse YAML frontmatter from a skill markdown file.
 * Returns { name, description, allowedTools, argumentHint } or null.
 */
function parseSkillFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (/^\S/.test(line) && line.includes(':')) {
        // New key — save accumulated value
        fields[currentKey] = currentValue.trim();
        inMultiline = false;
      } else {
        currentValue += '\n' + line;
        continue;
      }
    }

    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawValue = kvMatch[2].trim();
      if (rawValue === '|' || rawValue === '>') {
        // Multiline YAML value
        inMultiline = true;
        currentValue = '';
      } else {
        fields[currentKey] = rawValue;
      }
    }
  }

  if (inMultiline && currentKey) {
    fields[currentKey] = currentValue.trim();
  }

  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Scan a skills directory for SKILL.md files and return SkillStatusEntry[].
 */
function scanSkillsDir(
  dir: string,
  source: string,
  bundled: boolean,
  disabledSet: Set<string>,
): SkillStatusEntry[] {
  const skills: SkillStatusEntry[] = [];

  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Look for SKILL.md (case-insensitive)
      const subDir = path.join(dir, entry.name);
      const skillFiles = fs.readdirSync(subDir).filter(
        f => f.toLowerCase() === 'skill.md'
      );

      if (skillFiles.length === 0) continue;

      const skillFilePath = path.join(subDir, skillFiles[0]);
      try {
        const content = fs.readFileSync(skillFilePath, 'utf-8');
        const frontmatter = parseSkillFrontmatter(content);
        if (!frontmatter || !frontmatter.name) continue;

        const skillKey = `${source}:${frontmatter.name}`;
        const isDisabled = disabledSet.has(skillKey);

        skills.push({
          name: frontmatter.name,
          description: (frontmatter.description || '').split('\n')[0].slice(0, 200),
          source,
          bundled,
          filePath: skillFilePath,
          baseDir: subDir,
          skillKey,
          always: false,
          disabled: isDisabled,
          blockedByAllowlist: false,
          eligible: !isDisabled,
          requirements: { ...EMPTY_REQUIREMENTS },
          missing: { ...EMPTY_REQUIREMENTS },
          configChecks: [],
          install: [],
        });
      } catch {
        // Skip unreadable skill files
      }
    }
  } catch {
    logger.debug({ dir }, 'Failed to scan skills directory');
  }

  return skills;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface KlawEvent {
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface ClientRequest {
  type: string;
  method?: string;
  id?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Singleton ──────────────────────────────────────────────────────────

let instance: KlawEventServer | null = null;

export function getEventServer(): KlawEventServer | null {
  return instance;
}

/**
 * Broadcast an event to all connected KlawHQ clients.
 * Safe to call even if the WS server isn't running — it's a no-op.
 */
export function broadcast(event: string, payload: Record<string, unknown>): void {
  instance?.broadcast(event, payload);
}

// ── Server ─────────────────────────────────────────────────────────────

export class KlawEventServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number = 18800) {
    this.wss = new WebSocketServer({ port }, () => {
      logger.info({ port }, 'KlawHQ WebSocket event server listening');
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info({ clients: this.clients.size }, 'KlawHQ client connected');

      // Send current system state snapshot on connect
      const snapshot = this.getSystemState();
      for (const evt of snapshot) {
        ws.send(JSON.stringify(evt));
      }

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as ClientRequest;
          this.handleMessage(ws, data);
        } catch {
          logger.debug('KlawHQ: invalid message from client');
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.debug({ clients: this.clients.size }, 'KlawHQ client disconnected');
      });

      ws.on('error', (err) => {
        logger.debug({ err }, 'KlawHQ client error');
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn({ port }, 'KlawHQ WS port in use — running without event server');
        instance = null;
      } else {
        logger.error({ err }, 'KlawHQ WS server error');
      }
    });

    instance = this;
  }

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast(event: string, payload: Record<string, unknown>): void {
    if (this.clients.size === 0) return;

    const msg: KlawEvent = { event, payload, timestamp: Date.now() };
    const data = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Handle incoming request from a KlawHQ client.
   * Supports two formats:
   *   1. { type: "req", method: "agents.list", id: "nc-1-..." } (NanoClawClient protocol)
   *   2. { type: "agents.list" } (legacy direct format)
   */
  private handleMessage(ws: WebSocket, data: ClientRequest): void {
    // Normalize: extract method from either format
    const method = data.type === 'req' ? (data.method ?? '') : data.type;
    const requestId = data.id ?? null;

    switch (method) {
      case 'agents.list': {
        const agents = this.buildNanoClawAgents();
        this.sendResponse(ws, requestId, 'agents.list', { agents });
        break;
      }

      case 'state.snapshot': {
        const agents = this.buildNanoClawAgents();
        const teams: unknown[] = [];
        const tasks: unknown[] = [];
        this.sendResponse(ws, requestId, 'state.snapshot', { agents, teams, tasks });
        break;
      }

      case 'system.status': {
        const snapshot = this.getSystemState();
        for (const evt of snapshot) {
          ws.send(JSON.stringify(evt));
        }
        break;
      }

      case 'chat.send': {
        const result = this.handleChatSend(data);
        this.sendResponse(ws, requestId, 'chat.send', result);
        break;
      }

      case 'approval.respond': {
        const params = data.params || data;
        const approvalRequestId = params.requestId as string | undefined;
        const approved = params.approved as boolean | undefined;
        if (!approvalRequestId || typeof approved !== 'boolean') {
          this.sendResponse(ws, requestId, 'approval.respond', { ok: false, error: 'Missing requestId or approved' });
        } else {
          const found = respondToApproval(approvalRequestId, approved);
          this.sendResponse(ws, requestId, 'approval.respond', { ok: found, requestId: approvalRequestId });
        }
        break;
      }

      case 'models.list': {
        const models = [
          { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'flagship' },
          { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'balanced' },
          { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast' },
        ];
        this.sendResponse(ws, requestId, 'models.list', { models });
        break;
      }

      case 'config.get': {
        const configPath = path.join(DATA_DIR, 'klawhq-config.json');
        let fullConfig: Record<string, unknown> = {
          defaultModel: 'claude-sonnet-4-6',
          maxContextWindow: 1_000_000,
          allowedModels: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
          executionMode: 'local',
          wsPort: 18800,
        };
        let configHash = '';

        try {
          if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const saved = JSON.parse(raw);
            fullConfig = { ...fullConfig, ...saved };
            configHash = crypto.createHash('md5').update(raw).digest('hex');
          }
        } catch {
          // Use defaults
        }

        // Ensure agents list exists
        if (!fullConfig.agents || typeof fullConfig.agents !== 'object') {
          fullConfig.agents = {};
        }
        const agentsSection = fullConfig.agents as Record<string, unknown>;
        if (!Array.isArray(agentsSection.list)) {
          agentsSection.list = this.buildConfigAgentList();
        }

        this.sendResponse(ws, requestId, 'config.get', {
          config: fullConfig,
          hash: configHash || crypto.createHash('md5').update(JSON.stringify(fullConfig)).digest('hex'),
          exists: true,
          path: configPath,
        });
        break;
      }

      case 'sessions.patch': {
        // Acknowledge session setting changes (model, context, etc.)
        const params = data.params || data;
        const sessionId = params.sessionId as string | undefined;
        logger.info({ sessionId, params }, 'KlawHQ sessions.patch: settings updated');
        this.sendResponse(ws, requestId, 'sessions.patch', { ok: true, sessionId: sessionId ?? 'default' });
        break;
      }

      case 'skills.status': {
        const report = this.buildSkillStatusReport();
        this.sendResponse(ws, requestId, 'skills.status', report as unknown as Record<string, unknown>);
        break;
      }

      case 'skills.update': {
        const params = data.params || data;
        const skillKey = params.skillKey as string | undefined;
        const enabled = params.enabled as boolean | undefined;

        if (!skillKey) {
          this.sendResponse(ws, requestId, 'skills.update', { ok: false, skillKey: '', config: {} });
          break;
        }

        const config = loadSkillConfig();
        if (typeof enabled === 'boolean') {
          if (enabled) {
            config.disabled = config.disabled.filter(k => k !== skillKey);
          } else {
            if (!config.disabled.includes(skillKey)) {
              config.disabled.push(skillKey);
            }
          }
          saveSkillConfig(config);
        }

        this.sendResponse(ws, requestId, 'skills.update', {
          ok: true,
          skillKey,
          config: { disabled: config.disabled },
        });

        // Broadcast skills changed event so other clients refresh
        this.broadcast('skills.changed', { skillKey, enabled });
        break;
      }

      case 'skills.remove': {
        const params = data.params || data;
        const skillKey = params.skillKey as string | undefined;
        const removeSource = params.source as string | undefined;
        const removeBaseDir = params.baseDir as string | undefined;

        if (!skillKey || !removeSource || !removeBaseDir) {
          this.sendResponse(ws, requestId, 'skills.remove', {
            removed: false,
            removedPath: '',
            source: removeSource ?? '',
          });
          break;
        }

        // Only allow removing workspace or managed skills
        const removableSources = new Set(['nanoclaw-managed', 'nanoclaw-workspace']);
        if (!removableSources.has(removeSource)) {
          this.sendResponse(ws, requestId, 'skills.remove', {
            removed: false,
            removedPath: removeBaseDir,
            source: removeSource,
          });
          break;
        }

        try {
          if (fs.existsSync(removeBaseDir)) {
            fs.rmSync(removeBaseDir, { recursive: true, force: true });
          }
          // Also remove from disabled list if present
          const cfg = loadSkillConfig();
          cfg.disabled = cfg.disabled.filter(k => k !== skillKey);
          saveSkillConfig(cfg);

          this.sendResponse(ws, requestId, 'skills.remove', {
            removed: true,
            removedPath: removeBaseDir,
            source: removeSource,
          });
          this.broadcast('skills.changed', { skillKey, removed: true });
        } catch (err) {
          logger.error({ err, skillKey }, 'KlawHQ skills.remove: failed');
          this.sendResponse(ws, requestId, 'skills.remove', {
            removed: false,
            removedPath: removeBaseDir,
            source: removeSource,
          });
        }
        break;
      }

      // ── Brain Panel: Agent Files ───────────────────────────────────

      case 'agents.files.get': {
        const params = data.params || data;
        const agentId = params.agentId as string | undefined;
        const fileName = params.name as string | undefined;

        if (!agentId || !fileName) {
          this.sendResponse(ws, requestId, 'agents.files.get', {
            file: { missing: true, content: '' },
          });
          break;
        }

        const filePath = this.resolveAgentFilePath(agentId, fileName);
        try {
          if (filePath && fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.sendResponse(ws, requestId, 'agents.files.get', {
              file: { missing: false, content },
            });
          } else {
            this.sendResponse(ws, requestId, 'agents.files.get', {
              file: { missing: true, content: '' },
            });
          }
        } catch (err) {
          logger.error({ err, agentId, fileName }, 'KlawHQ agents.files.get: failed');
          this.sendResponse(ws, requestId, 'agents.files.get', {
            file: { missing: true, content: '' },
          });
        }
        break;
      }

      case 'agents.files.set': {
        const params = data.params || data;
        const agentId = params.agentId as string | undefined;
        const fileName = params.name as string | undefined;
        const content = params.content as string | undefined;

        if (!agentId || !fileName || typeof content !== 'string') {
          this.sendResponse(ws, requestId, 'agents.files.set', { ok: false, error: 'Missing params' });
          break;
        }

        const filePath = this.resolveAgentFilePath(agentId, fileName);
        if (!filePath) {
          this.sendResponse(ws, requestId, 'agents.files.set', { ok: false, error: 'Invalid file path' });
          break;
        }

        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, 'utf-8');
          this.sendResponse(ws, requestId, 'agents.files.set', { ok: true });
          logger.info({ agentId, fileName }, 'KlawHQ agents.files.set: file saved');
        } catch (err) {
          logger.error({ err, agentId, fileName }, 'KlawHQ agents.files.set: failed');
          this.sendResponse(ws, requestId, 'agents.files.set', { ok: false, error: 'Write failed' });
        }
        break;
      }

      // ── Automations: Cron Jobs ─────────────────────────────────────

      case 'cron.list': {
        const params = data.params || data;
        const includeDisabled = params.includeDisabled !== false;

        const tasks = getAllTasks();
        const jobs = tasks
          .filter(t => includeDisabled || t.status === 'active')
          .map(t => this.taskToCronJobSummary(t));

        this.sendResponse(ws, requestId, 'cron.list', { jobs });
        break;
      }

      case 'cron.add': {
        const params = data.params || data;
        const name = (params.name as string || '').trim();
        const agentId = (params.agentId as string || '').trim();
        const payload = params.payload as Record<string, unknown> | undefined;

        if (!name || !payload) {
          this.sendResponse(ws, requestId, 'cron.add', { ok: false, error: 'Missing name or payload' });
          break;
        }

        // Extract prompt from payload
        const prompt = payload.kind === 'agentTurn'
          ? (payload.message as string || '')
          : (payload.text as string || '');

        if (!prompt) {
          this.sendResponse(ws, requestId, 'cron.add', { ok: false, error: 'Missing prompt in payload' });
          break;
        }

        // Resolve schedule
        const schedule = params.schedule as Record<string, unknown> | undefined;
        let scheduleType: string;
        let scheduleValue: string;
        let nextRun: string | null = null;

        if (schedule?.kind === 'cron') {
          scheduleType = 'cron';
          scheduleValue = schedule.expr as string;
          const interval = CronExpressionParser.parse(scheduleValue, { tz: schedule.tz as string || TIMEZONE });
          nextRun = interval.next().toISOString();
        } else if (schedule?.kind === 'every') {
          scheduleType = 'interval';
          scheduleValue = String(schedule.everyMs as number);
          nextRun = new Date(Date.now() + (schedule.everyMs as number)).toISOString();
        } else if (schedule?.kind === 'at') {
          scheduleType = 'once';
          scheduleValue = schedule.at as string;
          nextRun = new Date(schedule.at as string).toISOString();
        } else {
          this.sendResponse(ws, requestId, 'cron.add', { ok: false, error: 'Invalid schedule' });
          break;
        }

        // Resolve group folder from agentId
        const groupFolder = this.resolveGroupFolder(agentId) || 'main';

        // Find chat JID for this group
        const groups = this.loadRegisteredGroups();
        const groupEntry = Object.entries(groups).find(([, g]) => g.folder === groupFolder);
        const chatJid = groupEntry ? groupEntry[0] : 'klawhq';

        const sessionTarget = (params.sessionTarget as string) || 'isolated';

        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const task: Omit<ScheduledTask, 'last_run' | 'last_result' | 'last_error'> = {
          id: taskId,
          group_folder: groupFolder,
          chat_jid: chatJid,
          prompt,
          schedule_type: scheduleType as 'cron' | 'interval' | 'once',
          schedule_value: scheduleValue,
          context_mode: sessionTarget === 'main' ? 'group' : 'isolated',
          next_run: nextRun,
          status: (params.enabled !== false) ? 'active' : 'paused',
          created_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: 3,
        };

        try {
          createTask(task);
          const summary = this.taskToCronJobSummary({ ...task, last_run: null, last_result: null, last_error: null } as ScheduledTask);
          this.sendResponse(ws, requestId, 'cron.add', summary as unknown as Record<string, unknown>);
          this.broadcast('cron.changed', { action: 'added', jobId: taskId });
          logger.info({ taskId, name }, 'KlawHQ cron.add: task created');
        } catch (err) {
          logger.error({ err }, 'KlawHQ cron.add: failed');
          this.sendResponse(ws, requestId, 'cron.add', { ok: false, error: 'Create failed' });
        }
        break;
      }

      case 'cron.run': {
        const params = data.params || data;
        const jobId = (params.id as string || '').trim();

        if (!jobId) {
          this.sendResponse(ws, requestId, 'cron.run', { ok: false });
          break;
        }

        const task = getTaskById(jobId);
        if (!task) {
          this.sendResponse(ws, requestId, 'cron.run', { ok: false });
          break;
        }

        // Force run: set next_run to now so the scheduler picks it up immediately
        updateTask(jobId, {
          next_run: new Date().toISOString(),
          status: 'active',
        });

        this.sendResponse(ws, requestId, 'cron.run', { ok: true, ran: true });
        logger.info({ jobId }, 'KlawHQ cron.run: forced task run');
        break;
      }

      case 'cron.remove': {
        const params = data.params || data;
        const jobId = (params.id as string || '').trim();

        if (!jobId) {
          this.sendResponse(ws, requestId, 'cron.remove', { ok: false, removed: false });
          break;
        }

        const task = getTaskById(jobId);
        if (!task) {
          this.sendResponse(ws, requestId, 'cron.remove', { ok: true, removed: false });
          break;
        }

        try {
          deleteTask(jobId);
          this.sendResponse(ws, requestId, 'cron.remove', { ok: true, removed: true });
          this.broadcast('cron.changed', { action: 'removed', jobId });
          logger.info({ jobId }, 'KlawHQ cron.remove: task deleted');
        } catch (err) {
          logger.error({ err, jobId }, 'KlawHQ cron.remove: failed');
          this.sendResponse(ws, requestId, 'cron.remove', { ok: false, removed: false });
        }
        break;
      }

      // ── Chat History ───────────────────────────────────────────────

      case 'chat.history': {
        const params = data.params || data;
        const sessionKey = (params.sessionKey as string || '').trim();
        const limit = Math.min(Math.max(params.limit as number || 50, 1), 200);

        // sessionKey maps to groupId (folder name) in NanoClaw
        const groupId = sessionKey || 'main';
        const groups = this.loadRegisteredGroups();
        const entry = Object.entries(groups).find(([, g]) => g.folder === groupId);

        if (!entry) {
          this.sendResponse(ws, requestId, 'chat.history', {
            sessionKey: groupId,
            messages: [],
          });
          break;
        }

        const [jid] = entry;

        try {
          const db = getDb();
          const rows = db.prepare(`
            SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
            FROM messages
            WHERE chat_jid = ?
            ORDER BY timestamp DESC
            LIMIT ?
          `).all(jid, limit) as Array<{
            id: string;
            chat_jid: string;
            sender: string;
            sender_name: string;
            content: string;
            timestamp: string;
            is_from_me: number;
          }>;

          // Reverse to chronological order and format for KlawHQ
          const messages = rows.reverse().map(row => ({
            id: row.id,
            role: row.is_from_me ? 'assistant' : 'user',
            type: 'message',
            text: row.content || '',
            sender: row.sender_name || row.sender,
            timestamp: row.timestamp,
            timestampMs: new Date(row.timestamp).getTime(),
          }));

          this.sendResponse(ws, requestId, 'chat.history', {
            sessionKey: groupId,
            messages,
          });
        } catch (err) {
          logger.error({ err, groupId }, 'KlawHQ chat.history: failed');
          this.sendResponse(ws, requestId, 'chat.history', {
            sessionKey: groupId,
            messages: [],
          });
        }
        break;
      }

      // ── Agent Lifecycle ────────────────────────────────────────────

      case 'agents.create': {
        const params = data.params || data;
        const name = (params.name as string || '').trim();

        if (!name) {
          this.sendResponse(ws, requestId, 'agents.create', { ok: false, error: 'Name required' });
          break;
        }

        // Generate agentId from name
        const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!agentId) {
          this.sendResponse(ws, requestId, 'agents.create', { ok: false, error: 'Invalid name' });
          break;
        }

        // Create the group folder
        const groupDir = path.join(GROUPS_DIR, agentId);
        try {
          fs.mkdirSync(groupDir, { recursive: true });

          // Create a basic CLAUDE.md
          const claudeMd = `# ${name}\n\nAgent created via KlawHQ.\n`;
          fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), claudeMd, 'utf-8');

          this.sendResponse(ws, requestId, 'agents.create', {
            ok: true,
            agentId,
            name,
            workspace: groupDir,
          });

          this.broadcast('agents.changed', { action: 'created', agentId, name });
          logger.info({ agentId, name }, 'KlawHQ agents.create: agent created');
        } catch (err) {
          logger.error({ err, agentId }, 'KlawHQ agents.create: failed');
          this.sendResponse(ws, requestId, 'agents.create', { ok: false, error: 'Create failed' });
        }
        break;
      }

      case 'agents.update': {
        const params = data.params || data;
        const agentId = (params.agentId as string || '').trim();
        const newName = (params.name as string || '').trim();

        if (!agentId) {
          this.sendResponse(ws, requestId, 'agents.update', { ok: false, error: 'agentId required' });
          break;
        }

        // For now, acknowledge the rename
        this.sendResponse(ws, requestId, 'agents.update', {
          ok: true,
          agentId,
          name: newName || agentId,
        });

        this.broadcast('agents.changed', { action: 'updated', agentId, name: newName });
        logger.info({ agentId, newName }, 'KlawHQ agents.update: agent renamed');
        break;
      }

      case 'agents.delete': {
        const params = data.params || data;
        const agentId = (params.agentId as string || '').trim();

        if (!agentId) {
          this.sendResponse(ws, requestId, 'agents.delete', { ok: false });
          break;
        }

        // Don't allow deleting core agents
        const coreAgents = new Set(['main', 'klaw', 'ball-ai-dev']);
        if (coreAgents.has(agentId)) {
          this.sendResponse(ws, requestId, 'agents.delete', {
            ok: false,
            error: 'Cannot delete core agent',
          });
          break;
        }

        this.sendResponse(ws, requestId, 'agents.delete', {
          ok: true,
          removedBindings: 0,
        });

        this.broadcast('agents.changed', { action: 'deleted', agentId });
        logger.info({ agentId }, 'KlawHQ agents.delete: agent deleted');
        break;
      }

      // ── Config (write agent config) ────────────────────────────────

      case 'config.patch':
      case 'config.set': {
        const params = data.params || data;
        const raw = params.raw as string | undefined;

        if (!raw) {
          this.sendResponse(ws, requestId, method, { ok: false, error: 'Missing raw config' });
          break;
        }

        const configPath = path.join(DATA_DIR, 'klawhq-config.json');
        try {
          const parsed = JSON.parse(raw);
          fs.mkdirSync(path.dirname(configPath), { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
          this.sendResponse(ws, requestId, method, { ok: true });
          logger.info('KlawHQ config updated');
        } catch (err) {
          logger.error({ err }, 'KlawHQ config write failed');
          this.sendResponse(ws, requestId, method, { ok: false, error: 'Write failed' });
        }
        break;
      }

      // ── System Status ──────────────────────────────────────────────

      case 'status': {
        this.sendResponse(ws, requestId, 'status', {
          heartbeat: { agents: [] },
        });
        break;
      }

      // ── Wake (trigger agent) ───────────────────────────────────────

      case 'wake': {
        const params = data.params || data;
        const text = params.text as string | undefined;

        if (text) {
          // Inject as a chat message to main group
          const result = this.handleChatSend({
            type: 'chat.send',
            params: { groupId: 'main', text },
          });
          this.sendResponse(ws, requestId, 'wake', { ok: (result as Record<string, unknown>).queued === true });
        } else {
          this.sendResponse(ws, requestId, 'wake', { ok: false });
        }
        break;
      }

      default:
        logger.debug({ method }, 'KlawHQ: unknown client request');
    }
  }

  /**
   * Handle chat.send: inject a message from KlawHQ into the NanoClaw pipeline.
   * Accepts { groupId, text } and inserts into SQLite so the polling loop picks it up.
   */
  private handleChatSend(data: ClientRequest): Record<string, unknown> {
    const params = data.params || data;
    const groupId = params.groupId as string | undefined;
    const text = params.text as string | undefined;

    if (!groupId || !text) {
      return { queued: false, error: 'Missing required params: groupId, text' };
    }

    // Map groupId (folder name) to JID
    const groups = this.loadRegisteredGroups();
    const entry = Object.entries(groups).find(([, g]) => g.folder === groupId);
    if (!entry) {
      return { queued: false, error: `Unknown groupId: ${groupId}` };
    }

    const [jid, group] = entry;
    const now = new Date().toISOString();
    const messageId = `klawhq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Ensure chat row exists (FK constraint)
      storeChatMetadata(jid, now, group.name);

      // Insert message into the pipeline — the polling loop will pick this up
      storeMessage({
        id: messageId,
        chatJid: jid,
        sender: 'klawhq-user',
        senderName: 'KlawHQ',
        content: text,
        timestamp: now,
        isFromMe: false,
      });

      logger.info({ messageId, groupId, jid }, 'KlawHQ chat.send: message injected into pipeline');

      // Broadcast the message as a received event so other KlawHQ clients see it
      this.broadcast('message.received', {
        groupId,
        text: text.slice(0, 200),
        sender: 'KlawHQ',
      });

      return { queued: true, messageId };
    } catch (err) {
      logger.error({ err, groupId }, 'KlawHQ chat.send: failed to inject message');
      return { queued: false, error: 'Database error' };
    }
  }

  /**
   * Send a response frame matching the NanoClawClient protocol.
   * If requestId is provided, sends { type: "res", id, ok, method, payload }.
   * Otherwise falls back to a KlawEvent.
   */
  private sendResponse(
    ws: WebSocket,
    requestId: string | null,
    method: string,
    payload: Record<string, unknown>,
  ): void {
    if (requestId) {
      // NanoClawClient request/response protocol
      ws.send(JSON.stringify({
        type: 'res',
        id: requestId,
        ok: true,
        method,
        payload,
      }));
    } else {
      // Legacy event format
      ws.send(JSON.stringify({
        event: method,
        payload,
        timestamp: Date.now(),
      }));
    }
  }

  /**
   * Build the NanoClaw agent list that KlawHQ expects.
   * Maps registered groups + the built-in specialist roster.
   */
  private buildNanoClawAgents(): Array<Record<string, unknown>> {
    const groups = this.loadRegisteredGroups();
    const agents: Array<Record<string, unknown>> = [
      { id: 'klaw', name: 'Klaw', role: 'Field Commander', status: 'idle', group: 'main' },
      { id: 'ball-ai-dev', name: 'Ball-AI Dev', role: 'Coding Specialist', status: 'idle', group: 'ball-ai-dev' },
      { id: 'ball-ai-research', name: 'Ball-AI Research', role: 'Research Specialist', status: 'idle', group: 'main' },
      { id: 'ball-ai-marketing', name: 'Ball-AI Marketing', role: 'Marketing Specialist', status: 'idle', group: 'main' },
      { id: 'ball-ai-copywriter', name: 'Ball-AI Copywriter', role: 'Content Specialist', status: 'idle', group: 'main' },
    ];

    // Also add any registered groups that aren't already covered
    for (const [jid, g] of Object.entries(groups)) {
      const exists = agents.some(a => a.group === g.folder || a.id === g.folder);
      if (!exists) {
        agents.push({
          id: g.folder,
          name: g.name,
          role: 'Group Agent',
          status: 'idle',
          group: g.folder,
          jid,
        });
      }
    }

    return agents;
  }

  /**
   * Build a snapshot of current system state for newly connected clients.
   */
  private getSystemState(): KlawEvent[] {
    const events: KlawEvent[] = [];
    const now = Date.now();

    // 1. Registered agents/groups
    const groups = this.loadRegisteredGroups();
    const agents = Object.entries(groups).map(([jid, g]) => ({
      jid,
      name: g.name,
      folder: g.folder,
      trigger: g.trigger,
    }));
    events.push({ event: 'system.state', payload: { agents }, timestamp: now });

    // 2. System status snapshot (active agents, queued messages) if available
    const statusFile = path.join(DATA_DIR, 'ipc', 'main', 'system_status.json');
    try {
      if (fs.existsSync(statusFile)) {
        const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
        events.push({ event: 'system.status', payload: status, timestamp: now });
      }
    } catch {
      // Non-critical — status file may not exist yet
    }

    return events;
  }

  /**
   * Scan all skill directories and build a SkillStatusReport.
   */
  private buildSkillStatusReport(): SkillStatusReport {
    const config = loadSkillConfig();
    const disabledSet = new Set(config.disabled);

    const skills: SkillStatusEntry[] = [];

    // 1. Project-level skills: .claude/skills/
    const projectSkillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');
    skills.push(...scanSkillsDir(projectSkillsDir, 'nanoclaw-workspace', false, disabledSet));

    // 2. Container/bundled skills: container/skills/
    const containerSkillsDir = path.join(PROJECT_ROOT, 'container', 'skills');
    skills.push(...scanSkillsDir(containerSkillsDir, 'nanoclaw-bundled', true, disabledSet));

    // 3. Group-specific skills: groups/main/.claude/skills/
    const mainGroupSkillsDir = path.join(GROUPS_DIR, 'main', '.claude', 'skills');
    skills.push(...scanSkillsDir(mainGroupSkillsDir, 'agents-skills-personal', false, disabledSet));

    // Deduplicate by name (project-level takes precedence)
    const seen = new Set<string>();
    const deduped: SkillStatusEntry[] = [];
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        deduped.push(skill);
      }
    }

    return {
      workspaceDir: PROJECT_ROOT,
      managedSkillsDir: projectSkillsDir,
      skills: deduped,
    };
  }

  /**
   * Load registered_groups.json from disk.
   */
  private loadRegisteredGroups(): Record<string, { name: string; folder: string; trigger: string }> {
    const groupsFile = path.join(DATA_DIR, 'registered_groups.json');
    try {
      if (fs.existsSync(groupsFile)) {
        return JSON.parse(fs.readFileSync(groupsFile, 'utf-8'));
      }
    } catch {
      logger.debug('Failed to read registered_groups.json for WS state');
    }
    return {};
  }

  /**
   * Resolve the file path for an agent personality file.
   * Files live in groups/{agentId}/CLAUDE.md or groups/{agentId}/{fileName}
   */
  private resolveAgentFilePath(agentId: string, fileName: string): string | null {
    // Validate fileName to prevent path traversal
    const ALLOWED_FILES = new Set([
      'SOUL.md', 'USER.md', 'IDENTITY.md', 'AGENTS.md',
      'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md',
    ]);

    if (!ALLOWED_FILES.has(fileName)) {
      return null;
    }

    // Map agentId to group folder
    const groupFolder = this.resolveGroupFolder(agentId) || agentId;
    return path.join(GROUPS_DIR, groupFolder, fileName);
  }

  /**
   * Map an agentId to a group folder name.
   */
  private resolveGroupFolder(agentId: string): string | null {
    if (!agentId) return null;

    // Direct match (agentId IS the folder name)
    const directPath = path.join(GROUPS_DIR, agentId);
    if (fs.existsSync(directPath)) return agentId;

    // Check registered groups
    const groups = this.loadRegisteredGroups();
    for (const g of Object.values(groups)) {
      if (g.folder === agentId) return g.folder;
    }

    // Known specialist mappings
    const AGENT_FOLDER_MAP: Record<string, string> = {
      'klaw': 'main',
      'ball-ai-dev': 'ball-ai-dev',
      'ball-ai-research': 'main',
      'ball-ai-marketing': 'main',
      'ball-ai-copywriter': 'main',
    };

    return AGENT_FOLDER_MAP[agentId] || null;
  }

  /**
   * Convert a NanoClaw ScheduledTask to a KlawHQ CronJobSummary.
   */
  private taskToCronJobSummary(task: ScheduledTask): Record<string, unknown> {
    let schedule: Record<string, unknown>;
    if (task.schedule_type === 'cron') {
      schedule = { kind: 'cron', expr: task.schedule_value, tz: TIMEZONE };
    } else if (task.schedule_type === 'interval') {
      schedule = { kind: 'every', everyMs: parseInt(task.schedule_value, 10) };
    } else {
      schedule = { kind: 'at', at: task.schedule_value };
    }

    return {
      id: task.id,
      name: task.prompt.slice(0, 60).split('\n')[0] || 'Unnamed task',
      agentId: task.group_folder,
      description: task.prompt.slice(0, 200),
      enabled: task.status === 'active',
      updatedAtMs: task.last_run ? new Date(task.last_run).getTime() : new Date(task.created_at).getTime(),
      schedule,
      sessionTarget: task.context_mode === 'group' ? 'main' : 'isolated',
      wakeMode: 'now' as const,
      payload: {
        kind: 'agentTurn',
        message: task.prompt,
      },
      state: {
        nextRunAtMs: task.next_run ? new Date(task.next_run).getTime() : undefined,
        lastRunAtMs: task.last_run ? new Date(task.last_run).getTime() : undefined,
        lastStatus: task.last_error ? 'error' : (task.last_run ? 'ok' : undefined),
        lastError: task.last_error || undefined,
      },
    };
  }

  /**
   * Build the config agents list from registered groups + known specialists.
   */
  private buildConfigAgentList(): Array<Record<string, unknown>> {
    const agents: Array<Record<string, unknown>> = [
      { id: 'klaw', name: 'Klaw', default: true },
    ];

    const groups = this.loadRegisteredGroups();
    for (const [, g] of Object.entries(groups)) {
      if (g.folder === 'main') continue; // Already covered by klaw
      agents.push({ id: g.folder, name: g.name });
    }

    return agents;
  }

  /**
   * Gracefully close the WebSocket server.
   */
  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
    instance = null;
    logger.info('KlawHQ WebSocket event server closed');
  }
}
