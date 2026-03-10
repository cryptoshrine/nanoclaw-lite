/**
 * Workflow Engine — Persistent step-file execution for multi-session tasks.
 *
 * Agents execute workflows step by step. State is persisted to disk so
 * work can resume across sessions. The engine handles:
 *
 * - Parsing workflow markdown files into discrete steps
 * - Tracking current step, status, and outputs per step
 * - Auto-scheduling continuation when a session ends mid-workflow
 * - Writing progress updates for the ProgressStreamer
 *
 * State is stored at: data/workflows/{workflow-id}.json
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { createTask } from './db.js';
import { logger } from './logger.js';

const WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows');

export interface WorkflowStep {
  /** Step number (1-indexed) */
  number: number;
  /** Step title */
  title: string;
  /** Full step content (instructions, inputs, outputs, criteria) */
  content: string;
  /** Step status */
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  /** Output/result from this step */
  output?: string;
  /** When this step was started */
  startedAt?: string;
  /** When this step was completed */
  completedAt?: string;
}

export interface WorkflowState {
  /** Unique workflow ID */
  id: string;
  /** Path to the workflow definition file */
  workflowPath: string;
  /** Original task description */
  taskDescription: string;
  /** Group folder this workflow belongs to */
  groupFolder: string;
  /** Chat JID for sending updates */
  chatJid: string;
  /** Overall workflow status */
  status: 'active' | 'completed' | 'blocked' | 'cancelled';
  /** Parsed steps */
  steps: WorkflowStep[];
  /** Current step number (1-indexed) */
  currentStep: number;
  /** When the workflow was started */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Accumulated context from previous steps */
  context: string;
  /** Session ID for continuation */
  sessionId?: string;
}

/**
 * Parse a workflow markdown file into discrete steps.
 * Expects steps as ## Step N: Title headers.
 */
export function parseWorkflowSteps(content: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  // Match headers like "## Step 1: Research" or "## Step 1 — Research"
  const stepRegex = /^##\s+Step\s+(\d+)[:\s—–-]+(.+)$/gm;
  const matches: { index: number; number: number; title: string }[] = [];

  let match;
  while ((match = stepRegex.exec(content)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1], 10),
      title: match[2].trim(),
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const stepContent = content.slice(start, end).trim();

    steps.push({
      number: matches[i].number,
      title: matches[i].title,
      content: stepContent,
      status: 'pending',
    });
  }

  return steps;
}

/**
 * Create a new workflow from a definition file.
 */
export function createWorkflow(
  workflowPath: string,
  taskDescription: string,
  groupFolder: string,
  chatJid: string,
): WorkflowState {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

  // Read and parse the workflow file
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  const content = fs.readFileSync(workflowPath, 'utf-8');
  const steps = parseWorkflowSteps(content);

  if (steps.length === 0) {
    throw new Error(`No steps found in workflow file: ${workflowPath}`);
  }

  const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const state: WorkflowState = {
    id,
    workflowPath,
    taskDescription,
    groupFolder,
    chatJid,
    status: 'active',
    steps,
    currentStep: 1,
    createdAt: now,
    updatedAt: now,
    context: '',
  };

  saveWorkflow(state);
  logger.info({ workflowId: id, steps: steps.length, path: workflowPath }, 'Workflow created');

  return state;
}

/**
 * Load a workflow state from disk.
 */
export function loadWorkflow(workflowId: string): WorkflowState | null {
  const filePath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save workflow state to disk.
 */
export function saveWorkflow(state: WorkflowState): void {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  const filePath = path.join(WORKFLOWS_DIR, `${state.id}.json`);
  const tmpPath = `${filePath}.tmp`;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Advance a workflow to the next step.
 * Returns the next step's content, or null if all steps are done.
 */
export function advanceWorkflow(
  workflowId: string,
  stepOutput: string,
): { nextStep: WorkflowStep | null; state: WorkflowState } | null {
  const state = loadWorkflow(workflowId);
  if (!state) return null;

  // Complete current step
  const currentIdx = state.currentStep - 1;
  if (currentIdx >= 0 && currentIdx < state.steps.length) {
    state.steps[currentIdx].status = 'completed';
    state.steps[currentIdx].output = stepOutput;
    state.steps[currentIdx].completedAt = new Date().toISOString();

    // Accumulate context
    state.context += `\n\n--- Step ${state.currentStep}: ${state.steps[currentIdx].title} ---\n${stepOutput}`;
  }

  // Move to next step
  state.currentStep++;

  if (state.currentStep > state.steps.length) {
    // All steps done
    state.status = 'completed';
    saveWorkflow(state);
    return { nextStep: null, state };
  }

  // Start next step
  const nextIdx = state.currentStep - 1;
  state.steps[nextIdx].status = 'in_progress';
  state.steps[nextIdx].startedAt = new Date().toISOString();
  saveWorkflow(state);

  return { nextStep: state.steps[nextIdx], state };
}

/**
 * Get current step info for a workflow.
 */
export function getCurrentStep(workflowId: string): {
  step: WorkflowStep;
  state: WorkflowState;
} | null {
  const state = loadWorkflow(workflowId);
  if (!state || state.status !== 'active') return null;

  const idx = state.currentStep - 1;
  if (idx < 0 || idx >= state.steps.length) return null;

  return { step: state.steps[idx], state };
}

/**
 * List all active workflows.
 */
export function listActiveWorkflows(): WorkflowState[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];

  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
  const workflows: WorkflowState[] = [];

  for (const file of files) {
    try {
      const state: WorkflowState = JSON.parse(
        fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8'),
      );
      if (state.status === 'active') {
        workflows.push(state);
      }
    } catch {
      // Skip corrupt files
    }
  }

  return workflows;
}

/**
 * Build a continuation prompt for resuming a workflow at its current step.
 * Used by the task scheduler to auto-continue workflows.
 */
export function buildContinuationPrompt(workflowId: string): string | null {
  const current = getCurrentStep(workflowId);
  if (!current) return null;

  const { step, state } = current;
  const completedSteps = state.steps
    .filter(s => s.status === 'completed')
    .map(s => `Step ${s.number} (${s.title}): ${(s.output || '').slice(0, 200)}`)
    .join('\n');

  return `WORKFLOW CONTINUATION — ${state.taskDescription}

You are continuing a multi-step workflow. Workflow ID: ${state.id}

COMPLETED STEPS:
${completedSteps || 'None yet'}

ACCUMULATED CONTEXT:
${state.context.slice(-3000) || 'None'}

CURRENT STEP (${step.number}/${state.steps.length}):
${step.content}

INSTRUCTIONS:
1. Execute this step based on the instructions above
2. When done, call advance_workflow with the step output
3. If blocked, call block_workflow with the reason
4. Report progress via send_message`;
}

/**
 * Check for active workflows in a group and schedule continuation tasks.
 * Called after a specialist completes or a scheduled task finishes.
 * Schedules a one-shot task with a 10s delay so the scheduler picks it up.
 */
export function checkAndScheduleWorkflowContinuation(
  groupFolder: string,
  chatJid: string,
): number {
  const activeWorkflows = listActiveWorkflows().filter(
    (wf) => wf.groupFolder === groupFolder,
  );

  let scheduled = 0;
  for (const wf of activeWorkflows) {
    const prompt = buildContinuationPrompt(wf.id);
    if (!prompt) continue;

    const taskId = `wf-cont-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const runAt = new Date(now.getTime() + 10_000).toISOString();

    createTask({
      id: taskId,
      group_folder: groupFolder,
      chat_jid: chatJid || wf.chatJid,
      prompt,
      schedule_type: 'once',
      schedule_value: runAt,
      context_mode: 'isolated',
      next_run: runAt,
      status: 'active',
      created_at: now.toISOString(),
      retry_count: 0,
      max_retries: 2,
    });

    logger.info(
      { workflowId: wf.id, taskId, step: wf.currentStep, runAt },
      'Scheduled workflow continuation',
    );
    scheduled++;
  }

  return scheduled;
}
