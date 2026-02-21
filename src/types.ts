export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath: string; // Path inside container (under /workspace/extra/)
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
  env?: Record<string, string>;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
}

export interface Session {
  [folder: string]: string;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed' | 'failed';
  created_at: string;
  // Retry fields
  retry_count: number;
  max_retries: number;
  last_error: string | null;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// ============ Agent Teams ============

export interface Team {
  id: string;
  name: string;
  lead_group: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  name: string;
  model: string;
  role: 'lead' | 'teammate';
  status: 'pending' | 'active' | 'completed' | 'failed';
  container_id: string | null;
  session_id: string | null;
  prompt: string | null;
  created_at: string;
}

export interface TeamTask {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  assigned_to: string | null;
  depends_on: string | null;
  priority: number;
  created_at: string;
  completed_at: string | null;
}

export interface TeamMessage {
  id: number;
  team_id: string;
  from_member: string;
  to_member: string | null;
  content: string;
  read: boolean;
  created_at: string;
}
