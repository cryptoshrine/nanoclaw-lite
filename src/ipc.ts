import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  OMX_TMUX_ENABLED,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
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

      // Process tmux IPC requests from this group
      if (isMain && OMX_TMUX_ENABLED) {
        const tmuxDir = path.join(ipcBaseDir, sourceGroup, 'tmux');
        try {
          if (fs.existsSync(tmuxDir)) {
            const tmuxFiles = fs
              .readdirSync(tmuxDir)
              .filter((f) => f.endsWith('.json') && !f.startsWith('responses'));
            for (const file of tmuxFiles) {
              const filePath = path.join(tmuxDir, file);
              try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                await processTmuxIpc(data, tmuxDir);
                fs.unlinkSync(filePath);
              } catch (err) {
                logger.error({ file, sourceGroup, err }, 'Error processing tmux IPC');
                const errorDir = path.join(ipcBaseDir, 'errors');
                fs.mkdirSync(errorDir, { recursive: true });
                fs.renameSync(filePath, path.join(errorDir, `tmux-${sourceGroup}-${file}`));
              }
            }
          }
        } catch (err) {
          logger.error({ err, sourceGroup }, 'Error reading tmux IPC directory');
        }
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
    // For dm_allowlist
    user_id?: string;
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
          retry_count: 0,
          max_retries: 3,
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
          if (data.context_mode !== undefined) updates.context_mode = data.context_mode as 'group' | 'isolated';

          // Handle schedule changes — recalculate next_run
          const newScheduleType = (data.schedule_type || task.schedule_type) as 'cron' | 'interval' | 'once';
          const newScheduleValue = data.schedule_value || task.schedule_value;
          const scheduleChanged = data.schedule_type !== undefined || data.schedule_value !== undefined;

          if (data.schedule_type !== undefined) updates.schedule_type = data.schedule_type as 'cron' | 'interval' | 'once';
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

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

// ── OmX Tmux IPC Handler ��─────────────────────────────────────────────────

// Lazy-loaded tmux module (only when OMX_TMUX_ENABLED=true)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tmuxModule: any = null;
// Track active tmux jobs: jobId → { teamId, sessionName, workers[] }
const tmuxJobs = new Map<string, { teamId: string; sessionName: string; workers: string[] }>();

async function getTmuxModule() {
  if (!tmuxModule) {
    tmuxModule = await import('./omx-tmux.js');
  }
  return tmuxModule;
}

function writeTmuxResponse(tmuxDir: string, jobId: string, data: object): void {
  const responsesDir = path.join(tmuxDir, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });
  const filePath = path.join(responsesDir, `${jobId}.json`);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

async function processTmuxIpc(
  data: {
    type: string;
    jobId: string;
    teamName?: string;
    agentTypes?: string[];
    tasks?: Array<{ subject: string; description: string }>;
    cwd?: string;
    timeoutMs?: number;
    nudgeDelayMs?: number;
    nudgeMaxCount?: number;
    nudgeMessage?: string;
    graceMs?: number;
  },
  tmuxDir: string,
): Promise<void> {
  const tmux = await getTmuxModule();

  switch (data.type) {
    case 'omx_run_team_start': {
      if (!data.teamName || !data.agentTypes || !data.tasks || !data.cwd) {
        writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'error', error: 'Missing required fields' });
        break;
      }

      const sessionName = tmux.createTmuxSession(data.teamName, data.jobId);
      const workers: string[] = [];

      for (let i = 0; i < data.tasks.length; i++) {
        const agentType = data.agentTypes[i] || data.agentTypes[0] || 'claude-cli';
        const task = data.tasks[i];
        const prompt = `${task.subject}\n\n${task.description}`;

        try {
          const worker = await tmux.spawnTmuxWorker({
            teamId: data.jobId,
            stepNumber: i + 1,
            agentType: agentType === 'claude' ? 'claude-cli' : agentType,
            cwd: data.cwd,
            prompt,
          });
          workers.push(worker.workerId);
        } catch (err) {
          logger.error({ jobId: data.jobId, step: i + 1, err }, 'Failed to spawn tmux worker');
        }
      }

      tmuxJobs.set(data.jobId, { teamId: data.jobId, sessionName, workers });
      writeTmuxResponse(tmuxDir, data.jobId, {
        jobId: data.jobId,
        status: 'running',
        sessionName,
        workerCount: workers.length,
        workers,
      });
      logger.info({ jobId: data.jobId, sessionName, workers: workers.length }, 'Tmux team started');
      break;
    }

    case 'omx_run_team_status': {
      const job = tmuxJobs.get(data.jobId);
      if (!job) {
        writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'not_found' });
        break;
      }

      const workerStatuses = job.workers.map((wId: string) => {
        const worker = tmux.getWorker(wId);
        if (!worker) return { workerId: wId, status: 'unknown' };
        const activity = tmux.checkWorkerActivity(worker);
        return {
          workerId: wId,
          status: worker.status,
          isAlive: activity.isAlive,
          isIdle: activity.isIdle,
          lastOutput: activity.lastOutput?.slice(-200),
        };
      });

      const allDone = workerStatuses.every((w: { status: string }) => w.status === 'completed' || w.status === 'failed');
      writeTmuxResponse(tmuxDir, data.jobId, {
        jobId: data.jobId,
        status: allDone ? 'completed' : 'running',
        workers: workerStatuses,
      });
      break;
    }

    case 'omx_run_team_wait': {
      const job = tmuxJobs.get(data.jobId);
      if (!job) {
        writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'not_found' });
        break;
      }

      const timeoutMs = data.timeoutMs || 300000;
      const nudgeDelay = data.nudgeDelayMs || 30000;
      const maxNudges = data.nudgeMaxCount || 3;
      const deadline = Date.now() + timeoutMs;
      const pollInterval = 5000;

      while (Date.now() < deadline) {
        let allDone = true;
        for (const wId of job.workers) {
          const worker = tmux.getWorker(wId);
          if (!worker) continue;
          if (worker.status !== 'completed' && worker.status !== 'failed') {
            allDone = false;
            const activity = tmux.checkWorkerActivity(worker);
            if (activity.isAlive && activity.isIdle && activity.idleDuration >= nudgeDelay && worker.nudgeCount < maxNudges) {
              tmux.nudgeWorker(worker, data.nudgeMessage);
            }
          }
        }

        if (allDone) {
          const finalStatuses = job.workers.map((wId: string) => {
            const w = tmux.getWorker(wId);
            return { workerId: wId, status: w?.status || 'unknown' };
          });
          writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'completed', workers: finalStatuses });
          return;
        }

        await new Promise(r => setTimeout(r, pollInterval));
      }

      // Timeout
      const timeoutStatuses = job.workers.map((wId: string) => {
        const w = tmux.getWorker(wId);
        return { workerId: wId, status: w?.status || 'unknown' };
      });
      writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'timeout', workers: timeoutStatuses });
      break;
    }

    case 'omx_run_team_cleanup': {
      const job = tmuxJobs.get(data.jobId);
      if (!job) {
        writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'not_found' });
        break;
      }

      await tmux.shutdownAllWorkers(job.sessionName);
      tmuxJobs.delete(data.jobId);
      writeTmuxResponse(tmuxDir, data.jobId, { jobId: data.jobId, status: 'cleaned_up' });
      logger.info({ jobId: data.jobId, sessionName: job.sessionName }, 'Tmux team cleaned up');
      break;
    }

    default:
      logger.warn({ type: data.type, jobId: data.jobId }, 'Unknown tmux IPC type');
  }
}
