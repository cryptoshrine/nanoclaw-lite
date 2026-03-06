/**
 * Team Manager for NanoClaw
 * Orchestrates teammate lifecycle: spawning, monitoring, and cleanup.
 */

import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  TEAM_DIR,
  TEAM_POLL_INTERVAL,
  TEAMMATE_TIMEOUT,
  DEFAULT_TEAMMATE_MODEL,
  MAX_CONCURRENT_SPECIALISTS,
} from './config.js';
import {
  createTeam,
  createTeamMember,
  getTeam,
  getTeamMembers,
  updateTeamMember,
  updateTeamStatus,
  getActiveTeams,
} from './db.js';
import { runTeammate as runTeammateDispatch } from './container-runner.js';
import { logger } from './logger.js';
import { Team, TeamMember } from './types.js';

// Track active teammate containers
interface ActiveTeammate {
  memberId: string;
  teamId: string;
  name: string;
  chatJid: string;
  promise: Promise<void>;
  startTime: number;
}

const activeTeammates = new Map<string, ActiveTeammate>();

/**
 * Generate a unique ID for teams or members
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new team with the lead as the first member
 */
export function createNewTeam(name: string, leadGroup: string): Team {
  const teamId = generateId('team');
  const now = new Date().toISOString();

  const team: Team = {
    id: teamId,
    name,
    lead_group: leadGroup,
    status: 'active',
    created_at: now,
  };

  createTeam(team);

  // Create lead member entry
  const leadMember: TeamMember = {
    id: generateId('member'),
    team_id: teamId,
    name: 'lead',
    model: 'claude-opus-4-6', // Lead uses opus
    role: 'lead',
    status: 'active',
    container_id: null,
    session_id: null,
    prompt: null,
    created_at: now,
  };

  createTeamMember(leadMember);

  // Create team directory
  const teamDir = path.join(TEAM_DIR, teamId);
  fs.mkdirSync(teamDir, { recursive: true });

  logger.info({ teamId, name, leadGroup }, 'Team created');

  return team;
}

/**
 * Spawn a new teammate in a container
 */
export async function spawnTeammate(params: {
  teamId: string;
  name: string;
  prompt: string;
  model?: string;
  leadGroup: string;
  chatJid?: string;
}): Promise<TeamMember> {
  const { teamId, name, prompt, model, leadGroup, chatJid } = params;
  const now = new Date().toISOString();

  // Enforce concurrency cap — prevent runaway specialist spawning
  if (activeTeammates.size >= MAX_CONCURRENT_SPECIALISTS) {
    throw new Error(
      `Concurrency cap reached: ${activeTeammates.size}/${MAX_CONCURRENT_SPECIALISTS} specialists active. ` +
      `Wait for a specialist to finish before spawning another.`
    );
  }

  const team = getTeam(teamId);
  if (!team) {
    throw new Error(`Team ${teamId} not found`);
  }

  if (team.status !== 'active') {
    throw new Error(`Team ${teamId} is not active`);
  }

  const memberId = generateId('member');
  const member: TeamMember = {
    id: memberId,
    team_id: teamId,
    name,
    model: model || DEFAULT_TEAMMATE_MODEL,
    role: 'teammate',
    status: 'pending',
    container_id: null,
    session_id: null,
    prompt,
    created_at: now,
  };

  createTeamMember(member);

  logger.info({ memberId, teamId, name }, 'Spawning teammate');

  // Start the container asynchronously
  const containerPromise = runTeammateInContainer(member, leadGroup, chatJid);

  activeTeammates.set(memberId, {
    memberId,
    teamId,
    name,
    chatJid: chatJid || '',
    promise: containerPromise,
    startTime: Date.now(),
  });

  // Update status to active
  updateTeamMember(memberId, { status: 'active' });

  return member;
}

/**
 * Run a teammate in a container
 */
async function runTeammateInContainer(
  member: TeamMember,
  leadGroup: string,
  chatJid?: string,
): Promise<void> {
  try {
    const output = await runTeammateDispatch({
      teamId: member.team_id,
      memberId: member.id,
      memberName: member.name,
      prompt: member.prompt || '',
      model: member.model,
      leadGroup,
      chatJid,
    });

    if (output.status === 'error') {
      logger.error(
        { memberId: member.id, error: output.error },
        'Teammate container failed',
      );
      updateTeamMember(member.id, { status: 'failed' });
    } else {
      logger.info({ memberId: member.id }, 'Teammate completed');
      updateTeamMember(member.id, {
        status: 'completed',
        session_id: output.newSessionId,
      });
    }
  } catch (err) {
    logger.error({ memberId: member.id, err }, 'Teammate container error');
    updateTeamMember(member.id, { status: 'failed' });
  } finally {
    activeTeammates.delete(member.id);
  }
}

/**
 * Shutdown a specific teammate (not implemented yet - would need container kill)
 */
export function shutdownTeammate(memberId: string): void {
  const active = activeTeammates.get(memberId);
  if (!active) {
    logger.warn({ memberId }, 'Teammate not found in active list');
    return;
  }

  // Mark as completed (container will timeout or finish)
  updateTeamMember(memberId, { status: 'completed' });
  activeTeammates.delete(memberId);

  logger.info({ memberId }, 'Teammate marked for shutdown');
}

/**
 * Cleanup a team: mark as completed and stop all teammates
 */
export function cleanupTeam(teamId: string): void {
  const team = getTeam(teamId);
  if (!team) {
    logger.warn({ teamId }, 'Team not found for cleanup');
    return;
  }

  // Stop all active teammates
  const members = getTeamMembers(teamId);
  for (const member of members) {
    if (activeTeammates.has(member.id)) {
      shutdownTeammate(member.id);
    }
  }

  // Mark team as completed
  updateTeamStatus(teamId, 'completed');

  logger.info({ teamId }, 'Team cleaned up');
}

/**
 * Get status of all teammates in a team
 */
export function getTeammateStatus(teamId: string): {
  members: TeamMember[];
  activeCount: number;
} {
  const members = getTeamMembers(teamId);
  let activeCount = 0;

  for (const member of members) {
    if (activeTeammates.has(member.id)) {
      activeCount++;
    }
  }

  return { members, activeCount };
}

/**
 * Start the team watcher loop
 * Monitors for teammate timeouts and team status
 */
export function startTeamWatcher(): void {
  const checkTeams = () => {
    const now = Date.now();

    // Check for timed out teammates
    for (const [memberId, active] of activeTeammates.entries()) {
      if (now - active.startTime > TEAMMATE_TIMEOUT) {
        logger.warn(
          { memberId, teamId: active.teamId },
          'Teammate timed out',
        );
        updateTeamMember(memberId, { status: 'failed' });
        activeTeammates.delete(memberId);
      }
    }

    // Check for teams with all teammates completed
    const teams = getActiveTeams();
    for (const team of teams) {
      const members = getTeamMembers(team.id);
      const teammates = members.filter((m) => m.role === 'teammate');

      if (teammates.length > 0) {
        const allDone = teammates.every(
          (m) => m.status === 'completed' || m.status === 'failed',
        );
        if (allDone) {
          logger.info({ teamId: team.id }, 'All teammates finished');
          // Don't auto-complete - let lead decide
        }
      }
    }

    setTimeout(checkTeams, TEAM_POLL_INTERVAL);
  };

  checkTeams();
  logger.info('Team watcher started');
}

/**
 * Get the number of currently active specialists across all teams.
 */
export function getActiveSpecialistCount(): number {
  return activeTeammates.size;
}

/**
 * Get info about a tracked active teammate for progress streaming.
 * Returns null if the teammate is not active.
 */
export function getTeammateInfo(memberId: string): { name: string; chatJid: string; teamId: string } | null {
  const active = activeTeammates.get(memberId);
  if (!active) return null;
  return { name: active.name, chatJid: active.chatJid, teamId: active.teamId };
}

/**
 * Write team state snapshot for container to read
 */
export function writeTeamSnapshot(teamId: string, groupFolder: string): void {
  const team = getTeam(teamId);
  if (!team) return;

  const members = getTeamMembers(teamId);
  const teamDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(teamDir, { recursive: true });

  const snapshot = {
    team,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      status: m.status,
    })),
    lastUpdated: new Date().toISOString(),
  };

  const snapshotFile = path.join(teamDir, `team-${teamId}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
}
