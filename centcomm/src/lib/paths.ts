import path from "path";

// All paths relative to the centcomm project root
const PROJECT_ROOT = path.resolve(process.cwd(), "..");

export const PATHS = {
  /** NanoClaw project root */
  root: PROJECT_ROOT,
  /** SQLite database */
  database: path.join(PROJECT_ROOT, "store", "messages.db"),
  /** Registered groups config */
  registeredGroups: path.join(PROJECT_ROOT, "data", "registered_groups.json"),
  /** Router state */
  routerState: path.join(PROJECT_ROOT, "data", "router_state.json"),
  /** Sessions */
  sessions: path.join(PROJECT_ROOT, "data", "sessions.json"),
  /** Groups directory */
  groups: path.join(PROJECT_ROOT, "groups"),
  /** IPC directory */
  ipc: path.join(PROJECT_ROOT, "data", "ipc"),
  /** Betting analysis output directory */
  bettingOutput: path.join(PROJECT_ROOT, "groups", "main", "betting", "output"),
  /** Canvas state directory */
  canvas: path.join(PROJECT_ROOT, "data", "canvas"),
} as const;
