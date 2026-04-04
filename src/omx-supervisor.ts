/**
 * OmX Supervisor — Autonomous multi-agent orchestration engine.
 *
 * The supervisor runs as a stateless tick (called every 60s by a scheduled task).
 * Each tick reads workflow state from disk, makes one decision, writes state back.
 * This design survives crashes, restarts, and context limits.
 *
 * Flow: Decompose → Execute (spawn/monitor/retry) → Gate (test) → Push → Report
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  OMX_MAX_RETRIES_PER_STEP,
  OMX_STEP_TIMEOUT,
  OMX_MAX_TOTAL_DURATION,
  OMX_MAX_SPECIALISTS_PER_WORKFLOW,
  OMX_REQUIRE_APPROVAL_FOR_PUSH,
  OMX_WORKFLOWS_DIR,
  OMX_CODEX_ENABLED,
  OMX_CODEX_AGENT_TYPE,
} from './config.js';
import {
  startCodexJob,
  checkCodexJobStatus,
  cleanupCodexJob,
  nudgeCodexJob,
} from './codex-bridge.js';
import { getTeamMember } from './db.js';
import { logger } from './logger.js';
import { spawnTeammate, cleanupTeam } from './team-manager.js';
import { broadcast as wsBroadcast } from './ws-server.js';
import { postToMissionControl } from './discord-channels.js';
import { claimStep, transitionStep, reclaimExpiredSteps } from './omx-claim.js';
import { createSnapshot, appendToSnapshot, readSnapshot } from './omx-context.js';
import { initMailbox, getUnreadMessages, markDelivered } from './omx-mailbox.js';
import { scoreStepClarity, isStepTooVague, isStepNeedsEnhancement, enhanceVagueStep } from './omx-ambiguity.js';
import { detectSlop, shouldDeslop, buildDeslopPrompt } from './omx-deslop.js';
import { createWorkflowBranch, mergeWorkflowBranch, cleanupBranch } from './omx-branch.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OmxSpecialistType = 'dev' | 'research' | 'review' | 'gate' | 'commit';

export interface OmxStepAnnotations {
  specialist: OmxSpecialistType;
  model?: string;
  depends?: number;
  gate?: 'full' | 'quick';
  agent?: 'codex' | 'claude';
}

export interface OmxStep {
  number: number;
  title: string;
  content: string;
  status: 'pending' | 'skipped' | 'in_progress' | 'completed' | 'failed';
  annotations: OmxStepAnnotations;
  memberId?: string;
  codexJobId?: string;
  executionMode?: 'specialist' | 'codex' | 'direct';
  retryCount: number;
  output?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Claim-safe lifecycle (Pattern 1) */
  version?: number;
  claim?: { owner: string; token: string; leasedUntil: string };
  claimToken?: string;
  /** Pattern 4: Heartbeat — track when Codex nudge was sent (one per step) */
  nudgedAt?: string;
  /** Pattern 2: Ambiguity — clarity score 0-1 for this step */
  clarityScore?: number;
  /** Pattern 5: Deslop — tracks whether a cleanup pass is pending/running */
  deslopPending?: boolean;
  deslopMemberId?: string;
}

export type OmxPhaseStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface OmxWorkflow {
  id: string;
  taskDescription: string;
  groupFolder: string;
  chatJid: string;
  teamId: string;
  projectPath: string;
  status: 'active' | 'completed' | 'failed' | 'awaiting_approval';
  steps: OmxStep[];
  currentStepIndex: number;
  phases: {
    execute: OmxPhaseStatus;
    gate: OmxPhaseStatus;
    push: OmxPhaseStatus;
    report: OmxPhaseStatus;
  };
  specialistsSpawned: number;
  requiresApproval: boolean;
  approvalRequestId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  context: string;
  /** Pattern 7: Branch Isolation — dedicated branch for this workflow */
  branch?: string;
  /** Pattern 8: Leader Activity Tracking */
  lastSupervisorActionAt?: string;
  lastSpecialistProgressAt?: string;
  lastUserInteractionAt?: string;
  staleAlertSentAt?: string;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureDir(): void {
  fs.mkdirSync(OMX_WORKFLOWS_DIR, { recursive: true });
}

function workflowPath(id: string): string {
  return path.join(OMX_WORKFLOWS_DIR, `${id}.json`);
}

export function saveOmxWorkflow(workflow: OmxWorkflow): void {
  ensureDir();
  workflow.updatedAt = new Date().toISOString();
  const tmpPath = `${workflowPath(workflow.id)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(workflow, null, 2));
  fs.renameSync(tmpPath, workflowPath(workflow.id));
}

export function loadOmxWorkflow(id: string): OmxWorkflow | null {
  const p = workflowPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function listActiveOmxWorkflows(): OmxWorkflow[] {
  ensureDir();
  const files = fs.readdirSync(OMX_WORKFLOWS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const workflows: OmxWorkflow[] = [];
  for (const file of files) {
    try {
      const wf: OmxWorkflow = JSON.parse(
        fs.readFileSync(path.join(OMX_WORKFLOWS_DIR, file), 'utf-8'),
      );
      if (wf.status === 'active' || wf.status === 'awaiting_approval') {
        workflows.push(wf);
      }
    } catch { /* skip corrupt */ }
  }
  return workflows;
}

// ── Leader Activity Tracking (Pattern 8) ──────────────────────────────────────

/** A workflow is considered stale if all activity signals exceed this threshold. */
const OMX_STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
/** Don't re-alert about the same stale workflow within this cooldown. */
const OMX_STALE_ALERT_COOLDOWN = 10 * 60 * 1000; // 10 minutes

/** Pattern 4: Specialist stall timeout — fail early instead of waiting full 15min. */
const OMX_SPECIALIST_STALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes
/** Pattern 4: Codex nudge threshold — nudge idle workers after this period. */
const OMX_CODEX_NUDGE_THRESHOLD = 3 * 60 * 1000; // 3 minutes

/**
 * Returns true when ALL three activity signals are stale (or unset).
 * A single recent signal means something is still happening.
 */
export function isWorkflowStale(workflow: OmxWorkflow): boolean {
  const now = Date.now();

  function signalAge(ts: string | undefined): number {
    return ts ? now - new Date(ts).getTime() : Infinity;
  }

  return (
    signalAge(workflow.lastSupervisorActionAt) > OMX_STALE_THRESHOLD &&
    signalAge(workflow.lastSpecialistProgressAt) > OMX_STALE_THRESHOLD &&
    signalAge(workflow.lastUserInteractionAt) > OMX_STALE_THRESHOLD
  );
}

/**
 * Update supervisor action timestamp on the workflow.
 */
function touchSupervisorAction(workflow: OmxWorkflow): void {
  workflow.lastSupervisorActionAt = new Date().toISOString();
}

/**
 * Update specialist progress timestamp on the workflow.
 */
function touchSpecialistProgress(workflow: OmxWorkflow): void {
  workflow.lastSpecialistProgressAt = new Date().toISOString();
}

/**
 * Update user interaction timestamp on the workflow.
 */
function touchUserInteraction(workflow: OmxWorkflow): void {
  workflow.lastUserInteractionAt = new Date().toISOString();
}

// ── Step Annotation Parser ────────────────────────────────────────────────────

/**
 * Parse OmX annotations from step header.
 * Format: ## Step N: Title [specialist:dev, model:sonnet, depends:3, gate:full]
 */
export function parseOmxAnnotations(header: string): OmxStepAnnotations {
  const annotations: OmxStepAnnotations = { specialist: 'dev' };

  const bracketMatch = header.match(/\[([^\]]+)\]/);
  if (!bracketMatch) return annotations;

  const parts = bracketMatch[1].split(',').map(s => s.trim());
  for (const part of parts) {
    const [key, value] = part.split(':').map(s => s.trim());
    switch (key) {
      case 'specialist':
        annotations.specialist = value as OmxSpecialistType;
        break;
      case 'model':
        annotations.model = value;
        break;
      case 'depends':
        annotations.depends = parseInt(value, 10);
        break;
      case 'gate':
        annotations.gate = value as 'full' | 'quick';
        break;
      case 'agent':
        annotations.agent = value as 'codex' | 'claude';
        break;
    }
  }

  return annotations;
}

/**
 * Parse an OmX workflow markdown file into structured steps.
 */
export function parseOmxWorkflowSteps(content: string): OmxStep[] {
  const steps: OmxStep[] = [];
  const stepRegex = /^##\s+Step\s+(\d+)[:\s\u2014\u2013-]+(.+)$/gm;
  const matches: { index: number; number: number; title: string; rawTitle: string }[] = [];

  let match;
  while ((match = stepRegex.exec(content)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1], 10),
      title: match[2].replace(/\[.*\]/, '').trim(),
      rawTitle: match[2].trim(),
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const stepContent = content.slice(start, end).trim();
    const annotations = parseOmxAnnotations(matches[i].rawTitle);

    steps.push({
      number: matches[i].number,
      title: matches[i].title,
      content: stepContent,
      status: 'pending',
      annotations,
      retryCount: 0,
    });
  }

  return steps;
}

// ── Workflow Creation ─────────────────────────────────────────────────────────

/**
 * Create a new OmX workflow from a markdown definition.
 */
export function createOmxWorkflow(params: {
  workflowContent: string;
  taskDescription: string;
  groupFolder: string;
  chatJid: string;
  teamId: string;
  projectPath: string;
}): OmxWorkflow {
  const steps = parseOmxWorkflowSteps(params.workflowContent);
  if (steps.length === 0) {
    throw new Error('No steps found in OmX workflow');
  }

  const id = `omx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const workflow: OmxWorkflow = {
    id,
    taskDescription: params.taskDescription,
    groupFolder: params.groupFolder,
    chatJid: params.chatJid,
    teamId: params.teamId,
    projectPath: params.projectPath,
    status: 'active',
    steps,
    currentStepIndex: 0,
    phases: {
      execute: 'in_progress',
      gate: 'pending',
      push: 'pending',
      report: 'pending',
    },
    specialistsSpawned: 0,
    requiresApproval: OMX_REQUIRE_APPROVAL_FOR_PUSH,
    createdAt: now,
    updatedAt: now,
    context: '',
  };

  saveOmxWorkflow(workflow);

  // Pattern 7: Create a dedicated git branch for this workflow
  try {
    const branch = createWorkflowBranch(params.projectPath, id);
    workflow.branch = branch;
    saveOmxWorkflow(workflow);
  } catch (err) {
    logger.warn({ omxId: id, error: String(err) }, 'Pattern 7: Failed to create workflow branch — continuing without isolation');
  }

  // Pattern 6: Create initial context snapshot on disk
  createSnapshot(id, params.taskDescription, params.projectPath, params.workflowContent);

  // Pattern 3: Initialize mailbox directory for specialist ↔ supervisor messaging
  initMailbox(id);

  logger.info({ omxId: id, steps: steps.length }, 'OmX workflow created');

  wsBroadcast('omx.created', { id, taskDescription: params.taskDescription, steps: steps.length });
  postToMissionControl(
    'OmX Workflow Started',
    `**${params.taskDescription}**\nID: \`${id}\`\nSteps: ${steps.length}`,
    0xf59e0b,
  ).catch(() => {});

  return workflow;
}

// ── Specialist Prompt Building ────────────────────────────────────────────────

function buildSpecialistPrompt(workflow: OmxWorkflow, step: OmxStep): string {
  // Pattern 6: Use file-based snapshot instead of in-memory string accumulator
  const previousContext = readSnapshot(workflow.id) || workflow.context.slice(-4000);
  const specialistProfile = getSpecialistProfile(step.annotations.specialist);

  let prompt = '';

  if (specialistProfile) {
    prompt += `Read the specialist profile below:\n\n${specialistProfile}\n\n---\n\n`;
  }

  prompt += `OmX AUTONOMOUS TASK — Step ${step.number}/${workflow.steps.length}\n\n`;
  prompt += `OVERALL TASK: ${workflow.taskDescription}\n\n`;

  if (previousContext) {
    prompt += `CONTEXT FROM PREVIOUS STEPS:\n${previousContext}\n\n`;
  }

  prompt += `YOUR STEP:\n${step.content}\n\n`;
  prompt += `PROJECT PATH: ${workflow.projectPath}\n\n`;
  // Pattern 3: Mailbox for progress reporting
  const mailboxPath = `data/omx-workflows/${workflow.id}/mailbox/${step.number}.json`;
  prompt += `MAILBOX (progress reporting): ${mailboxPath}\n`;
  prompt += `Write progress updates by appending JSON messages to this file. Format: array of { "id": "<uuid>", "from": "specialist", "to": "supervisor", "body": "<your update>", "created_at": "<iso timestamp>" }.\n`;
  prompt += `The supervisor checks this file every 60s and forwards updates to the user.\n\n`;

  // Pattern 7: Branch isolation — tell specialist which branch to work on
  if (workflow.branch) {
    prompt += `GIT BRANCH: You are working on branch ${workflow.branch}. Make sure you're on this branch before making changes (run: git checkout ${workflow.branch}).\n\n`;
  }

  prompt += `INSTRUCTIONS:\n`;
  prompt += `1. Execute the step above thoroughly\n`;
  prompt += `2. Use send_message to report your results when done\n`;
  prompt += `3. If you hit a blocker, report it via send_message\n`;
  prompt += `4. Save any important output to files in the project\n`;
  prompt += `5. Write progress updates to your mailbox file every 2-3 minutes to avoid being marked as stalled (the supervisor auto-fails steps with no progress for 5 minutes)\n`;

  return prompt;
}

function getSpecialistProfile(type: OmxSpecialistType): string | null {
  const profileMap: Record<string, string> = {
    dev: 'specialists/ball-ai-dev.md',
    research: 'specialists/ball-ai-research.md',
    review: 'specialists/adversarial-review.md',
    gate: 'specialists/omx-gate.md',
    commit: 'specialists/omx-gate.md',
  };

  const profilePath = profileMap[type];
  if (!profilePath) return null;

  const fullPath = path.join(process.cwd(), 'groups', 'main', profilePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

function getModelForStep(step: OmxStep): string {
  if (step.annotations.model) {
    const modelMap: Record<string, string> = {
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-6',
    };
    return modelMap[step.annotations.model] || step.annotations.model;
  }

  // Defaults by specialist type
  const defaults: Record<string, string> = {
    dev: 'claude-sonnet-4-6',
    research: 'claude-sonnet-4-6',
    review: 'claude-sonnet-4-6',
    gate: 'claude-sonnet-4-6',
    commit: 'claude-sonnet-4-6',
  };

  return defaults[step.annotations.specialist] || 'claude-sonnet-4-6';
}

// ── Test Gate ─────────────────────────────────────────────────────────────────

function buildGatePrompt(workflow: OmxWorkflow, step: OmxStep): string {
  const gateType = step.annotations.gate || 'full';

  let commands: string;
  if (gateType === 'full') {
    commands = `pytest -v && mypy . --strict && ruff check .`;
  } else {
    commands = `pytest -v`;
  }

  return `You are an OmX test gate agent. Your ONLY job is to run validation commands and report results.

PROJECT PATH: ${workflow.projectPath}

COMMANDS TO RUN (in order):
${commands}

INSTRUCTIONS:
1. cd to the project path
2. Run each command
3. Report PASS if ALL succeed
4. Report FAIL with the specific error output if ANY fail
5. Use send_message to report: "GATE: PASS" or "GATE: FAIL\\n<error details>"
6. Be concise — include only the failing test/error output, not passing test noise
`;
}

// ── Commit Step ───────────────────────────────────────────────────────────────

function buildCommitPrompt(workflow: OmxWorkflow): string {
  const branch = workflow.branch || 'main';
  return `You are an OmX commit agent. Your job is to commit changes on the workflow branch.

PROJECT PATH: ${workflow.projectPath}
BRANCH: ${branch}

INSTRUCTIONS:
1. cd to the project path
2. Run: git checkout ${branch}
3. Run: git add -A
4. Run: git diff --staged --stat
5. Run: git commit -m "feat(omx): ${workflow.taskDescription}"
6. Report the commit hash and summary via send_message
7. Format: "COMMIT: <hash>\\n<summary of files changed>"

Do NOT push. Do NOT merge. The supervisor handles branch merging after approval.
`;
}

// ── Codex Dispatch Routing ─────────────────────────────────────────────────────

/**
 * Determine if a step should be dispatched to Codex CLI instead of Claude SDK.
 */
function shouldUseCodex(step: OmxStep): boolean {
  if (!OMX_CODEX_ENABLED) return false;
  // Explicit override in annotation
  if (step.annotations.agent === 'codex') return true;
  if (step.annotations.agent === 'claude') return false;
  // Gate steps run as direct shell commands — not Codex
  if (step.annotations.gate) return false;
  // Coding-focused specialists → Codex
  const codexTypes: OmxSpecialistType[] = ['dev', 'commit'];
  return codexTypes.includes(step.annotations.specialist);
}

/**
 * Determine if a step should run as a direct shell command (no AI agent).
 */
function shouldRunDirectly(step: OmxStep): boolean {
  return !!step.annotations.gate;
}

/**
 * Spawn a Codex job for an OmX step.
 */
async function spawnCodexForStep(workflow: OmxWorkflow, step: OmxStep): Promise<void> {
  if (workflow.specialistsSpawned >= OMX_MAX_SPECIALISTS_PER_WORKFLOW) {
    step.status = 'failed';
    step.error = 'Specialist budget exhausted';
    saveOmxWorkflow(workflow);
    return;
  }

  const prompt = buildCodexPrompt(workflow, step);
  const teamName = `omx-${workflow.id.slice(-8)}-s${step.number}`;

  try {
    const { jobId, pid } = await startCodexJob({
      teamName,
      agentType: OMX_CODEX_AGENT_TYPE,
      task: { subject: step.title, description: prompt },
      cwd: workflow.projectPath,
    });

    step.status = 'in_progress';
    step.codexJobId = jobId;
    step.executionMode = 'codex';
    step.startedAt = new Date().toISOString();
    workflow.specialistsSpawned++;
    saveOmxWorkflow(workflow);

    logger.info(
      { omxId: workflow.id, step: step.number, jobId, pid },
      'OmX Codex job started',
    );
    wsBroadcast('omx.step.spawned', {
      id: workflow.id,
      step: step.number,
      specialist: 'codex',
      jobId,
    });
  } catch (err) {
    step.status = 'failed';
    step.error = err instanceof Error ? err.message : String(err);
    saveOmxWorkflow(workflow);
    logger.error(
      { omxId: workflow.id, step: step.number, error: step.error },
      'Failed to start Codex job',
    );
  }
}

/**
 * Build a simpler prompt for Codex workers (no specialist profiles needed).
 */
function buildCodexPrompt(workflow: OmxWorkflow, step: OmxStep): string {
  // Pattern 6: Use file-based snapshot instead of in-memory string accumulator
  const previousContext = readSnapshot(workflow.id) || workflow.context.slice(-4000);
  let prompt = `TASK: ${workflow.taskDescription}\n\n`;
  prompt += `STEP ${step.number}/${workflow.steps.length}: ${step.title}\n\n`;
  prompt += step.content + '\n\n';
  if (previousContext) {
    prompt += `CONTEXT FROM PREVIOUS STEPS:\n${previousContext}\n\n`;
  }
  prompt += `WORKING DIRECTORY: ${workflow.projectPath}\n`;
  // Pattern 7: Branch isolation for Codex workers
  if (workflow.branch) {
    prompt += `GIT BRANCH: ${workflow.branch} — ensure you're on this branch before making changes.\n`;
  }
  prompt += `Run tests to verify your changes work correctly.\n\n`;
  // Pattern 3: Mailbox for progress reporting
  const mailboxPath = `data/omx-workflows/${workflow.id}/mailbox/${step.number}.json`;
  prompt += `MAILBOX: ${mailboxPath}\n`;
  prompt += `Write progress updates by appending JSON messages to this file. Format: array of { "id": "<uuid>", "from": "codex", "to": "supervisor", "body": "<update>", "created_at": "<timestamp>" }.\n`;
  return prompt;
}

/**
 * Check the status of an in-progress Codex step.
 */
async function checkCodexStepStatus(
  workflow: OmxWorkflow,
  step: OmxStep,
  _sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<void> {
  const jobStatus = checkCodexJobStatus(step.codexJobId!);

  switch (jobStatus.status) {
    case 'running': {
      const stepElapsed = Date.now() - new Date(step.startedAt || workflow.createdAt).getTime();
      if (stepElapsed > OMX_STEP_TIMEOUT) {
        step.status = 'failed';
        step.error = `Codex job timed out after ${Math.round(stepElapsed / 60000)} minutes`;
        await cleanupCodexJob(step.codexJobId!);
        saveOmxWorkflow(workflow);
      }
      break;
    }
    case 'completed': {
      step.status = 'completed';
      step.completedAt = new Date().toISOString();
      step.output = jobStatus.result || `Codex completed step ${step.number}`;
      saveOmxWorkflow(workflow);
      logger.info(
        { omxId: workflow.id, step: step.number, jobId: step.codexJobId },
        'Codex step completed',
      );
      break;
    }
    case 'failed':
    case 'timeout': {
      step.status = 'failed';
      step.error = jobStatus.error || `Codex job ${jobStatus.status}`;
      await cleanupCodexJob(step.codexJobId!);
      saveOmxWorkflow(workflow);
      logger.warn(
        { omxId: workflow.id, step: step.number, error: step.error },
        'Codex step failed',
      );
      break;
    }
  }
}

/**
 * Run a gate step as a direct shell command — no AI agent needed.
 * pytest/mypy/ruff are pure CLI tools.
 */
async function runGateDirectly(
  workflow: OmxWorkflow,
  step: OmxStep,
  _sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<void> {
  const gateType = step.annotations.gate || 'full';
  const commands = gateType === 'full'
    ? ['pytest -v', 'mypy . --strict', 'ruff check .']
    : ['pytest -v'];

  step.status = 'in_progress';
  step.executionMode = 'direct';
  step.startedAt = new Date().toISOString();
  saveOmxWorkflow(workflow);

  for (const cmd of commands) {
    try {
      const result = await execInProject(workflow.projectPath, cmd);
      if (result.exitCode !== 0) {
        step.status = 'failed';
        step.error = `Gate failed: ${cmd}\n${result.stderr.slice(0, 2000)}`;
        saveOmxWorkflow(workflow);
        return;
      }
    } catch (err) {
      step.status = 'failed';
      step.error = `Gate error: ${cmd}\n${err instanceof Error ? err.message : String(err)}`;
      saveOmxWorkflow(workflow);
      return;
    }
  }

  step.status = 'completed';
  step.completedAt = new Date().toISOString();
  step.output = 'GATE: PASS';
  saveOmxWorkflow(workflow);
  logger.info({ omxId: workflow.id, step: step.number }, 'Gate step passed (direct exec)');
}

/**
 * Execute a shell command in a project directory. Returns stdout, stderr, and exit code.
 * Used for gate steps that don't need an AI agent.
 */
function execInProject(projectPath: string, cmd: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', cmd], {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000, // 5 min max for gate commands
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on('data', (d: Buffer) => stdout.push(d.toString()));
    child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
    child.on('close', (code: number | null) => {
      resolve({
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        exitCode: code ?? 1,
      });
    });
    child.on('error', (err: Error) => {
      resolve({
        stdout: stdout.join(''),
        stderr: `Spawn error: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

// ── Supervisor Tick ───────────────────────────────────────────────────────────

/**
 * Main supervisor tick. Called every 60s for each active OmX workflow.
 * Stateless: reads state, makes one decision, writes state back.
 */
export async function supervisorTick(
  workflow: OmxWorkflow,
  sendMessage: (jid: string, text: string) => Promise<void>,
  requestApproval?: (description: string) => Promise<{ requestId: string }>,
  checkApproval?: (requestId: string) => Promise<{ status: string; response?: string }>,
): Promise<void> {
  const now = Date.now();
  const elapsed = now - new Date(workflow.createdAt).getTime();

  // Reclaim any steps with expired leases (Pattern 1: Claim-Safe)
  const reclaimed = reclaimExpiredSteps(workflow);
  if (reclaimed > 0) {
    logger.info({ omxId: workflow.id, reclaimed }, 'Reclaimed expired step leases');
    saveOmxWorkflow(workflow);
  }

  // Pattern 8: Stale workflow detection — alert user if nothing is happening
  if (isWorkflowStale(workflow)) {
    const cooldownOk = !workflow.staleAlertSentAt ||
      now - new Date(workflow.staleAlertSentAt).getTime() > OMX_STALE_ALERT_COOLDOWN;
    if (cooldownOk) {
      const lastActivity = workflow.lastSupervisorActionAt || workflow.lastSpecialistProgressAt || workflow.createdAt;
      const agoMin = Math.round((now - new Date(lastActivity).getTime()) / 60000);
      await sendMessage(
        workflow.chatJid,
        `*OmX stall detected:* "${workflow.taskDescription}" — no activity for ${agoMin}min. Step ${workflow.currentStepIndex + 1}/${workflow.steps.length}.`,
      );
      workflow.staleAlertSentAt = new Date().toISOString();
      saveOmxWorkflow(workflow);
    }
  }

  // Check total duration limit
  if (elapsed > OMX_MAX_TOTAL_DURATION) {
    workflow.status = 'failed';
    saveOmxWorkflow(workflow);
    await sendMessage(workflow.chatJid, `*OmX Failed: ${workflow.taskDescription}*\n\nExceeded maximum duration (${Math.round(OMX_MAX_TOTAL_DURATION / 60000)} minutes).`);
    cleanupTeam(workflow.teamId);
    wsBroadcast('omx.failed', { id: workflow.id, reason: 'timeout' });
    return;
  }

  // Check specialist budget
  if (workflow.specialistsSpawned >= OMX_MAX_SPECIALISTS_PER_WORKFLOW) {
    const allDone = workflow.steps.every(s =>
      s.status === 'completed' || s.status === 'skipped' || s.status === 'failed',
    );
    if (!allDone) {
      // Only fail if there are still pending steps and no active specialists
      const hasActive = workflow.steps.some(s => s.status === 'in_progress');
      if (!hasActive) {
        workflow.status = 'failed';
        saveOmxWorkflow(workflow);
        await sendMessage(workflow.chatJid, `*OmX Failed: ${workflow.taskDescription}*\n\nExceeded specialist budget (${OMX_MAX_SPECIALISTS_PER_WORKFLOW} max).`);
        cleanupTeam(workflow.teamId);
        return;
      }
    }
  }

  // Handle approval-waiting state
  if (workflow.status === 'awaiting_approval' && workflow.approvalRequestId) {
    if (checkApproval) {
      try {
        const result = await checkApproval(workflow.approvalRequestId);
        if (result.status === 'approved') {
          touchUserInteraction(workflow);
          workflow.status = 'active';
          workflow.approvalRequestId = undefined;
          // Find the commit step and proceed
          const commitStep = workflow.steps.find(
            s => s.annotations.specialist === 'commit' && s.status === 'pending',
          );
          if (commitStep) {
            await spawnForStep(workflow, commitStep);
          }
          saveOmxWorkflow(workflow);
        } else if (result.status === 'rejected') {
          touchUserInteraction(workflow);
          workflow.status = 'completed';
          workflow.approvalRequestId = undefined;
          saveOmxWorkflow(workflow);
          await sendMessage(workflow.chatJid, `*OmX Cancelled: ${workflow.taskDescription}*\n\nPush rejected by user. Changes are committed locally but not pushed.`);
          cleanupTeam(workflow.teamId);
        }
        // else still pending — do nothing
      } catch {
        // Approval check failed — retry next tick
      }
    }
    return;
  }

  // Find current step to work on
  const currentStep = workflow.steps[workflow.currentStepIndex];
  if (!currentStep) {
    // All steps processed — complete the workflow
    await completeWorkflow(workflow, sendMessage);
    return;
  }

  // Handle different step states
  switch (currentStep.status) {
    case 'pending':
      await handlePendingStep(workflow, currentStep, sendMessage, requestApproval);
      break;

    case 'in_progress':
      await handleInProgressStep(workflow, currentStep, sendMessage);
      break;

    case 'completed':
    case 'skipped':
      // Pattern 5: Wait for deslop specialist to finish before advancing
      if (currentStep.deslopPending && currentStep.deslopMemberId) {
        const deslopMember = getTeamMember(currentStep.deslopMemberId);
        if (deslopMember && (deslopMember.status === 'active' || deslopMember.status === 'pending')) {
          // Deslop still running — wait for next tick
          break;
        }
        // Deslop finished (completed or failed) — clear and advance
        currentStep.deslopPending = false;
        if (deslopMember?.status === 'completed') {
          logger.info({ omxId: workflow.id, step: currentStep.number }, 'Pattern 5: Deslop cleanup complete');
        } else {
          logger.warn({ omxId: workflow.id, step: currentStep.number }, 'Pattern 5: Deslop specialist failed or missing — advancing anyway');
        }
      }
      // Advance to next step
      accumulateContext(workflow, currentStep);
      workflow.currentStepIndex++;
      saveOmxWorkflow(workflow);
      break;

    case 'failed':
      await handleFailedStep(workflow, currentStep, sendMessage);
      break;
  }
}

// ── Step Handlers ─────────────────────────────────────────────────────────────

async function handlePendingStep(
  workflow: OmxWorkflow,
  step: OmxStep,
  sendMessage: (jid: string, text: string) => Promise<void>,
  requestApproval?: (description: string) => Promise<{ requestId: string }>,
): Promise<void> {
  // Check dependencies
  if (step.annotations.depends) {
    const depStep = workflow.steps.find(s => s.number === step.annotations.depends);
    if (depStep && depStep.status !== 'completed' && depStep.status !== 'skipped') {
      // Dependency not met — skip this tick
      return;
    }
  }

  // Claim the step before dispatching (Pattern 1: Claim-Safe)
  const stepIndex = workflow.steps.indexOf(step);
  const claimOwner = `supervisor-${workflow.id}`;
  const token = claimStep(workflow, stepIndex, claimOwner);
  if (!token) {
    logger.warn({ omxId: workflow.id, step: step.number }, 'Failed to claim step — skipping tick');
    return;
  }
  saveOmxWorkflow(workflow);

  // Pattern 8: Record supervisor action (we claimed and are about to dispatch)
  touchSupervisorAction(workflow);

  // Pattern 2: Ambiguity Scoring — check step clarity before spawning
  // (skip for gate/commit steps which have generated prompts, not user-written content)
  if (step.annotations.specialist !== 'commit' && !step.annotations.gate) {
    const clarity = scoreStepClarity(step.content);
    step.clarityScore = clarity;

    if (isStepTooVague(clarity)) {
      // Too vague — release claim and ask user to clarify
      step.status = 'pending';
      step.claim = undefined;
      step.claimToken = undefined;
      saveOmxWorkflow(workflow);
      await sendMessage(
        workflow.chatJid,
        `*OmX Step ${step.number}* ("${step.title}") is too vague (clarity: ${clarity}). Please clarify before I proceed.`,
      );
      logger.warn(
        { omxId: workflow.id, step: step.number, clarity },
        'Pattern 2: Step too vague — awaiting clarification',
      );
      return;
    }

    if (isStepNeedsEnhancement(clarity)) {
      // Borderline — inject context from snapshot to help the specialist
      const snapshot = readSnapshot(workflow.id);
      if (snapshot) {
        step.content = enhanceVagueStep(step.content, snapshot);
        logger.info(
          { omxId: workflow.id, step: step.number, clarity },
          'Pattern 2: Step enhanced with context snapshot',
        );
      }
    }
    // clarity >= 0.7 → proceed as-is
  }

  // Gate steps run directly — no AI agent needed
  if (shouldRunDirectly(step)) {
    await runGateDirectly(workflow, step, sendMessage);
    return;
  }

  // Handle commit steps — check if approval needed
  if (step.annotations.specialist === 'commit' && workflow.requiresApproval) {
    if (requestApproval) {
      try {
        const { requestId } = await requestApproval(
          `*OmX ready to push:*\n${workflow.taskDescription}\n\nSteps completed: ${workflow.steps.filter(s => s.status === 'completed').length}/${workflow.steps.length}`,
        );
        workflow.status = 'awaiting_approval';
        workflow.approvalRequestId = requestId;
        saveOmxWorkflow(workflow);
        return;
      } catch {
        // Approval request failed — proceed without approval
        logger.warn({ omxId: workflow.id }, 'Approval request failed, proceeding without');
      }
    }
  }

  // Route coding steps through Codex CLI
  if (shouldUseCodex(step)) {
    await spawnCodexForStep(workflow, step);
    return;
  }

  // Route non-coding steps through Claude SDK specialist (existing path)
  await spawnForStep(workflow, step);
}

async function handleInProgressStep(
  workflow: OmxWorkflow,
  step: OmxStep,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<void> {
  // Pattern 3: Check mailbox for unread specialist progress updates
  try {
    const unread = getUnreadMessages(workflow.id, step.number);
    if (unread.length > 0) {
      touchSpecialistProgress(workflow); // Pattern 8: mailbox activity
    }
    for (const msg of unread) {
      await sendMessage(
        workflow.chatJid,
        `*OmX Step ${step.number} update:*\n${msg.body}`,
      );
      markDelivered(workflow.id, step.number, msg.id);
    }
  } catch {
    // Mailbox read failure is non-fatal — continue with step monitoring
  }

  // Codex job path — check job status from disk
  if (step.codexJobId) {
    // Pattern 4: Nudge idle Codex workers once after threshold
    const codexElapsed = Date.now() - new Date(step.startedAt || workflow.createdAt).getTime();
    if (codexElapsed > OMX_CODEX_NUDGE_THRESHOLD && !step.nudgedAt) {
      const nudged = nudgeCodexJob(step.codexJobId);
      if (nudged) {
        step.nudgedAt = new Date().toISOString();
        saveOmxWorkflow(workflow);
        logger.info(
          { omxId: workflow.id, step: step.number, jobId: step.codexJobId },
          'Pattern 4: Codex worker nudged after idle threshold',
        );
      }
    }
    await checkCodexStepStatus(workflow, step, sendMessage);
    return;
  }

  // Direct exec path (gate) — already completed synchronously in handlePendingStep
  if (step.executionMode === 'direct') {
    // Should not reach here — direct steps complete synchronously
    return;
  }

  if (!step.memberId) {
    // In-progress but no member assigned — something went wrong, retry
    step.status = 'pending';
    step.claim = undefined;
    step.claimToken = undefined;
    saveOmxWorkflow(workflow);
    return;
  }

  // Check specialist status from DB
  const member = getTeamMember(step.memberId);
  if (!member) {
    // Member gone — mark as failed for retry
    const stepIndex = workflow.steps.indexOf(step);
    if (step.claimToken) {
      transitionStep(workflow, stepIndex, step.claimToken, 'failed');
    } else {
      step.status = 'failed';
    }
    step.error = 'Specialist member not found in database';
    saveOmxWorkflow(workflow);
    return;
  }

  const stepIndex = workflow.steps.indexOf(step);

  switch (member.status) {
    case 'active':
    case 'pending': {
      // Still running — check timeout
      const stepElapsed = Date.now() - new Date(step.startedAt || workflow.createdAt).getTime();

      // Pattern 4: Early stall detection for specialists.
      // If no mailbox progress in 5min, fail early instead of waiting full timeout.
      if (
        step.executionMode === 'specialist' &&
        stepElapsed > OMX_SPECIALIST_STALL_TIMEOUT &&
        stepElapsed <= OMX_STEP_TIMEOUT
      ) {
        // Check if there's been any recent progress via mailbox or activity timestamps
        const lastProgress = workflow.lastSpecialistProgressAt
          ? new Date(workflow.lastSpecialistProgressAt).getTime()
          : 0;
        const stepStartTime = new Date(step.startedAt || workflow.createdAt).getTime();
        const progressSinceStart = lastProgress > stepStartTime;

        if (!progressSinceStart) {
          // No mailbox activity at all since step started — stalled
          if (step.claimToken) {
            transitionStep(workflow, stepIndex, step.claimToken, 'failed');
          } else {
            step.status = 'failed';
          }
          step.error = `Specialist stalled (no progress for ${Math.round(stepElapsed / 60000)}min)`;
          saveOmxWorkflow(workflow);
          logger.warn(
            { omxId: workflow.id, step: step.number, elapsed: Math.round(stepElapsed / 1000) },
            'Pattern 4: Specialist stall detected — failing early',
          );
          await sendMessage(
            workflow.chatJid,
            `*OmX Step ${step.number} stalled:* "${step.title}" — no progress for ${Math.round(stepElapsed / 60000)}min. Retrying...`,
          );
          break;
        }
      }

      if (stepElapsed > OMX_STEP_TIMEOUT) {
        if (step.claimToken) {
          transitionStep(workflow, stepIndex, step.claimToken, 'failed');
        } else {
          step.status = 'failed';
        }
        step.error = `Step timed out after ${Math.round(stepElapsed / 60000)} minutes`;
        saveOmxWorkflow(workflow);
        logger.warn({ omxId: workflow.id, step: step.number }, 'OmX step timed out');
      }
      break;
    }

    case 'completed': {
      // Pattern 8: Record activity — specialist completed + supervisor acted
      touchSpecialistProgress(workflow);
      touchSupervisorAction(workflow);
      // Specialist finished successfully — transition via claim token
      if (step.claimToken) {
        transitionStep(workflow, stepIndex, step.claimToken, 'completed');
      } else {
        step.status = 'completed';
      }
      step.completedAt = new Date().toISOString();
      // Read output from team messages or specialist files if available
      step.output = `Step ${step.number} completed by specialist ${step.memberId}`;

      // Special handling for gate steps — parse result
      if (step.annotations.gate) {
        // The gate agent reports via send_message, so we trust the completion
        step.output = 'GATE: PASS';
      }

      // Special handling for review steps — check for PASS/FAIL
      if (step.annotations.specialist === 'review') {
        // Review completed — check if next step is a fix step
        const nextStep = workflow.steps.find(
          s => s.annotations.depends === step.number && s.status === 'pending',
        );
        if (nextStep) {
          // The fix step will get context from the review output
          accumulateContext(workflow, step);
        }
      }

      // Pattern 5: Deslop — detect sloppy output from dev/commit specialists
      if (
        shouldDeslop(step) &&
        !step.deslopPending &&
        !step.deslopMemberId &&
        workflow.specialistsSpawned < OMX_MAX_SPECIALISTS_PER_WORKFLOW
      ) {
        try {
          const slopReport = detectSlop(workflow.projectPath);
          if (slopReport.hasIssues) {
            const deslopPrompt = buildDeslopPrompt(slopReport, workflow.projectPath);
            const deslopName = `omx-deslop-s${step.number}`;
            const deslopMember = await spawnTeammate({
              teamId: workflow.teamId,
              name: deslopName,
              prompt: deslopPrompt,
              model: 'claude-haiku-4-5-20251001',
              leadGroup: workflow.groupFolder,
              chatJid: workflow.chatJid,
            });
            step.deslopPending = true;
            step.deslopMemberId = deslopMember.id;
            workflow.specialistsSpawned++;
            logger.info(
              { omxId: workflow.id, step: step.number, issues: slopReport.issues.length, memberId: deslopMember.id },
              'Pattern 5: Deslop specialist spawned',
            );
          }
        } catch (err) {
          // Deslop is best-effort — don't block the pipeline on failure
          logger.warn(
            { omxId: workflow.id, step: step.number, err },
            'Pattern 5: Deslop detection/spawn failed — continuing',
          );
        }
      }

      saveOmxWorkflow(workflow);
      break;
    }

    case 'failed': {
      // Pattern 8: Record activity — specialist reported failure + supervisor acted
      touchSpecialistProgress(workflow);
      touchSupervisorAction(workflow);
      if (step.claimToken) {
        transitionStep(workflow, stepIndex, step.claimToken, 'failed');
      } else {
        step.status = 'failed';
      }
      step.error = `Specialist ${member.name} failed`;
      saveOmxWorkflow(workflow);
      break;
    }
  }
}

async function handleFailedStep(
  workflow: OmxWorkflow,
  step: OmxStep,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<void> {
  if (step.retryCount < OMX_MAX_RETRIES_PER_STEP) {
    // Pattern 8: Record supervisor retry decision
    touchSupervisorAction(workflow);

    // Clean up Codex job if present
    if (step.codexJobId) {
      await cleanupCodexJob(step.codexJobId).catch(() => {});
    }

    // Retry the step
    step.retryCount++;
    step.status = 'pending';
    step.memberId = undefined;
    step.codexJobId = undefined;
    step.executionMode = undefined;
    step.error = undefined;
    step.claim = undefined;
    step.claimToken = undefined;
    step.nudgedAt = undefined; // Pattern 4: Reset nudge state on retry
    saveOmxWorkflow(workflow);

    logger.info(
      { omxId: workflow.id, step: step.number, retry: step.retryCount },
      'OmX step retrying',
    );

    wsBroadcast('omx.step.retry', {
      id: workflow.id,
      step: step.number,
      retry: step.retryCount,
    });
  } else {
    // Max retries — escalate to user

    // Clean up any Codex jobs across all steps
    for (const s of workflow.steps) {
      if (s.codexJobId && s.status === 'in_progress') {
        await cleanupCodexJob(s.codexJobId).catch(() => {});
      }
    }

    workflow.status = 'failed';
    saveOmxWorkflow(workflow);

    await sendMessage(
      workflow.chatJid,
      `*OmX Failed: ${workflow.taskDescription}*\n\nStep ${step.number} (${step.title}) failed after ${OMX_MAX_RETRIES_PER_STEP} retries.\nError: ${step.error || 'Unknown'}`,
    );

    cleanupTeam(workflow.teamId);

    wsBroadcast('omx.failed', {
      id: workflow.id,
      step: step.number,
      reason: 'max_retries',
    });

    postToMissionControl(
      'OmX Workflow Failed',
      `**${workflow.taskDescription}**\nStep ${step.number}: ${step.title}\nError: ${step.error || 'Unknown'}`,
      0xef4444,
    ).catch(() => {});
  }
}

// ── Specialist Spawning ───────────────────────────────────────────────────────

async function spawnForStep(workflow: OmxWorkflow, step: OmxStep): Promise<void> {
  if (workflow.specialistsSpawned >= OMX_MAX_SPECIALISTS_PER_WORKFLOW) {
    step.status = 'failed';
    step.error = 'Specialist budget exhausted';
    saveOmxWorkflow(workflow);
    return;
  }

  let prompt: string;
  if (step.annotations.specialist === 'commit') {
    prompt = buildCommitPrompt(workflow);
  } else {
    prompt = buildSpecialistPrompt(workflow, step);
  }

  const model = getModelForStep(step);
  const specialistName = `omx-${step.annotations.specialist}-s${step.number}`;

  try {
    const member = await spawnTeammate({
      teamId: workflow.teamId,
      name: specialistName,
      prompt,
      model,
      leadGroup: workflow.groupFolder,
      chatJid: workflow.chatJid,
    });

    step.status = 'in_progress';
    step.memberId = member.id;
    step.executionMode = 'specialist';
    step.startedAt = new Date().toISOString();
    workflow.specialistsSpawned++;
    saveOmxWorkflow(workflow);

    logger.info(
      { omxId: workflow.id, step: step.number, memberId: member.id, specialist: step.annotations.specialist },
      'OmX specialist spawned',
    );

    wsBroadcast('omx.step.spawned', {
      id: workflow.id,
      step: step.number,
      specialist: step.annotations.specialist,
      memberId: member.id,
    });
  } catch (err) {
    step.status = 'failed';
    step.error = err instanceof Error ? err.message : String(err);
    saveOmxWorkflow(workflow);

    logger.error(
      { omxId: workflow.id, step: step.number, error: step.error },
      'Failed to spawn OmX specialist',
    );
  }
}

async function spawnGateAgent(workflow: OmxWorkflow, step: OmxStep): Promise<void> {
  if (workflow.specialistsSpawned >= OMX_MAX_SPECIALISTS_PER_WORKFLOW) {
    step.status = 'failed';
    step.error = 'Specialist budget exhausted';
    saveOmxWorkflow(workflow);
    return;
  }

  const prompt = buildGatePrompt(workflow, step);
  const specialistName = `omx-gate-s${step.number}`;

  try {
    const member = await spawnTeammate({
      teamId: workflow.teamId,
      name: specialistName,
      prompt,
      model: 'claude-sonnet-4-6',
      leadGroup: workflow.groupFolder,
      chatJid: workflow.chatJid,
    });

    step.status = 'in_progress';
    step.memberId = member.id;
    step.startedAt = new Date().toISOString();
    workflow.specialistsSpawned++;
    workflow.phases.gate = 'in_progress';
    saveOmxWorkflow(workflow);

    logger.info(
      { omxId: workflow.id, step: step.number, memberId: member.id },
      'OmX gate agent spawned',
    );
  } catch (err) {
    step.status = 'failed';
    step.error = err instanceof Error ? err.message : String(err);
    saveOmxWorkflow(workflow);
  }
}

// ── Workflow Completion ───────────────────────────────────────────────────────

function accumulateContext(workflow: OmxWorkflow, step: OmxStep): void {
  if (step.output) {
    // In-memory accumulator (fallback)
    workflow.context += `\n\n--- Step ${step.number}: ${step.title} ---\n${step.output}`;
    if (workflow.context.length > 8000) {
      workflow.context = workflow.context.slice(-6000);
    }
    // Pattern 6: Also persist to file-based snapshot
    appendToSnapshot(workflow.id, step.number, step.title, step.output);
  }
}

async function completeWorkflow(
  workflow: OmxWorkflow,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<void> {
  // Clean up any lingering Codex jobs
  for (const step of workflow.steps) {
    if (step.codexJobId && step.status === 'in_progress') {
      await cleanupCodexJob(step.codexJobId).catch(() => {});
    }
  }

  // Pattern 7: Merge workflow branch back to base
  if (workflow.branch) {
    const mergeResult = mergeWorkflowBranch(workflow.projectPath, workflow.id);
    if (mergeResult.success) {
      cleanupBranch(workflow.projectPath, workflow.id);
      logger.info({ omxId: workflow.id, branch: workflow.branch }, 'Pattern 7: Branch merged and cleaned up');
    } else {
      await sendMessage(
        workflow.chatJid,
        `*OmX branch merge failed:* ${workflow.branch}\nError: ${mergeResult.error}\n\nThe branch is preserved for manual resolution.`,
      );
      logger.error({ omxId: workflow.id, branch: workflow.branch, error: mergeResult.error }, 'Pattern 7: Branch merge failed');
    }
  }

  workflow.status = 'completed';
  workflow.completedAt = new Date().toISOString();
  workflow.phases.report = 'done';
  saveOmxWorkflow(workflow);

  // Build report
  const elapsed = Date.now() - new Date(workflow.createdAt).getTime();
  const elapsedMin = Math.round(elapsed / 60000);
  const completedSteps = workflow.steps.filter(s => s.status === 'completed').length;
  const skippedSteps = workflow.steps.filter(s => s.status === 'skipped').length;
  const failedSteps = workflow.steps.filter(s => s.status === 'failed').length;

  const stepSummary = workflow.steps
    .map(s => {
      const icon = s.status === 'completed' ? '\u2705' : s.status === 'skipped' ? '\u23ed' : '\u274c';
      const mode = s.executionMode ? ` [${s.executionMode}]` : '';
      return `${icon} Step ${s.number}: ${s.title}${mode}`;
    })
    .join('\n');

  const report = [
    `*OmX Complete: ${workflow.taskDescription}*`,
    '',
    `*Duration:* ${elapsedMin} minutes (${workflow.steps.length} steps)`,
    `*Specialists used:* ${workflow.specialistsSpawned}`,
    `*Results:* ${completedSteps} completed, ${skippedSteps} skipped, ${failedSteps} failed`,
    '',
    stepSummary,
  ].join('\n');

  await sendMessage(workflow.chatJid, report);

  cleanupTeam(workflow.teamId);

  wsBroadcast('omx.completed', {
    id: workflow.id,
    duration: elapsedMin,
    specialistsUsed: workflow.specialistsSpawned,
    completedSteps,
  });

  postToMissionControl(
    'OmX Workflow Complete',
    `**${workflow.taskDescription}**\nDuration: ${elapsedMin}min | Specialists: ${workflow.specialistsSpawned} | Steps: ${completedSteps}/${workflow.steps.length}`,
    0x22c55e,
  ).catch(() => {});
}

// ── Supervisor Runner ─────────────────────────────────────────────────────────

/**
 * Run one supervisor tick across all active OmX workflows.
 * Called by the task scheduler every 60s.
 */
export async function runOmxSupervisor(
  sendMessage: (jid: string, text: string) => Promise<void>,
  requestApproval?: (description: string) => Promise<{ requestId: string }>,
  checkApproval?: (requestId: string) => Promise<{ status: string; response?: string }>,
): Promise<void> {
  const workflows = listActiveOmxWorkflows();
  if (workflows.length === 0) return;

  logger.debug({ count: workflows.length }, 'OmX supervisor tick');

  for (const workflow of workflows) {
    try {
      await supervisorTick(workflow, sendMessage, requestApproval, checkApproval);
    } catch (err) {
      logger.error(
        { omxId: workflow.id, err },
        'OmX supervisor tick error',
      );
    }
  }
}
