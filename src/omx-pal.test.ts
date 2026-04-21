import { describe, it, expect, beforeEach } from 'vitest';
import {
  palResolve, palTierName, palNextTierName, PAL_LADDER,
  getPalSession, palRecordFailure, palRecordSuccess, palToOuroborosTier,
  palCleanupSession, palListSessions,
} from './omx-pal.js';

// ── palResolve ──────────────────────────────────────────────────────────────

describe('palResolve', () => {
  describe('PAL enabled, no annotation', () => {
    it('returns haiku on first attempt (retryCount=0)', () => {
      const d = palResolve(0, undefined, true);
      expect(d.model).toBe('claude-haiku-4-5-20251001');
      expect(d.tier).toBe(0);
      expect(d.tierName).toBe('haiku');
      expect(d.palApplied).toBe(true);
    });

    it('returns sonnet on first retry (retryCount=1)', () => {
      const d = palResolve(1, undefined, true);
      expect(d.model).toBe('claude-sonnet-4-6');
      expect(d.tier).toBe(1);
      expect(d.tierName).toBe('sonnet');
      expect(d.palApplied).toBe(true);
    });

    it('returns opus on second retry (retryCount=2)', () => {
      const d = palResolve(2, undefined, true);
      expect(d.model).toBe('claude-opus-4-7');
      expect(d.tier).toBe(2);
      expect(d.tierName).toBe('opus');
      expect(d.palApplied).toBe(true);
    });

    it('caps at opus for retryCount > 2', () => {
      const d = palResolve(5, undefined, true);
      expect(d.model).toBe('claude-opus-4-7');
      expect(d.tier).toBe(2);
      expect(d.tierName).toBe('opus');
      expect(d.palApplied).toBe(true);
    });
  });

  describe('annotation override', () => {
    it('uses annotation model regardless of retryCount', () => {
      const d = palResolve(0, 'opus', true);
      expect(d.model).toBe('claude-opus-4-7');
      expect(d.palApplied).toBe(false);
    });

    it('haiku annotation on retry still returns haiku', () => {
      const d = palResolve(2, 'haiku', true);
      expect(d.model).toBe('claude-haiku-4-5-20251001');
      expect(d.palApplied).toBe(false);
    });

    it('passes unknown annotation through as model ID', () => {
      const d = palResolve(0, 'claude-custom-model', true);
      expect(d.model).toBe('claude-custom-model');
      expect(d.tier).toBe(-1);
      expect(d.palApplied).toBe(false);
    });
  });

  describe('PAL disabled', () => {
    it('falls back to sonnet regardless of retryCount', () => {
      const d0 = palResolve(0, undefined, false);
      expect(d0.model).toBe('claude-sonnet-4-6');
      expect(d0.palApplied).toBe(false);

      const d2 = palResolve(2, undefined, false);
      expect(d2.model).toBe('claude-sonnet-4-6');
      expect(d2.palApplied).toBe(false);
    });

    it('annotation still works when PAL disabled', () => {
      const d = palResolve(0, 'opus', false);
      expect(d.model).toBe('claude-opus-4-7');
      expect(d.palApplied).toBe(false);
    });
  });

  describe('with custom resolveModelFn', () => {
    const customResolver = (cls: string) => `custom-${cls}-v99`;

    it('PAL uses custom resolver', () => {
      const d = palResolve(0, undefined, true, customResolver);
      expect(d.model).toBe('custom-haiku-v99');
      expect(d.palApplied).toBe(true);
    });

    it('annotation uses custom resolver', () => {
      const d = palResolve(0, 'sonnet', true, customResolver);
      expect(d.model).toBe('custom-sonnet-v99');
      expect(d.palApplied).toBe(false);
    });

    it('PAL disabled uses custom resolver for sonnet fallback', () => {
      const d = palResolve(0, undefined, false, customResolver);
      expect(d.model).toBe('custom-sonnet-v99');
      expect(d.palApplied).toBe(false);
    });
  });
});

// ── palTierName ─────────────────────────────────────────────────────────────

describe('palTierName', () => {
  it('maps retry counts to tier names', () => {
    expect(palTierName(0)).toBe('haiku');
    expect(palTierName(1)).toBe('sonnet');
    expect(palTierName(2)).toBe('opus');
  });

  it('caps at opus for high retry counts', () => {
    expect(palTierName(10)).toBe('opus');
  });
});

// ── palNextTierName ─────────────────────────────────────────────────────────

describe('palNextTierName', () => {
  it('returns the next tier after current retry count', () => {
    expect(palNextTierName(0)).toBe('sonnet');  // after first failure → retry 1 = sonnet
    expect(palNextTierName(1)).toBe('opus');     // after second failure → retry 2 = opus
  });

  it('caps at opus', () => {
    expect(palNextTierName(2)).toBe('opus');
    expect(palNextTierName(5)).toBe('opus');
  });
});

// ── PAL_LADDER ──────────────────────────────────────────────────────────────

describe('PAL_LADDER', () => {
  it('has exactly 3 tiers', () => {
    expect(PAL_LADDER).toHaveLength(3);
  });

  it('is ordered haiku → sonnet → opus', () => {
    expect(PAL_LADDER[0]).toBe('haiku');
    expect(PAL_LADDER[1]).toBe('sonnet');
    expect(PAL_LADDER[2]).toBe('opus');
  });
});

// ── PalSession (shared escalation state) ──────────────────────────────────

describe('PalSession', () => {
  const testId = `test-session-${Date.now()}`;

  // Clean up after each test to avoid leaking state
  beforeEach(() => {
    palCleanupSession(testId);
  });

  describe('getPalSession', () => {
    it('creates a new session with tier 0 and 0 failures', () => {
      const session = getPalSession(testId);
      expect(session.sessionId).toBe(testId);
      expect(session.currentTier).toBe(0);
      expect(session.consecutiveFailures).toBe(0);
      expect(session.escalationLog).toHaveLength(0);
    });

    it('returns the same session on repeated calls', () => {
      const s1 = getPalSession(testId);
      s1.consecutiveFailures = 99;
      const s2 = getPalSession(testId);
      expect(s2.consecutiveFailures).toBe(99);
    });
  });

  describe('palRecordFailure', () => {
    it('increments failure count', () => {
      palRecordFailure(testId, 'omx');
      const session = getPalSession(testId);
      expect(session.consecutiveFailures).toBe(1);
    });

    it('escalates tier when threshold is met', () => {
      palRecordFailure(testId, 'omx', 2);
      palRecordFailure(testId, 'omx', 2);
      const session = getPalSession(testId);
      expect(session.currentTier).toBe(1); // escalated haiku → sonnet
      expect(session.escalationLog).toHaveLength(1);
      expect(session.lastEscalationSource).toBe('omx');
    });

    it('returns true when escalation occurs', () => {
      palRecordFailure(testId, 'test', 2);
      const escalated = palRecordFailure(testId, 'test', 2);
      expect(escalated).toBe(true);
    });

    it('returns false when no escalation', () => {
      const escalated = palRecordFailure(testId, 'test', 2);
      expect(escalated).toBe(false); // only 1 failure, threshold is 2
    });

    it('caps at max tier (opus)', () => {
      // Escalate to sonnet
      palRecordFailure(testId, 'test', 1);
      // Escalate to opus
      palRecordFailure(testId, 'test', 1);
      // Try to escalate beyond opus
      const result = palRecordFailure(testId, 'test', 1);
      const session = getPalSession(testId);
      expect(session.currentTier).toBe(2); // stuck at opus
      expect(result).toBe(false); // no escalation happened
    });
  });

  describe('palRecordSuccess', () => {
    it('resets consecutive failures to 0', () => {
      palRecordFailure(testId, 'test');
      palRecordFailure(testId, 'test');
      const session = getPalSession(testId);
      expect(session.consecutiveFailures).toBe(2);

      palRecordSuccess(testId);
      expect(session.consecutiveFailures).toBe(0);
    });

    it('does not change the current tier', () => {
      // Escalate to sonnet
      palRecordFailure(testId, 'test', 1);
      const session = getPalSession(testId);
      expect(session.currentTier).toBe(1);

      palRecordSuccess(testId);
      expect(session.currentTier).toBe(1); // tier stays
    });
  });

  describe('palCleanupSession', () => {
    it('removes the session', () => {
      getPalSession(testId); // create it
      palCleanupSession(testId);

      // Getting it again should create a fresh one
      const session = getPalSession(testId);
      expect(session.consecutiveFailures).toBe(0);
      expect(session.currentTier).toBe(0);
    });
  });

  describe('palListSessions', () => {
    it('includes active sessions', () => {
      const uniqueId = `list-test-${Date.now()}`;
      getPalSession(uniqueId);
      const sessions = palListSessions();
      expect(sessions.some(s => s.sessionId === uniqueId)).toBe(true);
      palCleanupSession(uniqueId);
    });
  });
});

// ── palToOuroborosTier ──────────────────────────────────────────────────────

describe('palToOuroborosTier', () => {
  it('maps haiku (0) to small', () => {
    expect(palToOuroborosTier(0)).toBe('small');
  });

  it('maps sonnet (1) to medium', () => {
    expect(palToOuroborosTier(1)).toBe('medium');
  });

  it('maps opus (2) to large', () => {
    expect(palToOuroborosTier(2)).toBe('large');
  });

  it('defaults to medium for unknown tier', () => {
    expect(palToOuroborosTier(99)).toBe('medium');
    expect(palToOuroborosTier(-1)).toBe('medium');
  });
});
