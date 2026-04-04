/**
 * OmX Capability 8: Autoresearch — Evaluator-Driven Iterative Research/Coding
 *
 * Autoresearch runs a tight loop:
 *   Seed → Agent produces candidate → Evaluator scores → Keep best / Discard → Loop
 *
 * Each candidate gets its own git worktree (via omx-worktree.ts) so bad attempts
 * are just discarded branches. The evaluator is a shell command that produces a
 * score (exit 0 = pass, numeric output = fine-grained scoring).
 *
 * This is the "generate-test" paradigm: the agent writes code, the evaluator
 * verifies it. Iteration continues until the evaluator is satisfied or we
 * exhaust the budget.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';
import {
  createWorktree,
  removeWorktree,
  mergeWorktree,
  type GitWorktree,
} from './omx-worktree.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Configuration for an autoresearch run */
export interface AutoresearchConfig {
  /** Description of what to research/build */
  task: string;
  /** Shell command that evaluates the candidate's output.
   *  Exit 0 = pass. A numeric value on the last stdout line = score (0-100). */
  evaluatorScript: string;
  /** Root of the git project to work in */
  projectPath: string;
  /** Maximum number of iterate-evaluate cycles (default: 5) */
  maxIterations?: number;
  /** Minimum score improvement required to keep iterating (default: 5) */
  improvementThreshold?: number;
  /** OmX workflow ID (auto-generated if not provided) */
  workflowId?: string;
  /** Group folder for the OmX run */
  groupFolder: string;
  /** Chat JID for progress messages */
  chatJid: string;
  /** Base branch to start from (default: current HEAD) */
  baseBranch?: string;
  /** Shell command to run the agent (produces the candidate).
   *  If not provided, a default Claude CLI invocation is used. */
  agentCommand?: string;
  /** Model for the default agent command (default: claude-sonnet-4-6) */
  agentModel?: string;
  /** Timeout per evaluator run in ms (default: 300_000 = 5 min) */
  evaluatorTimeout?: number;
  /** Timeout per agent run in ms (default: 600_000 = 10 min) */
  agentTimeout?: number;
}

/** Represents a single candidate produced by one iteration */
export interface AutoresearchCandidate {
  /** Iteration number (1-indexed) */
  iteration: number;
  /** Path to the git worktree for this candidate */
  worktreePath: string;
  /** Branch name for this candidate */
  branch: string;
  /** Evaluator score (0-100) */
  score: number;
  /** Evaluator stdout */
  output: string;
  /** Raw agent stdout/stderr */
  agentOutput: string;
  /** Lifecycle status */
  status: 'pending' | 'evaluated' | 'accepted' | 'rejected';
  /** ISO timestamp */
  timestamp: string;
}

/** Result from evaluating a single candidate */
export interface EvalResult {
  /** Extracted score (0-100) */
  score: number;
  /** Whether the evaluator exited cleanly (exit 0) */
  passed: boolean;
  /** Evaluator stdout */
  output: string;
  /** Evaluator stderr (if any) */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

/** Final result of an autoresearch run */
export interface AutoresearchResult {
  /** The best-scoring candidate */
  bestCandidate: AutoresearchCandidate;
  /** All candidates in iteration order */
  allCandidates: AutoresearchCandidate[];
  /** Total iterations executed */
  iterations: number;
  /** Score history: score[i] = score of iteration i+1 */
  improvementHistory: number[];
  /** Branch containing the best candidate's work */
  finalBranch: string;
  /** Whether the best candidate was merged back */
  merged: boolean;
  /** Overall run duration in ms */
  durationMs: number;
}

/** Callback for sending progress messages */
export type SendMessageFn = (text: string) => void;

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_IMPROVEMENT_THRESHOLD = 5;
const DEFAULT_EVALUATOR_TIMEOUT = 300_000;  // 5 minutes
const DEFAULT_AGENT_TIMEOUT = 600_000;      // 10 minutes

/** Directory for autoresearch logs (JSONL) */
function autoresearchLogDir(workflowId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, workflowId);
}

/** Path to the JSONL log file for a run */
function autoresearchLogPath(workflowId: string): string {
  return path.join(autoresearchLogDir(workflowId), 'autoresearch.jsonl');
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Run an autoresearch loop.
 *
 * Creates a series of candidates, each in its own git worktree. The evaluator
 * script scores each candidate. Feedback from previous attempts is fed into
 * subsequent agent invocations.
 *
 * @param config - Autoresearch configuration
 * @param sendMessage - Callback to send progress updates to the user
 * @returns The result including the best candidate and merge status
 */
export async function runAutoresearch(
  config: AutoresearchConfig,
  sendMessage: SendMessageFn,
): Promise<AutoresearchResult> {
  const startTime = Date.now();
  const workflowId = config.workflowId || `ar-${crypto.randomBytes(4).toString('hex')}`;
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const improvementThreshold = config.improvementThreshold ?? DEFAULT_IMPROVEMENT_THRESHOLD;
  const evaluatorTimeout = config.evaluatorTimeout ?? DEFAULT_EVALUATOR_TIMEOUT;
  const agentTimeout = config.agentTimeout ?? DEFAULT_AGENT_TIMEOUT;
  const baseBranch = config.baseBranch || 'HEAD';

  // Ensure log directory exists
  fs.mkdirSync(autoresearchLogDir(workflowId), { recursive: true });

  logger.info(
    { workflowId, task: config.task, maxIterations, evaluator: config.evaluatorScript },
    'Autoresearch starting',
  );

  sendMessage(`Autoresearch starting: ${config.task}\nMax iterations: ${maxIterations}, Evaluator: \`${config.evaluatorScript}\``);

  const candidates: AutoresearchCandidate[] = [];
  const improvementHistory: number[] = [];
  let bestCandidate: AutoresearchCandidate | null = null;
  let consecutivePlateau = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    logger.info({ workflowId, iteration }, 'Autoresearch iteration starting');

    // ── Step 1: Create worktree for this candidate ──────────────────────
    let worktree: GitWorktree;
    try {
      worktree = createWorktree({
        projectPath: config.projectPath,
        workflowId,
        stepNumber: iteration,
        baseBranch: bestCandidate ? bestCandidate.branch : baseBranch,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowId, iteration, error: errorMsg }, 'Failed to create worktree');
      sendMessage(`Iteration ${iteration}: Failed to create worktree — ${errorMsg}`);
      break;
    }

    // ── Step 2: Build feedback prompt ───────────────────────────────────
    const feedback = buildFeedbackPrompt(config.task, candidates, bestCandidate);

    // ── Step 3: Run the agent ──────────────────────────────────────────
    let agentOutput: string;
    try {
      agentOutput = await runAgent(
        feedback,
        worktree.path,
        config.agentCommand,
        config.agentModel,
        agentTimeout,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ workflowId, iteration, error: errorMsg }, 'Agent failed');
      agentOutput = `AGENT ERROR: ${errorMsg}`;
    }

    // ── Step 4: Evaluate the candidate ─────────────────────────────────
    let evalResult: EvalResult;
    try {
      evalResult = await evaluateCandidate(config.evaluatorScript, worktree.path, evaluatorTimeout);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      evalResult = {
        score: 0,
        passed: false,
        output: '',
        error: errorMsg,
        durationMs: 0,
      };
    }

    // ── Step 5: Record the candidate ───────────────────────────────────
    const candidate: AutoresearchCandidate = {
      iteration,
      worktreePath: worktree.path,
      branch: worktree.branch,
      score: evalResult.score,
      output: evalResult.output,
      agentOutput: agentOutput.slice(0, 5000), // Cap agent output for storage
      status: 'evaluated',
      timestamp: new Date().toISOString(),
    };

    candidates.push(candidate);
    improvementHistory.push(evalResult.score);

    // Persist to JSONL log
    appendCandidateLog(workflowId, candidate);

    // ── Step 6: Accept or reject ───────────────────────────────────────
    const prevBestScore = bestCandidate?.score ?? -1;
    const improved = evalResult.score > prevBestScore;

    if (improved) {
      // Mark previous best as rejected
      if (bestCandidate) {
        bestCandidate.status = 'rejected';
      }
      candidate.status = 'accepted';
      bestCandidate = candidate;
      consecutivePlateau = 0;

      sendMessage(
        `Iteration ${iteration}/${maxIterations}: Score ${evalResult.score}/100 (improved from ${prevBestScore < 0 ? 'N/A' : prevBestScore})` +
        (evalResult.passed ? ' — PASSED' : '') +
        `\n${truncate(evalResult.output, 200)}`,
      );
    } else {
      candidate.status = 'rejected';
      consecutivePlateau++;

      sendMessage(
        `Iteration ${iteration}/${maxIterations}: Score ${evalResult.score}/100 (no improvement over best: ${prevBestScore})` +
        `\n${truncate(evalResult.output, 200)}`,
      );

      // Clean up rejected candidate's worktree immediately to save disk
      try {
        removeWorktree(worktree, true);
      } catch {
        // Non-fatal
      }
    }

    // ── Step 7: Check termination conditions ───────────────────────────

    // Perfect score
    if (evalResult.score >= 100) {
      logger.info({ workflowId, iteration }, 'Perfect score — stopping early');
      sendMessage('Perfect score achieved — stopping autoresearch.');
      break;
    }

    // Plateau detection — stop if we haven't improved for 2 consecutive iterations
    if (consecutivePlateau >= 2) {
      logger.info({ workflowId, iteration, consecutivePlateau }, 'Score plateaued — stopping');
      sendMessage(`Score plateaued for ${consecutivePlateau} iterations — stopping.`);
      break;
    }

    // Marginal improvement detection
    if (improved && prevBestScore >= 0 && (evalResult.score - prevBestScore) < improvementThreshold) {
      // Still technically improved but below threshold — count it but don't stop yet
      logger.info(
        { workflowId, iteration, delta: evalResult.score - prevBestScore, threshold: improvementThreshold },
        'Marginal improvement below threshold',
      );
    }

    // Evaluator passed cleanly — we can stop
    if (evalResult.passed && evalResult.score >= 80) {
      logger.info({ workflowId, iteration }, 'Evaluator passed with high score — stopping');
      sendMessage(`Evaluator passed with score ${evalResult.score}/100 — stopping.`);
      break;
    }
  }

  // ── Final: Merge best candidate ────────────────────────────────────────

  if (!bestCandidate) {
    const durationMs = Date.now() - startTime;
    sendMessage('Autoresearch completed with no successful candidates.');
    logger.warn({ workflowId }, 'Autoresearch finished with no candidates');

    // Return a synthetic "zero" result
    return {
      bestCandidate: {
        iteration: 0,
        worktreePath: '',
        branch: '',
        score: 0,
        output: 'No candidates produced',
        agentOutput: '',
        status: 'rejected',
        timestamp: new Date().toISOString(),
      },
      allCandidates: candidates,
      iterations: candidates.length,
      improvementHistory,
      finalBranch: '',
      merged: false,
      durationMs,
    };
  }

  // Merge the best candidate's branch back
  let merged = false;
  const mergeTarget = config.baseBranch || 'main';

  try {
    const mergeResult = mergeWorktree(
      {
        path: bestCandidate.worktreePath,
        branch: bestCandidate.branch,
        workflowId,
        stepNumber: bestCandidate.iteration,
        status: 'active',
        createdAt: bestCandidate.timestamp,
        isolationMode: 'isolated',
      },
      mergeTarget,
    );
    merged = mergeResult.success;

    if (merged) {
      sendMessage(`Best candidate (iteration ${bestCandidate.iteration}, score ${bestCandidate.score}/100) merged into ${mergeTarget}.`);
    } else {
      sendMessage(`Merge of best candidate failed: ${mergeResult.error || 'unknown error'}. Branch ${bestCandidate.branch} preserved.`);
    }
  } catch (err) {
    logger.error({ workflowId, error: String(err) }, 'Failed to merge best candidate');
    sendMessage(`Failed to merge best candidate. Branch ${bestCandidate.branch} preserved for manual merge.`);
  }

  // Clean up non-best worktrees
  for (const c of candidates) {
    if (c !== bestCandidate && c.status !== 'rejected') {
      // Already cleaned rejected ones above
      try {
        removeWorktree({
          path: c.worktreePath,
          branch: c.branch,
          workflowId,
          stepNumber: c.iteration,
          status: 'active',
          createdAt: c.timestamp,
          isolationMode: 'isolated',
        }, !merged); // Only delete branch if we didn't merge
      } catch {
        // Non-fatal
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const durationSec = Math.round(durationMs / 1000);

  logger.info(
    {
      workflowId,
      iterations: candidates.length,
      bestScore: bestCandidate.score,
      merged,
      durationMs,
    },
    'Autoresearch complete',
  );

  sendMessage(
    `Autoresearch complete.\n` +
    `Iterations: ${candidates.length}\n` +
    `Best score: ${bestCandidate.score}/100 (iteration ${bestCandidate.iteration})\n` +
    `Duration: ${durationSec}s\n` +
    `Branch: ${bestCandidate.branch}${merged ? ' (merged)' : ' (preserved)'}`,
  );

  return {
    bestCandidate,
    allCandidates: candidates,
    iterations: candidates.length,
    improvementHistory,
    finalBranch: bestCandidate.branch,
    merged,
    durationMs,
  };
}

// ── Agent Execution ───────────────────────────────────────────────────────────

/**
 * Run the agent to produce a candidate.
 *
 * Uses Claude CLI by default but can be overridden via config.agentCommand.
 * The agent runs in the candidate's worktree directory.
 */
async function runAgent(
  prompt: string,
  cwd: string,
  agentCommand?: string,
  agentModel?: string,
  timeout: number = DEFAULT_AGENT_TIMEOUT,
): Promise<string> {
  const model = agentModel || 'claude-sonnet-4-6';

  // Escape the prompt for shell
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  let command: string;
  if (agentCommand) {
    // If the agent command contains {PROMPT}, replace it; otherwise append
    if (agentCommand.includes('{PROMPT}')) {
      command = agentCommand.replace('{PROMPT}', escapedPrompt);
    } else {
      command = `${agentCommand} '${escapedPrompt}'`;
    }
  } else {
    // Default: Claude CLI in print mode (non-interactive)
    command = `claude --model ${model} --dangerously-skip-permissions --print '${escapedPrompt}'`;
  }

  logger.info({ cwd, command: command.slice(0, 100) + '...' }, 'Running autoresearch agent');

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }) as string;
    return output;
  } catch (err: unknown) {
    // execSync throws on non-zero exit. Extract output if available.
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const stdoutStr = typeof execErr.stdout === 'string' ? execErr.stdout : '';
    const stderrStr = typeof execErr.stderr === 'string' ? execErr.stderr : '';
    if (stdoutStr) {
      // Agent produced output but exited non-zero — still useful
      return `${stdoutStr}\n\nSTDERR:\n${stderrStr}`;
    }
    throw err;
  }
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

/**
 * Run an evaluator script against a candidate's worktree.
 *
 * Score extraction strategy:
 *  1. Look for "score: N" pattern in stdout (case-insensitive)
 *  2. If the last non-empty line of stdout is a number, use it
 *  3. Fall back to exit code: 0 → 100, non-zero → 0
 */
export async function evaluateCandidate(
  evaluatorScript: string,
  cwd: string,
  timeout: number = DEFAULT_EVALUATOR_TIMEOUT,
): Promise<EvalResult> {
  const startTime = Date.now();

  logger.info({ evaluator: evaluatorScript, cwd }, 'Running evaluator');

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    stdout = execSync(evaluatorScript, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }) as string;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    stdout = typeof execErr.stdout === 'string' ? execErr.stdout : '';
    stderr = typeof execErr.stderr === 'string' ? execErr.stderr : '';
    exitCode = typeof execErr.status === 'number' ? execErr.status : 1;
  }

  const durationMs = Date.now() - startTime;
  const score = extractScore(stdout, exitCode);
  const passed = exitCode === 0;

  logger.info(
    { score, passed, exitCode, durationMs },
    'Evaluator completed',
  );

  return {
    score,
    passed,
    output: stdout.slice(0, 5000), // Cap output
    error: stderr ? stderr.slice(0, 2000) : undefined,
    durationMs,
  };
}

/**
 * Extract a numeric score from evaluator output.
 *
 * Priority:
 *  1. Explicit "score: N" or "score=N" in the output
 *  2. Last non-empty line is a bare number
 *  3. Exit code fallback (0 → 100, non-zero → 0)
 */
function extractScore(stdout: string, exitCode: number): number {
  // Strategy 1: "score: N" pattern
  const scorePattern = /\bscore[:\s=]+(\d+(?:\.\d+)?)/i;
  const scoreMatch = stdout.match(scorePattern);
  if (scoreMatch) {
    const score = parseFloat(scoreMatch[1]);
    return clamp(score, 0, 100);
  }

  // Strategy 2: Last non-empty line is a number
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    const num = parseFloat(lastLine);
    if (!isNaN(num) && lastLine === String(num)) {
      return clamp(num, 0, 100);
    }
  }

  // Strategy 3: Exit code fallback
  return exitCode === 0 ? 100 : 0;
}

// ── Feedback Prompt Builder ───────────────────────────────────────────────────

/**
 * Build a prompt that incorporates feedback from previous iterations.
 *
 * The feedback progressively gets more specific: early iterations describe the
 * task, later iterations include what worked, what didn't, and specific issues.
 */
function buildFeedbackPrompt(
  task: string,
  previousCandidates: AutoresearchCandidate[],
  bestCandidate: AutoresearchCandidate | null,
): string {
  const parts: string[] = [];

  parts.push(`TASK: ${task}`);
  parts.push('');

  if (previousCandidates.length === 0) {
    parts.push('This is the first iteration. Produce your best attempt.');
    return parts.join('\n');
  }

  // Include iteration history
  parts.push(`PREVIOUS ATTEMPTS: ${previousCandidates.length} iteration(s) so far.`);
  parts.push(`Best score so far: ${bestCandidate?.score ?? 0}/100 (iteration ${bestCandidate?.iteration ?? 0})`);
  parts.push('');

  // Last candidate's feedback
  const lastCandidate = previousCandidates[previousCandidates.length - 1];
  const prevCandidate = previousCandidates.length >= 2
    ? previousCandidates[previousCandidates.length - 2]
    : null;

  if (lastCandidate.score < (prevCandidate?.score ?? 0)) {
    parts.push('WARNING: Your last change DECREASED the score from ' +
      `${prevCandidate?.score ?? 0} to ${lastCandidate.score}. ` +
      `Revert to the approach from iteration ${bestCandidate?.iteration ?? 1} and try a different strategy.`);
    parts.push('');
  }

  parts.push(`Last attempt (iteration ${lastCandidate.iteration}) scored ${lastCandidate.score}/100.`);
  parts.push('Evaluator output:');
  parts.push('```');
  parts.push(truncate(lastCandidate.output, 1000));
  parts.push('```');
  parts.push('');

  // Actionable improvement request
  if (lastCandidate.score < 100) {
    parts.push('IMPROVE ON: Based on the evaluator output above, fix the remaining issues.');
    parts.push('Focus on what the evaluator is specifically complaining about.');
  }

  return parts.join('\n');
}

// ── Logging ───────────────────────────────────────────────────────────────────

/** Append a candidate record to the JSONL log file */
function appendCandidateLog(workflowId: string, candidate: AutoresearchCandidate): void {
  const logPath = autoresearchLogPath(workflowId);
  try {
    const entry = JSON.stringify({
      ...candidate,
      // Don't log full agent output to JSONL — too large
      agentOutput: candidate.agentOutput.slice(0, 500),
    });
    fs.appendFileSync(logPath, entry + '\n');
  } catch (err) {
    logger.warn({ workflowId, error: String(err) }, 'Failed to append autoresearch log');
  }
}

/**
 * Read the autoresearch log for a workflow.
 * Returns all candidate entries from the JSONL file.
 */
export function readAutoresearchLog(workflowId: string): AutoresearchCandidate[] {
  const logPath = autoresearchLogPath(workflowId);
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as AutoresearchCandidate);
  } catch {
    return [];
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Clamp a number between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Truncate a string with ellipsis */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
