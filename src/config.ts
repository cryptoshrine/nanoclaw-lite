import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
export const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const EXECUTION_MODE: 'local' | 'docker' =
  (process.env.EXECUTION_MODE as 'local' | 'docker') || 'local';

export const AGENT_RUNNER_ENTRY = path.resolve(
  PROJECT_ROOT, 'container', 'agent-runner', 'dist', 'index.js'
);

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
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
// Prevents replaying days of history when the agent has been offline.
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
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Memory IPC configuration
export const MEMORY_IPC_POLL_MS = 100;
export const MEMORY_IPC_TIMEOUT_MS = 30000;

// Agent Teams configuration
export const TEAM_DIR = path.resolve(DATA_DIR, 'teams');
export const TEAM_POLL_INTERVAL = 2000; // Poll interval for teammate status checks
export const TEAMMATE_TIMEOUT = 600000; // 10 minutes timeout for teammates
export const DEFAULT_TEAMMATE_MODEL = 'claude-sonnet-4-6';
export const MAX_CONCURRENT_SPECIALISTS = parseInt(
  process.env.MAX_CONCURRENT_SPECIALISTS || '3',
  10,
);

// OmX Autonomous Mode configuration
export const OMX_SUPERVISOR_INTERVAL = 60_000;     // 60s between supervisor checks
export const OMX_MAX_RETRIES_PER_STEP = 2;         // Retry failed specialists twice
export const OMX_STEP_TIMEOUT = 900_000;           // 15min per specialist step
export const OMX_MAX_TOTAL_DURATION = 3_600_000;   // 1hr max for entire workflow
export const OMX_MAX_SPECIALISTS_PER_WORKFLOW = 10; // Budget cap per OmX run
export const OMX_MAX_CONCURRENT_WORKFLOWS = 2;     // Max simultaneous OmX workflows
export const OMX_REQUIRE_APPROVAL_FOR_PUSH = true; // Require human OK before push
export const OMX_WORKFLOWS_DIR = path.resolve(DATA_DIR, 'omx-workflows');

// OmX Codex Dispatch
export const OMX_CODEX_ENABLED = process.env.OMX_CODEX_ENABLED !== 'false';
export const OMX_CODEX_AGENT_TYPE = process.env.OMX_CODEX_AGENT_TYPE || 'codex';
export const OMX_RUNTIME_CLI_PATH = process.env.OMX_RUNTIME_CLI_PATH ||
  path.resolve('C:/claw/orchestration/OMC/oh-my-codex/dist/team/runtime-cli.js');
export const OMX_CODEX_JOBS_DIR = process.env.OMX_CODEX_JOBS_DIR ||
  path.join(HOME_DIR, '.omx', 'team-jobs');
