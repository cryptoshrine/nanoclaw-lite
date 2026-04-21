/**
 * OmX PAL Router — Progressive Autonomy Ladder
 *
 * 3-tier cost escalation: Haiku → Sonnet → Opus.
 * On first attempt, use the cheapest model (Haiku). On retry, escalate to Sonnet.
 * On second retry, escalate to Opus. Explicit model annotations always win.
 *
 * This module is pure (no side effects, no I/O) for easy testing.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** PAL escalation tiers in order of cost/capability */
export const PAL_LADDER = ['haiku', 'sonnet', 'opus'] as const;
export type PalTier = (typeof PAL_LADDER)[number];

/** Full Claude model IDs for each tier */
const PAL_MODEL_IDS: Record<PalTier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PalDecision {
  /** Full model ID to use */
  model: string;
  /** PAL tier index (0=haiku, 1=sonnet, 2=opus) */
  tier: number;
  /** Human-readable tier name */
  tierName: PalTier;
  /** Whether PAL actually made this decision (false if annotation overrode it) */
  palApplied: boolean;
}

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Resolve the model for a step based on PAL escalation rules.
 *
 * @param retryCount - Number of previous failed attempts (0 = first try)
 * @param annotationModel - Explicit model annotation from step header (e.g. 'opus')
 * @param palEnabled - Whether PAL is enabled globally
 * @param resolveModelFn - Optional model resolver (from omx-agents catalog)
 * @returns PAL decision with model ID, tier, and whether PAL was applied
 */
export function palResolve(
  retryCount: number,
  annotationModel: string | undefined,
  palEnabled: boolean,
  resolveModelFn?: (modelClass: string) => string,
): PalDecision {
  // Explicit annotation always wins — PAL skipped
  if (annotationModel) {
    const model = resolveModelFn
      ? resolveModelFn(annotationModel)
      : (PAL_MODEL_IDS[annotationModel as PalTier] ?? annotationModel);
    const tierIndex = PAL_LADDER.indexOf(annotationModel as PalTier);
    return {
      model,
      tier: tierIndex >= 0 ? tierIndex : -1,
      tierName: (tierIndex >= 0 ? PAL_LADDER[tierIndex] : annotationModel) as PalTier,
      palApplied: false,
    };
  }

  // PAL escalation
  if (palEnabled) {
    const tier = Math.min(retryCount, PAL_LADDER.length - 1);
    const tierName = PAL_LADDER[tier];
    const model = resolveModelFn
      ? resolveModelFn(tierName)
      : PAL_MODEL_IDS[tierName];
    return { model, tier, tierName, palApplied: true };
  }

  // PAL disabled — fallback to sonnet
  const model = resolveModelFn ? resolveModelFn('sonnet') : PAL_MODEL_IDS.sonnet;
  return { model, tier: 1, tierName: 'sonnet', palApplied: false };
}

/**
 * Get the tier name for a given retry count.
 */
export function palTierName(retryCount: number): PalTier {
  const tier = Math.min(retryCount, PAL_LADDER.length - 1);
  return PAL_LADDER[tier];
}

/**
 * Get the next tier name after a failure (for logging before retry increments).
 */
export function palNextTierName(currentRetryCount: number): PalTier {
  return palTierName(currentRetryCount + 1);
}

// ── Shared PAL State (cross-system escalation tracking) ──────────────────────

/**
 * Session-scoped PAL escalation state.
 *
 * Tracks escalation across both OmX specialist spawning and Ouroboros internal
 * calls so escalation in one system is visible to the other. Each OmX workflow
 * gets its own session — escalation doesn't leak between workflows.
 */
export interface PalSession {
  /** Workflow/session identifier */
  sessionId: string;
  /** Current PAL tier (0=haiku, 1=sonnet, 2=opus) */
  currentTier: number;
  /** Consecutive failure count (drives escalation) */
  consecutiveFailures: number;
  /** History of tier transitions: [timestamp, fromTier, toTier, reason] */
  escalationLog: Array<[string, number, number, string]>;
  /** Source of last escalation ('omx' | 'ouroboros' | 'ralph') */
  lastEscalationSource?: string;
}

/** In-memory store of active PAL sessions keyed by workflow/session ID */
const palSessions = new Map<string, PalSession>();

/**
 * Get or create a PAL session for a workflow.
 */
export function getPalSession(sessionId: string): PalSession {
  let session = palSessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      currentTier: 0,
      consecutiveFailures: 0,
      escalationLog: [],
    };
    palSessions.set(sessionId, session);
  }
  return session;
}

/**
 * Record a failure and potentially escalate the PAL tier.
 * Returns true if escalation occurred.
 */
export function palRecordFailure(
  sessionId: string,
  source: string,
  threshold = 2,
): boolean {
  const session = getPalSession(sessionId);
  session.consecutiveFailures++;

  if (session.consecutiveFailures >= threshold && session.currentTier < PAL_LADDER.length - 1) {
    const oldTier = session.currentTier;
    session.currentTier++;
    session.lastEscalationSource = source;
    session.escalationLog.push([
      new Date().toISOString(),
      oldTier,
      session.currentTier,
      `${source}: ${session.consecutiveFailures} consecutive failures`,
    ]);
    return true;
  }
  return false;
}

/**
 * Record a success — reset consecutive failure count (tier stays).
 */
export function palRecordSuccess(sessionId: string): void {
  const session = getPalSession(sessionId);
  session.consecutiveFailures = 0;
}

/**
 * Get the Ouroboros model_tier string for the current PAL tier.
 */
export function palToOuroborosTier(palTierIndex: number): 'small' | 'medium' | 'large' {
  switch (palTierIndex) {
    case 0: return 'small';   // haiku → small
    case 1: return 'medium';  // sonnet → medium
    case 2: return 'large';   // opus → large
    default: return 'medium';
  }
}

/**
 * Clean up a PAL session when a workflow completes or is abandoned.
 */
export function palCleanupSession(sessionId: string): void {
  palSessions.delete(sessionId);
}

/**
 * Get all active PAL sessions (for diagnostics).
 */
export function palListSessions(): PalSession[] {
  return [...palSessions.values()];
}
