export interface AdditionalMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
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

// ============ DM Allowlist ============

export interface DmAllowlistEntry {
  user_id: number;
  username?: string;
  first_name?: string;
  requested_at: string;
}

export interface DmAllowlist {
  allowed_user_ids: number[];
  pending_requests: DmAllowlistEntry[];
}
