import { execSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';

import { Bot, InputFile } from 'grammy';

import { GROUPS_DIR } from './config.js';

import {
  AGENT_RUNNER_ENTRY,
  ASSISTANT_NAME,
  DATA_DIR,
  EXECUTION_MODE,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  MAX_HISTORY_AGE_MS,
  POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import {
  AvailableGroup,
  runAgent as runContainerAgentDispatch,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  getDb,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  storeChatMetadata,
  storeMessage,
  // Team functions
  getTeam,
  getTeamMembers,
  getTeamTasks,
  getPendingTeamTasks,
  createTeamTask,
  claimTeamTask,
  completeTeamTask,
  updateTeamTask,
  createTeamMessage,
  getUnreadTeamMessages,
  markTeamMessagesRead,
} from './db.js';
import { MemoryManager } from './memory/manager.js';
import { MemoryIpcRequest, MemoryIpcResponse } from './memory/types.js';
import { startSchedulerLoop } from './task-scheduler.js';
import {
  createNewTeam,
  spawnTeammate,
  shutdownTeammate,
  cleanupTeam,
  startTeamWatcher,
  writeTeamSnapshot,
} from './team-manager.js';
import { NewMessage, RegisteredGroup, Session, TeamTask } from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';

let bot: Bot;
let botUserId: number | undefined;
let lastTimestamp = '';
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let memoryManager: MemoryManager;

/**
 * Set of recently processed message IDs (format: "msgId:chatJid").
 * Prevents duplicate processing when the system crashes mid-loop and
 * the same message is re-fetched on restart (at-least-once → exactly-once).
 * We keep a bounded window to avoid unbounded memory growth.
 */
const MAX_PROCESSED_IDS = 500;
let processedMessageIds: Set<string> = new Set();

/**
 * Track Telegram messages we've already seen in this session (format: "messageId:chatId").
 * When polling reconnects after an error, the library may re-deliver
 * the same messages. By tracking what we've seen we prevent duplicate storage
 * and downstream duplicate processing.
 */
const seenUpdateIds: Set<string> = new Set();
const MAX_SEEN_UPDATES = 1000;

/**
 * Track messages currently being processed by an agent (in-flight).
 * Prevents the 2-second message loop from re-dispatching a message
 * while its agent container is still running.
 */
const inFlightMessages: Set<string> = new Set();

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    processed_message_ids?: string[];
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  // Restore processed message IDs from disk (prevents duplicates after crash/restart)
  processedMessageIds = new Set(state.processed_message_ids || []);
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  logger.info(
    {
      groupCount: Object.keys(registeredGroups).length,
      processedIds: processedMessageIds.size,
    },
    'State loaded',
  );
}

function saveState(): void {
  // Trim processedMessageIds to bounded window before persisting
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const arr = Array.from(processedMessageIds);
    processedMessageIds = new Set(arr.slice(arr.length - MAX_PROCESSED_IDS));
  }
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
    processed_message_ids: Array.from(processedMessageIds),
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Start memory file watcher for the new group
  if (memoryManager) {
    memoryManager.watchGroup(group.folder);
  }

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Convert a Telegram chat ID to a string JID for internal use.
 * Format: "{chatId}@telegram"
 */
function chatIdToJid(chatId: number): string {
  return `${chatId}@telegram`;
}

/**
 * Extract the Telegram chat ID from a JID string.
 */
function jidToChatId(jid: string): number {
  return parseInt(jid.split('@')[0], 10);
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@telegram'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

async function processMessage(msg: NewMessage): Promise<void> {
  const group = registeredGroups[msg.chat_jid];
  if (!group) return;

  const agentTs = lastAgentTimestamp[msg.chat_jid] || '';
  const historyFloor = new Date(Date.now() - MAX_HISTORY_AGE_MS).toISOString();
  const sinceTimestamp = agentTs > historyFloor ? agentTs : historyFloor;
  const missedMessages = getMessagesSince(
    msg.chat_jid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  const lines = missedMessages.map((m) => {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });
  const prompt = `<messages>\n${lines.join('\n')}\n</messages>`;

  if (!prompt) return;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  await sendTyping(msg.chat_jid);
  const response = await runAgent(group, prompt, msg.chat_jid);

  if (response) {
    lastAgentTimestamp[msg.chat_jid] = msg.timestamp;
    await sendMessage(msg.chat_jid, `${ASSISTANT_NAME}: ${response}`);
  }
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    await memoryManager.sync(group.folder);
  } catch (err) {
    logger.warn({ group: group.name, err }, 'Memory sync failed (non-fatal)');
  }

  try {
    const output = await runContainerAgentDispatch(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid,
      isMain,
    });

    if (output.sessionCleared) {
      logger.warn(
        { group: group.name, oldSessionId: sessionId },
        'Agent recovered from corrupt session by starting fresh',
      );
    }

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      if (sessions[group.folder]) {
        logger.info(
          { group: group.name, sessionId: sessions[group.folder] },
          'Clearing failed session to prevent retry loop',
        );
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
      }
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    if (sessions[group.folder]) {
      logger.info(
        { group: group.name, sessionId: sessions[group.folder] },
        'Clearing session after unexpected error',
      );
      delete sessions[group.folder];
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }
    return null;
  }
}

async function sendTyping(jid: string): Promise<void> {
  try {
    const chatId = jidToChatId(jid);
    await bot.api.sendChatAction(chatId, 'typing');
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to send typing action');
  }
}

const TELEGRAM_MAX_LENGTH = 4096;

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

async function sendMessage(jid: string, text: string): Promise<void> {
  const chatId = jidToChatId(jid);
  const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH);
  const maxRetries = 3;

  for (const chunk of chunks) {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await bot.api.sendMessage(chatId, chunk);
        lastError = null;
        break;
      } catch (err) {
        lastError = err as Error;
        logger.warn({ jid, attempt, maxRetries }, 'Send failed, retrying...');
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    if (lastError) {
      logger.error({ jid, err: lastError }, 'Failed to send message after retries');
      return;
    }
  }
  logger.info({ jid, length: text.length, chunks: chunks.length }, 'Message sent');
}

/**
 * Download a file from Telegram to a local directory.
 * Replacement for node-telegram-bot-api's bot.downloadFile().
 */
async function downloadTelegramFile(fileId: string, destDir: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const ext = path.extname(file.file_path || '');
  const destPath = path.join(destDir, `${fileId}${ext}`);

  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      res.pipe(dest);
      dest.on('finish', () => dest.close(() => resolve(destPath)));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors' && f !== 'teammates';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    // Process teammate IPC directories
    const teammatesDir = path.join(ipcBaseDir, 'teammates');
    if (fs.existsSync(teammatesDir)) {
      try {
        const teammateIds = fs.readdirSync(teammatesDir).filter((f) => {
          const stat = fs.statSync(path.join(teammatesDir, f));
          return stat.isDirectory();
        });
        for (const memberId of teammateIds) {
          const teammateTasksDir = path.join(teammatesDir, memberId, 'tasks');
          if (fs.existsSync(teammateTasksDir)) {
            const taskFiles = fs
              .readdirSync(teammateTasksDir)
              .filter((f) => f.endsWith('.json'));
            for (const file of taskFiles) {
              const filePath = path.join(teammateTasksDir, file);
              try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                await processTaskIpc(data, `teammate:${memberId}`, false);
                fs.unlinkSync(filePath);
              } catch (err) {
                logger.error({ file, memberId, err }, 'Error processing teammate IPC');
                const errorDir = path.join(ipcBaseDir, 'errors');
                fs.mkdirSync(errorDir, { recursive: true });
                fs.renameSync(filePath, path.join(errorDir, `teammate-${memberId}-${file}`));
              }
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error processing teammate IPC directories');
      }
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');
      const memoryDir = path.join(ipcBaseDir, sourceGroup, 'memory');

      // Process messages
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  const isSteering = data.source === 'centcomm-steering';
                  const messageText = isSteering ? data.text : `${ASSISTANT_NAME}: ${data.text}`;
                  const messageId = `ipc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const timestamp = data.timestamp || new Date().toISOString();

                  await sendMessage(data.chatJid, messageText);

                  storeMessage({
                    id: messageId,
                    chatJid: data.chatJid,
                    sender: isSteering ? 'centcomm' : sourceGroup,
                    senderName: isSteering ? 'CENTCOMM' : sourceGroup,
                    content: messageText,
                    timestamp,
                    isFromMe: !isSteering,
                  });

                  logger.info(
                    { chatJid: data.chatJid, sourceGroup, stored: true, isSteering },
                    'IPC message sent and stored',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              } else if (data.type === 'photo' && data.chatJid && data.filePath) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  const chatId = jidToChatId(data.chatJid);
                  let photoPath = data.filePath as string;

                  if (photoPath.startsWith('/workspace/group/')) {
                    photoPath = path.join(
                      GROUPS_DIR,
                      sourceGroup,
                      photoPath.slice('/workspace/group/'.length),
                    );
                  } else if (photoPath.startsWith('/workspace/project/')) {
                    photoPath = path.join(
                      GROUPS_DIR,
                      '..',
                      photoPath.slice('/workspace/project/'.length),
                    );
                  }

                  if (!fs.existsSync(photoPath)) {
                    logger.error(
                      { chatJid: data.chatJid, filePath: photoPath, originalPath: data.filePath, sourceGroup },
                      'IPC photo file not found on host',
                    );
                  } else {
                    try {
                      await bot.api.sendPhoto(chatId, new InputFile(photoPath), {
                        caption: data.caption || undefined,
                      });
                      logger.info(
                        { chatJid: data.chatJid, sourceGroup, filePath: photoPath },
                        'IPC photo sent',
                      );
                    } catch (photoErr) {
                      logger.error(
                        { chatJid: data.chatJid, sourceGroup, filePath: photoPath, err: photoErr },
                        'Failed to send IPC photo',
                      );
                    }
                  }
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC photo attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }

      // Process memory IPC requests
      try {
        if (fs.existsSync(memoryDir)) {
          const reqFiles = fs
            .readdirSync(memoryDir)
            .filter((f) => f.startsWith('req-') && f.endsWith('.json'));
          for (const file of reqFiles) {
            const filePath = path.join(memoryDir, file);
            try {
              const req: MemoryIpcRequest = JSON.parse(
                fs.readFileSync(filePath, 'utf-8'),
              );
              const reqId = req.id;
              let res: MemoryIpcResponse;

              if (req.type === 'memory_search') {
                const results = await memoryManager.search(
                  sourceGroup,
                  req.query,
                  req.maxResults,
                  req.minScore,
                );
                res = { id: reqId, status: 'success', results };
              } else if (req.type === 'memory_get') {
                const content = memoryManager.readFile(
                  sourceGroup,
                  req.path,
                  req.startLine,
                  req.endLine,
                );
                if (content !== null) {
                  res = { id: reqId, status: 'success', content };
                } else {
                  res = {
                    id: reqId,
                    status: 'error',
                    error: 'File not found or access denied',
                  };
                }
              } else {
                res = {
                  id: reqId,
                  status: 'error',
                  error: `Unknown memory request type`,
                };
              }

              const resPath = path.join(memoryDir, `res-${reqId}.json`);
              const tmpPath = `${resPath}.tmp`;
              fs.writeFileSync(tmpPath, JSON.stringify(res));
              fs.renameSync(tmpPath, resPath);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing memory IPC request',
              );
              try {
                fs.unlinkSync(filePath);
              } catch { /* ignore */ }
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading memory IPC directory',
        );
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    max_retries?: number;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For agent_message
    targetGroup?: string;
    message?: string;
    subject?: string;
    inReplyTo?: string;
    // For team operations
    teamId?: string;
    teamName?: string;
    teammateName?: string;
    teammatePrompt?: string;
    teammateModel?: string;
    memberId?: string;
    fromMember?: string;
    toMember?: string;
    content?: string;
    taskTitle?: string;
    taskDescription?: string;
    taskStatus?: 'pending' | 'in_progress' | 'completed' | 'blocked';
    priority?: number;
    dependsOn?: string;
  },
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
  const {
    createTask,
    updateTask,
    deleteTask,
    getTaskById: getTask,
  } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        (data.targetJid || data.groupFolder)
      ) {
        let targetJid: string;
        let targetGroup: string;

        if (data.targetJid) {
          targetJid = data.targetJid as string;
          const targetGroupEntry = registeredGroups[targetJid];
          if (!targetGroupEntry) {
            logger.warn(
              { targetJid },
              'Cannot schedule task: target group not registered',
            );
            break;
          }
          targetGroup = targetGroupEntry.folder;
        } else {
          targetGroup = data.groupFolder as string;
          const matchingEntry = Object.entries(registeredGroups).find(
            ([, group]) => group.folder === targetGroup,
          );
          if (!matchingEntry) {
            logger.warn(
              { targetGroup },
              'Cannot schedule task: target group folder not registered',
            );
            break;
          }
          targetJid = matchingEntry[0];
        }

        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: data.max_retries ?? 3,
        });
        logger.info(
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task paused via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task pause attempt');
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task resume attempt');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task cancelled via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task cancel attempt');
        }
      }
      break;

    case 'register_group':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized register_group attempt blocked');
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn({ data }, 'Invalid register_group request - missing required fields');
      }
      break;

    case 'agent_message':
      if (data.targetGroup && data.message) {
        const targetGroupEntry = Object.values(registeredGroups).find(
          (g) => g.folder === data.targetGroup,
        );
        if (!targetGroupEntry) {
          logger.warn(
            { from: sourceGroup, targetGroup: data.targetGroup },
            'agent_message: target group not registered, dropping',
          );
          break;
        }

        const inboxDir = path.join(DATA_DIR, 'ipc', data.targetGroup as string, 'agent-inbox');
        fs.mkdirSync(inboxDir, { recursive: true });

        const msgId = `amsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const payload = {
          id: msgId,
          from: sourceGroup,
          to: data.targetGroup,
          subject: data.subject || '',
          message: data.message,
          inReplyTo: data.inReplyTo || null,
          timestamp: new Date().toISOString(),
        };

        const msgPath = path.join(inboxDir, `${msgId}.json`);
        const tmpPath = `${msgPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
        fs.renameSync(tmpPath, msgPath);

        logger.info(
          { from: sourceGroup, to: data.targetGroup, msgId },
          'Agent message routed to inbox',
        );
      } else {
        logger.warn({ data }, 'agent_message: missing targetGroup or message');
      }
      break;

    case 'create_team':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized create_team attempt');
        break;
      }
      if (data.teamName) {
        try {
          const team = createNewTeam(data.teamName, sourceGroup);
          logger.info({ teamId: team.id, name: data.teamName }, 'Team created via IPC');
        } catch (err) {
          logger.error({ err, teamName: data.teamName }, 'Failed to create team');
        }
      }
      break;

    case 'spawn_teammate':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized spawn_teammate attempt');
        break;
      }
      if (data.teamId && data.teammateName && data.teammatePrompt) {
        try {
          await spawnTeammate({
            teamId: data.teamId,
            name: data.teammateName,
            prompt: data.teammatePrompt,
            model: data.teammateModel,
            leadGroup: sourceGroup,
          });
          logger.info(
            { teamId: data.teamId, name: data.teammateName },
            'Teammate spawned via IPC',
          );
        } catch (err) {
          logger.error({ err, teamId: data.teamId }, 'Failed to spawn teammate');
        }
      }
      break;

    case 'shutdown_teammate':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized shutdown_teammate attempt');
        break;
      }
      if (data.memberId) {
        shutdownTeammate(data.memberId);
        logger.info({ memberId: data.memberId }, 'Teammate shutdown via IPC');
      }
      break;

    case 'cleanup_team':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized cleanup_team attempt');
        break;
      }
      if (data.teamId) {
        cleanupTeam(data.teamId);
        logger.info({ teamId: data.teamId }, 'Team cleaned up via IPC');
      }
      break;

    case 'team_message':
      if (data.teamId && data.fromMember && data.content) {
        createTeamMessage({
          team_id: data.teamId,
          from_member: data.fromMember,
          to_member: data.toMember || null,
          content: data.content,
          created_at: new Date().toISOString(),
        });
        logger.debug(
          { teamId: data.teamId, from: data.fromMember, to: data.toMember },
          'Team message created',
        );
      }
      break;

    case 'create_team_task':
      if (data.teamId && data.taskTitle) {
        const taskId = `ttask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newTask: TeamTask = {
          id: taskId,
          team_id: data.teamId,
          title: data.taskTitle,
          description: data.taskDescription || null,
          status: 'pending',
          assigned_to: null,
          depends_on: data.dependsOn || null,
          priority: data.priority || 0,
          created_at: new Date().toISOString(),
          completed_at: null,
        };
        createTeamTask(newTask);
        logger.info({ taskId, teamId: data.teamId }, 'Team task created via IPC');
      }
      break;

    case 'claim_team_task':
      if (data.taskId && data.memberId) {
        const claimed = claimTeamTask(data.taskId, data.memberId);
        if (claimed) {
          logger.info({ taskId: data.taskId, memberId: data.memberId }, 'Team task claimed');
        } else {
          logger.debug({ taskId: data.taskId, memberId: data.memberId }, 'Team task already taken');
        }
      }
      break;

    case 'complete_team_task':
      if (data.taskId) {
        completeTeamTask(data.taskId);
        logger.info({ taskId: data.taskId }, 'Team task completed');
      }
      break;

    case 'update_team_task':
      if (data.taskId) {
        updateTeamTask(data.taskId, {
          status: data.taskStatus,
          description: data.taskDescription,
        });
        logger.info({ taskId: data.taskId }, 'Team task updated');
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

function connectTelegram(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error(
      'TELEGRAM_BOT_TOKEN not set in .env file. Get a token from @BotFather on Telegram.',
    );
    process.exit(1);
  }

  bot = new Bot(token);

  bot.on('message', async (ctx) => {
    const msg = ctx.message;

    // Dedup at intake — grammy may re-deliver messages on reconnect
    const intakeKey = `${msg.message_id}:${msg.chat.id}`;
    if (seenUpdateIds.has(intakeKey)) {
      logger.debug({ messageId: msg.message_id, chatId: msg.chat.id }, 'Skipping duplicate Telegram message at intake');
      return;
    }
    seenUpdateIds.add(intakeKey);
    if (seenUpdateIds.size > MAX_SEEN_UPDATES) {
      const iterator = seenUpdateIds.values();
      const toRemove = seenUpdateIds.size - MAX_SEEN_UPDATES;
      for (let i = 0; i < toRemove; i++) {
        const val = iterator.next().value;
        if (val !== undefined) seenUpdateIds.delete(val);
      }
    }

    const chatId = msg.chat.id;
    const jid = chatIdToJid(chatId);
    const timestamp = new Date((msg.date || 0) * 1000).toISOString();

    const chatName =
      msg.chat.title ||
      [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') ||
      String(chatId);

    storeChatMetadata(jid, timestamp, chatName);

    // Auto-register: if no groups registered yet, register this chat as main
    if (Object.keys(registeredGroups).length === 0) {
      registerGroup(jid, {
        name: chatName,
        folder: MAIN_GROUP_FOLDER,
        trigger: `@${ASSISTANT_NAME}`,
        added_at: new Date().toISOString(),
      });
      logger.info({ jid, chatName }, 'Auto-registered first chat as main group');
      await bot.api.sendMessage(
        chatId,
        `Registered this chat as the main channel. Send any message and ${ASSISTANT_NAME} will respond.`,
      );
    }

    let content = msg.text || '';

    // Handle document uploads
    if (msg.document && registeredGroups[jid]) {
      const group = registeredGroups[jid];
      const fileName = msg.document.file_name || `file-${msg.document.file_id}`;
      const caption = msg.caption || '';

      try {
        const uploadsDir = path.join(GROUPS_DIR, group.folder, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        const downloadedPath = await downloadTelegramFile(
          msg.document.file_id,
          uploadsDir,
        );

        const finalPath = path.join(uploadsDir, fileName);
        fs.renameSync(downloadedPath, finalPath);

        const ext = path.extname(fileName).toLowerCase();
        const textExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sh', '.env', '.toml', '.ini', '.cfg'];

        if (textExtensions.includes(ext)) {
          const fileContent = fs.readFileSync(finalPath, 'utf-8');
          content = `${caption}\n\n[Uploaded file: ${fileName}]\n\`\`\`\n${fileContent}\n\`\`\``;
        } else {
          content = `${caption}\n\n[Uploaded file: ${fileName} - saved to uploads/${fileName}]`;
        }

        logger.info({ fileName, finalPath }, 'File downloaded from Telegram');
      } catch (err) {
        logger.error({ err, fileName }, 'Failed to download file');
        content = `${caption}\n\n[Failed to download file: ${fileName}]`;
      }
    }

    if (!content) return;

    if (registeredGroups[jid]) {
      const senderName =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
        msg.from?.username ||
        String(msg.from?.id || 'unknown');

      storeMessage({
        id: String(msg.message_id),
        chatJid: jid,
        sender: String(msg.from?.id || ''),
        senderName,
        content,
        timestamp,
        isFromMe: msg.from?.id === botUserId,
      });
    }
  });

  // grammy's bot.start() handles reconnection automatically — no manual retry logic needed
  bot.start({
    onStart: async (botInfo) => {
      botUserId = botInfo.id;
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        'Connected to Telegram',
      );

      startSchedulerLoop({
        sendMessage,
        registeredGroups: () => registeredGroups,
        getSessions: () => sessions,
      });
      startIpcWatcher();
      startMessageLoop();
    },
  });
}

async function startMessageLoop(): Promise<void> {
  logger.info(`NanoClaw running on Telegram (assistant: ${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0)
        logger.info({ count: messages.length }, 'New messages');
      for (const msg of messages) {
        const dedupKey = `${msg.id}:${msg.chat_jid}`;
        if (processedMessageIds.has(dedupKey)) {
          logger.debug(
            { msgId: msg.id, chatJid: msg.chat_jid },
            'Skipping already-processed message (dedup)',
          );
          lastTimestamp = msg.timestamp;
          saveState();
          continue;
        }

        if (inFlightMessages.has(dedupKey)) {
          logger.debug(
            { msgId: msg.id, chatJid: msg.chat_jid },
            'Skipping in-flight message (agent still running)',
          );
          continue;
        }

        try {
          inFlightMessages.add(dedupKey);
          await processMessage(msg);
          processedMessageIds.add(dedupKey);
          lastTimestamp = msg.timestamp;
          saveState();
        } catch (err) {
          logger.error(
            { err, msg: msg.id },
            'Error processing message, will retry',
          );
          break;
        } finally {
          inFlightMessages.delete(dedupKey);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function ensureDockerRunning(): void {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10000 });
    logger.debug('Docker daemon is running');
  } catch {
    logger.error('Docker daemon is not running');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Docker is not running                                  ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without Docker. To fix:                     ║',
    );
    console.error(
      '║  macOS: Start Docker Desktop                                   ║',
    );
    console.error(
      '║  Linux: sudo systemctl start docker                            ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Install from: https://docker.com/products/docker-desktop      ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Docker is required but not running');
  }
}

function ensureAgentRunnerExists(): void {
  if (!fs.existsSync(AGENT_RUNNER_ENTRY)) {
    logger.error({ entry: AGENT_RUNNER_ENTRY }, 'Agent runner entry not found');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Agent runner not built                                ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Run: npm run build:agent                                     ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Agent runner entry not found. Run npm run build:agent');
  }
}

async function main(): Promise<void> {
  if (EXECUTION_MODE === 'docker') {
    ensureDockerRunning();
  } else {
    ensureAgentRunnerExists();
  }
  logger.info({ executionMode: EXECUTION_MODE }, 'Execution mode');
  initDatabase();
  logger.info('Database initialized');

  memoryManager = new MemoryManager(getDb());
  logger.info('Memory system initialized');

  loadState();

  for (const group of Object.values(registeredGroups)) {
    memoryManager.watchGroup(group.folder);
  }

  startTeamWatcher();
  connectTelegram();
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start NanoClaw');
  process.exit(1);
});
