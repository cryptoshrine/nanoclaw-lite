/**
 * OmX–Ouroboros Bridge — MCP client that connects NanoClaw to the Ouroboros
 * Python process running as an MCP server via `uvx`.
 *
 * Ouroboros replaces OmX's planning/interview phases:
 *   - Interview → Ouroboros BigBang (stricter 0.2 ambiguity gate)
 *   - Seed → Immutable spec with acceptance criteria tree
 *   - Execute → Double Diamond decomposition (Discover→Define→Design→Deliver)
 *   - Evaluate → 3-stage verification (Mechanical→Semantic→Consensus)
 *   - Evolve → Convergence loop with drift detection
 *   - Unstuck → Lateral thinking (5 personas)
 *   - Ralph → Event-sourced persistent evolution loop
 *
 * Feature-flagged behind OUROBOROS_ENABLED (default: false).
 * When disabled, OmX falls back to its existing engines.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from './logger.js';
import { OUROBOROS_ENABLED, OMX_PAL_ENABLED } from './config.js';
import { palToOuroborosTier } from './omx-pal.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OuroborosInterviewResult {
  sessionId: string;
  question?: string;
  ambiguityScore?: number;
  isComplete: boolean;
  /** Populated when isComplete=true — feed into generate_seed */
  spec?: Record<string, unknown>;
}

export interface OuroborosSeedSpec {
  lineageId: string;
  seedContent: string;
  acceptanceCriteria: string[];
}

export interface OuroborosEvaluation {
  sessionId: string;
  score: number;
  verdict: 'pass' | 'revise' | 'fail';
  dimensions?: Record<string, number>;
  suggestions: string[];
  reasoning: string;
}

export interface OuroborosEvolveResult {
  lineageId: string;
  generation: number;
  verdict: 'pass' | 'revise' | 'fail';
  converged: boolean;
  output?: string;
  nextAction?: string;
}

export interface OuroborosJobRef {
  jobId: string;
}

export interface OuroborosJobResult {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  error?: string;
}

export interface OuroborosLateralThinkResult {
  persona: string;
  suggestion: string;
  alternatives: string[];
}

export interface OuroborosAcDashboard {
  lineageId: string;
  summary: string;
}

// ── MCP Bridge ────────────────────────────────────────────────────────────────

/** Connection state */
type BridgeState = 'disconnected' | 'connecting' | 'connected' | 'failed';

class OuroborosBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private state: BridgeState = 'disconnected';
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;
  private availableTools: string[] = [];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start the Ouroboros MCP server and establish connection */
  async connect(projectDir?: string): Promise<void> {
    if (!OUROBOROS_ENABLED) {
      logger.debug('Ouroboros: disabled via OUROBOROS_ENABLED=false');
      return;
    }

    if (this.state === 'connected') return;
    if (this.state === 'connecting') return;

    this.state = 'connecting';
    logger.info('Ouroboros: connecting to MCP server...');

    try {
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
      };
      if (projectDir) {
        env.OUROBOROS_PROJECT_DIR = projectDir;
      }
      // Ouroboros uses its own Anthropic key — pass through if set
      if (process.env.ANTHROPIC_API_KEY) {
        env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      }
      // Pass PAL config so Ouroboros can align model selection
      env.OUROBOROS_PAL_ENABLED = OMX_PAL_ENABLED ? 'true' : 'false';

      this.transport = new StdioClientTransport({
        command: 'uvx',
        args: ['--from', 'ouroboros-ai[mcp,claude]', 'ouroboros', 'mcp', 'serve'],
        env,
      });

      this.client = new Client(
        { name: 'nanoclaw-omx', version: '1.0.0' },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);
      this.state = 'connected';
      this.reconnectAttempts = 0;

      // Discover available tools
      const toolsResult = await this.client.listTools();
      this.availableTools = toolsResult.tools.map(t => t.name);
      logger.info(
        { toolCount: this.availableTools.length },
        `Ouroboros: connected — ${this.availableTools.length} tools available`,
      );
    } catch (err) {
      this.state = 'failed';
      this.reconnectAttempts++;
      logger.error(
        { err, attempt: this.reconnectAttempts },
        'Ouroboros: failed to connect to MCP server',
      );
      throw err;
    }
  }

  /** Disconnect and clean up the MCP server process */
  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch { /* best effort */ }
    }
    this.client = null;
    this.transport = null;
    this.state = 'disconnected';
    logger.info('Ouroboros: disconnected');
  }

  /** Reconnect if connection was lost */
  private async ensureConnected(): Promise<void> {
    if (this.state === 'connected' && this.client) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(
        `Ouroboros: max reconnect attempts (${this.maxReconnectAttempts}) exceeded — falling back to OmX`,
      );
    }
    await this.connect();
  }

  /** Check if bridge is available */
  isAvailable(): boolean {
    return OUROBOROS_ENABLED && this.state === 'connected';
  }

  /** Get list of discovered tools */
  getAvailableTools(): string[] {
    return [...this.availableTools];
  }

  // ── Generic Tool Call ─────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.ensureConnected();
    if (!this.client) throw new Error('Ouroboros: not connected');

    logger.debug({ tool: name, args: Object.keys(args) }, `Ouroboros: calling ${name}`);

    const result = await this.client.callTool({ name, arguments: args });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (result.content ?? []) as Array<Record<string, any>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (result as any).meta ?? {};

    if (result.isError) {
      const errorText = content
        .filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('\n') || 'Unknown error';
      throw new Error(`Ouroboros ${name} failed: ${errorText}`);
    }

    // Extract text content
    const textContent = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n') || '';

    // Try to parse as JSON, fall back to raw text
    try {
      return JSON.parse(textContent);
    } catch {
      return { raw: textContent, meta };
    }
  }

  // ── Interview (BigBang) ───────────────────────────────────────────────────

  /** Start a new Ouroboros interview session */
  async interviewStart(
    userRequest: string,
    cwd?: string,
  ): Promise<OuroborosInterviewResult> {
    const result = await this.callTool('ouroboros_interview', {
      initial_context: userRequest,
      ...(cwd && { cwd }),
    });
    return {
      sessionId: result.meta?.session_id || result.session_id || '',
      question: result.raw || result.question,
      ambiguityScore: result.meta?.ambiguity_score ?? result.ambiguity_score,
      isComplete: result.meta?.is_complete ?? result.is_complete ?? false,
    };
  }

  /** Continue an interview with a user answer */
  async interviewAnswer(
    sessionId: string,
    answer: string,
  ): Promise<OuroborosInterviewResult> {
    const result = await this.callTool('ouroboros_interview', {
      session_id: sessionId,
      answer,
    });
    return {
      sessionId,
      question: result.raw || result.question,
      ambiguityScore: result.meta?.ambiguity_score ?? result.ambiguity_score,
      isComplete: result.meta?.is_complete ?? result.is_complete ?? false,
    };
  }

  // ── Seed Spec ─────────────────────────────────────────────────────────────

  /** Generate an immutable seed spec from a completed interview */
  async generateSeed(sessionId: string): Promise<OuroborosSeedSpec> {
    const result = await this.callTool('ouroboros_generate_seed', {
      session_id: sessionId,
    });
    const seedContent = result.raw || result.seed_content || '';
    // Extract acceptance criteria from seed YAML
    const acMatches = seedContent.match(/acceptance_criteria:[\s\S]*?(?=\n\w|\n---|\Z)/);
    const criteria: string[] = [];
    if (acMatches) {
      const lines = acMatches[0].split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*-\s+(.+)/);
        if (m) criteria.push(m[1].trim());
      }
    }
    return {
      lineageId: result.meta?.lineage_id || result.lineage_id || sessionId,
      seedContent,
      acceptanceCriteria: criteria,
    };
  }

  // ── Execution (Double Diamond) ────────────────────────────────────────────

  /** Plan execution via Double Diamond (plan only, don't execute) */
  async plan(lineageId: string, seedContent: string): Promise<OuroborosEvolveResult> {
    const result = await this.callTool('ouroboros_evolve_step', {
      lineage_id: lineageId,
      seed_content: seedContent,
      execute: false,
    });
    return {
      lineageId,
      generation: result.meta?.generation ?? result.generation ?? 1,
      verdict: result.meta?.verdict ?? result.verdict ?? 'revise',
      converged: result.meta?.converged ?? result.converged ?? false,
      output: result.raw || result.output,
    };
  }

  /** Start background execution of a seed */
  async startExecution(
    seedContent: string,
    opts?: {
      cwd?: string;
      modelTier?: 'small' | 'medium' | 'large';
      maxIterations?: number;
    },
  ): Promise<OuroborosJobRef> {
    const result = await this.callTool('ouroboros_start_execute_seed', {
      seed_content: seedContent,
      ...(opts?.cwd && { cwd: opts.cwd }),
      ...(opts?.modelTier && { model_tier: opts.modelTier }),
      ...(opts?.maxIterations && { max_iterations: opts.maxIterations }),
    });
    return { jobId: result.meta?.job_id || result.job_id || '' };
  }

  // ── Evolution ─────────────────────────────────────────────────────────────

  /** Run one generation of the evolutionary loop */
  async evolveStep(
    lineageId: string,
    opts?: {
      seedContent?: string;
      execute?: boolean;
      projectDir?: string;
      modelTier?: 'small' | 'medium' | 'large';
    },
  ): Promise<OuroborosEvolveResult> {
    const result = await this.callTool('ouroboros_evolve_step', {
      lineage_id: lineageId,
      ...(opts?.seedContent && { seed_content: opts.seedContent }),
      execute: opts?.execute ?? true,
      ...(opts?.projectDir && { project_dir: opts.projectDir }),
      ...(opts?.modelTier && { model_tier: opts.modelTier }),
    });
    return {
      lineageId,
      generation: result.meta?.generation ?? result.generation ?? 0,
      verdict: result.meta?.verdict ?? result.verdict ?? 'revise',
      converged: result.meta?.converged ?? result.converged ?? false,
      output: result.raw || result.output,
      nextAction: result.meta?.next_action ?? result.next_action,
    };
  }

  /** Start background evolve step */
  async startEvolveStep(
    lineageId: string,
    seedContent: string,
    opts?: { execute?: boolean; projectDir?: string; modelTier?: 'small' | 'medium' | 'large' },
  ): Promise<OuroborosJobRef> {
    const result = await this.callTool('ouroboros_start_evolve_step', {
      lineage_id: lineageId,
      seed_content: seedContent,
      execute: opts?.execute ?? true,
      ...(opts?.projectDir && { project_dir: opts.projectDir }),
      ...(opts?.modelTier && { model_tier: opts.modelTier }),
    });
    return { jobId: result.meta?.job_id || result.job_id || '' };
  }

  /** Get lineage status */
  async lineageStatus(lineageId: string): Promise<Record<string, unknown>> {
    return this.callTool('ouroboros_lineage_status', { lineage_id: lineageId });
  }

  /** Rewind lineage to a specific generation */
  async evolveRewind(lineageId: string, toGeneration: number): Promise<void> {
    await this.callTool('ouroboros_evolve_rewind', {
      lineage_id: lineageId,
      to_generation: toGeneration,
    });
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  /** 3-stage evaluation pipeline */
  async evaluate(
    sessionId: string,
    artifact: string,
    opts?: {
      seedContent?: string;
      acceptanceCriteria?: string[];
      artifactType?: 'code' | 'docs' | 'config';
      triggerConsensus?: boolean;
      workingDir?: string;
    },
  ): Promise<OuroborosEvaluation> {
    const result = await this.callTool('ouroboros_evaluate', {
      session_id: sessionId,
      artifact,
      ...(opts?.seedContent && { seed_content: opts.seedContent }),
      ...(opts?.acceptanceCriteria && { acceptance_criteria: opts.acceptanceCriteria }),
      ...(opts?.artifactType && { artifact_type: opts.artifactType }),
      ...(opts?.triggerConsensus && { trigger_consensus: opts.triggerConsensus }),
      ...(opts?.workingDir && { working_dir: opts.workingDir }),
    });
    return {
      sessionId,
      score: result.score ?? result.meta?.score ?? 0,
      verdict: result.verdict ?? result.meta?.verdict ?? 'fail',
      dimensions: result.dimensions,
      suggestions: result.suggestions || [],
      reasoning: result.reasoning || '',
    };
  }

  /** Checklist verification against acceptance criteria */
  async checklistVerify(
    sessionId: string,
    seedContent: string,
    artifact: string,
    opts?: { artifactType?: string; workingDir?: string },
  ): Promise<Record<string, unknown>> {
    return this.callTool('ouroboros_checklist_verify', {
      session_id: sessionId,
      seed_content: seedContent,
      artifact,
      ...(opts?.artifactType && { artifact_type: opts.artifactType }),
      ...(opts?.workingDir && { working_dir: opts.workingDir }),
    });
  }

  /** Measure drift from original seed */
  async measureDrift(
    sessionId: string,
    currentOutput: string,
    seedContent: string,
  ): Promise<Record<string, unknown>> {
    return this.callTool('ouroboros_measure_drift', {
      session_id: sessionId,
      current_output: currentOutput,
      seed_content: seedContent,
    });
  }

  // ── Lateral Thinking (Unstuck) ────────────────────────────────────────────

  /** Generate alternative approaches when stuck */
  async lateralThink(
    problemContext: string,
    currentApproach: string,
    opts?: {
      persona?: string;
      personas?: string[];
      failedAttempts?: string[];
    },
  ): Promise<OuroborosLateralThinkResult> {
    const result = await this.callTool('ouroboros_lateral_think', {
      problem_context: problemContext,
      current_approach: currentApproach,
      ...(opts?.persona && { persona: opts.persona }),
      ...(opts?.personas && { personas: opts.personas }),
      ...(opts?.failedAttempts && { failed_attempts: opts.failedAttempts }),
    });
    return {
      persona: result.persona || 'unknown',
      suggestion: result.raw || result.suggestion || '',
      alternatives: result.alternatives || [],
    };
  }

  // ── QA ────────────────────────────────────────────────────────────────────

  /** General-purpose QA verdict */
  async qa(
    artifact: string,
    qualityBar: string,
    opts?: {
      artifactType?: string;
      passThreshold?: number;
      seedContent?: string;
    },
  ): Promise<OuroborosEvaluation> {
    const result = await this.callTool('ouroboros_qa', {
      artifact,
      quality_bar: qualityBar,
      ...(opts?.artifactType && { artifact_type: opts.artifactType }),
      ...(opts?.passThreshold && { pass_threshold: opts.passThreshold }),
      ...(opts?.seedContent && { seed_content: opts.seedContent }),
    });
    return {
      sessionId: result.meta?.qa_session_id || '',
      score: result.score ?? 0,
      verdict: result.verdict ?? 'fail',
      suggestions: result.suggestions || [],
      reasoning: result.reasoning || '',
    };
  }

  // ── Job Management ────────────────────────────────────────────────────────

  /** Check status of a background job */
  async jobStatus(jobId: string): Promise<OuroborosJobResult> {
    const result = await this.callTool('ouroboros_job_status', { job_id: jobId });
    return {
      jobId,
      status: result.meta?.status ?? result.status ?? 'running',
      output: result.raw || result.output,
      error: result.error,
    };
  }

  /** Wait for a job state change */
  async jobWait(
    jobId: string,
    opts?: { cursor?: number; timeoutSeconds?: number },
  ): Promise<OuroborosJobResult> {
    const result = await this.callTool('ouroboros_job_wait', {
      job_id: jobId,
      ...(opts?.cursor != null && { cursor: opts.cursor }),
      ...(opts?.timeoutSeconds && { timeout_seconds: opts.timeoutSeconds }),
    });
    return {
      jobId,
      status: result.meta?.status ?? result.status ?? 'running',
      output: result.raw || result.output,
      error: result.error,
    };
  }

  /** Get final result of a completed job */
  async jobResult(jobId: string): Promise<OuroborosJobResult> {
    const result = await this.callTool('ouroboros_job_result', { job_id: jobId });
    return {
      jobId,
      status: result.meta?.status ?? result.status ?? 'completed',
      output: result.raw || result.output,
      error: result.error,
    };
  }

  /** Cancel a background job */
  async cancelJob(jobId: string): Promise<void> {
    await this.callTool('ouroboros_cancel_job', { job_id: jobId });
  }

  // ── AC Dashboard ──────────────────────────────────────────────────────────

  /** Get acceptance criteria dashboard for a lineage */
  async acDashboard(
    lineageId: string,
    mode?: 'summary' | 'full' | 'ac',
  ): Promise<OuroborosAcDashboard> {
    const result = await this.callTool('ouroboros_ac_dashboard', {
      lineage_id: lineageId,
      ...(mode && { mode }),
    });
    return {
      lineageId,
      summary: result.raw || JSON.stringify(result),
    };
  }

  /** Get AC tree HUD for live progress */
  async acTreeHud(
    sessionId: string,
    opts?: { cursor?: number; maxNodes?: number },
  ): Promise<string> {
    const result = await this.callTool('ouroboros_ac_tree_hud', {
      session_id: sessionId,
      ...(opts?.cursor != null && { cursor: opts.cursor }),
      ...(opts?.maxNodes && { max_nodes: opts.maxNodes }),
    });
    return result.raw || JSON.stringify(result);
  }

  // ── Session & Event Queries ───────────────────────────────────────────────

  /** Get session status */
  async sessionStatus(sessionId: string): Promise<Record<string, unknown>> {
    return this.callTool('ouroboros_session_status', { session_id: sessionId });
  }

  /** Query event history */
  async queryEvents(
    opts?: { sessionId?: string; eventType?: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.callTool('ouroboros_query_events', {
      ...(opts?.sessionId && { session_id: opts.sessionId }),
      ...(opts?.eventType && { event_type: opts.eventType }),
      ...(opts?.limit && { limit: opts.limit }),
    });
  }

  // ── Ralph Mode ────────────────────────────────────────────────────────────

  /**
   * Run the Ralph evolutionary loop: seed → execute → evaluate → evolve → repeat.
   * Polls until convergence, max iterations, or failure.
   *
   * @param seedContent - Seed YAML content
   * @param maxIterations - Max generations (default 10)
   * @param onProgress - Callback for progress updates
   * @returns Final evolve result
   */
  async ralph(
    seedContent: string,
    maxIterations = 10,
    onProgress?: (gen: number, verdict: string) => void,
    opts?: { projectDir?: string },
  ): Promise<OuroborosEvolveResult> {
    // Gen 1: provide seed content
    const lineageId = `ralph-${Date.now()}`;
    let result = await this.evolveStep(lineageId, {
      seedContent,
      execute: true,
      projectDir: opts?.projectDir,
    });
    onProgress?.(result.generation, result.verdict);

    if (result.converged || result.verdict === 'pass') return result;

    // Gen 2+: continue lineage (state reconstructed from events)
    for (let i = 1; i < maxIterations; i++) {
      result = await this.evolveStep(lineageId, {
        execute: true,
        projectDir: opts?.projectDir,
      });
      onProgress?.(result.generation, result.verdict);

      if (result.converged || result.verdict === 'pass') return result;
    }

    // Max iterations reached
    logger.warn(
      { lineageId, maxIterations },
      'Ouroboros Ralph: max iterations reached without convergence',
    );
    return result;
  }

  /**
   * Start Ralph in background (non-blocking). Returns job ref for polling.
   */
  async startRalph(
    seedContent: string,
    opts?: { projectDir?: string },
  ): Promise<OuroborosJobRef> {
    const lineageId = `ralph-${Date.now()}`;
    return this.startEvolveStep(lineageId, seedContent, {
      execute: true,
      projectDir: opts?.projectDir,
    });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const ouroboros = new OuroborosBridge();

// ── Helper: Poll a background job until terminal state ────────────────────────

export async function pollOuroborosJob(
  jobId: string,
  timeoutMs = 120_000,
  onPoll?: (status: string) => void,
): Promise<OuroborosJobResult> {
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;

  while (Date.now() < deadline) {
    const result = await ouroboros.jobWait(jobId, {
      cursor,
      timeoutSeconds: Math.min(30, Math.floor((deadline - Date.now()) / 1000)),
    });

    onPoll?.(result.status);

    if (result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
      return result;
    }

    // Advance cursor if available in meta
    cursor++;
  }

  throw new Error(`Ouroboros job ${jobId} timed out after ${timeoutMs}ms`);
}

// ── PAL ↔ Ouroboros Model Tier Mapping ────────────────────────────────────────

/**
 * Map OmX PAL tier (haiku/sonnet/opus) to Ouroboros model_tier (small/medium/large).
 * Delegates to the centralized palToOuroborosTier in omx-pal.ts.
 * Kept as re-export for backward compatibility with supervisor imports.
 */
export { palToOuroborosTier as palTierToOuroboros } from './omx-pal.js';

// ── Double Diamond → OmX Workflow Conversion ─────────────────────────────────

/**
 * Mapping from Double Diamond phases to OmX specialist types.
 *
 * Discover → research (explore the problem space)
 * Define   → dev (architecture/design decisions)
 * Design   → dev (implementation)
 * Deliver  → gate + commit (test, verify, push)
 */
interface DoubleDiamondStep {
  phase: 'discover' | 'define' | 'design' | 'deliver';
  title: string;
  description: string;
  dependsOn?: number;
}

/**
 * Parse Ouroboros Double Diamond plan output into structured steps.
 *
 * Ouroboros plan output is free-form markdown. We parse it by looking for:
 *   - Headed sections like "## Discover:", "## Define:", etc.
 *   - Numbered sub-steps within each phase
 *   - Fallback: if no Diamond structure is found, treat the whole output as
 *     a single Design phase and wrap it in standard OmX steps
 */
export function parseDoubleDiamondPlan(planOutput: string): DoubleDiamondStep[] {
  const steps: DoubleDiamondStep[] = [];

  // Try to find explicit Diamond phase headers
  const phasePattern = /^#+\s*(discover|define|design|deliver)\b[:\s\u2014\u2013-]*(.*)/gim;
  const phaseMatches: Array<{
    phase: DoubleDiamondStep['phase'];
    title: string;
    index: number;
  }> = [];

  let m;
  while ((m = phasePattern.exec(planOutput)) !== null) {
    phaseMatches.push({
      phase: m[1].toLowerCase() as DoubleDiamondStep['phase'],
      title: m[2]?.trim() || m[1],
      index: m.index,
    });
  }

  if (phaseMatches.length >= 2) {
    // Structured Diamond output — extract sub-steps from each phase section
    for (let i = 0; i < phaseMatches.length; i++) {
      const start = phaseMatches[i].index;
      const end = i + 1 < phaseMatches.length ? phaseMatches[i + 1].index : planOutput.length;
      const sectionBody = planOutput.slice(start, end);

      // Look for numbered items or bullet items within the section
      const itemPattern = /^\s*(?:\d+[\.\)]\s*|-\s+\*?\*?)(.+)/gm;
      const items: string[] = [];
      let itemMatch;
      while ((itemMatch = itemPattern.exec(sectionBody)) !== null) {
        const text = itemMatch[1].replace(/\*+/g, '').trim();
        if (text.length > 5) items.push(text);
      }

      if (items.length > 0) {
        for (const item of items) {
          steps.push({
            phase: phaseMatches[i].phase,
            title: item.slice(0, 100),
            description: item,
          });
        }
      } else {
        // No sub-items — treat the whole section as one step
        steps.push({
          phase: phaseMatches[i].phase,
          title: phaseMatches[i].title.slice(0, 100) || `${phaseMatches[i].phase} phase`,
          description: sectionBody.slice(0, 2000),
        });
      }
    }
  } else {
    // Unstructured output — parse numbered steps or bullet points
    const linePattern = /^\s*(?:\d+[\.\)]\s*|-\s+\*?\*?)(.+)/gm;
    let lineMatch;
    while ((lineMatch = linePattern.exec(planOutput)) !== null) {
      const text = lineMatch[1].replace(/\*+/g, '').trim();
      if (text.length > 5) {
        steps.push({
          phase: 'design',
          title: text.slice(0, 100),
          description: text,
        });
      }
    }

    // If still nothing, wrap the whole thing as a single design step
    if (steps.length === 0) {
      steps.push({
        phase: 'design',
        title: 'Execute plan',
        description: planOutput.slice(0, 2000),
      });
    }
  }

  // Assign dependency chain: each Deliver step depends on the last Design step
  // Each Define step depends on the last Discover step, etc.
  const phaseOrder: DoubleDiamondStep['phase'][] = ['discover', 'define', 'design', 'deliver'];
  let lastStepByPhase: Record<string, number> = {};
  for (let i = 0; i < steps.length; i++) {
    const stepNum = i + 1;
    const phase = steps[i].phase;
    const phaseIdx = phaseOrder.indexOf(phase);

    // Depend on the last step of the previous phase
    if (phaseIdx > 0) {
      const prevPhase = phaseOrder[phaseIdx - 1];
      if (lastStepByPhase[prevPhase]) {
        steps[i].dependsOn = lastStepByPhase[prevPhase];
      }
    }

    lastStepByPhase[phase] = stepNum;
  }

  return steps;
}

/** Map a Double Diamond phase to the appropriate OmX specialist type + model */
function phaseToAnnotations(phase: DoubleDiamondStep['phase']): string {
  switch (phase) {
    case 'discover':
      return '[specialist:research]';
    case 'define':
      return '[specialist:dev, model:sonnet]';
    case 'design':
      return '[specialist:dev, model:sonnet]';
    case 'deliver':
      return '[specialist:gate, gate:full]';
  }
}

/**
 * Convert parsed Double Diamond steps into OmX workflow markdown.
 *
 * Output format matches what `parseOmxWorkflowSteps()` expects:
 *
 * ```markdown
 * # OmX: Task Description
 *
 * ## Step 1: Research requirements [specialist:research]
 * Discover what's needed.
 * OUTPUT: findings summary
 *
 * ## Step 2: Design architecture [specialist:dev, model:sonnet, depends:1]
 * ...
 * ```
 */
export function convertDoubleDiamondToWorkflow(
  taskDescription: string,
  ddSteps: DoubleDiamondStep[],
  seedAcceptanceCriteria: string[],
): string {
  const lines: string[] = [
    `# OmX: ${taskDescription}`,
    ``,
    `_Generated from Ouroboros Double Diamond plan._`,
    ``,
  ];

  // If we only got design steps (unstructured plan), add a review + commit step
  const hasDiscover = ddSteps.some(s => s.phase === 'discover');
  const hasDeliver = ddSteps.some(s => s.phase === 'deliver');

  for (let i = 0; i < ddSteps.length; i++) {
    const step = ddSteps[i];
    const stepNum = i + 1;
    const annotations = phaseToAnnotations(step.phase);
    const depsSuffix = step.dependsOn ? `, depends:${step.dependsOn}` : '';

    // Insert depends into annotation bracket
    const annotationStr = annotations.replace(']', `${depsSuffix}]`);

    lines.push(`## Step ${stepNum}: ${step.title} ${annotationStr}`);
    lines.push(step.description);
    lines.push(`OUTPUT: ${step.phase} phase deliverable`);
    lines.push(``);
  }

  // If the plan didn't include a Deliver phase, append review + commit steps
  if (!hasDeliver && ddSteps.length > 0) {
    const lastStepNum = ddSteps.length;

    // Review step
    const reviewNum = lastStepNum + 1;
    lines.push(`## Step ${reviewNum}: Adversarial review [specialist:review, depends:${lastStepNum}]`);
    lines.push(`Review all changes for correctness, security, and adherence to acceptance criteria.`);
    if (seedAcceptanceCriteria.length > 0) {
      lines.push(`ACCEPTANCE CRITERIA:`);
      for (const ac of seedAcceptanceCriteria) {
        lines.push(`- [ ] ${ac}`);
      }
    }
    lines.push(`ACCEPTANCE: PASS or PASS WITH CONCERNS.`);
    lines.push(``);

    // Gate step
    const gateNum = reviewNum + 1;
    lines.push(`## Step ${gateNum}: Test gate [specialist:gate, gate:full, depends:${reviewNum}]`);
    lines.push(`Run full test suite to verify changes.`);
    lines.push(`ACCEPTANCE: All tests green.`);
    lines.push(``);

    // Commit step
    const commitNum = gateNum + 1;
    lines.push(`## Step ${commitNum}: Commit [specialist:commit, depends:${gateNum}]`);
    lines.push(`Commit and push changes.`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Full Double Diamond flow: seed → plan → parse → convert → OmX workflow markdown.
 *
 * This is the high-level function called by the supervisor to replace RALPLAN.
 * Returns the workflow markdown ready for `createOmxWorkflow()`.
 */
export async function planAndConvert(
  bridge: OuroborosBridge,
  seedSpec: OuroborosSeedSpec,
  taskDescription: string,
): Promise<{ workflowMarkdown: string; rawPlanOutput: string; ddSteps: DoubleDiamondStep[] }> {
  // Call Ouroboros to generate the Double Diamond plan (plan only, no execution)
  const plan = await bridge.plan(seedSpec.lineageId, seedSpec.seedContent);
  const rawPlanOutput = plan.output || '';

  // Parse into structured phases
  const ddSteps = parseDoubleDiamondPlan(rawPlanOutput);

  // Convert to OmX workflow markdown
  const workflowMarkdown = convertDoubleDiamondToWorkflow(
    taskDescription,
    ddSteps,
    seedSpec.acceptanceCriteria,
  );

  return { workflowMarkdown, rawPlanOutput, ddSteps };
}
