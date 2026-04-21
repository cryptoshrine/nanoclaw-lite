import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
export const PROJECT_ROOT = process.cwd();

export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const EXECUTION_MODE: 'local' = 'local';

export const AGENT_RUNNER_ENTRY = path.resolve(
  PROJECT_ROOT, 'container', 'agent-runner', 'dist', 'index.js'
);

export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

// Maximum age of messages to replay when rebuilding agent context.
// Default: 4 hours (14_400_000 ms)
export const MAX_HISTORY_AGE_MS = parseInt(
  process.env.MAX_HISTORY_AGE_MS || '14400000',
  10,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Memory IPC configuration
export const MEMORY_IPC_POLL_MS = 100;
export const MEMORY_IPC_TIMEOUT_MS = 30000;

// OmX Tmux Workers (opt-in — set OMX_TMUX_ENABLED=true in .env)
export const OMX_TMUX_ENABLED = process.env.OMX_TMUX_ENABLED === 'true';
export const OMX_WORKFLOWS_DIR = path.resolve(DATA_DIR, 'omx-workflows');

// OmX PAL Router — Haiku→Sonnet→Opus escalation (default: on)
export const OMX_PAL_ENABLED = process.env.OMX_PAL_ENABLED !== 'false';

// Ouroboros Integration — replaces OmX interview/ralplan/convergence with Ouroboros MCP server
// Default: false (opt-in). Set OUROBOROS_ENABLED=true to activate.
export const OUROBOROS_ENABLED = process.env.OUROBOROS_ENABLED === 'true';
