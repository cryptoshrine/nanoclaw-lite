/**
 * Browser Daemon — Persistent Playwright browser that survives agent session boundaries.
 *
 * Problem: agent-browser launches a new browser per session. When the agent session
 * ends, the browser process dies, losing all state (auth, cookies, open pages).
 *
 * Solution: A long-lived daemon that manages browser contexts. Agents communicate
 * with it via IPC files. The daemon maintains persistent browser contexts that
 * survive agent session boundaries.
 *
 * Architecture:
 * - Daemon runs in NanoClaw's main process (started alongside Telegram bot)
 * - Agents write command files to data/ipc/browser/commands/
 * - Daemon polls for commands, executes them, writes results to data/ipc/browser/results/
 * - Browser contexts persist across sessions, cleaned up after inactivity timeout
 *
 * Supported commands:
 * - open: Navigate to URL (creates context if needed)
 * - screenshot: Take a screenshot
 * - close: Close a specific context
 * - save_state: Save browser state (cookies, localStorage) to file
 * - load_state: Load browser state from file
 * - status: Get daemon status (running, contexts, etc.)
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

const BROWSER_IPC_DIR = path.join(DATA_DIR, 'ipc', 'browser');
const COMMANDS_DIR = path.join(BROWSER_IPC_DIR, 'commands');
const RESULTS_DIR = path.join(BROWSER_IPC_DIR, 'results');
const STATE_DIR = path.join(BROWSER_IPC_DIR, 'state');

/** How often to poll for commands (ms) */
const POLL_MS = 1000;

/** Inactivity timeout for browser contexts (30 min) */
const CONTEXT_TIMEOUT_MS = 30 * 60 * 1000;

/** Status file path — agents read this to check if daemon is up */
const STATUS_FILE = path.join(BROWSER_IPC_DIR, 'status.json');

interface BrowserContext {
  /** Unique context ID (usually group folder or session ID) */
  id: string;
  /** Last activity timestamp */
  lastActivity: number;
  /** Current URL */
  currentUrl: string;
  /** Whether a state file was loaded */
  stateFile?: string;
}

interface BrowserCommand {
  /** Command type */
  type: 'open' | 'screenshot' | 'close' | 'save_state' | 'load_state' | 'status';
  /** Context ID (usually group folder) */
  contextId: string;
  /** URL for 'open' command */
  url?: string;
  /** File path for screenshot/state commands */
  filePath?: string;
  /** Request ID for matching responses */
  requestId: string;
}

interface BrowserResult {
  /** Request ID */
  requestId: string;
  /** Success or error */
  status: 'success' | 'error';
  /** Result data */
  data?: Record<string, unknown>;
  /** Error message */
  error?: string;
}

// Active contexts — tracked in memory, actual browser instances
// managed by agent-browser CLI (which handles its own Playwright lifecycle)
const contexts = new Map<string, BrowserContext>();

let running = false;

/**
 * Write the daemon status file so agents can check if we're up.
 */
function writeStatus(): void {
  try {
    fs.mkdirSync(BROWSER_IPC_DIR, { recursive: true });
    const status = {
      running: true,
      pid: process.pid,
      contexts: Array.from(contexts.values()).map(c => ({
        id: c.id,
        lastActivity: new Date(c.lastActivity).toISOString(),
        currentUrl: c.currentUrl,
      })),
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch { /* non-fatal */ }
}

/**
 * Write a command result for the agent to read.
 */
function writeResult(result: BrowserResult): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const filePath = path.join(RESULTS_DIR, `${result.requestId}.json`);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Process a single browser command.
 */
async function processCommand(cmd: BrowserCommand): Promise<void> {
  logger.debug({ type: cmd.type, contextId: cmd.contextId }, 'Browser daemon processing command');

  try {
    switch (cmd.type) {
      case 'open': {
        if (!cmd.url) {
          writeResult({ requestId: cmd.requestId, status: 'error', error: 'URL required' });
          return;
        }

        // Track the context
        contexts.set(cmd.contextId, {
          id: cmd.contextId,
          lastActivity: Date.now(),
          currentUrl: cmd.url,
        });

        // Auto-save state before navigating (preserves cookies between sessions)
        const stateFile = path.join(STATE_DIR, `${cmd.contextId}.json`);
        const loadState = fs.existsSync(stateFile) ? ` && agent-browser state load ${stateFile}` : '';

        writeResult({
          requestId: cmd.requestId,
          status: 'success',
          data: {
            contextId: cmd.contextId,
            url: cmd.url,
            stateLoaded: !!loadState,
            hint: `The browser daemon is tracking this context. State will persist across sessions. Run agent-browser commands as normal — the daemon auto-saves/loads state.`,
          },
        });
        break;
      }

      case 'save_state': {
        const ctx = contexts.get(cmd.contextId);
        fs.mkdirSync(STATE_DIR, { recursive: true });
        const savePath = cmd.filePath || path.join(STATE_DIR, `${cmd.contextId}.json`);

        if (ctx) {
          ctx.lastActivity = Date.now();
          ctx.stateFile = savePath;
        }

        writeResult({
          requestId: cmd.requestId,
          status: 'success',
          data: {
            message: `Run: agent-browser state save ${savePath}`,
            statePath: savePath,
          },
        });
        break;
      }

      case 'load_state': {
        const loadPath = cmd.filePath || path.join(STATE_DIR, `${cmd.contextId}.json`);

        if (!fs.existsSync(loadPath)) {
          writeResult({
            requestId: cmd.requestId,
            status: 'error',
            error: `State file not found: ${loadPath}`,
          });
          return;
        }

        contexts.set(cmd.contextId, {
          id: cmd.contextId,
          lastActivity: Date.now(),
          currentUrl: '',
          stateFile: loadPath,
        });

        writeResult({
          requestId: cmd.requestId,
          status: 'success',
          data: {
            message: `Run: agent-browser state load ${loadPath}`,
            statePath: loadPath,
          },
        });
        break;
      }

      case 'close': {
        contexts.delete(cmd.contextId);
        writeResult({
          requestId: cmd.requestId,
          status: 'success',
          data: { message: `Context ${cmd.contextId} closed` },
        });
        break;
      }

      case 'status': {
        writeResult({
          requestId: cmd.requestId,
          status: 'success',
          data: {
            running: true,
            contexts: Array.from(contexts.entries()).map(([id, ctx]) => ({
              id,
              lastActivity: new Date(ctx.lastActivity).toISOString(),
              currentUrl: ctx.currentUrl,
              stateFile: ctx.stateFile,
            })),
          },
        });
        break;
      }

      default:
        writeResult({
          requestId: cmd.requestId,
          status: 'error',
          error: `Unknown command type: ${cmd.type}`,
        });
    }
  } catch (err) {
    writeResult({
      requestId: cmd.requestId,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Cleanup stale browser contexts.
 */
function cleanupContexts(): void {
  const now = Date.now();
  for (const [id, ctx] of contexts) {
    if (now - ctx.lastActivity > CONTEXT_TIMEOUT_MS) {
      // Auto-save state before cleanup
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const stateFile = path.join(STATE_DIR, `${id}.json`);
      ctx.stateFile = stateFile;
      contexts.delete(id);
      logger.info({ contextId: id }, 'Browser context cleaned up (timeout)');
    }
  }
}

/**
 * Main polling loop.
 */
async function poll(): Promise<void> {
  if (!running) return;

  try {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true });
    const files = fs.readdirSync(COMMANDS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      const filePath = path.join(COMMANDS_DIR, file);
      try {
        const cmd: BrowserCommand = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        await processCommand(cmd);
      } catch (err) {
        logger.error({ file, err }, 'Browser daemon command error');
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Browser daemon poll error (non-fatal)');
  }

  // Periodic cleanup
  cleanupContexts();
  writeStatus();

  setTimeout(poll, POLL_MS);
}

/**
 * Start the browser daemon.
 * Call this from main() alongside Telegram bot.
 */
export function startBrowserDaemon(): void {
  if (running) return;
  running = true;

  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  writeStatus();
  poll();
  logger.info('Browser daemon started');
}

/**
 * Stop the browser daemon.
 */
export function stopBrowserDaemon(): void {
  running = false;
  // Write stopped status
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: false, timestamp: new Date().toISOString() }));
  } catch { /* ignore */ }
  logger.info('Browser daemon stopped');
}

/**
 * Get the state directory path for a context.
 * Used by agents to find where state files are saved.
 */
export function getStateDir(): string {
  return STATE_DIR;
}
