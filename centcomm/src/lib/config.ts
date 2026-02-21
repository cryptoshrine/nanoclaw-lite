import fs from "fs";
import path from "path";
import { PATHS } from "./paths";

// ── Types ──────────────────────────────────────────────────────────────

export interface ContainerConfig {
  additionalMounts?: {
    hostPath: string;
    containerPath: string;
    readonly: boolean;
  }[];
  skillSources?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface RegisteredGroup {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  containerConfig?: ContainerConfig;
}

export interface RouterState {
  last_timestamp: string;
  last_agent_timestamp: Record<string, string>;
}

// ── Config readers ─────────────────────────────────────────────────────

export function getRegisteredGroups(): RegisteredGroup[] {
  try {
    const raw = fs.readFileSync(PATHS.registeredGroups, "utf-8");
    const data = JSON.parse(raw) as Record<string, Omit<RegisteredGroup, "jid">>;
    return Object.entries(data).map(([jid, group]) => ({
      jid,
      ...group,
    }));
  } catch {
    return [];
  }
}

export function getRouterState(): RouterState | null {
  try {
    const raw = fs.readFileSync(PATHS.routerState, "utf-8");
    return JSON.parse(raw) as RouterState;
  } catch {
    return null;
  }
}

export function getSessions(): Record<string, string> {
  try {
    const raw = fs.readFileSync(PATHS.sessions, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

// ── Memory file reader ─────────────────────────────────────────────────

export interface MemoryFile {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  mtime: Date;
  isDirectory: boolean;
}

export function getGroupFiles(folder: string): MemoryFile[] {
  const groupPath = path.join(PATHS.groups, folder);
  if (!fs.existsSync(groupPath)) return [];

  const files: MemoryFile[] = [];

  function walk(dir: string, prefix = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        files.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          size: 0,
          mtime: new Date(),
          isDirectory: true,
        });
        walk(fullPath, relativePath);
      } else if (entry.name.endsWith(".md") || entry.name.endsWith(".json") || entry.name.endsWith(".txt")) {
        const stat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          size: stat.size,
          mtime: stat.mtime,
          isDirectory: false,
        });
      }
    }
  }

  walk(groupPath);
  return files;
}

export function readGroupFile(folder: string, filePath: string): string | null {
  // Security: ensure path stays within the group folder
  const groupPath = path.join(PATHS.groups, folder);
  const fullPath = path.resolve(groupPath, filePath);
  if (!fullPath.startsWith(groupPath)) return null;

  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}
