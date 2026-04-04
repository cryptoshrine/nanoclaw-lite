/**
 * OmX Pattern 5: Deep-Interview (Socratic Pre-Planning)
 *
 * A Socratic interview system that extracts precise requirements from vague
 * task descriptions BEFORE they enter the OmX pipeline (or RALPLAN).
 *
 * The problem: "improve the auth system" or "add real-time features" wastes
 * specialist budget when OmX proceeds with incomplete understanding.
 *
 * Solution: 7-dimension ambiguity scoring → targeted question generation →
 * user interview → structured TaskSpec output ready for planning.
 *
 * Flow:
 *   1. scoreAmbiguity() — heuristic 7-dimension analysis
 *   2. needsInterview() — weighted score < 0.7 triggers interview
 *   3. generateQuestions() — targeted Qs for low-scoring dimensions
 *   4. runInterview() — send questions, await responses, re-score
 *   5. Output: InterviewResult with TaskSpec → feeds into OmX/RALPLAN
 */

import fs from 'fs';
import path from 'path';
import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** 7-dimension ambiguity scores (each 0-1, higher = clearer) */
export interface AmbiguityDimensions {
  /** What is the user trying to achieve? */
  intent: number;
  /** What does "done" look like? */
  outcome: number;
  /** What's included/excluded? */
  scope: number;
  /** What's the current state of the system? */
  context: number;
  /** What are the limits (time, budget, tech)? */
  constraints: number;
  /** What quality bar? (tests, types, docs) */
  quality: number;
  /** How should it be validated? */
  testing: number;
}

/** Mode weights per dimension — greenfield emphasises intent, brownfield emphasises context */
export type InterviewMode = 'greenfield' | 'brownfield';

/** Challenge strategy for probing weak spots */
export type ChallengeMode = 'contrarian' | 'simplifier' | 'ontologist';

/** A single exchange in the interview transcript */
export interface InterviewTurn {
  role: 'interviewer' | 'user' | 'system';
  content: string;
  dimension?: keyof AmbiguityDimensions;
  timestamp: string;
}

/** Structured task specification — the interview's output */
export interface TaskSpec {
  intent: string;
  outcome: string;
  scope: { included: string[]; excluded: string[] };
  constraints: string[];
  qualityBar: string;
  testingStrategy: string;
  nonGoals: string[];
  decisionBoundaries: { agent: string[]; human: string[] };
}

/** Full interview result, ready for OmX/RALPLAN consumption */
export interface InterviewResult {
  spec: TaskSpec;
  transcript: InterviewTurn[];
  ambiguityScore: AmbiguityDimensions;
  weightedScore: number;
  mode: InterviewMode;
  challengeMode: ChallengeMode;
  readyForPlanning: boolean;
}

/** Configuration for starting an interview */
export interface InterviewConfig {
  taskDescription: string;
  mode?: InterviewMode;
  challengeMode?: ChallengeMode;
  /** Callback to send questions to the user (e.g. Telegram send_message) */
  sendMessage: (text: string) => Promise<void>;
  /** Callback to request approval with formatted questions, returns user answer */
  requestApproval: (description: string) => Promise<{ requestId: string }>;
  /** Callback to check approval status */
  checkApproval: (requestId: string) => Promise<{ status: string; response?: string }>;
  /** Max number of interview rounds before forcing a decision */
  maxRounds?: number;
  /** Workflow ID to associate the interview with (for persistence) */
  workflowId?: string;
}

/** Persisted interview state (survives session boundaries) */
interface InterviewState {
  taskDescription: string;
  mode: InterviewMode;
  challengeMode: ChallengeMode;
  dimensions: AmbiguityDimensions;
  weightedScore: number;
  transcript: InterviewTurn[];
  pendingQuestions: string[];
  round: number;
  maxRounds: number;
  approvalRequestId?: string;
  status: 'scoring' | 'awaiting_response' | 'complete' | 'skipped';
  spec: TaskSpec;
  createdAt: string;
  updatedAt: string;
}

// ── Weight Tables ─────────────────────────────────────────────────────────────

const GREENFIELD_WEIGHTS: Record<keyof AmbiguityDimensions, number> = {
  intent: 0.25,
  outcome: 0.20,
  scope: 0.15,
  context: 0.05,
  constraints: 0.15,
  quality: 0.10,
  testing: 0.10,
};

const BROWNFIELD_WEIGHTS: Record<keyof AmbiguityDimensions, number> = {
  intent: 0.15,
  outcome: 0.15,
  scope: 0.20,
  context: 0.25,
  constraints: 0.10,
  quality: 0.05,
  testing: 0.10,
};

// ── Heuristic Patterns ────────────────────────────────────────────────────────

/** Intent clarity signals */
const INTENT_VERBS = /\b(?:add|create|build|implement|fix|remove|delete|migrate|replace|extract|split|merge|integrate|connect|wire|deploy|enable|disable)\b/i;
const VAGUE_INTENT = /\b(?:improve|enhance|optimize|refactor|clean\s?up|make\s+better|update|work\s+on|look\s+at|handle)\b/i;

/** Outcome signals — what "done" looks like */
const OUTCOME_RE = /\b(?:should\s+(?:return|display|show|render|output|produce|generate|save|store)|endpoint|page|component|API|route|response|report|notification|email|message)\b/i;
const DONE_CRITERIA_RE = /\b(?:when|until|so\s+that|in\s+order\s+to|result|output|acceptance|criteria|must\s+(?:be|have|pass|return))\b/i;

/** Scope signals */
const SCOPE_BOUNDARY_RE = /\b(?:only|just|limited\s+to|within|for\s+now|specifically|exclude|except|not\s+including|scope|boundary|skip|ignore)\b/i;
const SCOPE_FILES_RE = /(?:src\/|app\/|lib\/|test[s]?\/|\.(?:ts|tsx|js|jsx|py|md|json|yaml|rs|go))\b/i;

/** Context signals — references to current system state */
const CONTEXT_RE = /\b(?:currently|existing|right\s+now|as-is|broken|failing|returns|error|bug|issue|version|already|today|production)\b/i;

/** Constraints signals */
const CONSTRAINTS_RE = /\b(?:must\s+not|cannot|no\s+more\s+than|within|deadline|budget|backward[s]?\s*compatible|without\s+breaking|performance|latency|limit|restriction|dependency)\b/i;

/** Quality bar signals */
const QUALITY_RE = /\b(?:test[s]?|type[s]?\s*(?:safe|check|strict)|lint|doc[s]?|documentation|coverage|review|CI|strict|clean|robust|reliable|production\s*ready)\b/i;

/** Testing strategy signals */
const TESTING_RE = /\b(?:unit\s+test|integration\s+test|e2e|end.to.end|pytest|jest|vitest|manual\s+test|test\s+plan|coverage|assert|expect|should\s+pass|TDD|BDD)\b/i;

/** Greenfield indicators — new things being built */
const GREENFIELD_RE = /\b(?:new|create|add|build|implement|introduce|set\s+up|bootstrap|scaffold|from\s+scratch|initial|first|MVP|prototype)\b/i;

/** Brownfield indicators — modifying existing things */
const BROWNFIELD_RE = /\b(?:fix|bug|broken|refactor|migrate|update|change|modify|existing|current|legacy|deprecat|replac|upgrad|rewrit|restructur)\b/i;

/** Challenge mode detection */
const ARCHITECTURE_RE = /\b(?:architect|design|pattern|approach|strategy|framework|system|infrastructure|stack|layer)\b/i;
const SIMPLE_TASK_RE = /\b(?:simple|quick|small|minor|tweak|adjust|just|one-liner|trivial)\b/i;
const JARGON_RE = /\b(?:microservice|event.driven|CQRS|saga|DDD|hexagonal|clean\s+arch|serverless|edge\s+function|webhook|middleware|proxy|gateway|orchestrat)\b/i;

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score a task description across 7 ambiguity dimensions.
 * Each dimension is 0-1 (higher = clearer). Pure heuristic, zero LLM cost.
 */
export function scoreAmbiguity(taskDescription: string): AmbiguityDimensions {
  const text = taskDescription;

  // Intent: clear action verb vs vague "improve"
  let intent = 0;
  if (INTENT_VERBS.test(text)) intent += 0.6;
  if (VAGUE_INTENT.test(text) && !INTENT_VERBS.test(text)) intent += 0.2;
  // Bonus for specific object ("add auth to the login page" vs "add auth")
  if (SCOPE_FILES_RE.test(text) || /\b(?:the|this)\s+\w+\s+(?:page|component|module|service|endpoint|route|file)\b/i.test(text)) {
    intent += 0.4;
  }
  intent = Math.min(1, intent);

  // Outcome: what "done" looks like
  let outcome = 0;
  if (OUTCOME_RE.test(text)) outcome += 0.5;
  if (DONE_CRITERIA_RE.test(text)) outcome += 0.5;
  outcome = Math.min(1, outcome);

  // Scope: bounded vs unbounded
  let scope = 0;
  if (SCOPE_BOUNDARY_RE.test(text)) scope += 0.4;
  if (SCOPE_FILES_RE.test(text)) scope += 0.4;
  // Penalty for extremely short descriptions
  if (text.split(/\s+/).length < 5) scope = Math.max(0, scope - 0.3);
  // Bonus for listing multiple items (bullet points, commas)
  if (/(?:\n[-*•]|\d+\.\s|,\s*\w+\s*,)/.test(text)) scope += 0.2;
  scope = Math.min(1, scope);

  // Context: references to current system state
  let context = 0;
  if (CONTEXT_RE.test(text)) context += 0.5;
  if (SCOPE_FILES_RE.test(text)) context += 0.3;
  // Bonus for mentioning error messages or specific behavior
  if (/["'`].*["'`]/.test(text)) context += 0.2;
  context = Math.min(1, context);

  // Constraints: explicit limits
  let constraints = 0;
  if (CONSTRAINTS_RE.test(text)) constraints += 0.6;
  // Bonus for tech constraints
  if (/\b(?:Python|TypeScript|React|FastAPI|PostgreSQL|Redis|Docker|Solana|Anchor)\b/i.test(text)) {
    constraints += 0.4;
  }
  constraints = Math.min(1, constraints);

  // Quality: explicit quality expectations
  let quality = 0;
  if (QUALITY_RE.test(text)) quality += 0.7;
  // Default baseline — most tasks implicitly expect "working"
  quality += 0.15;
  quality = Math.min(1, quality);

  // Testing: explicit validation strategy
  let testing = 0;
  if (TESTING_RE.test(text)) testing += 0.7;
  // Partial credit for quality signals that imply testing
  if (QUALITY_RE.test(text) && !TESTING_RE.test(text)) testing += 0.2;
  testing = Math.min(1, testing);

  return {
    intent: round2(intent),
    outcome: round2(outcome),
    scope: round2(scope),
    context: round2(context),
    constraints: round2(constraints),
    quality: round2(quality),
    testing: round2(testing),
  };
}

/**
 * Compute a weighted score from dimensions and mode weights.
 */
export function computeWeightedScore(
  dimensions: AmbiguityDimensions,
  mode: InterviewMode,
): number {
  const weights = mode === 'greenfield' ? GREENFIELD_WEIGHTS : BROWNFIELD_WEIGHTS;
  let score = 0;
  for (const key of Object.keys(weights) as (keyof AmbiguityDimensions)[]) {
    score += dimensions[key] * weights[key];
  }
  return round2(score);
}

// ── Mode Detection ────────────────────────────────────────────────────────────

/**
 * Auto-detect whether a task is greenfield (new feature) or brownfield (modification).
 */
export function detectMode(taskDescription: string): InterviewMode {
  const gfMatches = (taskDescription.match(GREENFIELD_RE) || []).length;
  const bfMatches = (taskDescription.match(BROWNFIELD_RE) || []).length;

  // Brownfield gets a slight bias — most tasks in existing codebases are modifications
  if (bfMatches > gfMatches) return 'brownfield';
  if (gfMatches > bfMatches) return 'greenfield';
  return 'brownfield'; // default to brownfield in ties
}

/**
 * Select a challenge mode based on task characteristics.
 *
 * - contrarian: for architecture/design tasks → "Why not just use X?"
 * - simplifier: for large-scope tasks → "What's the minimum viable version?"
 * - ontologist: for jargon-heavy or vague tasks → "What exactly do you mean by X?"
 */
export function selectChallengeMode(
  taskDescription: string,
  _mode: InterviewMode,
): ChallengeMode {
  if (JARGON_RE.test(taskDescription) || VAGUE_INTENT.test(taskDescription)) {
    return 'ontologist';
  }
  if (ARCHITECTURE_RE.test(taskDescription)) {
    return 'contrarian';
  }
  if (!SIMPLE_TASK_RE.test(taskDescription) && taskDescription.split(/\s+/).length > 15) {
    return 'simplifier';
  }
  // Default: ontologist (safest — clarifies terminology)
  return 'ontologist';
}

// ── Question Generation ───────────────────────────────────────────────────────

/** Question templates per dimension */
const QUESTION_TEMPLATES: Record<keyof AmbiguityDimensions, string[]> = {
  intent: [
    'What specific action should the system take? (e.g., create X, fix Y, replace Z)',
    'Can you describe the user story? "As a [role], I want [action] so that [benefit]"',
  ],
  outcome: [
    'What does "done" look like? Describe the end state.',
    'How will you verify this works? What would you check manually?',
  ],
  scope: [
    'Which files, modules, or components should be touched?',
    'What should this NOT include? (explicit exclusions help prevent scope creep)',
  ],
  context: [
    'What\'s the current state of the system? What exists today?',
    'Is anything broken right now that this relates to?',
  ],
  constraints: [
    'Are there any technical constraints? (backward compat, no new dependencies, performance targets)',
    'Any timeline or budget limits?',
  ],
  quality: [
    'What quality bar? (full test coverage, type-safe, linted, documented)',
    'Should this be production-ready or is a prototype acceptable?',
  ],
  testing: [
    'How should this be tested? (unit tests, integration tests, manual, E2E)',
    'Any specific test scenarios that must pass?',
  ],
};

/** Challenge prompts by mode */
const CHALLENGE_PROMPTS: Record<ChallengeMode, string[]> = {
  contrarian: [
    'Why build this at all? What happens if you don\'t?',
    'What\'s the simplest existing tool or library that already does this?',
    'Have you considered the opposite approach?',
  ],
  simplifier: [
    'What\'s the smallest version of this that would still be useful?',
    'Can you cut this in half? What would you drop?',
    'If you had to ship this in 30 minutes, what would you build?',
  ],
  ontologist: [
    'When you say "{term}", what exactly do you mean in this context?',
    'Can you give a concrete example of what you\'re describing?',
    'Is there a difference between what you said and [alternative interpretation]?',
  ],
};

/**
 * Generate targeted questions for dimensions scoring below the threshold.
 * Returns 3-7 questions — never overwhelming, always focused.
 */
export function generateQuestions(
  dimensions: AmbiguityDimensions,
  mode: InterviewMode,
  challengeMode: ChallengeMode,
  taskDescription: string,
): string[] {
  const weights = mode === 'greenfield' ? GREENFIELD_WEIGHTS : BROWNFIELD_WEIGHTS;
  const questions: string[] = [];

  // Collect dimensions that need clarification (score < 0.5)
  // Sort by weight descending — ask about the most impactful gaps first
  const gaps = (Object.keys(dimensions) as (keyof AmbiguityDimensions)[])
    .filter(dim => dimensions[dim] < 0.5)
    .sort((a, b) => weights[b] - weights[a]);

  for (const dim of gaps) {
    if (questions.length >= 5) break; // Cap at 5 dimension questions
    const templates = QUESTION_TEMPLATES[dim];
    // Pick the first template for the most important gaps, second for less important
    const templateIdx = questions.length < 3 ? 0 : 1;
    const template = templates[Math.min(templateIdx, templates.length - 1)];
    questions.push(template);
  }

  // Add one challenge question if we have room
  if (questions.length < 6) {
    const challengePool = CHALLENGE_PROMPTS[challengeMode];
    let challenge = challengePool[0];
    // Ontologist mode: try to find a specific term to challenge
    if (challengeMode === 'ontologist') {
      const jargonMatch = taskDescription.match(JARGON_RE);
      if (jargonMatch) {
        challenge = challenge.replace('{term}', jargonMatch[0]);
      } else {
        // Fall back to the concrete example question
        challenge = challengePool[1];
      }
    }
    questions.push(challenge);
  }

  // Always include the two gate questions (non-goals + decision boundaries)
  questions.push('What should this NOT do? (explicit non-goals)');
  questions.push('What decisions should the agent make autonomously vs. check with you first?');

  return questions;
}

// ── Interview Flow ────────────────────────────────────────────────────────────

/**
 * Determine if a task needs a Deep-Interview before planning.
 * Returns true if the weighted ambiguity score is below the clarity threshold.
 */
export function needsInterview(taskDescription: string): boolean {
  const dimensions = scoreAmbiguity(taskDescription);
  const mode = detectMode(taskDescription);
  const weighted = computeWeightedScore(dimensions, mode);
  return weighted < 0.7;
}

/**
 * Build the interviewer agent prompt for generating follow-up questions.
 * This is used when the interview is conducted by an AI agent rather than
 * pure heuristics.
 */
export function buildInterviewerPrompt(context: {
  taskDescription: string;
  dimensions: AmbiguityDimensions;
  mode: InterviewMode;
  challengeMode: ChallengeMode;
  transcript: InterviewTurn[];
}): string {
  const { taskDescription, dimensions, mode, challengeMode, transcript } = context;

  const dimSummary = Object.entries(dimensions)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const transcriptText = transcript.length > 0
    ? transcript.map(t => `[${t.role}] ${t.content}`).join('\n')
    : '(no prior conversation)';

  return `You are a Socratic interviewer for a software engineering task.
Your role is to ask precise, targeted questions to resolve ambiguity.

TASK: ${taskDescription}

MODE: ${mode} (${mode === 'greenfield' ? 'new feature' : 'modification to existing system'})
CHALLENGE STYLE: ${challengeMode}

AMBIGUITY SCORES (0-1, higher = clearer):
${dimSummary}

CONVERSATION SO FAR:
${transcriptText}

RULES:
1. Focus on dimensions scoring below 0.5
2. Ask ONE question at a time
3. Be specific — reference the task description
4. Challenge style "${challengeMode}":
   - contrarian: question whether the approach is right
   - simplifier: push for the minimum viable version
   - ontologist: clarify exact meanings of vague terms
5. Always ensure non-goals and decision boundaries are covered
6. When you have enough clarity (all dimensions > 0.5), say "INTERVIEW COMPLETE"
   and output the structured spec.

Ask your next question:`;
}

/**
 * Run a full interview flow. Sends questions to the user, waits for responses,
 * re-scores, and outputs a structured TaskSpec.
 *
 * This function drives the interview through multiple rounds until clarity
 * is sufficient or maxRounds is reached.
 */
export async function runInterview(config: InterviewConfig): Promise<InterviewResult> {
  const {
    taskDescription,
    sendMessage,
    requestApproval,
    checkApproval,
    maxRounds = 3,
    workflowId,
  } = config;

  const mode = config.mode ?? detectMode(taskDescription);
  const challengeMode = config.challengeMode ?? selectChallengeMode(taskDescription, mode);
  const dimensions = scoreAmbiguity(taskDescription);
  const weightedScore = computeWeightedScore(dimensions, mode);
  const transcript: InterviewTurn[] = [];

  // Record the initial task as a system turn
  transcript.push({
    role: 'system',
    content: `Task submitted: "${taskDescription}" | Mode: ${mode} | Challenge: ${challengeMode} | Score: ${weightedScore}`,
    timestamp: new Date().toISOString(),
  });

  // If already clear enough, skip the interview
  if (weightedScore >= 0.7) {
    logger.info(
      { taskDescription: taskDescription.slice(0, 80), weightedScore, mode },
      'Deep-Interview: task clear enough, skipping interview',
    );

    const spec = buildSpecFromDescription(taskDescription);
    const result: InterviewResult = {
      spec,
      transcript,
      ambiguityScore: dimensions,
      weightedScore,
      mode,
      challengeMode,
      readyForPlanning: true,
    };

    if (workflowId) saveInterviewState(workflowId, result, 'skipped');
    return result;
  }

  // Generate questions for low-scoring dimensions
  const questions = generateQuestions(dimensions, mode, challengeMode, taskDescription);

  // Format questions for the user
  const questionBlock = [
    `*Deep-Interview: ${taskDescription.slice(0, 60)}${taskDescription.length > 60 ? '...' : ''}*`,
    '',
    `I need to clarify a few things before planning this (score: ${weightedScore}/1.0):`,
    '',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Reply with your answers (numbered or free-form). Say "skip" to proceed without clarification.',
  ].join('\n');

  transcript.push({
    role: 'interviewer',
    content: questionBlock,
    timestamp: new Date().toISOString(),
  });

  // Send questions and request response
  try {
    const { requestId } = await requestApproval(questionBlock);

    // Poll for response (the supervisor tick will handle this)
    let response: string | undefined;
    let attempts = 0;
    const maxAttempts = 60; // ~60 seconds of polling

    while (attempts < maxAttempts) {
      const result = await checkApproval(requestId);
      if (result.status === 'approved' || result.status === 'rejected') {
        response = result.response || result.status;
        break;
      }
      // Wait 1 second between polls
      await sleep(1000);
      attempts++;
    }

    if (response && response !== 'skip' && response !== 'rejected') {
      transcript.push({
        role: 'user',
        content: response,
        timestamp: new Date().toISOString(),
      });

      // Re-score with user input
      const combinedText = `${taskDescription}\n\n${response}`;
      const updatedDimensions = scoreAmbiguity(combinedText);
      const updatedScore = computeWeightedScore(updatedDimensions, mode);

      // Build spec from combined information
      const spec = buildSpecFromResponses(taskDescription, response, questions);

      const result: InterviewResult = {
        spec,
        transcript,
        ambiguityScore: updatedDimensions,
        weightedScore: updatedScore,
        mode,
        challengeMode,
        readyForPlanning: updatedScore >= 0.5, // lower bar after user responded
      };

      if (workflowId) saveInterviewState(workflowId, result, 'complete');

      logger.info(
        {
          taskDescription: taskDescription.slice(0, 80),
          before: weightedScore,
          after: updatedScore,
          mode,
        },
        'Deep-Interview: complete',
      );

      return result;
    }

    // User skipped or didn't respond — proceed with what we have
    await sendMessage('Interview skipped. Proceeding with available context.');
  } catch (err) {
    logger.warn(
      { err, taskDescription: taskDescription.slice(0, 80) },
      'Deep-Interview: approval mechanism failed, proceeding with heuristic spec',
    );
  }

  // Fallback: build spec from description alone
  const spec = buildSpecFromDescription(taskDescription);
  const result: InterviewResult = {
    spec,
    transcript,
    ambiguityScore: dimensions,
    weightedScore,
    mode,
    challengeMode,
    readyForPlanning: false,
  };

  if (workflowId) saveInterviewState(workflowId, result, 'complete');
  return result;
}

// ── Async Interview (Supervisor-Compatible) ───────────────────────────────────

/**
 * Start an interview asynchronously. Sends questions and saves state to disk.
 * The supervisor tick can check for responses on subsequent passes.
 *
 * Returns the interview state ID for tracking.
 */
export async function startAsyncInterview(
  taskDescription: string,
  sendMessage: (text: string) => Promise<void>,
  requestApproval: (description: string) => Promise<{ requestId: string }>,
  workflowId?: string,
): Promise<string> {
  const id = workflowId || `interview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const mode = detectMode(taskDescription);
  const challengeMode = selectChallengeMode(taskDescription, mode);
  const dimensions = scoreAmbiguity(taskDescription);
  const weightedScore = computeWeightedScore(dimensions, mode);

  // Skip if clear enough
  if (weightedScore >= 0.7) {
    const spec = buildSpecFromDescription(taskDescription);
    const state: InterviewState = {
      taskDescription,
      mode,
      challengeMode,
      dimensions,
      weightedScore,
      transcript: [],
      pendingQuestions: [],
      round: 0,
      maxRounds: 3,
      status: 'skipped',
      spec,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveState(id, state);
    return id;
  }

  const questions = generateQuestions(dimensions, mode, challengeMode, taskDescription);

  const questionBlock = [
    `*Deep-Interview: ${taskDescription.slice(0, 60)}${taskDescription.length > 60 ? '...' : ''}*`,
    '',
    `Clarity score: ${weightedScore}/1.0 — I need a few answers before planning:`,
    '',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Reply with your answers (numbered or free-form). Approve to skip.',
  ].join('\n');

  const { requestId } = await requestApproval(questionBlock);

  const state: InterviewState = {
    taskDescription,
    mode,
    challengeMode,
    dimensions,
    weightedScore,
    transcript: [
      {
        role: 'system',
        content: `Interview started. Score: ${weightedScore}. Mode: ${mode}.`,
        timestamp: new Date().toISOString(),
      },
      {
        role: 'interviewer',
        content: questionBlock,
        timestamp: new Date().toISOString(),
      },
    ],
    pendingQuestions: questions,
    round: 1,
    maxRounds: 3,
    approvalRequestId: requestId,
    status: 'awaiting_response',
    spec: buildSpecFromDescription(taskDescription),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveState(id, state);
  logger.info(
    { interviewId: id, weightedScore, mode, questionCount: questions.length },
    'Deep-Interview: async interview started',
  );
  return id;
}

/**
 * Check on an async interview. Called by the supervisor tick.
 * Returns the interview result if complete, null if still waiting.
 */
export async function checkAsyncInterview(
  interviewId: string,
  checkApproval: (requestId: string) => Promise<{ status: string; response?: string }>,
): Promise<InterviewResult | null> {
  const state = loadState(interviewId);
  if (!state) return null;

  if (state.status === 'complete' || state.status === 'skipped') {
    return stateToResult(state);
  }

  if (state.status !== 'awaiting_response' || !state.approvalRequestId) {
    return null;
  }

  try {
    const result = await checkApproval(state.approvalRequestId);
    if (result.status === 'pending') return null;

    if (result.status === 'approved' && result.response) {
      // User provided answers
      state.transcript.push({
        role: 'user',
        content: result.response,
        timestamp: new Date().toISOString(),
      });

      // Re-score with combined input
      const combined = `${state.taskDescription}\n\n${result.response}`;
      state.dimensions = scoreAmbiguity(combined);
      state.weightedScore = computeWeightedScore(state.dimensions, state.mode);
      state.spec = buildSpecFromResponses(
        state.taskDescription,
        result.response,
        state.pendingQuestions,
      );
      state.status = 'complete';
    } else {
      // Approved without response (skip) or rejected
      state.status = 'complete';
    }

    state.updatedAt = new Date().toISOString();
    saveState(interviewId, state);
    return stateToResult(state);
  } catch {
    // Check failed — retry on next tick
    return null;
  }
}

// ── Spec Building ─────────────────────────────────────────────────────────────

/**
 * Build a minimal TaskSpec from just the task description (no user responses).
 */
function buildSpecFromDescription(taskDescription: string): TaskSpec {
  return {
    intent: taskDescription,
    outcome: extractOutcome(taskDescription),
    scope: { included: extractInclusions(taskDescription), excluded: [] },
    constraints: extractConstraints(taskDescription),
    qualityBar: QUALITY_RE.test(taskDescription) ? 'explicit quality requirements' : 'standard (tests pass, types clean)',
    testingStrategy: TESTING_RE.test(taskDescription) ? 'explicit testing strategy' : 'default (unit tests for new code)',
    nonGoals: [],
    decisionBoundaries: {
      agent: ['implementation details', 'variable naming', 'minor refactoring'],
      human: ['architecture decisions', 'external API choices', 'data model changes'],
    },
  };
}

/**
 * Build a richer TaskSpec by combining the original description with user responses.
 */
function buildSpecFromResponses(
  taskDescription: string,
  userResponse: string,
  questions: string[],
): TaskSpec {
  const spec = buildSpecFromDescription(taskDescription);

  // Parse numbered answers (e.g., "1. answer\n2. answer")
  const answers = parseNumberedAnswers(userResponse);

  // Map answers back to dimensions based on question order
  for (let i = 0; i < questions.length && i < answers.length; i++) {
    const q = questions[i].toLowerCase();
    const a = answers[i];
    if (!a) continue;

    if (q.includes('done') || q.includes('verify') || q.includes('end state')) {
      spec.outcome = a;
    } else if (q.includes('not do') || q.includes('non-goal')) {
      spec.nonGoals = a.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    } else if (q.includes('decision') || q.includes('autonomously')) {
      const parts = a.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        spec.decisionBoundaries.human = parts;
      }
    } else if (q.includes('file') || q.includes('module') || q.includes('component')) {
      spec.scope.included = a.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    } else if (q.includes('not include') || q.includes('exclude')) {
      spec.scope.excluded = a.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    } else if (q.includes('constraint') || q.includes('limit')) {
      spec.constraints = a.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    } else if (q.includes('quality') || q.includes('production')) {
      spec.qualityBar = a;
    } else if (q.includes('test')) {
      spec.testingStrategy = a;
    } else if (q.includes('action') || q.includes('user story')) {
      spec.intent = a;
    }
  }

  // If no numbered answers, treat the whole response as additional context
  if (answers.length === 0 && userResponse.trim()) {
    spec.intent = `${spec.intent}\n\nUser clarification: ${userResponse.trim()}`;
  }

  return spec;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const INTERVIEWS_DIR = path.join(OMX_WORKFLOWS_DIR, '_interviews');

function ensureInterviewDir(): void {
  fs.mkdirSync(INTERVIEWS_DIR, { recursive: true });
}

function statePath(id: string): string {
  return path.join(INTERVIEWS_DIR, `${id}.json`);
}

function saveState(id: string, state: InterviewState): void {
  ensureInterviewDir();
  const tmpPath = `${statePath(id)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath(id));
}

function loadState(id: string): InterviewState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(id), 'utf-8'));
  } catch {
    return null;
  }
}

function saveInterviewState(
  workflowId: string,
  result: InterviewResult,
  status: 'complete' | 'skipped',
): void {
  const state: InterviewState = {
    taskDescription: result.spec.intent,
    mode: result.mode,
    challengeMode: result.challengeMode,
    dimensions: result.ambiguityScore,
    weightedScore: result.weightedScore,
    transcript: result.transcript,
    pendingQuestions: [],
    round: 0,
    maxRounds: 3,
    status,
    spec: result.spec,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveState(workflowId, state);
}

function stateToResult(state: InterviewState): InterviewResult {
  return {
    spec: state.spec,
    transcript: state.transcript,
    ambiguityScore: state.dimensions,
    weightedScore: state.weightedScore,
    mode: state.mode,
    challengeMode: state.challengeMode,
    readyForPlanning: state.status === 'skipped' || state.weightedScore >= 0.5,
  };
}

/**
 * Load a previously completed interview result.
 * Returns null if no interview exists or it's still in progress.
 */
export function loadInterviewResult(id: string): InterviewResult | null {
  const state = loadState(id);
  if (!state || (state.status !== 'complete' && state.status !== 'skipped')) return null;
  return stateToResult(state);
}

/**
 * List all interviews with their current status.
 */
export function listInterviews(): Array<{ id: string; status: string; task: string; score: number }> {
  ensureInterviewDir();
  const files = fs.readdirSync(INTERVIEWS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const results: Array<{ id: string; status: string; task: string; score: number }> = [];

  for (const file of files) {
    try {
      const state: InterviewState = JSON.parse(
        fs.readFileSync(path.join(INTERVIEWS_DIR, file), 'utf-8'),
      );
      results.push({
        id: file.replace('.json', ''),
        status: state.status,
        task: state.taskDescription.slice(0, 80),
        score: state.weightedScore,
      });
    } catch { /* skip corrupt */ }
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract outcome hints from task description */
function extractOutcome(text: string): string {
  const doneMatch = text.match(/(?:should|must|will)\s+(.{10,80}?)(?:\.|$)/i);
  if (doneMatch) return doneMatch[1].trim();
  return 'Task completes successfully';
}

/** Extract file/module inclusions from task description */
function extractInclusions(text: string): string[] {
  const paths = text.match(/(?:src\/|app\/|lib\/|test[s]?\/)\S+/gi) || [];
  const files = text.match(/\w+\.(?:ts|tsx|js|jsx|py|md|json|yaml)\b/gi) || [];
  return [...new Set([...paths, ...files])];
}

/** Extract constraint phrases from task description */
function extractConstraints(text: string): string[] {
  const constraints: string[] = [];
  const mustNotMatch = text.match(/must\s+not\s+(.{5,60}?)(?:\.|,|$)/gi);
  if (mustNotMatch) constraints.push(...mustNotMatch.map(m => m.trim()));
  const withoutMatch = text.match(/without\s+(.{5,40}?)(?:\.|,|$)/gi);
  if (withoutMatch) constraints.push(...withoutMatch.map(m => m.trim()));
  return constraints;
}

/** Parse "1. answer\n2. answer" style responses */
function parseNumberedAnswers(text: string): string[] {
  const lines = text.split('\n');
  const answers: string[] = [];
  let current = '';

  for (const line of lines) {
    const numMatch = line.match(/^\s*(\d+)[.)]\s*(.*)/);
    if (numMatch) {
      if (current) answers.push(current.trim());
      current = numMatch[2];
    } else if (current) {
      current += ' ' + line.trim();
    }
  }
  if (current) answers.push(current.trim());

  return answers;
}
