import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { runAgent as runContainerAgentDispatch, writeTasksSnapshot } from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  markTaskFailed,
  updateTaskAfterRun,
  updateTaskRetry,
} from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';
import {
  postDailyDigest,
  postToProject,
  postToMissionControl,
} from './discord-channels.js';
import { checkAndScheduleWorkflowContinuation } from './workflow-engine.js';
import { broadcast as wsBroadcast } from './ws-server.js';

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}

/**
 * Calculate exponential backoff delay for retries.
 * Retry 1: 1 minute
 * Retry 2: 5 minutes
 * Retry 3: 15 minutes
 */
function calculateBackoffDelay(retryCount: number): number {
  const delays = [
    60 * 1000, // 1 minute
    5 * 60 * 1000, // 5 minutes
    15 * 60 * 1000, // 15 minutes
  ];
  return delays[Math.min(retryCount, delays.length - 1)];
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  wsBroadcast('task.running', {
    taskId: task.id,
    group: task.group_folder,
    prompt: task.prompt.slice(0, 200),
  });

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
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

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  try {
    const output = await runContainerAgentDispatch(group, {
      prompt: task.prompt,
      sessionId,
      groupFolder: task.group_folder,
      chatJid: task.chat_jid,
      isMain,
      isScheduledTask: true,
    });

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else {
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  // Handle retry logic on failure
  if (error) {
    const currentRetry = task.retry_count || 0;
    const maxRetries = task.max_retries || 3;

    if (currentRetry < maxRetries) {
      // Schedule retry with exponential backoff
      const backoffDelay = calculateBackoffDelay(currentRetry);
      const retryTime = new Date(Date.now() + backoffDelay).toISOString();
      const newRetryCount = currentRetry + 1;

      logger.warn(
        {
          taskId: task.id,
          retry: newRetryCount,
          maxRetries,
          nextRetry: retryTime,
        },
        'Task failed, scheduling retry',
      );

      updateTaskRetry(task.id, newRetryCount, retryTime, error);

      wsBroadcast('task.completed', {
        taskId: task.id,
        status: 'retry',
        retry: newRetryCount,
        maxRetries,
      });

      // Notify user about retry
      try {
        await deps.sendMessage(
          task.chat_jid,
          `⚠️ Scheduled task failed (attempt ${newRetryCount}/${maxRetries}). Retrying in ${Math.round(backoffDelay / 60000)} minutes.\nError: ${error.slice(0, 100)}`,
        );
      } catch {
        // Ignore send errors
      }
      return;
    } else {
      // Max retries exceeded, mark as failed
      logger.error(
        { taskId: task.id, retries: currentRetry },
        'Task failed after max retries',
      );

      markTaskFailed(task.id, error);

      wsBroadcast('task.completed', {
        taskId: task.id,
        status: 'failed',
      });

      // Notify user about permanent failure
      try {
        await deps.sendMessage(
          task.chat_jid,
          `❌ Scheduled task permanently failed after ${maxRetries} retries.\nError: ${error.slice(0, 200)}`,
        );
      } catch {
        // Ignore send errors
      }
      return;
    }
  }

  // Success - calculate next run
  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }
  // 'once' tasks have no next run

  const resultSummary = result ? result.slice(0, 200) : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);

  wsBroadcast('task.completed', {
    taskId: task.id,
    status: 'success',
    durationMs,
  });

  // Route task results to Discord channels based on prompt content
  if (result) {
    const promptLower = task.prompt.toLowerCase();
    try {
      if (promptLower.includes('heartbeat') || promptLower.includes('morning brief') || promptLower.includes('daily digest')) {
        postDailyDigest(result).catch((err) =>
          logger.error({ err }, 'Failed to post daily digest to Discord'),
        );
      }
      if (promptLower.includes('bet value') || promptLower.includes('betting') || promptLower.includes('oddsportal')) {
        postToProject('betting-signals', 'Betting Pipeline Result', result).catch((err) =>
          logger.error({ err }, 'Failed to post betting signals to Discord'),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error routing task result to Discord');
    }
  }

  // Auto-continue any active workflows for this group
  try {
    const continued = checkAndScheduleWorkflowContinuation(task.group_folder, task.chat_jid);
    if (continued > 0) {
      logger.info(
        { taskId: task.id, groupFolder: task.group_folder, continued },
        'Scheduled workflow continuation after task completed',
      );
    }
  } catch (err) {
    logger.error({ err, taskId: task.id }, 'Failed to check workflow continuation');
  }
}

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled/failed
        const currentTask = getTaskById(task.id);
        if (
          !currentTask ||
          (currentTask.status !== 'active' && currentTask.status !== 'failed')
        ) {
          continue;
        }

        // Skip permanently failed tasks (status='failed' means max retries exceeded)
        if (currentTask.status === 'failed') {
          continue;
        }

        await runTask(currentTask, deps);
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}
