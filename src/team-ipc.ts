/**
 * Team IPC Type Definitions
 * Defines the message types for inter-process communication between
 * main process and teammate containers.
 */

// Base IPC message structure
export interface TeamIpcBase {
  type: string;
  timestamp: string;
}

// ============ Lead-only IPC messages ============

export interface CreateTeamIpc extends TeamIpcBase {
  type: 'create_team';
  name: string;
  leadGroup: string;
}

export interface SpawnTeammateIpc extends TeamIpcBase {
  type: 'spawn_teammate';
  teamId: string;
  name: string;
  prompt: string;
  model?: string;
}

export interface ShutdownTeammateIpc extends TeamIpcBase {
  type: 'shutdown_teammate';
  memberId: string;
}

export interface CleanupTeamIpc extends TeamIpcBase {
  type: 'cleanup_team';
  teamId: string;
}

// ============ Team messaging IPC ============

export interface TeamMessageIpc extends TeamIpcBase {
  type: 'team_message';
  teamId: string;
  fromMember: string;
  toMember: string | null; // null = broadcast
  content: string;
}

// ============ Team task IPC ============

export interface CreateTeamTaskIpc extends TeamIpcBase {
  type: 'create_team_task';
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  dependsOn?: string;
}

export interface ClaimTeamTaskIpc extends TeamIpcBase {
  type: 'claim_team_task';
  taskId: string;
  memberId: string;
}

export interface CompleteTeamTaskIpc extends TeamIpcBase {
  type: 'complete_team_task';
  taskId: string;
}

export interface UpdateTeamTaskIpc extends TeamIpcBase {
  type: 'update_team_task';
  taskId: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'blocked';
  description?: string;
}

// Union type for all team IPC messages
export type TeamIpcMessage =
  | CreateTeamIpc
  | SpawnTeammateIpc
  | ShutdownTeammateIpc
  | CleanupTeamIpc
  | TeamMessageIpc
  | CreateTeamTaskIpc
  | ClaimTeamTaskIpc
  | CompleteTeamTaskIpc
  | UpdateTeamTaskIpc;

// Response written back to container's IPC directory
export interface TeamIpcResponse {
  requestId: string;
  success: boolean;
  error?: string;
  data?: unknown;
}
