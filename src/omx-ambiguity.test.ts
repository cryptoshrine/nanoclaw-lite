import { describe, it, expect } from 'vitest';
import {
  scoreStepClarity,
  scoreDimensions,
  isStepTooVague,
  isStepNeedsEnhancement,
  enhanceVagueStep,
} from './omx-ambiguity.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('omx-ambiguity', () => {
  describe('scoreStepClarity', () => {
    it('returns 1.0 for a perfectly clear step', () => {
      const step = `
        Modify src/auth/login.ts — update the validateCredentials function.
        ACCEPTANCE: All 12 tests passing, no type errors.
        OUTPUT: Test report showing 12 PASS results.
      `;
      const score = scoreStepClarity(step);
      expect(score).toBe(1.0);
    });

    it('returns 0.0 for "improve the code"', () => {
      const score = scoreStepClarity('improve the code');
      expect(score).toBe(0);
    });

    it('returns partial score for semi-specific steps', () => {
      // Has acceptance criteria and scope bounded, but no file paths, identifiers, or measurable output
      const step = 'Add error handling. Must handle all edge cases correctly.';
      const score = scoreStepClarity(step);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1.0);
    });

    it('gives 0.2 for file specificity alone', () => {
      const result = scoreDimensions('edit src/index.ts');
      expect(result.dimensions.fileSpecificity).toBe(0.2);
    });

    it('gives 0.2 for acceptance criteria alone', () => {
      const result = scoreDimensions('ACCEPTANCE: tests green');
      expect(result.dimensions.acceptanceCriteria).toBe(0.2);
    });

    it('gives 0.2 for identifier references alone', () => {
      const result = scoreDimensions('call the handleAuth function');
      // handleAuth is camelCase → matches IDENTIFIER_RE
      expect(result.dimensions.identifierReferences).toBe(0.2);
    });

    it('gives 0.2 for measurable output alone', () => {
      const result = scoreDimensions('OUTPUT: 5 tests passing');
      expect(result.dimensions.measurableOutput).toBe(0.2);
    });

    it('gives 0.2 for bounded scope by default', () => {
      const result = scoreDimensions('do the thing');
      expect(result.dimensions.scopeBounded).toBe(0.2);
    });

    it('removes scope bounded when vague verbs without specifics', () => {
      const result = scoreDimensions('improve and optimize everything');
      expect(result.dimensions.scopeBounded).toBe(0);
    });

    it('keeps scope bounded when vague verbs have specifics', () => {
      // "refactor" is vague, but "src/auth.ts" is a specific file path
      const result = scoreDimensions('refactor src/auth.ts');
      expect(result.dimensions.scopeBounded).toBe(0.2);
    });
  });

  describe('isStepTooVague', () => {
    it('returns true for score < 0.4', () => {
      expect(isStepTooVague(0)).toBe(true);
      expect(isStepTooVague(0.2)).toBe(true);
      expect(isStepTooVague(0.39)).toBe(true);
    });

    it('returns false for score >= 0.4', () => {
      expect(isStepTooVague(0.4)).toBe(false);
      expect(isStepTooVague(0.6)).toBe(false);
      expect(isStepTooVague(1.0)).toBe(false);
    });
  });

  describe('isStepNeedsEnhancement', () => {
    it('returns true for 0.4 <= score < 0.7', () => {
      expect(isStepNeedsEnhancement(0.4)).toBe(true);
      expect(isStepNeedsEnhancement(0.5)).toBe(true);
      expect(isStepNeedsEnhancement(0.6)).toBe(true);
    });

    it('returns false for score < 0.4', () => {
      expect(isStepNeedsEnhancement(0.2)).toBe(false);
      expect(isStepNeedsEnhancement(0.39)).toBe(false);
    });

    it('returns false for score >= 0.7', () => {
      expect(isStepNeedsEnhancement(0.7)).toBe(false);
      expect(isStepNeedsEnhancement(1.0)).toBe(false);
    });
  });

  describe('enhanceVagueStep', () => {
    it('prepends snapshot context to the step content', () => {
      const step = 'Fix the bug in auth';
      const snapshot = 'Recent changes: login.ts added session validation';
      const enhanced = enhanceVagueStep(step, snapshot);

      expect(enhanced).toContain('ENHANCED CONTEXT');
      expect(enhanced).toContain(snapshot);
      expect(enhanced).toContain(step);
      // Step content should come AFTER the context block
      const contextEnd = enhanced.indexOf('END ENHANCED CONTEXT');
      const stepStart = enhanced.indexOf(step);
      expect(stepStart).toBeGreaterThan(contextEnd);
    });

    it('truncates snapshot to 2KB when longer', () => {
      const step = 'Fix something';
      const longSnapshot = 'x'.repeat(5000);
      const enhanced = enhanceVagueStep(step, longSnapshot);

      // Should contain the last 2048 chars of the snapshot
      expect(enhanced).toContain('x'.repeat(2048));
      expect(enhanced).not.toContain('x'.repeat(2049));
    });

    it('does not modify already-clear steps (still prepends context)', () => {
      // enhanceVagueStep always prepends — the caller decides whether to call it
      // based on isStepNeedsEnhancement. Verify it works correctly either way.
      const clearStep = 'Modify src/auth.ts — update validateCredentials. ACCEPTANCE: 12 tests PASS.';
      const snapshot = 'context here';
      const enhanced = enhanceVagueStep(clearStep, snapshot);

      expect(enhanced).toContain(clearStep);
      expect(enhanced).toContain('ENHANCED CONTEXT');
    });
  });
});
