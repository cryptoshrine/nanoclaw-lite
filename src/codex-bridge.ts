/**
 * Codex Bridge — Spawns and monitors OMC runtime-cli.js jobs for OmX supervisor.
 *
 * Instead of routing coding steps through spawnTeammate() (Claude SDK specialists
 * that die ~50% of the time), this module dispatches them to Codex CLI workers
 * via OMC's runtime-cli.ts. Workers run in tmux panes and persist independently.
 *
 * Flow:
 *   1. startCodexJob() spawns `node runtime-cli.js` as child process, pipes JSON to stdin
 *   2. runtime-cli creates tmux workers, polls until completion, writes JSON to stdout
 *   3. checkCodexJobStatus() reads job state file from disk
 *   4. cleanupCodexJob() kills tmux panes and cleans up state files
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { OMX_RUNTIME_CLI_PATH, OMX_CODEX_JOBS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CodexJob {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  pid: number;
  teamName: string;
  cwd: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface CodexJobStatus {
  status: 'running' | 'completed' | 'failed' | 'timeout';
  result?: string;
  error?: string;
}

interface RuntimeCliOutput {
  status: 'completed' | 'failed';
  teamName: string;
  taskResults: Array<{ taskId: string; status: string; summary: string }>;
  duration: number;
  workerCount: number;
}

// ── Job Directory ─────────────────────────────────────────────────────────────

function ensureJobsDir(): void {
  fs.mkdirSync(OMX_CODEX_JOBS_DIR, { recursive: true });
}

function jobPath(jobId: string): string {
  return path.join(OMX_CODEX_JOBS_DIR, `${jobId}.json`);
}

function readJobFile(jobId: string): CodexJob | null {
  const p = jobPath(jobId);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJobFile(job: CodexJob): void {
  ensureJobsDir();
  const tmpPath = `${jobPath(job.jobId)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(job, null, 2));
  fs.renameSync(tmpPath, jobPath(job.jobId));
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Start a Codex job via OMC's runtime-cli.js.
 * Spawns a child process, pipes JSON config to stdin, returns immediately.
 * The child process manages tmux workers and polls until completion.
 */
export async function startCodexJob(params: {
  teamName: string;
  agentType: string;
  task: { subject: string; description: string };
  cwd: string;
}): Promise<{ jobId: string; pid: number }> {
  const jobId = `codex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  ensureJobsDir();

  // Verify runtime-cli.js exists
  if (!fs.existsSync(OMX_RUNTIME_CLI_PATH)) {
    throw new Error(
      `OMC runtime-cli.js not found at ${OMX_RUNTIME_CLI_PATH}. ` +
      `Run 'npm run build' in the OMC project first.`,
    );
  }

  const cliInput = {
    teamName: params.teamName,
    agentTypes: [params.agentType],
    tasks: [params.task],
    cwd: params.cwd,
    pollIntervalMs: 5000,
  };

  const child = spawn('node', [OMX_RUNTIME_CLI_PATH], {
    cwd: params.cwd,
    env: {
      ...process.env,
      OMX_JOB_ID: jobId,
      OMX_JOBS_DIR: OMX_CODEX_JOBS_DIR,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn runtime-cli process — no PID returned');
  }

  // Write initial job state
  const job: CodexJob = {
    jobId,
    status: 'running',
    pid,
    teamName: params.teamName,
    cwd: params.cwd,
    startedAt: Date.now(),
  };
  writeJobFile(job);

  // Pipe JSON config to stdin, then close
  child.stdin.write(JSON.stringify(cliInput));
  child.stdin.end();

  // Collect stdout for final result
  const stdoutChunks: string[] = [];
  child.stdout.on('data', (data: Buffer) => {
    stdoutChunks.push(data.toString());
  });

  // Log stderr
  child.stderr.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      logger.debug({ jobId, line }, 'Codex runtime-cli stderr');
    }
  });

  // Handle process exit — update job state
  child.on('close', (code: number | null) => {
    const existingJob = readJobFile(jobId);
    if (!existingJob || existingJob.status !== 'running') return;

    const stdout = stdoutChunks.join('').trim();

    if (code === 0) {
      // Parse runtime-cli output
      try {
        const output: RuntimeCliOutput = JSON.parse(stdout);
        existingJob.status = output.status === 'completed' ? 'completed' : 'failed';
        existingJob.completedAt = Date.now();
        existingJob.result = output.taskResults
          .map(r => `[${r.status}] ${r.taskId}: ${r.summary}`)
          .join('\n') || `Codex job ${output.status}`;
      } catch {
        existingJob.status = 'completed';
        existingJob.completedAt = Date.now();
        existingJob.result = stdout || 'Codex job completed (no structured output)';
      }
    } else {
      existingJob.status = 'failed';
      existingJob.completedAt = Date.now();
      existingJob.error = `runtime-cli exited with code ${code}. ${stdout.slice(0, 1000)}`;
    }

    writeJobFile(existingJob);
    logger.info(
      { jobId, status: existingJob.status, code },
      'Codex job process exited',
    );
  });

  // Handle spawn errors
  child.on('error', (err: Error) => {
    const existingJob = readJobFile(jobId);
    if (existingJob && existingJob.status === 'running') {
      existingJob.status = 'failed';
      existingJob.completedAt = Date.now();
      existingJob.error = `Spawn error: ${err.message}`;
      writeJobFile(existingJob);
    }
    logger.error({ jobId, error: err.message }, 'Codex job spawn error');
  });

  logger.info({ jobId, pid, teamName: params.teamName }, 'Codex job started');
  return { jobId, pid };
}

/**
 * Check the status of a Codex job.
 * Reads from the job state file on disk. If the process died but the file
 * still says "running", performs orphan detection via process.kill(pid, 0).
 */
export function checkCodexJobStatus(jobId: string): CodexJobStatus {
  const job = readJobFile(jobId);

  if (!job) {
    return { status: 'failed', error: `Job file not found for ${jobId}` };
  }

  if (job.status !== 'running') {
    return {
      status: job.status,
      result: job.result,
      error: job.error,
    };
  }

  // Orphan detection — verify the PID is still alive
  try {
    process.kill(job.pid, 0);
    // Process is alive — still running
    return { status: 'running' };
  } catch {
    // Process is dead but job file says running → orphan
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = `Process ${job.pid} died unexpectedly (orphan detected)`;
    writeJobFile(job);
    logger.warn({ jobId, pid: job.pid }, 'Codex job orphan detected');
    return { status: 'failed', error: job.error };
  }
}

/**
 * Clean up a Codex job — kill tmux panes and remove state files.
 */
export async function cleanupCodexJob(jobId: string): Promise<void> {
  // Read panes file written by runtime-cli
  const panesPath = path.join(OMX_CODEX_JOBS_DIR, `${jobId}-panes.json`);

  try {
    if (fs.existsSync(panesPath)) {
      const panes = JSON.parse(fs.readFileSync(panesPath, 'utf-8')) as {
        paneIds: string[];
        leaderPaneId: string;
      };

      // Kill each tmux pane
      for (const paneId of panes.paneIds) {
        if (!paneId) continue;
        try {
          const { execSync } = await import('child_process');
          execSync(`tmux kill-pane -t "${paneId}" 2>/dev/null`, { timeout: 5000 });
        } catch {
          // Pane already dead — fine
        }
      }

      // Clean up panes file
      try { fs.unlinkSync(panesPath); } catch { /* ignore */ }
    }
  } catch (err) {
    logger.warn({ jobId, error: String(err) }, 'Error cleaning up Codex panes');
  }

  // Kill the runtime-cli process if still running
  const job = readJobFile(jobId);
  if (job && job.status === 'running') {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // Already dead
    }

    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = 'Cleaned up by supervisor';
    writeJobFile(job);
  }

  logger.info({ jobId }, 'Codex job cleaned up');
}

/**
 * Check if a string is a Codex job ID (starts with "codex-").
 */
export function isCodexJobId(id: string): boolean {
  return id.startsWith('codex-');
}
