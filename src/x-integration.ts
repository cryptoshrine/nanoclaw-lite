/**
 * X Integration IPC Handler (Host Side)
 *
 * Thin wrapper that delegates to the x-integration skill scripts.
 * Handles all x_* IPC messages from container agents.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

interface SkillResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// Run a skill script as subprocess
async function runScript(script: string, args: object): Promise<SkillResult> {
  const scriptPath = path.join(process.cwd(), '.claude', 'skills', 'x-integration', 'scripts', `${script}.ts`);

  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, NANOCLAW_ROOT: process.cwd() },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Required on Windows for npx
    });

    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stdin.write(JSON.stringify(args));
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, message: 'Script timed out (120s)' });
    }, 120000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ success: false, message: `Script exited with code: ${code}` });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch {
        resolve({ success: false, message: `Failed to parse output: ${stdout.slice(0, 200)}` });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, message: `Failed to spawn: ${err.message}` });
    });
  });
}

// Write result to IPC results directory
function writeResult(dataDir: string, sourceGroup: string, requestId: string, result: SkillResult): void {
  const resultsDir = path.join(dataDir, 'ipc', sourceGroup, 'x_results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${requestId}.json`), JSON.stringify(result));
}

/**
 * Handle X integration IPC messages
 *
 * @returns true if message was handled, false if not an X message
 */
export async function handleXIpc(
  data: Record<string, unknown>,
  sourceGroup: string,
  isMain: boolean,
  dataDir: string
): Promise<boolean> {
  const type = data.type as string;

  // Only handle x_* types
  if (!type?.startsWith('x_')) {
    return false;
  }

  // Only main group can use X integration
  if (!isMain) {
    logger.warn({ sourceGroup, type }, 'X integration blocked: not main group');
    return true;
  }

  const requestId = data.requestId as string;
  if (!requestId) {
    logger.warn({ type }, 'X integration blocked: missing requestId');
    return true;
  }

  logger.info({ type, requestId }, 'Processing X request');

  let result: SkillResult;

  switch (type) {
    case 'x_post':
      if (!data.content) {
        result = { success: false, message: 'Missing content' };
        break;
      }
      result = await runScript('post', { content: data.content });
      break;

    case 'x_like':
      if (!data.tweetUrl) {
        result = { success: false, message: 'Missing tweetUrl' };
        break;
      }
      result = await runScript('like', { tweetUrl: data.tweetUrl });
      break;

    case 'x_reply':
      if (!data.tweetUrl || !data.content) {
        result = { success: false, message: 'Missing tweetUrl or content' };
        break;
      }
      result = await runScript('reply', { tweetUrl: data.tweetUrl, content: data.content });
      break;

    case 'x_retweet':
      if (!data.tweetUrl) {
        result = { success: false, message: 'Missing tweetUrl' };
        break;
      }
      result = await runScript('retweet', { tweetUrl: data.tweetUrl });
      break;

    case 'x_quote':
      if (!data.tweetUrl || !data.comment) {
        result = { success: false, message: 'Missing tweetUrl or comment' };
        break;
      }
      result = await runScript('quote', { tweetUrl: data.tweetUrl, comment: data.comment });
      break;

    // === Reading / Monitoring ===

    case 'x_search':
      if (!data.query) {
        result = { success: false, message: 'Missing query' };
        break;
      }
      result = await runScript('search', {
        query: data.query,
        sort: data.sort || 'latest',
        count: data.count || 10
      });
      break;

    case 'x_read_feed':
      if (!data.feedType) {
        result = { success: false, message: 'Missing feedType' };
        break;
      }
      if (data.feedType === 'user' && !data.username) {
        result = { success: false, message: 'Missing username for user feed' };
        break;
      }
      result = await runScript('read-feed', {
        type: data.feedType,
        username: data.username,
        count: data.count || 10
      });
      break;

    case 'x_read_post':
      if (!data.tweetUrl) {
        result = { success: false, message: 'Missing tweetUrl' };
        break;
      }
      result = await runScript('read-post', {
        tweetUrl: data.tweetUrl,
        includeReplies: data.includeReplies !== false,
        replyCount: data.replyCount || 5
      });
      break;

    case 'x_check_stats':
      if (!data.tweetUrl) {
        result = { success: false, message: 'Missing tweetUrl' };
        break;
      }
      result = await runScript('check-stats', { tweetUrl: data.tweetUrl });
      break;

    case 'x_notifications':
      result = await runScript('notifications', {
        count: data.count || 10,
        tab: data.tab || 'all'
      });
      break;

    default:
      return false;
  }

  writeResult(dataDir, sourceGroup, requestId, result);
  if (result.success) {
    logger.info({ type, requestId }, 'X request completed');
  } else {
    logger.error({ type, requestId, message: result.message }, 'X request failed');
  }
  return true;
}
