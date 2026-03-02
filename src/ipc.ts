import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { sendToDiscordChannel } from './discord-pipeline.js';
import { logger } from './logger.js';
import { addToDmAllowlist, getDmAllowlist, removeFromDmAllowlist } from './dm-allowlist.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendPhoto: (jid: string, filePath: string, caption?: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
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

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
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
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              } else if (
                data.type === 'photo' &&
                data.chatJid &&
                data.filePath
              ) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendPhoto(
                    data.chatJid,
                    data.filePath,
                    data.caption,
                  );
                  logger.info(
                    {
                      chatJid: data.chatJid,
                      sourceGroup,
                      filePath: data.filePath,
                    },
                    'IPC photo sent',
                  );
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

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
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
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For edit_task
    task_id?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        (data.targetJid || data.groupFolder)
      ) {
        // Resolve target from either targetJid (stdio MCP) or groupFolder (agent SDK MCP)
        let targetJid: string;
        let targetFolder: string;

        if (data.targetJid) {
          // stdio MCP path: has targetJid, look up folder
          targetJid = data.targetJid as string;
          const targetGroupEntry = registeredGroups[targetJid];
          if (!targetGroupEntry) {
            logger.warn(
              { targetJid },
              'Cannot schedule task: target group not registered',
            );
            break;
          }
          targetFolder = targetGroupEntry.folder;
        } else {
          // agent SDK MCP path: has groupFolder, look up JID
          targetFolder = data.groupFolder as string;
          const matchingEntry = Object.entries(registeredGroups).find(
            ([, g]) => g.folder === targetFolder,
          );
          if (!matchingEntry) {
            logger.warn(
              { targetFolder },
              'Cannot schedule task: target group folder not registered',
            );
            break;
          }
          targetJid = matchingEntry[0];
        }

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
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
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'edit_task': {
      const editTaskId = data.taskId || data.task_id;
      if (editTaskId) {
        const task = getTaskById(editTaskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          const updates: Parameters<typeof updateTask>[1] = {};

          if (data.prompt !== undefined) updates.prompt = data.prompt;
          if (data.context_mode !== undefined) updates.context_mode = data.context_mode;

          // Handle schedule changes — recalculate next_run
          const newScheduleType = data.schedule_type || task.schedule_type;
          const newScheduleValue = data.schedule_value || task.schedule_value;
          const scheduleChanged = data.schedule_type !== undefined || data.schedule_value !== undefined;

          if (data.schedule_type !== undefined) updates.schedule_type = data.schedule_type;
          if (data.schedule_value !== undefined) updates.schedule_value = data.schedule_value;

          if (scheduleChanged && task.status === 'active') {
            // Recalculate next_run based on new schedule
            if (newScheduleType === 'cron') {
              try {
                const interval = CronExpressionParser.parse(newScheduleValue, {
                  tz: TIMEZONE,
                });
                updates.next_run = interval.next().toISOString();
              } catch {
                logger.warn(
                  { scheduleValue: newScheduleValue, taskId: editTaskId },
                  'Invalid cron expression in edit_task',
                );
                break;
              }
            } else if (newScheduleType === 'interval') {
              const ms = parseInt(newScheduleValue, 10);
              if (isNaN(ms) || ms <= 0) {
                logger.warn(
                  { scheduleValue: newScheduleValue, taskId: editTaskId },
                  'Invalid interval in edit_task',
                );
                break;
              }
              updates.next_run = new Date(Date.now() + ms).toISOString();
            } else if (newScheduleType === 'once') {
              const scheduled = new Date(newScheduleValue);
              if (isNaN(scheduled.getTime())) {
                logger.warn(
                  { scheduleValue: newScheduleValue, taskId: editTaskId },
                  'Invalid timestamp in edit_task',
                );
                break;
              }
              updates.next_run = scheduled.toISOString();
            }
          }

          updateTask(editTaskId, updates);
          logger.info(
            { taskId: editTaskId, sourceGroup, updates: Object.keys(updates) },
            'Task edited via IPC',
          );
        } else {
          logger.warn(
            { taskId: editTaskId, sourceGroup },
            'Unauthorized task edit attempt',
          );
        }
      }
      break;
    }

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'discord_post': {
      const postedChannelId = process.env.DISCORD_CHANNEL_POSTED;
      if (!postedChannelId) {
        logger.warn('discord_post: DISCORD_CHANNEL_POSTED not set');
        break;
      }
      const tweetText = data.text || 'No text provided';
      const tweetUrl = data.url || '';
      const source = data.source || 'autonomous';
      const msg = `🐦 **Published to X** (${source})\n\n${tweetText}${tweetUrl ? `\n\n🔗 ${tweetUrl}` : ''}`;
      try {
        await sendToDiscordChannel(msg, postedChannelId);
        logger.info({ url: tweetUrl, source }, 'discord_post: sent to #posted');
      } catch (err) {
        logger.error({ err }, 'discord_post: failed to send to #posted');
      }
      break;
    }

    case 'dm_allowlist_add':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized dm_allowlist_add attempt blocked');
        break;
      }
      if (typeof data.user_id === 'number') {
        const added = addToDmAllowlist(data.user_id);
        logger.info({ userId: data.user_id, added }, 'dm_allowlist_add processed');
      }
      break;

    case 'dm_allowlist_remove':
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized dm_allowlist_remove attempt blocked');
        break;
      }
      if (typeof data.user_id === 'number') {
        const removed = removeFromDmAllowlist(data.user_id);
        logger.info({ userId: data.user_id, removed }, 'dm_allowlist_remove processed');
      }
      break;

    case 'dm_allowlist_list': {
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized dm_allowlist_list attempt blocked');
        break;
      }
      const allowlist = getDmAllowlist();
      // Write result to IPC response file for the agent to read
      const responseDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
      fs.mkdirSync(responseDir, { recursive: true });
      const responseFile = path.join(responseDir, `dm_allowlist_${Date.now()}.json`);
      fs.writeFileSync(responseFile, JSON.stringify(allowlist, null, 2));
      logger.info('dm_allowlist_list: wrote response');
      break;
    }

    case 'canvas_update': {
      const canvasDir = path.join(DATA_DIR, 'canvas', sourceGroup);
      fs.mkdirSync(canvasDir, { recursive: true });

      const canvasPath = path.join(canvasDir, 'canvas.json');
      const eventsPath = path.join(canvasDir, 'events.json');

      // Read current state
      let state: {
        id: string;
        artifacts: Array<Record<string, unknown>>;
        annotations: Array<Record<string, unknown>>;
        viewport: { x: number; y: number; zoom: number };
        lastUpdate: string;
      } = {
        id: sourceGroup,
        artifacts: [],
        annotations: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        lastUpdate: '',
      };
      try {
        if (fs.existsSync(canvasPath)) {
          state = JSON.parse(fs.readFileSync(canvasPath, 'utf-8'));
        }
      } catch {
        /* fresh start */
      }

      const action = data.canvas_action as string;
      let event: Record<string, unknown> | null = null;

      if (action === 'add' && data.artifact) {
        state.artifacts.push(data.artifact as Record<string, unknown>);
        event = { type: 'artifact_add', artifact: data.artifact };
      } else if (action === 'update' && data.artifactId && data.changes) {
        const idx = state.artifacts.findIndex(
          (a) => (a as { id: string }).id === data.artifactId,
        );
        if (idx >= 0) {
          state.artifacts[idx] = {
            ...state.artifacts[idx],
            ...(data.changes as Record<string, unknown>),
            updatedAt: new Date().toISOString(),
          };
          event = {
            type: 'artifact_update',
            artifactId: data.artifactId,
            changes: data.changes,
          };
        }
      } else if (action === 'remove' && data.artifactId) {
        state.artifacts = state.artifacts.filter(
          (a) => (a as { id: string }).id !== data.artifactId,
        );
        event = { type: 'artifact_remove', artifactId: data.artifactId };
      }

      if (event) {
        state.lastUpdate = new Date().toISOString();
        fs.writeFileSync(canvasPath, JSON.stringify(state, null, 2));

        // Append event for SSE streaming (ring buffer, max 100)
        let events: Array<Record<string, unknown>> = [];
        try {
          if (fs.existsSync(eventsPath)) {
            events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
          }
        } catch {
          /* empty */
        }
        const seq =
          events.length > 0
            ? ((events[events.length - 1].seq as number) || 0) + 1
            : 1;
        events.push({
          ...event,
          timestamp: new Date().toISOString(),
          seq,
        });
        if (events.length > 100) {
          events = events.slice(-100);
        }
        fs.writeFileSync(eventsPath, JSON.stringify(events));

        logger.info(
          { sourceGroup, action, artifactId: data.artifactId },
          'Canvas update processed',
        );
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
