/**
 * OmX Pattern 7a: Tmux Parallel Workers
 *
 * Alternative worker spawning system for OmX that uses tmux panes instead of
 * the Claude Agent SDK's spawnTeammate(). Tmux panes persist independently of
 * the spawning process, solving the ~50% specialist death rate.
 *
 * Architecture:
 *   - Each OmX team gets a tmux session (e.g., "omx-team-abc123")
 *   - Each step gets a pane within that session
 *   - Workers run codex CLI, claude CLI, or custom commands
 *   - State persists to data/omx-tmux/{sessionName}.json
 *   - Idle detection via periodic pane content capture + diff
 *   - Nudge system sends keystrokes to stalled panes
 *   - Falls back to child_process.spawn if tmux is unavailable (Windows)
 *
 * Usage:
 *   import { spawnTmuxWorker, checkWorkerActivity, nudgeIdleWorkers } from './omx-tmux.js';
 *
 *   const worker = await spawnTmuxWorker({
 *     teamId: 'team-123',
 *     stepNumber: 1,
 *     agentType: 'claude-cli',
 *     command: 'claude --model claude-sonnet-4-6 --print "Implement auth..."',
 *     cwd: '/path/to/project',
 *   });
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Directory for tmux worker state files */
const TMUX_STATE_DIR = path.resolve(DATA_DIR, 'omx-tmux');

/** Default idle threshold in milliseconds before a worker is considered stalled */
const DEFAULT_IDLE_THRESHOLD_MS = 30_000;

/** Maximum nudges before marking a worker as failed */
const MAX_NUDGES = 3;

/** Default grace period for shutdown (ms) */
const DEFAULT_GRACE_MS = 5_000;

/** Tmux command timeout (ms) for all execSync calls */
const TMUX_CMD_TIMEOUT = 10_000;

/** Default nudge message sent to stalled workers */
const DEFAULT_NUDGE_MESSAGE = 'Continue your assigned task. If blocked, report what\'s wrong.';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Agent type determines what command runs in the tmux pane */
export type TmuxAgentType = 'codex' | 'claude-cli' | 'custom';

/** Worker lifecycle status */
export type TmuxWorkerStatus = 'starting' | 'running' | 'idle' | 'completed' | 'failed';

/** Represents a single tmux pane running a worker agent */
export interface TmuxWorker {
  /** Tmux pane ID (e.g., "omx-team-abc:0.1") */
  paneId: string;
  /** Tmux session name */
  sessionName: string;
  /** Window index within the session */
  windowIndex: number;
  /** Pane index within the window */
  paneIndex: number;
  /** Our internal worker ID */
  workerId: string;
  /** Team this worker belongs to */
  teamId: string;
  /** OmX step number this worker is executing */
  stepNumber: number;
  /** Type of agent running in the pane */
  agentType: TmuxAgentType;
  /** Current lifecycle status */
  status: TmuxWorkerStatus;
  /** ISO timestamp when worker was created */
  startedAt: string;
  /** ISO timestamp of last detected activity */
  lastActivityAt: string;
  /** PID of the process running in the pane (if detectable) */
  pid?: number;
  /** Number of nudges sent to this worker */
  nudgeCount: number;
  /** Last captured pane content (for idle detection diff) */
  lastCapture?: string;
  /** ISO timestamp of last capture */
  lastCaptureAt?: string;
  /** Command that was executed in the pane */
  command?: string;
  /** Working directory for the pane */
  cwd?: string;
}

/** Configuration for spawning a new tmux worker */
export interface TmuxSpawnConfig {
  /** Team ID this worker belongs to */
  teamId: string;
  /** OmX step number */
  stepNumber: number;
  /** Type of agent to run */
  agentType: TmuxAgentType;
  /** Command to execute (for 'custom' type, or override for codex/claude-cli) */
  command?: string;
  /** Working directory for the pane */
  cwd: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** For codex/claude-cli: the prompt to pass to the agent */
  prompt?: string;
  /** For codex: model override (default: gpt-4.1) */
  codexModel?: string;
  /** For claude-cli: model override (default: claude-sonnet-4-6) */
  claudeModel?: string;
}

/** Result of checking worker activity */
export interface WorkerActivity {
  /** Whether the tmux pane still exists */
  isAlive: boolean;
  /** Whether the worker appears idle (no output change) */
  isIdle: boolean;
  /** How long the worker has been idle (ms), or 0 if active */
  idleDuration: number;
  /** Last N lines of pane content */
  lastOutput: string;
  /** PID of the process in the pane */
  pid: number | null;
}

/** State file persisted to disk for a tmux session */
interface TmuxSessionState {
  sessionName: string;
  teamId: string;
  createdAt: string;
  workers: TmuxWorker[];
}

/** Fallback worker when tmux is not available — uses child_process */
interface FallbackWorker {
  workerId: string;
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
}

// ── In-Memory State ──────────────────────────────────────────────────────────

/** Cache for tmux availability check */
let tmuxAvailableCache: boolean | null = null;

/** In-memory worker registry (source of truth, periodically flushed to disk) */
const workerRegistry = new Map<string, TmuxWorker>();

/** Fallback child processes when tmux is not available */
const fallbackProcesses = new Map<string, FallbackWorker>();

// ── Platform Detection ───────────────────────────────────────────────────────

/**
 * Check if tmux is available on this system.
 * Result is cached after the first check.
 */
export function isTmuxAvailable(): boolean {
  if (tmuxAvailableCache !== null) return tmuxAvailableCache;

  try {
    execSync('which tmux', { timeout: 5000, stdio: 'pipe' });
    tmuxAvailableCache = true;
  } catch {
    tmuxAvailableCache = false;
    logger.warn('tmux not found — tmux workers will fall back to child_process.spawn');
  }

  return tmuxAvailableCache;
}

/**
 * Reset the tmux availability cache (for testing or after install).
 */
export function resetTmuxCache(): void {
  tmuxAvailableCache = null;
}

// ── State Persistence ────────────────────────────────────────────────────────

function ensureStateDir(): void {
  fs.mkdirSync(TMUX_STATE_DIR, { recursive: true });
}

function stateFilePath(sessionName: string): string {
  return path.join(TMUX_STATE_DIR, `${sessionName}.json`);
}

/**
 * Persist current worker state for a session to disk.
 * Uses atomic write (write to .tmp, rename).
 */
function persistSessionState(sessionName: string): void {
  ensureStateDir();

  const workers = Array.from(workerRegistry.values())
    .filter(w => w.sessionName === sessionName);

  const state: TmuxSessionState = {
    sessionName,
    teamId: workers[0]?.teamId || '',
    createdAt: workers[0]?.startedAt || new Date().toISOString(),
    workers,
  };

  const filePath = stateFilePath(sessionName);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Load session state from disk (for recovery after supervisor restart).
 */
export function loadSessionState(sessionName: string): TmuxSessionState | null {
  const filePath = stateFilePath(sessionName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state: TmuxSessionState = JSON.parse(raw);

    // Rehydrate in-memory registry
    for (const worker of state.workers) {
      if (!workerRegistry.has(worker.workerId)) {
        workerRegistry.set(worker.workerId, worker);
      }
    }

    return state;
  } catch (err) {
    logger.warn({ sessionName, error: String(err) }, 'Failed to load tmux session state');
    return null;
  }
}

/**
 * Remove state file for a session.
 */
function removeSessionState(sessionName: string): void {
  const filePath = stateFilePath(sessionName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup failures
  }
}

// ── Session Name Generation ──────────────────────────────────────────────────

/**
 * Generate a tmux session name from a team ID.
 * Format: omx-{short-hash} (tmux session names can't have dots or colons)
 */
function sessionNameFromTeam(teamId: string): string {
  const hash = teamId.replace(/[^a-zA-Z0-9-]/g, '').slice(-8) ||
    crypto.randomBytes(4).toString('hex');
  return `omx-${hash}`;
}

/**
 * Generate a unique worker ID.
 */
function generateWorkerId(teamId: string, stepNumber: number): string {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `w-${stepNumber}-${suffix}`;
}

// ── Tmux Command Helpers ─────────────────────────────────────────────────────

/**
 * Run a tmux command, returning stdout. Throws on failure.
 */
function tmuxExec(args: string, options?: { timeout?: number }): string {
  const timeout = options?.timeout ?? TMUX_CMD_TIMEOUT;
  try {
    return execSync(`tmux ${args}`, {
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`tmux command failed: tmux ${args} — ${message}`);
  }
}

/**
 * Run a tmux command, swallowing errors. Returns stdout or empty string.
 */
function tmuxExecSafe(args: string, options?: { timeout?: number }): string {
  try {
    return tmuxExec(args, options);
  } catch {
    return '';
  }
}

// ── Session Management ───────────────────────────────────────────────────────

/**
 * Create a new tmux session for a team.
 * If tmux is not available, returns the session name without creating anything.
 */
export function createTmuxSession(teamName: string, teamId?: string): string {
  const sessionName = teamId ? sessionNameFromTeam(teamId) : `omx-${teamName.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 20)}`;

  if (!isTmuxAvailable()) {
    logger.info({ sessionName }, 'Tmux not available — session name reserved (fallback mode)');
    return sessionName;
  }

  // Check if session already exists
  if (isSessionAlive(sessionName)) {
    logger.info({ sessionName }, 'Tmux session already exists');
    return sessionName;
  }

  try {
    // Create detached session with a meaningful name
    tmuxExec(`new-session -d -s "${sessionName}" -x 200 -y 50`);
    logger.info({ sessionName }, 'Tmux session created');
  } catch (err) {
    logger.error({ sessionName, error: String(err) }, 'Failed to create tmux session');
    throw err;
  }

  return sessionName;
}

/**
 * Check if a tmux session is alive.
 */
export function isSessionAlive(sessionName: string): boolean {
  if (!isTmuxAvailable()) return false;

  try {
    tmuxExec(`has-session -t "${sessionName}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all worker panes in a tmux session.
 * Reconciles disk state with actual tmux panes.
 */
export function listWorkerPanes(sessionName: string): TmuxWorker[] {
  const workers = Array.from(workerRegistry.values())
    .filter(w => w.sessionName === sessionName);

  if (!isTmuxAvailable()) return workers;

  // Reconcile: check which panes are actually alive
  for (const worker of workers) {
    if (worker.status === 'completed' || worker.status === 'failed') continue;

    const alive = isPaneAlive(worker.paneId);
    if (!alive) {
      worker.status = 'failed';
      logger.warn({ workerId: worker.workerId, paneId: worker.paneId }, 'Worker pane died');
    }
  }

  persistSessionState(sessionName);
  return workers;
}

/**
 * Check if a specific tmux pane is alive.
 */
function isPaneAlive(paneId: string): boolean {
  if (!isTmuxAvailable()) return false;
  const result = tmuxExecSafe(`display-message -t "${paneId}" -p "alive" 2>/dev/null`);
  return result === 'alive';
}

/**
 * Destroy a specific worker pane.
 */
export function destroyWorkerPane(worker: TmuxWorker): void {
  if (isTmuxAvailable()) {
    tmuxExecSafe(`kill-pane -t "${worker.paneId}"`);
  }

  worker.status = 'completed';
  workerRegistry.delete(worker.workerId);
  persistSessionState(worker.sessionName);

  logger.info({ workerId: worker.workerId, paneId: worker.paneId }, 'Worker pane destroyed');
}

/**
 * Destroy an entire tmux session and all its workers.
 */
export function destroySession(sessionName: string): void {
  if (isTmuxAvailable()) {
    tmuxExecSafe(`kill-session -t "${sessionName}"`);
  }

  // Clean up in-memory state
  const toRemove: string[] = [];
  for (const [id, worker] of workerRegistry) {
    if (worker.sessionName === sessionName) {
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    workerRegistry.delete(id);
  }

  // Clean up fallback processes
  for (const [id, fb] of fallbackProcesses) {
    if (id.includes(sessionName)) {
      try { fb.process.kill('SIGTERM'); } catch { /* already dead */ }
      fallbackProcesses.delete(id);
    }
  }

  removeSessionState(sessionName);
  logger.info({ sessionName, workersRemoved: toRemove.length }, 'Tmux session destroyed');
}

// ── Worker Spawning ──────────────────────────────────────────────────────────

/**
 * Build the command string for a worker based on its agent type.
 */
function buildWorkerCommand(config: TmuxSpawnConfig): string {
  if (config.command) return config.command;

  const prompt = config.prompt || 'Complete your assigned task.';
  // Escape single quotes in the prompt for shell
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  switch (config.agentType) {
    case 'codex': {
      const model = config.codexModel || 'gpt-4.1';
      return `codex --model ${model} --quiet --prompt '${escapedPrompt}'`;
    }
    case 'claude-cli': {
      const model = config.claudeModel || 'claude-sonnet-4-6';
      return `claude --model ${model} --dangerously-skip-permissions --print '${escapedPrompt}'`;
    }
    case 'custom':
      throw new Error('Custom agent type requires a command string');
    default:
      throw new Error(`Unknown agent type: ${config.agentType}`);
  }
}

/**
 * Spawn a new tmux worker for an OmX step.
 *
 * If tmux is available, creates a new pane in the team's session.
 * Otherwise, falls back to child_process.spawn.
 */
export async function spawnTmuxWorker(config: TmuxSpawnConfig): Promise<TmuxWorker> {
  const workerId = generateWorkerId(config.teamId, config.stepNumber);
  const sessionName = sessionNameFromTeam(config.teamId);
  const command = buildWorkerCommand(config);
  const now = new Date().toISOString();

  if (isTmuxAvailable()) {
    return spawnWithTmux(workerId, sessionName, config, command, now);
  }

  return spawnWithFallback(workerId, sessionName, config, command, now);
}

/**
 * Spawn a worker using tmux panes (primary path).
 */
async function spawnWithTmux(
  workerId: string,
  sessionName: string,
  config: TmuxSpawnConfig,
  command: string,
  now: string,
): Promise<TmuxWorker> {
  // Ensure session exists
  if (!isSessionAlive(sessionName)) {
    createTmuxSession('', config.teamId);
  }

  // Count existing panes to determine indices
  let windowIndex = 0;
  let paneIndex = 0;

  try {
    const paneList = tmuxExec(
      `list-panes -t "${sessionName}" -F "#{pane_index}"`,
    );
    const existingPanes = paneList.split('\n').filter(Boolean);
    paneIndex = existingPanes.length; // New pane gets next index
  } catch {
    // Session may have no panes yet, that's fine
  }

  // Create a new pane (split from the last pane)
  let paneId: string;
  try {
    if (paneIndex === 0) {
      // First pane — use the existing one (window 0, pane 0)
      paneId = `${sessionName}:${windowIndex}.0`;
    } else {
      // Split horizontally to create a new pane, then get its ID
      tmuxExec(
        `split-window -t "${sessionName}:${windowIndex}" -h`,
      );

      // Get the ID of the newly created pane
      const newPaneList = tmuxExec(
        `list-panes -t "${sessionName}:${windowIndex}" -F "#{pane_index}"`,
      );
      const panes = newPaneList.split('\n').filter(Boolean);
      paneIndex = parseInt(panes[panes.length - 1], 10);
      paneId = `${sessionName}:${windowIndex}.${paneIndex}`;

      // Re-layout to even-horizontal for readability
      tmuxExecSafe(`select-layout -t "${sessionName}:${windowIndex}" tiled`);
    }
  } catch (err) {
    // If we can't split (too many panes), create a new window
    try {
      tmuxExec(`new-window -t "${sessionName}"`);
      const windowList = tmuxExec(
        `list-windows -t "${sessionName}" -F "#{window_index}"`,
      );
      const windows = windowList.split('\n').filter(Boolean);
      windowIndex = parseInt(windows[windows.length - 1], 10);
      paneIndex = 0;
      paneId = `${sessionName}:${windowIndex}.0`;
    } catch (err2) {
      throw new Error(`Failed to create worker pane: ${err2}`);
    }
  }

  // Set the working directory for the pane
  if (config.cwd) {
    tmuxExecSafe(`send-keys -t "${paneId}" "cd '${config.cwd}'" Enter`);
    // Small delay for cd to complete
    await sleep(200);
  }

  // Set environment variables if provided
  if (config.env) {
    for (const [key, val] of Object.entries(config.env)) {
      const safeVal = val.replace(/'/g, "'\\''");
      tmuxExecSafe(`send-keys -t "${paneId}" "export ${key}='${safeVal}'" Enter`);
    }
    await sleep(100);
  }

  // Execute the command
  tmuxExec(`send-keys -t "${paneId}" '${command.replace(/'/g, "'\\''")}' Enter`);

  const worker: TmuxWorker = {
    paneId,
    sessionName,
    windowIndex,
    paneIndex,
    workerId,
    teamId: config.teamId,
    stepNumber: config.stepNumber,
    agentType: config.agentType,
    status: 'running',
    startedAt: now,
    lastActivityAt: now,
    nudgeCount: 0,
    command,
    cwd: config.cwd,
  };

  // Try to get PID
  const pid = getWorkerPid(worker);
  if (pid) worker.pid = pid;

  workerRegistry.set(workerId, worker);
  persistSessionState(sessionName);

  logger.info(
    { workerId, paneId, agentType: config.agentType, stepNumber: config.stepNumber },
    'Tmux worker spawned',
  );

  return worker;
}

/**
 * Spawn a worker using child_process.spawn (fallback when tmux unavailable).
 */
async function spawnWithFallback(
  workerId: string,
  sessionName: string,
  config: TmuxSpawnConfig,
  command: string,
  now: string,
): Promise<TmuxWorker> {
  logger.info({ workerId, agentType: config.agentType }, 'Spawning fallback worker (no tmux)');

  // Parse command into executable + args
  // For simple commands, split on spaces (handles most cases)
  const parts = parseCommand(command);
  const [executable, ...args] = parts;

  const child = spawn(executable, args, {
    cwd: config.cwd,
    env: { ...process.env, ...(config.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    detached: false,
  });

  const fallback: FallbackWorker = {
    workerId,
    process: child,
    stdout: [],
    stderr: [],
  };

  child.stdout?.on('data', (data: Buffer) => {
    fallback.stdout.push(data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    fallback.stderr.push(data.toString());
  });

  const worker: TmuxWorker = {
    paneId: `fallback-${workerId}`,
    sessionName,
    windowIndex: 0,
    paneIndex: 0,
    workerId,
    teamId: config.teamId,
    stepNumber: config.stepNumber,
    agentType: config.agentType,
    status: 'running',
    startedAt: now,
    lastActivityAt: now,
    pid: child.pid,
    nudgeCount: 0,
    command,
    cwd: config.cwd,
  };

  // Handle process exit
  child.on('close', (code: number | null) => {
    const w = workerRegistry.get(workerId);
    if (w && w.status === 'running') {
      w.status = code === 0 ? 'completed' : 'failed';
      w.lastActivityAt = new Date().toISOString();
      persistSessionState(sessionName);
    }
    fallbackProcesses.delete(workerId);
    logger.info({ workerId, code }, 'Fallback worker exited');
  });

  child.on('error', (err: Error) => {
    const w = workerRegistry.get(workerId);
    if (w && w.status === 'running') {
      w.status = 'failed';
      w.lastActivityAt = new Date().toISOString();
      persistSessionState(sessionName);
    }
    fallbackProcesses.delete(workerId);
    logger.error({ workerId, error: err.message }, 'Fallback worker error');
  });

  fallbackProcesses.set(workerId, fallback);
  workerRegistry.set(workerId, worker);
  persistSessionState(sessionName);

  return worker;
}

/**
 * Parse a command string into parts. Handles basic quoting.
 */
function parseCommand(command: string): string[] {
  // Return as-is for shell execution
  return [command];
}

// ── Worker Monitoring ────────────────────────────────────────────────────────

/**
 * Capture the current content of a tmux pane.
 * Returns the last 50 lines of pane output.
 */
export function capturePane(worker: TmuxWorker): string {
  if (!isTmuxAvailable()) {
    // Fallback: return captured stdout
    const fb = fallbackProcesses.get(worker.workerId);
    if (fb) {
      return fb.stdout.slice(-50).join('');
    }
    return '';
  }

  try {
    return tmuxExec(`capture-pane -p -t "${worker.paneId}" -S -50`);
  } catch {
    return '';
  }
}

/**
 * Get the PID of the foreground process in a tmux pane.
 */
export function getWorkerPid(worker: TmuxWorker): number | null {
  if (!isTmuxAvailable()) {
    return worker.pid ?? null;
  }

  try {
    const pidStr = tmuxExec(
      `display-message -t "${worker.paneId}" -p "#{pane_pid}"`,
    );
    const pid = parseInt(pidStr, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check a worker's current activity state.
 * Compares captured output with previous capture to detect idleness.
 */
export function checkWorkerActivity(worker: TmuxWorker): WorkerActivity {
  // Check if pane is alive first
  const isAlive = isTmuxAvailable()
    ? isPaneAlive(worker.paneId)
    : fallbackProcesses.has(worker.workerId);

  if (!isAlive) {
    return {
      isAlive: false,
      isIdle: false,
      idleDuration: 0,
      lastOutput: '',
      pid: null,
    };
  }

  // Capture current output
  const currentCapture = capturePane(worker);
  const pid = getWorkerPid(worker);
  const now = Date.now();

  // Compare with previous capture
  let isIdle = false;
  let idleDuration = 0;

  if (worker.lastCapture !== undefined) {
    // Strip trailing whitespace/newlines for comparison
    const prev = worker.lastCapture.trimEnd();
    const curr = currentCapture.trimEnd();

    if (prev === curr) {
      // Output hasn't changed — calculate idle duration
      const lastCaptureTime = worker.lastCaptureAt
        ? new Date(worker.lastCaptureAt).getTime()
        : now;
      idleDuration = now - lastCaptureTime;
      isIdle = idleDuration >= DEFAULT_IDLE_THRESHOLD_MS;
    } else {
      // Output changed — worker is active
      worker.lastActivityAt = new Date().toISOString();
    }
  }

  // Update worker state
  worker.lastCapture = currentCapture;
  if (!worker.lastCaptureAt || !isIdle) {
    worker.lastCaptureAt = new Date().toISOString();
  }
  if (pid) worker.pid = pid;

  // Update status based on activity
  if (isIdle && worker.status === 'running') {
    worker.status = 'idle';
  } else if (!isIdle && worker.status === 'idle') {
    worker.status = 'running';
  }

  // Persist state change
  persistSessionState(worker.sessionName);

  return {
    isAlive: true,
    isIdle,
    idleDuration,
    lastOutput: currentCapture.slice(-500), // Last 500 chars
    pid,
  };
}

/**
 * Get a worker by its ID.
 */
export function getWorker(workerId: string): TmuxWorker | undefined {
  return workerRegistry.get(workerId);
}

/**
 * Get all workers for a team.
 */
export function getTeamWorkers(teamId: string): TmuxWorker[] {
  return Array.from(workerRegistry.values()).filter(w => w.teamId === teamId);
}

// ── Nudging System ───────────────────────────────────────────────────────────

/**
 * Send a nudge to a stalled worker via tmux send-keys.
 * Returns true if the nudge was sent successfully.
 */
export function nudgeWorker(worker: TmuxWorker, message?: string): boolean {
  const nudgeMsg = message || DEFAULT_NUDGE_MESSAGE;

  if (worker.nudgeCount >= MAX_NUDGES) {
    logger.warn(
      { workerId: worker.workerId, nudgeCount: worker.nudgeCount },
      'Worker exceeded max nudges — marking as failed',
    );
    worker.status = 'failed';
    persistSessionState(worker.sessionName);
    return false;
  }

  if (isTmuxAvailable()) {
    try {
      // Escape double quotes for tmux send-keys
      const escaped = nudgeMsg.replace(/"/g, '\\"');
      tmuxExec(`send-keys -t "${worker.paneId}" "${escaped}" Enter`);
      worker.nudgeCount++;
      worker.lastActivityAt = new Date().toISOString();
      persistSessionState(worker.sessionName);

      logger.info(
        { workerId: worker.workerId, paneId: worker.paneId, nudgeCount: worker.nudgeCount },
        'Worker nudged',
      );
      return true;
    } catch (err) {
      logger.warn(
        { workerId: worker.workerId, error: String(err) },
        'Failed to nudge worker — pane may be dead',
      );
      return false;
    }
  }

  // Fallback: write to stdin of child process
  const fb = fallbackProcesses.get(worker.workerId);
  if (fb && fb.process.stdin && !fb.process.stdin.destroyed) {
    try {
      fb.process.stdin.write(nudgeMsg + '\n');
      worker.nudgeCount++;
      worker.lastActivityAt = new Date().toISOString();
      persistSessionState(worker.sessionName);
      logger.info({ workerId: worker.workerId, nudgeCount: worker.nudgeCount }, 'Fallback worker nudged');
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Nudge all idle workers in a session.
 * Returns the number of workers that were nudged.
 */
export function nudgeIdleWorkers(
  sessionName: string,
  idleThreshold: number = DEFAULT_IDLE_THRESHOLD_MS,
): number {
  const workers = Array.from(workerRegistry.values())
    .filter(w => w.sessionName === sessionName && (w.status === 'running' || w.status === 'idle'));

  let nudgedCount = 0;

  for (const worker of workers) {
    const activity = checkWorkerActivity(worker);

    if (activity.isAlive && activity.isIdle && activity.idleDuration >= idleThreshold) {
      const success = nudgeWorker(worker);
      if (success) nudgedCount++;
    }
  }

  if (nudgedCount > 0) {
    logger.info({ sessionName, nudgedCount }, 'Nudged idle workers');
  }

  return nudgedCount;
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

/**
 * Gracefully shut down a single worker.
 * Sends Ctrl+C first, waits grace period, then kills the pane.
 */
export async function shutdownWorker(
  worker: TmuxWorker,
  gracePeriod: number = DEFAULT_GRACE_MS,
): Promise<void> {
  if (worker.status === 'completed' || worker.status === 'failed') {
    // Already done — just clean up
    destroyWorkerPane(worker);
    return;
  }

  if (isTmuxAvailable() && isPaneAlive(worker.paneId)) {
    // Send Ctrl+C (interrupt)
    tmuxExecSafe(`send-keys -t "${worker.paneId}" C-c`);

    // Wait for grace period
    await sleep(gracePeriod);

    // Check if process exited cleanly
    if (isPaneAlive(worker.paneId)) {
      // Force kill
      tmuxExecSafe(`kill-pane -t "${worker.paneId}"`);
    }
  } else {
    // Fallback: kill child process
    const fb = fallbackProcesses.get(worker.workerId);
    if (fb) {
      try {
        fb.process.kill('SIGTERM');
        await sleep(gracePeriod);
        if (!fb.process.killed) {
          fb.process.kill('SIGKILL');
        }
      } catch {
        // Already dead
      }
      fallbackProcesses.delete(worker.workerId);
    }
  }

  worker.status = 'completed';
  workerRegistry.delete(worker.workerId);
  persistSessionState(worker.sessionName);

  logger.info({ workerId: worker.workerId }, 'Worker shut down gracefully');
}

/**
 * Shut down all workers in a session.
 */
export async function shutdownAllWorkers(sessionName: string): Promise<void> {
  const workers = Array.from(workerRegistry.values())
    .filter(w => w.sessionName === sessionName);

  // Send Ctrl+C to all workers in parallel
  for (const worker of workers) {
    if (isTmuxAvailable() && isPaneAlive(worker.paneId)) {
      tmuxExecSafe(`send-keys -t "${worker.paneId}" C-c`);
    }
  }

  // Wait grace period once (not per-worker)
  await sleep(DEFAULT_GRACE_MS);

  // Force kill any survivors
  for (const worker of workers) {
    if (isTmuxAvailable() && isPaneAlive(worker.paneId)) {
      tmuxExecSafe(`kill-pane -t "${worker.paneId}"`);
    }

    const fb = fallbackProcesses.get(worker.workerId);
    if (fb) {
      try { fb.process.kill('SIGKILL'); } catch { /* already dead */ }
      fallbackProcesses.delete(worker.workerId);
    }

    worker.status = 'completed';
    workerRegistry.delete(worker.workerId);
  }

  // Destroy the session itself
  if (isTmuxAvailable()) {
    tmuxExecSafe(`kill-session -t "${sessionName}"`);
  }

  removeSessionState(sessionName);
  logger.info({ sessionName, workerCount: workers.length }, 'All workers shut down');
}

// ── Recovery / Reconciliation ────────────────────────────────────────────────

/**
 * Recover worker state after a supervisor restart.
 * Reads state files from disk, verifies panes are alive, updates statuses.
 */
export function recoverSessions(): TmuxSessionState[] {
  ensureStateDir();

  const stateFiles = fs.readdirSync(TMUX_STATE_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));

  const recovered: TmuxSessionState[] = [];

  for (const file of stateFiles) {
    const sessionName = file.replace('.json', '');
    const state = loadSessionState(sessionName);
    if (!state) continue;

    // Verify each worker's pane is still alive
    for (const worker of state.workers) {
      if (worker.status === 'completed' || worker.status === 'failed') continue;

      const alive = isTmuxAvailable() ? isPaneAlive(worker.paneId) : false;
      if (!alive) {
        worker.status = 'failed';
        logger.warn(
          { workerId: worker.workerId, paneId: worker.paneId, sessionName },
          'Worker pane not found during recovery — marked failed',
        );
      }
    }

    persistSessionState(sessionName);
    recovered.push(state);
  }

  logger.info(
    { recoveredSessions: recovered.length },
    'Tmux session recovery complete',
  );

  return recovered;
}

/**
 * List all active tmux sessions managed by OmX.
 */
export function listOmxSessions(): string[] {
  if (!isTmuxAvailable()) return [];

  try {
    const output = tmuxExec('list-sessions -F "#{session_name}"');
    return output.split('\n')
      .filter(Boolean)
      .filter(name => name.startsWith('omx-'));
  } catch {
    return [];
  }
}

/**
 * Get summary stats for all OmX tmux workers.
 */
export function getWorkerStats(): {
  totalWorkers: number;
  byStatus: Record<TmuxWorkerStatus, number>;
  byAgentType: Record<TmuxAgentType, number>;
  activeSessions: number;
} {
  const workers = Array.from(workerRegistry.values());

  const byStatus: Record<TmuxWorkerStatus, number> = {
    starting: 0,
    running: 0,
    idle: 0,
    completed: 0,
    failed: 0,
  };

  const byAgentType: Record<TmuxAgentType, number> = {
    codex: 0,
    'claude-cli': 0,
    custom: 0,
  };

  for (const w of workers) {
    byStatus[w.status]++;
    byAgentType[w.agentType]++;
  }

  const sessions = new Set(workers.map(w => w.sessionName));

  return {
    totalWorkers: workers.length,
    byStatus,
    byAgentType,
    activeSessions: sessions.size,
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean up stale state files for sessions that no longer exist.
 */
export function cleanupStaleState(): number {
  ensureStateDir();

  const stateFiles = fs.readdirSync(TMUX_STATE_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));

  let cleaned = 0;

  for (const file of stateFiles) {
    const sessionName = file.replace('.json', '');

    // If tmux is available and the session is dead, clean up
    if (isTmuxAvailable() && !isSessionAlive(sessionName)) {
      // Check if all workers are terminal
      const state = loadSessionState(sessionName);
      if (state) {
        const allTerminal = state.workers.every(
          w => w.status === 'completed' || w.status === 'failed',
        );
        if (allTerminal) {
          removeSessionState(sessionName);
          for (const w of state.workers) {
            workerRegistry.delete(w.workerId);
          }
          cleaned++;
        }
      }
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'Cleaned up stale tmux state files');
  }

  return cleaned;
}
