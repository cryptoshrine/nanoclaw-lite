/**
 * OmX RALPLAN-DR: Multi-Agent Deliberative Planning
 *
 * Three-agent dialectic planning system for complex OmX workflows:
 *   1. Planner (thesis)     — produces structured plan with steps, deps, specialist assignments
 *   2. Architect (antithesis) — reviews for over-engineering, security gaps, missing edges
 *   3. Critic (consistency)  — checks consistency, completeness, feasibility → APPROVE or REVISE
 *
 * Up to 5 review iterations. On APPROVE, outputs:
 *   - OmX workflow markdown (ready for createOmxWorkflow)
 *   - ADR (Architecture Decision Record)
 *   - Staffing plan with model recommendations
 *   - Full deliberation transcript (NDJSON)
 *
 * Auto-triggers for: auth, security, migration, DB schema, API breaking changes,
 * infrastructure tasks, or workflows with 8+ steps.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { OMX_WORKFLOWS_DIR, OMX_MAX_SPECIALISTS_PER_WORKFLOW } from './config.js';
import { logger } from './logger.js';
import { spawnTeammate } from './team-manager.js';
import { listAgents, type OmxAgentDefinition } from './omx-agents.js';
import { emitEvent } from './omx-events.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RalplanConfig {
  taskDescription: string;
  projectPath: string;
  groupFolder: string;
  chatJid: string;
  teamId: string;
  maxIterations?: number;
  forceDeliberate?: boolean;
  skipPlanning?: boolean;
}

export interface StaffingPlan {
  agents: Array<{ role: string; modelClass: string; count: number }>;
  estimatedSpecialists: number;
  estimatedDuration: string;
  riskFactors: string[];
}

export interface DeliberationEntry {
  role: 'planner' | 'architect' | 'critic';
  iteration: number;
  content: string;
  verdict?: 'APPROVE' | 'REVISE';
  concerns?: string[];
  timestamp: string;
}

export interface RalplanResult {
  workflowMarkdown: string;
  adr: string;
  staffingPlan: StaffingPlan;
  iterations: number;
  approved: boolean;
  transcript: DeliberationEntry[];
}

/** Message-sending callback for progress reporting */
type SendMessageFn = (text: string) => void | Promise<void>;

// ── Constants ──────────────────────────────────────────────────────────────────

/** Default max deliberation iterations before auto-approving */
const DEFAULT_MAX_ITERATIONS = 5;

/** Timeout for each deliberation agent (3 minutes) */
const DELIBERATION_AGENT_TIMEOUT = 180_000;

/** Keywords that auto-trigger deliberation */
const DELIBERATION_KEYWORDS = [
  'auth',
  'authentication',
  'authorization',
  'security',
  'migration',
  'database schema',
  'db schema',
  'schema change',
  'api breaking',
  'breaking change',
  'infrastructure',
  'infra',
  'deploy',
  'deployment',
  'permissions',
  'rbac',
  'oauth',
  'encryption',
  'secrets',
  'certificate',
  'tls',
  'ssl',
];

/** Patterns the user can use to skip planning */
const SKIP_PATTERNS = [
  /just do it/i,
  /skip planning/i,
  /skip plan/i,
  /no planning/i,
  /no deliberation/i,
  /just build/i,
  /just implement/i,
];

/** Patterns that explicitly request planning */
const FORCE_PATTERNS = [
  /plan this/i,
  /deliberate/i,
  /ralplan/i,
  /think about this/i,
  /design first/i,
  /architect this/i,
];

/** Step count threshold for auto-triggering deliberation */
const STEP_COUNT_THRESHOLD = 8;

// ── Helpers ────────────────────────────────────────────────────────────────────

function deliberationDir(ralplanId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, ralplanId);
}

function transcriptPath(ralplanId: string): string {
  return path.join(deliberationDir(ralplanId), 'deliberation.jsonl');
}

function adrPath(ralplanId: string): string {
  return path.join(deliberationDir(ralplanId), 'adr.md');
}

/**
 * Append a deliberation entry to the NDJSON transcript.
 */
function appendTranscript(ralplanId: string, entry: DeliberationEntry): void {
  const dir = deliberationDir(ralplanId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(transcriptPath(ralplanId), JSON.stringify(entry) + '\n');
}

/**
 * Read the full transcript from disk.
 */
function readTranscript(ralplanId: string): DeliberationEntry[] {
  const filePath = transcriptPath(ralplanId);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entries: DeliberationEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as DeliberationEntry);
      } catch {
        // Corrupted line — skip
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Get the available agent catalog summary for the planner prompt.
 */
function getAgentCatalogSummary(): string {
  const agents = listAgents();
  if (agents.length === 0) {
    // Fallback to hardcoded list if catalog isn't loaded
    return [
      '- dev (sonnet): General-purpose development specialist — coding, bug fixes, features',
      '- research (sonnet): Research and analysis — codebase exploration, data analysis',
      '- review (sonnet): Adversarial code review — finds bugs, security issues, design flaws',
      '- gate (sonnet): Test gate — runs pytest, mypy, ruff validation',
      '- commit (sonnet): Git operations — staging, committing, branch management',
    ].join('\n');
  }

  return agents
    .map((a: OmxAgentDefinition) =>
      `- ${a.name} (${a.modelClass}): ${a.description}`,
    )
    .join('\n');
}

/**
 * Extract the workflow markdown from an agent's output.
 * Looks for content between ```markdown fences or the raw output.
 */
function extractWorkflowMarkdown(output: string): string {
  // Try to find fenced markdown block
  const fenceMatch = output.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find content starting with "# OmX:" header
  const headerMatch = output.match(/(# OmX:[\s\S]*)/);
  if (headerMatch) return headerMatch[1].trim();

  // Return raw output trimmed
  return output.trim();
}

/**
 * Extract concerns from architect/critic output.
 * Looks for bullet-pointed concerns or numbered issues.
 */
function extractConcerns(output: string): string[] {
  const concerns: string[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet points or numbered items that look like concerns
    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const concern = trimmed.replace(/^[-*•\d.]+\s+/, '');
      if (
        concern.length > 10 &&
        /(?:should|could|missing|risk|concern|issue|problem|consider|warning|danger|over-engineer|security)/i.test(concern)
      ) {
        concerns.push(concern);
      }
    }
  }

  return concerns;
}

/**
 * Extract verdict (APPROVE or REVISE) from critic output.
 */
function extractVerdict(output: string): 'APPROVE' | 'REVISE' {
  const upper = output.toUpperCase();
  if (upper.includes('APPROVE') && !upper.includes('REVISE')) return 'APPROVE';
  if (upper.includes('REVISE')) return 'REVISE';
  // Default to APPROVE if no clear signal (avoid infinite loops)
  return 'APPROVE';
}

/**
 * Count steps in workflow markdown.
 */
function countSteps(markdown: string): number {
  const stepRegex = /^##\s+Step\s+\d+/gm;
  let count = 0;
  while (stepRegex.exec(markdown)) count++;
  return count;
}

/**
 * Extract the staffing plan from a workflow markdown.
 */
function deriveStaffingPlan(workflowMarkdown: string): StaffingPlan {
  const stepRegex = /^##\s+Step\s+\d+[:\s\u2014\u2013-]+.+$/gm;
  const agents = new Map<string, { modelClass: string; count: number }>();
  const riskFactors: string[] = [];

  let match;
  while ((match = stepRegex.exec(workflowMarkdown)) !== null) {
    const header = match[0];

    // Parse specialist type
    const specialistMatch = header.match(/specialist:(\w+)/);
    const specialist = specialistMatch ? specialistMatch[1] : 'dev';

    // Parse model
    const modelMatch = header.match(/model:(\w+)/);
    const model = modelMatch ? modelMatch[1] : 'sonnet';

    const key = `${specialist}:${model}`;
    const existing = agents.get(key);
    if (existing) {
      existing.count++;
    } else {
      agents.set(key, { modelClass: model, count: 1 });
    }
  }

  const agentList = Array.from(agents.entries()).map(([key, val]) => ({
    role: key.split(':')[0],
    modelClass: val.modelClass,
    count: val.count,
  }));

  const totalSpecialists = agentList.reduce((sum, a) => sum + a.count, 0);

  // Risk assessment
  if (totalSpecialists > OMX_MAX_SPECIALISTS_PER_WORKFLOW) {
    riskFactors.push(`Exceeds specialist budget (${totalSpecialists}/${OMX_MAX_SPECIALISTS_PER_WORKFLOW})`);
  }

  const opusSteps = agentList.filter(a => a.modelClass === 'opus');
  if (opusSteps.length > 0) {
    const opusCount = opusSteps.reduce((s, a) => s + a.count, 0);
    riskFactors.push(`Uses ${opusCount} opus specialist(s) — high cost`);
  }

  const gateSteps = agentList.filter(a => a.role === 'gate');
  if (gateSteps.length === 0 && totalSpecialists > 3) {
    riskFactors.push('No test gate step — risky for complex workflows');
  }

  // Estimate duration: ~5min per sonnet step, ~8min per opus step
  const estimatedMinutes = agentList.reduce((sum, a) => {
    const perStep = a.modelClass === 'opus' ? 8 : 5;
    return sum + a.count * perStep;
  }, 0);

  return {
    agents: agentList,
    estimatedSpecialists: totalSpecialists,
    estimatedDuration: `${estimatedMinutes}min`,
    riskFactors,
  };
}

/**
 * Generate an ADR (Architecture Decision Record) from deliberation.
 */
function generateAdr(
  ralplanId: string,
  config: RalplanConfig,
  result: RalplanResult,
): string {
  const now = new Date().toISOString();

  const concerns = result.transcript
    .filter(e => e.concerns && e.concerns.length > 0)
    .flatMap(e => e.concerns ?? []);

  const architectEntries = result.transcript.filter(e => e.role === 'architect');
  const criticEntries = result.transcript.filter(e => e.role === 'critic');

  const adr = [
    `# ADR: ${config.taskDescription}`,
    ``,
    `**ID:** ${ralplanId}`,
    `**Date:** ${now}`,
    `**Status:** ${result.approved ? 'Approved' : 'Not Approved'}`,
    `**Iterations:** ${result.iterations}`,
    ``,
    `## Context`,
    ``,
    config.taskDescription,
    ``,
    `**Project:** ${config.projectPath}`,
    ``,
    `## Decision`,
    ``,
    `The RALPLAN-DR deliberation process produced a ${countSteps(result.workflowMarkdown)}-step workflow`,
    `with ${result.staffingPlan.estimatedSpecialists} specialist(s) estimated at ${result.staffingPlan.estimatedDuration}.`,
    ``,
    `### Staffing`,
    ``,
    ...result.staffingPlan.agents.map(a =>
      `- **${a.role}** (${a.modelClass}): ${a.count} step(s)`,
    ),
    ``,
    ...(result.staffingPlan.riskFactors.length > 0
      ? [
          `### Risk Factors`,
          ``,
          ...result.staffingPlan.riskFactors.map(r => `- ${r}`),
          ``,
        ]
      : []),
    ...(concerns.length > 0
      ? [
          `## Concerns Raised`,
          ``,
          ...concerns.map(c => `- ${c}`),
          ``,
        ]
      : []),
    ...(architectEntries.length > 0
      ? [
          `## Architect Review Summary`,
          ``,
          architectEntries[architectEntries.length - 1].content.slice(0, 2000),
          ``,
        ]
      : []),
    ...(criticEntries.length > 0
      ? [
          `## Critic Review Summary`,
          ``,
          criticEntries[criticEntries.length - 1].content.slice(0, 2000),
          ``,
        ]
      : []),
    `## Consequences`,
    ``,
    `- Workflow will be executed by the OmX supervisor`,
    `- Changes will be made on a dedicated branch`,
    `- Human approval required before merge/push`,
    ``,
  ].join('\n');

  return adr;
}

// ── Auto-Trigger Detection ─────────────────────────────────────────────────────

/**
 * Determine if a task should go through RALPLAN-DR deliberation.
 *
 * Auto-triggers when:
 *   - Task mentions auth, security, migration, DB schema, API breaking changes, infra
 *   - Estimated step count > 8
 *   - User explicitly requests planning ("plan this", "deliberate", "ralplan")
 *
 * Skips when:
 *   - User says "just do it", "skip planning", etc.
 */
export function shouldDeliberate(taskDescription: string): boolean {
  const lower = taskDescription.toLowerCase();

  // Check skip patterns first
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(taskDescription)) return false;
  }

  // Check force patterns
  for (const pattern of FORCE_PATTERNS) {
    if (pattern.test(taskDescription)) return true;
  }

  // Check keyword triggers
  for (const keyword of DELIBERATION_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }

  // Check estimated complexity from task description heuristics
  // Count commas, "and", semicolons as rough step indicators
  const complexitySignals = (taskDescription.match(/,|;|\band\b|\bthen\b|\bafter\b|\bfinally\b/gi) || []).length;
  if (complexitySignals >= STEP_COUNT_THRESHOLD - 1) return true;

  return false;
}

// ── Prompt Builders (exported for testing) ──────────────────────────────────

/**
 * Build the Planner agent's prompt.
 * The planner reads the codebase and produces a structured OmX workflow.
 */
export function buildPlannerPrompt(
  config: RalplanConfig,
  previousFeedback?: string,
): string {
  const agentCatalog = getAgentCatalogSummary();

  let prompt = `You are the PLANNER agent in the RALPLAN-DR deliberative planning process.

Your job is to produce a structured OmX workflow plan for the following task.

TASK: ${config.taskDescription}
PROJECT PATH: ${config.projectPath}

AVAILABLE SPECIALIST TYPES:
${agentCatalog}

OmX WORKFLOW FORMAT:
Your output MUST be a markdown document with this exact structure:

\`\`\`markdown
# OmX: [Task Title]

## Step 1: [Title] [specialist:type, model:sonnet]
[Description of what this step does]
[What files to modify]
ACCEPTANCE: [What "done" looks like]

## Step 2: [Title] [specialist:type, model:sonnet, depends:1]
...

## Step N: Test Gate [specialist:gate, gate:full]
Run full validation.
ACCEPTANCE: All tests passing, types clean.
\`\`\`

ANNOTATION FORMAT:
- \`[specialist:dev]\` — Which specialist to use
- \`[model:sonnet]\` or \`[model:opus]\` — Model class (default: sonnet, use opus only for complex architecture)
- \`[depends:N]\` — This step waits for step N to complete
- \`[gate:full]\` — Run pytest + mypy + ruff
- \`[gate:quick]\` — Run pytest only

PLANNING RULES:
1. Read the project codebase at ${config.projectPath} to understand existing architecture
2. Each step must specify: files to modify, acceptance criteria, specialist type
3. Include a test gate step (gate:full) before any commit step
4. Include a review step (specialist:review) for security-sensitive changes
5. Keep total specialists under ${OMX_MAX_SPECIALISTS_PER_WORKFLOW} (budget cap)
6. Prefer sonnet over opus unless the task genuinely requires deep reasoning
7. Mark dependencies correctly — don't create unnecessary sequential chains
8. Be specific about file paths and function names
9. Do NOT over-engineer — minimum steps needed for the task
10. Include a commit step at the end

OUTPUT:
Your response MUST contain a fenced markdown block with the complete OmX workflow.
Nothing else. No preamble, no explanation outside the fence.`;

  if (previousFeedback) {
    prompt += `\n\nPREVIOUS FEEDBACK FROM ARCHITECT AND CRITIC:
The previous version of your plan was REJECTED. Incorporate the following feedback:

${previousFeedback}

Address every concern raised. Do not ignore any feedback points.`;
  }

  return prompt;
}

/**
 * Build the Architect agent's prompt.
 * The architect reviews the plan for technical issues.
 */
export function buildArchitectPrompt(
  config: RalplanConfig,
  plannerOutput: string,
): string {
  return `You are the ARCHITECT agent in the RALPLAN-DR deliberative planning process.

Your job is to REVIEW the planner's workflow for technical issues. You are the antithesis — your role is to challenge the plan.

TASK: ${config.taskDescription}
PROJECT PATH: ${config.projectPath}

PLANNER'S PROPOSED WORKFLOW:
${plannerOutput}

REVIEW CHECKLIST:
1. **Over-engineering**: Can any steps be combined? Are there unnecessary abstractions?
2. **Security**: Are there security implications not addressed? Missing validation, auth checks, input sanitization?
3. **Dependencies**: Are step dependencies correct? Could steps run in parallel instead of sequential?
4. **Model assignment**: Is opus used where sonnet would suffice? (opus is expensive)
5. **Missing steps**: Are there edge cases, error handling, or rollback scenarios not covered?
6. **Test coverage**: Is the test gate appropriate? Should there be a quick gate mid-workflow?
7. **Scope creep**: Does the plan stay within the original task scope or introduce unnecessary work?
8. **Budget**: Will this exceed the ${OMX_MAX_SPECIALISTS_PER_WORKFLOW}-specialist budget cap?
9. **File specificity**: Are file paths and function names concrete or vague?
10. **Acceptance criteria**: Are they measurable and verifiable?

OUTPUT FORMAT:
Provide your review as a structured list of concerns. For each concern:
- State the issue clearly
- Explain why it matters
- Suggest a specific fix

End with a SUMMARY section:
- APPROVE if the plan is solid (minor nits only)
- REVISE if there are material issues that must be addressed

Be direct and specific. This is adversarial review — your job is to find problems.`;
}

/**
 * Build the Critic agent's prompt.
 * The critic checks consistency between plan and architect feedback.
 */
export function buildCriticPrompt(
  config: RalplanConfig,
  plannerOutput: string,
  architectOutput: string,
  iteration: number,
): string {
  return `You are the CRITIC agent in the RALPLAN-DR deliberative planning process.

Your job is to make the FINAL VERDICT on whether the plan is ready for execution.
You check for internal consistency, completeness, and feasibility.

TASK: ${config.taskDescription}
PROJECT PATH: ${config.projectPath}
ITERATION: ${iteration} of ${config.maxIterations || DEFAULT_MAX_ITERATIONS}

PLANNER'S WORKFLOW:
${plannerOutput}

ARCHITECT'S REVIEW:
${architectOutput}

EVALUATION CRITERIA:

1. **Internal consistency**: Do step outputs feed correctly into dependent steps?
   - If Step 3 depends on Step 2, does Step 2 produce what Step 3 needs?

2. **Completeness**: Are all aspects of the task covered?
   - No missing steps for the stated requirements

3. **Feasibility**: Can this be done within OmX constraints?
   - Budget: ${OMX_MAX_SPECIALISTS_PER_WORKFLOW} specialists max
   - Duration: 60 minutes max
   - Each specialist runs independently with file-based context

4. **Architect feedback addressed**: If the architect raised concerns, are they valid?
   - Valid concerns MUST be addressed before approval
   - Invalid concerns should be explicitly dismissed with reasoning

5. **Acceptance criteria**: Is every step's "done" state verifiable by the supervisor?

VERDICT (MANDATORY — include one of these exact strings):

**APPROVE** — Plan is ready for execution. Minor issues only.
**REVISE** — Material issues found. List specific changes needed for the planner.

If REVISE: provide a numbered list of changes the planner must make.
If APPROVE: confirm the plan is consistent, complete, and feasible.

Be decisive. Do not hedge. One word: APPROVE or REVISE.`;
}

// ── Agent Execution ─────────────────────────────────────────────────────────

/**
 * Run a deliberation agent (planner, architect, or critic) via spawnTeammate.
 *
 * Waits for the specialist to complete and reads output from IPC.
 * Returns the agent's textual output.
 */
async function runDeliberationAgent(
  role: 'planner' | 'architect' | 'critic',
  prompt: string,
  teamId: string,
  groupFolder: string,
  chatJid: string,
  ralplanId: string,
): Promise<string> {
  const outputFile = path.join(deliberationDir(ralplanId), `${role}-output.md`);

  // Wrap the prompt to instruct the agent to save output to a file
  const wrappedPrompt = `${prompt}

IMPORTANT: Save your COMPLETE output to this file: ${outputFile}
Use the Write tool or echo/cat to write the file. This is how the supervisor reads your results.
Also use send_message to report a brief summary of your findings.`;

  const member = await spawnTeammate({
    teamId,
    name: `ralplan-${role}`,
    prompt: wrappedPrompt,
    model: role === 'critic' ? 'claude-sonnet-4-6' : 'claude-sonnet-4-6',
    leadGroup: groupFolder,
    chatJid,
  });

  logger.info(
    { ralplanId, role, memberId: member.id },
    'RALPLAN: deliberation agent spawned',
  );

  // Poll for the output file to appear (agent writes it when done)
  const startTime = Date.now();
  while (Date.now() - startTime < DELIBERATION_AGENT_TIMEOUT) {
    await sleep(5000);

    // Check if output file exists
    try {
      const output = fs.readFileSync(outputFile, 'utf-8');
      if (output.trim().length > 0) {
        logger.info(
          { ralplanId, role, outputLength: output.length },
          'RALPLAN: deliberation agent produced output',
        );
        return output;
      }
    } catch {
      // File doesn't exist yet — keep waiting
    }
  }

  // Timeout — return empty output (will cause critic to request revision)
  logger.warn({ ralplanId, role }, 'RALPLAN: deliberation agent timed out');
  return `[TIMEOUT: ${role} agent did not produce output within ${DELIBERATION_AGENT_TIMEOUT / 1000}s]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main Entry Point ───────────────────────────────────────────────────────────

/**
 * Run the RALPLAN-DR deliberative planning process.
 *
 * Spawns three agents in sequence (planner → architect → critic) with
 * up to maxIterations review loops. Returns the approved plan or the
 * best plan after exhausting iterations.
 */
export async function runRalplan(
  config: RalplanConfig,
  sendMessage: SendMessageFn,
): Promise<RalplanResult> {
  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;
  const ralplanId = `ralplan-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // Ensure output directory
  fs.mkdirSync(deliberationDir(ralplanId), { recursive: true });

  logger.info(
    { ralplanId, task: config.taskDescription, maxIterations },
    'RALPLAN: starting deliberation',
  );

  await sendMessage(
    `RALPLAN deliberation started for: ${config.taskDescription}\n` +
    `Max iterations: ${maxIterations}\n` +
    `ID: ${ralplanId}`,
  );

  // Emit workflow event
  emitEvent(ralplanId, 'workflow.created', {
    type: 'ralplan',
    task: config.taskDescription,
    maxIterations,
  });

  let latestPlannerOutput = '';
  let latestArchitectOutput = '';
  let approved = false;
  let currentIteration = 0;
  const transcript: DeliberationEntry[] = [];

  for (let i = 1; i <= maxIterations; i++) {
    currentIteration = i;

    // ── Phase 1: Planner ──────────────────────────────────────────────
    const previousFeedback = i > 1
      ? `ARCHITECT (iteration ${i - 1}):\n${latestArchitectOutput}\n\nCRITIC verdict: REVISE`
      : undefined;

    const plannerPrompt = buildPlannerPrompt(config, previousFeedback);

    await sendMessage(`RALPLAN iteration ${i}/${maxIterations} — Planner agent working...`);

    const plannerOutput = await runDeliberationAgent(
      'planner',
      plannerPrompt,
      config.teamId,
      config.groupFolder,
      config.chatJid,
      ralplanId,
    );

    latestPlannerOutput = plannerOutput;

    const plannerEntry: DeliberationEntry = {
      role: 'planner',
      iteration: i,
      content: plannerOutput.slice(0, 8000),
      timestamp: new Date().toISOString(),
    };
    transcript.push(plannerEntry);
    appendTranscript(ralplanId, plannerEntry);

    logger.info({ ralplanId, iteration: i }, 'RALPLAN: planner complete');

    // ── Phase 2: Architect ────────────────────────────────────────────
    const architectPrompt = buildArchitectPrompt(config, plannerOutput);

    await sendMessage(`RALPLAN iteration ${i}/${maxIterations} — Architect reviewing...`);

    const architectOutput = await runDeliberationAgent(
      'architect',
      architectPrompt,
      config.teamId,
      config.groupFolder,
      config.chatJid,
      ralplanId,
    );

    latestArchitectOutput = architectOutput;

    const architectEntry: DeliberationEntry = {
      role: 'architect',
      iteration: i,
      content: architectOutput.slice(0, 8000),
      concerns: extractConcerns(architectOutput),
      timestamp: new Date().toISOString(),
    };
    transcript.push(architectEntry);
    appendTranscript(ralplanId, architectEntry);

    logger.info(
      { ralplanId, iteration: i, concerns: architectEntry.concerns?.length || 0 },
      'RALPLAN: architect complete',
    );

    // ── Phase 3: Critic ───────────────────────────────────────────────
    const criticPrompt = buildCriticPrompt(config, plannerOutput, architectOutput, i);

    await sendMessage(`RALPLAN iteration ${i}/${maxIterations} — Critic evaluating...`);

    const criticOutput = await runDeliberationAgent(
      'critic',
      criticPrompt,
      config.teamId,
      config.groupFolder,
      config.chatJid,
      ralplanId,
    );

    const verdict = extractVerdict(criticOutput);

    const criticEntry: DeliberationEntry = {
      role: 'critic',
      iteration: i,
      content: criticOutput.slice(0, 8000),
      verdict,
      concerns: extractConcerns(criticOutput),
      timestamp: new Date().toISOString(),
    };
    transcript.push(criticEntry);
    appendTranscript(ralplanId, criticEntry);

    logger.info(
      { ralplanId, iteration: i, verdict, concerns: criticEntry.concerns?.length || 0 },
      'RALPLAN: critic complete',
    );

    if (verdict === 'APPROVE') {
      approved = true;
      await sendMessage(
        `RALPLAN: Plan APPROVED on iteration ${i}/${maxIterations}`,
      );
      break;
    }

    // REVISE — loop continues
    await sendMessage(
      `RALPLAN: Plan needs REVISION (iteration ${i}/${maxIterations})\n` +
      `Concerns: ${criticEntry.concerns?.length || 0}`,
    );
  }

  // ── Finalize ──────────────────────────────────────────────────────────

  if (!approved) {
    await sendMessage(
      `RALPLAN: Max iterations (${maxIterations}) reached. Using latest plan version.`,
    );
  }

  // Extract the clean workflow markdown
  const workflowMarkdown = extractWorkflowMarkdown(latestPlannerOutput);

  // Derive staffing plan from the workflow
  const staffingPlan = deriveStaffingPlan(workflowMarkdown);

  const result: RalplanResult = {
    workflowMarkdown,
    adr: '',
    staffingPlan,
    iterations: currentIteration,
    approved,
    transcript,
  };

  // Generate ADR
  const adrContent = generateAdr(ralplanId, config, result);
  result.adr = adrContent;

  // Write artifacts to disk
  fs.writeFileSync(adrPath(ralplanId), adrContent, 'utf-8');
  fs.writeFileSync(
    path.join(deliberationDir(ralplanId), 'workflow.md'),
    workflowMarkdown,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(deliberationDir(ralplanId), 'staffing.json'),
    JSON.stringify(staffingPlan, null, 2),
    'utf-8',
  );

  // Emit completion event
  emitEvent(ralplanId, 'workflow.completed', {
    type: 'ralplan',
    iterations: currentIteration,
    approved,
    specialists: staffingPlan.estimatedSpecialists,
  });

  // Final report
  const summary = [
    `*RALPLAN Deliberation Complete*`,
    ``,
    `Task: ${config.taskDescription}`,
    `Verdict: ${approved ? 'APPROVED' : 'BEST EFFORT (max iterations)'}`,
    `Iterations: ${currentIteration}/${maxIterations}`,
    `Steps: ${countSteps(workflowMarkdown)}`,
    `Specialists: ${staffingPlan.estimatedSpecialists}`,
    `Est. Duration: ${staffingPlan.estimatedDuration}`,
    ...(staffingPlan.riskFactors.length > 0
      ? [`Risks: ${staffingPlan.riskFactors.join(', ')}`]
      : []),
    ``,
    `Artifacts saved to: ${deliberationDir(ralplanId)}`,
  ].join('\n');

  await sendMessage(summary);

  logger.info(
    {
      ralplanId,
      approved,
      iterations: currentIteration,
      steps: countSteps(workflowMarkdown),
      specialists: staffingPlan.estimatedSpecialists,
    },
    'RALPLAN: deliberation complete',
  );

  return result;
}
