import fs from 'fs';
import https from 'https';
import path from 'path';

import { Bot, InputFile } from 'grammy';

import { GROUPS_DIR } from './config.js';

import {
  createDefaultPipeline,
  MiddlewarePipeline,
  MiddlewareServices,
} from './middleware/index.js';
import { FactExtractor } from './memory/fact-extractor.js';

import {
  AGENT_RUNNER_ENTRY,
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  MAX_HISTORY_AGE_MS,
  POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import {
  AvailableGroup,
  ContainerInput,
  runAgent as runContainerAgentDispatch,
} from './container-runner.js';
import { runLocalAgent } from './local-runner.js';
import {
  getAllChats,
  getAllTasks,
  getDb,
  getMessagesSince,
  getNewMessages,
  initDatabase,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { MemoryManager } from './memory/manager.js';
import { MemoryIpcRequest, MemoryIpcResponse } from './memory/types.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { addPendingRequest, addToDmAllowlist, dmRejectTimes, getDmAllowlist, loadDmAllowlist, removeFromDmAllowlist } from './dm-allowlist.js';
import { registerCallbackHandler, processApprovalRequest, cleanupStaleApprovals } from './inline-keyboards.js';
import { startBrowserDaemon } from './browser-daemon.js';
import { NewMessage, RegisteredGroup, Session } from './types.js';
import { formatOutbound } from './router.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import { transcribeVoiceMessage } from './transcription.js';

let bot: Bot;
let botUserId: number | undefined;
let lastTimestamp = '';
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let memoryManager: MemoryManager;
let factExtractor: FactExtractor;
let pipeline: MiddlewarePipeline;

const MAX_PROCESSED_IDS = 500;
let processedMessageIds: Set<string> = new Set();

const seenUpdateIds: Set<string> = new Set();
const MAX_SEEN_UPDATES = 1000;

const inFlightMessages: Set<string> = new Set();
const activeGroups: Set<string> = new Set();
const pendingGroupMessages: Map<string, NewMessage[]> = new Map();

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    processed_message_ids?: string[];
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  processedMessageIds = new Set(state.processed_message_ids || []);
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  const allowlist = loadDmAllowlist();

  logger.info(
    {
      groupCount: Object.keys(registeredGroups).length,
      processedIds: processedMessageIds.size,
      dmAllowedUsers: allowlist.allowed_user_ids.length,
    },
    'State loaded',
  );
}

function saveState(): void {
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

  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  if (memoryManager) {
    memoryManager.watchGroup(group.folder);
  }

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function chatIdToJid(chatId: number): string {
  return `${chatId}@telegram`;
}

function jidToChatId(jid: string): number {
  return parseInt(jid.split('@')[0], 10);
}

export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

export function getAvailableGroups(): AvailableGroup[] {
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
    let content = m.content;
    if (content.startsWith(`${ASSISTANT_NAME}: `)) {
      content = content.slice(ASSISTANT_NAME.length + 2);
    }
    const role = m.sender_name === ASSISTANT_NAME ? 'assistant' : 'user';
    return `<message sender="${escapeXml(m.sender_name)}" role="${role}" time="${m.timestamp}">${escapeXml(content)}</message>`;
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
    const cleanResponse = formatOutbound(response);
    if (cleanResponse) {
      const fullResponse = `${ASSISTANT_NAME}: ${cleanResponse}`;
      await sendMessage(msg.chat_jid, fullResponse);
      storeMessage({
        id: `agent-resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatJid: msg.chat_jid,
        sender: ASSISTANT_NAME,
        senderName: ASSISTANT_NAME,
        content: fullResponse,
        timestamp: new Date().toISOString(),
        isFromMe: true,
      });
    }
  }
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
): Promise<string | null> {
  const ctx = {
    group,
    chatJid,
    prompt,
    isMain: group.folder === MAIN_GROUP_FOLDER,
    meta: {} as Record<string, unknown>,
  };

  try {
    const result = await pipeline.execute(ctx);
    return result.response;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Pipeline error');
    return null;
  }
}

/**
 * Background Review Agent — Hermes-inspired post-session review.
 * Spawns a lightweight agent (Haiku by default) that reviews the conversation
 * and writes learnings to persistent storage. Fire-and-forget.
 */
async function runBackgroundReview(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  model?: string,
): Promise<void> {
  const reviewModel = model || process.env.REVIEW_MODEL || 'claude-haiku-4-5-20251001';
  const timeout = 120_000; // 2 minutes max for review

  const input: ContainerInput = {
    prompt,
    groupFolder: group.folder,
    chatJid,
    isMain: group.folder === MAIN_GROUP_FOLDER,
    isScheduledTask: true, // Suppress output to user
  };

  // Override model for cost efficiency
  const savedModel = process.env.NANOCLAW_MODEL;
  process.env.NANOCLAW_MODEL = reviewModel;

  try {
    const result = await Promise.race([
      runLocalAgent(group, input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Background review timed out')), timeout)
      ),
    ]);
    logger.info(
      { group: group.folder, status: result.status, model: reviewModel },
      'Background review completed',
    );
  } finally {
    // Restore original model
    if (savedModel) {
      process.env.NANOCLAW_MODEL = savedModel;
    } else {
      delete process.env.NANOCLAW_MODEL;
    }
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
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
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
                  const cleanIpcText = formatOutbound(data.text);
                  if (!cleanIpcText) { fs.unlinkSync(filePath); continue; }
                  const messageText = `${ASSISTANT_NAME}: ${cleanIpcText}`;
                  const messageId = `ipc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const timestamp = data.timestamp || new Date().toISOString();

                  await sendMessage(data.chatJid, messageText);

                  storeMessage({
                    id: messageId,
                    chatJid: data.chatJid,
                    sender: sourceGroup,
                    senderName: sourceGroup,
                    content: messageText,
                    timestamp,
                    isFromMe: true,
                  });

                  logger.info(
                    { chatJid: data.chatJid, sourceGroup, stored: true },
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
                      { chatJid: data.chatJid, filePath: photoPath },
                      'IPC photo file not found on host',
                    );
                  } else {
                    try {
                      await bot.api.sendPhoto(chatId, new InputFile(photoPath), {
                        caption: data.caption || undefined,
                      });
                    } catch (photoErr) {
                      logger.error(
                        { chatJid: data.chatJid, filePath: photoPath, err: photoErr },
                        'Failed to send IPC photo',
                      );
                    }
                  }
                }
              } else if (data.type === 'document' && data.chatJid && data.filePath) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  const chatId = jidToChatId(data.chatJid);
                  let docPath = data.filePath as string;

                  if (docPath.startsWith('/workspace/group/')) {
                    docPath = path.join(
                      GROUPS_DIR,
                      sourceGroup,
                      docPath.slice('/workspace/group/'.length),
                    );
                  } else if (docPath.startsWith('/workspace/project/')) {
                    docPath = path.join(
                      GROUPS_DIR,
                      '..',
                      docPath.slice('/workspace/project/'.length),
                    );
                  }

                  if (!fs.existsSync(docPath)) {
                    logger.error(
                      { chatJid: data.chatJid, filePath: docPath },
                      'IPC document file not found on host',
                    );
                  } else {
                    try {
                      await bot.api.sendDocument(chatId, new InputFile(docPath), {
                        caption: data.caption || undefined,
                      });
                    } catch (docErr) {
                      logger.error(
                        { chatJid: data.chatJid, filePath: docPath, err: docErr },
                        'Failed to send IPC document',
                      );
                    }
                  }
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
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
    targetGroup?: string;
    message?: string;
    subject?: string;
    inReplyTo?: string;
    task_id?: string;
    text?: string;
    url?: string;
    source?: string;
    user_id?: number;
    requiresTrigger?: boolean;
    requestId?: string;
    description?: string;
    approveLabel?: string;
    rejectLabel?: string;
    options?: string[];
    ipcDir?: string;
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
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task cancelled via IPC');
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
            'agent_message: target group not registered',
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
      }
      break;

    case 'edit_task': {
      const editTaskId = data.taskId || data.task_id;
      if (editTaskId) {
        const task = getTask(editTaskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          const updates: Parameters<typeof updateTask>[1] = {};
          if (data.prompt !== undefined) updates.prompt = data.prompt;
          if (data.context_mode !== undefined) updates.context_mode = data.context_mode as 'group' | 'isolated';

          const newScheduleType = (data.schedule_type || task.schedule_type) as 'cron' | 'interval' | 'once';
          const newScheduleValue = data.schedule_value || task.schedule_value;
          const scheduleChanged = data.schedule_type !== undefined || data.schedule_value !== undefined;

          if (data.schedule_type !== undefined) updates.schedule_type = data.schedule_type as 'cron' | 'interval' | 'once';
          if (data.schedule_value !== undefined) updates.schedule_value = data.schedule_value;

          if (scheduleChanged && task.status === 'active') {
            if (newScheduleType === 'cron') {
              try {
                const interval = CronExpressionParser.parse(newScheduleValue, { tz: TIMEZONE });
                updates.next_run = interval.next().toISOString();
              } catch {
                break;
              }
            } else if (newScheduleType === 'interval') {
              const ms = parseInt(newScheduleValue, 10);
              if (isNaN(ms) || ms <= 0) break;
              updates.next_run = new Date(Date.now() + ms).toISOString();
            } else if (newScheduleType === 'once') {
              const scheduled = new Date(newScheduleValue);
              if (isNaN(scheduled.getTime())) break;
              updates.next_run = scheduled.toISOString();
            }
          }

          updateTask(editTaskId, updates);
          logger.info({ taskId: editTaskId, sourceGroup, updates: Object.keys(updates) }, 'Task edited via IPC');
        }
      }
      break;
    }

    case 'refresh_groups':
      if (isMain) {
        logger.info({ sourceGroup }, 'Group metadata refresh requested via IPC');
      }
      break;

    case 'dm_allowlist_add':
      if (isMain && typeof data.user_id === 'number') {
        const added = addToDmAllowlist(data.user_id);
        logger.info({ userId: data.user_id, added }, 'dm_allowlist_add processed');
      }
      break;

    case 'dm_allowlist_remove':
      if (isMain && typeof data.user_id === 'number') {
        const removed = removeFromDmAllowlist(data.user_id);
        logger.info({ userId: data.user_id, removed }, 'dm_allowlist_remove processed');
      }
      break;

    case 'dm_allowlist_list': {
      if (!isMain) break;
      const allowlist = getDmAllowlist();
      const responseDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
      fs.mkdirSync(responseDir, { recursive: true });
      const responseFile = path.join(responseDir, `dm_allowlist_${Date.now()}.json`);
      fs.writeFileSync(responseFile, JSON.stringify(allowlist, null, 2));
      break;
    }

    case 'request_approval':
      if (data.chatJid && data.description) {
        try {
          await processApprovalRequest(bot, {
            requestId: data.requestId || `approval-${Date.now()}`,
            chatJid: data.chatJid,
            description: data.description,
            approveLabel: data.approveLabel,
            rejectLabel: data.rejectLabel,
            options: data.options,
            ipcDir: data.ipcDir || path.join(DATA_DIR, 'ipc', sourceGroup),
            groupFolder: sourceGroup,
          });
        } catch (err) {
          logger.error({ err }, 'Failed to process approval request');
        }
      }
      break;

    case 'background_review': {
      // Hermes-inspired post-session review: spawn a lightweight agent to
      // review the conversation and write learnings to persistent storage.
      const reviewData = data as {
        prompt?: string;
        groupFolder?: string;
        chatJid?: string;
        model?: string;
      };
      if (reviewData.prompt && reviewData.groupFolder) {
        const reviewGroup = Object.entries(registeredGroups).find(
          ([, g]) => g.folder === reviewData.groupFolder,
        );
        if (reviewGroup) {
          const [reviewJid, reviewGroupConfig] = reviewGroup;
          // Fire-and-forget: spawn review agent in background
          runBackgroundReview(
            reviewGroupConfig,
            reviewData.prompt,
            reviewData.chatJid || reviewJid,
            reviewData.model,
          ).catch((err) => {
            logger.error({ err, group: reviewData.groupFolder }, 'Background review failed');
          });
          logger.info(
            { group: reviewData.groupFolder },
            'Background review agent spawned',
          );
        }
      }
      break;
    }

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

  registerCallbackHandler(bot);

  bot.on('message', async (ctx) => {
    const msg = ctx.message;

    const intakeKey = `${msg.message_id}:${msg.chat.id}`;
    if (seenUpdateIds.has(intakeKey)) {
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

    // DM allowlist gate
    if (chatId > 0 && !registeredGroups[jid]) {
      const userId = msg.from?.id;
      const allowlist = getDmAllowlist();
      if (userId && !allowlist.allowed_user_ids.includes(userId)) {
        const now = Date.now();
        const lastReject = dmRejectTimes.get(userId) || 0;
        if (now - lastReject > 3_600_000) {
          dmRejectTimes.set(userId, now);
          await bot.api.sendMessage(
            chatId,
            'This bot is private. Contact the owner for access.',
          );
        }
        addPendingRequest(userId, msg.from?.username, msg.from?.first_name);
        return;
      }
    }

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
      } catch (err) {
        logger.error({ err, fileName }, 'Failed to download file');
        content = `${caption}\n\n[Failed to download file: ${fileName}]`;
      }
    }

    // Handle photo messages
    if (msg.photo && msg.photo.length > 0 && registeredGroups[jid]) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      const caption = msg.caption || '';

      try {
        const group = registeredGroups[jid];
        const uploadsDir = path.join(GROUPS_DIR, group.folder, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        const downloadedPath = await downloadTelegramFile(
          largestPhoto.file_id,
          uploadsDir,
        );

        const fileName = path.basename(downloadedPath);
        content = caption
          ? `${caption}\n\n[Photo: uploads/${fileName}]`
          : `[Photo: uploads/${fileName}]`;
      } catch (err) {
        logger.error({ err }, 'Failed to download photo');
        content = caption
          ? `${caption}\n\n[Photo - failed to download]`
          : '[Photo - failed to download]';
      }
    }

    // Handle voice messages
    if (msg.voice && registeredGroups[jid]) {
      try {
        const transcript = await transcribeVoiceMessage(bot, msg.voice);
        const caption = msg.caption || '';
        content = caption
          ? `${caption}\n\n[Voice: ${transcript}]`
          : `[Voice: ${transcript}]`;
      } catch (err) {
        logger.error({ err, chatId }, 'Voice transcription failed');
        content = '[Voice Message - transcription failed]';
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

      setInterval(() => cleanupStaleApprovals(), 5 * 60 * 1000);

      startBrowserDaemon();
    },
  });
}

async function dispatchMessage(msg: NewMessage): Promise<void> {
  const dedupKey = `${msg.id}:${msg.chat_jid}`;
  try {
    inFlightMessages.add(dedupKey);
    await processMessage(msg);
    processedMessageIds.add(dedupKey);
    lastTimestamp = msg.timestamp;
    saveState();
  } catch (err) {
    logger.error(
      { err, msg: msg.id },
      'Error processing message',
    );
  } finally {
    inFlightMessages.delete(dedupKey);
  }
}

async function drainGroupQueue(groupFolder: string): Promise<void> {
  const queued = pendingGroupMessages.get(groupFolder);
  if (!queued || queued.length === 0) {
    pendingGroupMessages.delete(groupFolder);
    activeGroups.delete(groupFolder);
    return;
  }

  const latest = queued[queued.length - 1];
  for (const m of queued) {
    const dk = `${m.id}:${m.chat_jid}`;
    processedMessageIds.add(dk);
    if (m.timestamp > lastTimestamp) {
      lastTimestamp = m.timestamp;
    }
  }
  pendingGroupMessages.set(groupFolder, []);
  saveState();

  await dispatchMessage(latest);
  await drainGroupQueue(groupFolder);
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
          lastTimestamp = msg.timestamp;
          saveState();
          continue;
        }

        if (inFlightMessages.has(dedupKey)) {
          continue;
        }

        const group = registeredGroups[msg.chat_jid];
        const groupFolder = group?.folder || msg.chat_jid;

        if (activeGroups.has(groupFolder)) {
          logger.info(
            { group: groupFolder, msgId: msg.id },
            'Agent busy, queuing message',
          );
          if (!pendingGroupMessages.has(groupFolder)) {
            pendingGroupMessages.set(groupFolder, []);
          }
          pendingGroupMessages.get(groupFolder)!.push(msg);
          lastTimestamp = msg.timestamp;
          saveState();
          continue;
        }

        activeGroups.add(groupFolder);
        dispatchMessage(msg)
          .then(() => drainGroupQueue(groupFolder))
          .catch((err) => {
            logger.error({ err, group: groupFolder }, 'Fatal error in group dispatch');
            activeGroups.delete(groupFolder);
            pendingGroupMessages.delete(groupFolder);
          });
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
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
  ensureAgentRunnerExists();
  logger.info('Execution mode: local');
  initDatabase();
  logger.info('Database initialized');

  memoryManager = new MemoryManager(getDb());
  logger.info('Memory system initialized');

  loadState();

  factExtractor = new FactExtractor(getDb());
  const services: MiddlewareServices = {
    getSessions: () => sessions,
    setSession: (folder, id) => { sessions[folder] = id; },
    clearSession: (folder) => { delete sessions[folder]; },
    saveSessions: () => saveJson(path.join(DATA_DIR, 'sessions.json'), sessions),
    getRegisteredGroups: () => registeredGroups,
    getAvailableGroups,
    getAllTasks,
    getMemoryManager: () => memoryManager,
    getFactExtractor: () => factExtractor,
    runAgent: (group, input) => runContainerAgentDispatch(group, input),
  };
  pipeline = createDefaultPipeline(services, factExtractor);
  logger.info(
    { factExtraction: factExtractor.isAvailable },
    'Middleware pipeline initialized',
  );

  for (const group of Object.values(registeredGroups)) {
    memoryManager.watchGroup(group.folder);
  }

  connectTelegram();
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start NanoClaw');
  process.exit(1);
});
