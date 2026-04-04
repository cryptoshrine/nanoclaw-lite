import { describe, it, expect, beforeEach } from 'vitest';
import { claimStep, transitionStep, reclaimExpiredSteps } from './omx-claim.js';
import type { OmxWorkflow, OmxStep } from './omx-supervisor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<OmxStep> = {}): OmxStep {
  return {
    number: 1,
    title: 'Test step',
    content: 'Do something',
    status: 'pending',
    annotations: { specialist: 'dev' as any },
    retryCount: 0,
    ...overrides,
  };
}

function makeWorkflow(steps: OmxStep[]): OmxWorkflow {
  return {
    id: 'test-wf-1',
    taskDescription: 'Test workflow',
    groupFolder: 'main',
    chatJid: 'test@g.us',
    teamId: 'team-1',
    projectPath: '/tmp/project',
    status: 'active',
    steps,
    currentStepIndex: 0,
    phases: { execute: 'pending', gate: 'pending', push: 'pending', report: 'pending' },
    specialistsSpawned: 0,
    requiresApproval: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    context: '',
  } as OmxWorkflow;
}

function expiredLease(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function activeLease(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('omx-claim', () => {
  let workflow: OmxWorkflow;

  beforeEach(() => {
    workflow = makeWorkflow([makeStep({ number: 1 }), makeStep({ number: 2 })]);
  });

  describe('claimStep', () => {
    it('succeeds on unclaimed step and returns a token', () => {
      const token = claimStep(workflow, 0, 'specialist-A');
      expect(token).toBeTypeOf('string');
      expect(token).toHaveLength(36); // UUID format
      expect(workflow.steps[0].claim).toBeDefined();
      expect(workflow.steps[0].claim!.owner).toBe('specialist-A');
      expect(workflow.steps[0].claimToken).toBe(token);
    });

    it('fails if step already claimed by another owner with active lease', () => {
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'existing-token',
        leasedUntil: activeLease(),
      };

      const token = claimStep(workflow, 0, 'specialist-B');
      expect(token).toBeNull();
      // Original claim should be unchanged
      expect(workflow.steps[0].claim!.owner).toBe('specialist-A');
    });

    it('succeeds if previous claim is expired (reclaim)', () => {
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'old-token',
        leasedUntil: expiredLease(),
      };

      const token = claimStep(workflow, 0, 'specialist-B');
      expect(token).toBeTypeOf('string');
      expect(token).not.toBe('old-token');
      expect(workflow.steps[0].claim!.owner).toBe('specialist-B');
    });

    it('allows the same owner to re-claim their own step', () => {
      const token1 = claimStep(workflow, 0, 'specialist-A');
      const token2 = claimStep(workflow, 0, 'specialist-A');
      expect(token2).toBeTypeOf('string');
      expect(token2).not.toBe(token1);
    });

    it('returns null for invalid step index', () => {
      const token = claimStep(workflow, 99, 'specialist-A');
      expect(token).toBeNull();
    });

    it('increments version on each claim', () => {
      expect(workflow.steps[0].version).toBeUndefined();

      claimStep(workflow, 0, 'specialist-A');
      expect(workflow.steps[0].version).toBe(1);

      // Same owner re-claiming
      claimStep(workflow, 0, 'specialist-A');
      expect(workflow.steps[0].version).toBe(2);
    });
  });

  describe('transitionStep', () => {
    it('succeeds with valid token', () => {
      const token = claimStep(workflow, 0, 'specialist-A')!;
      const result = transitionStep(workflow, 0, token, 'completed');
      expect(result).toBe(true);
      expect(workflow.steps[0].status).toBe('completed');
    });

    it('fails with invalid token', () => {
      claimStep(workflow, 0, 'specialist-A');
      const result = transitionStep(workflow, 0, 'wrong-token', 'completed');
      expect(result).toBe(false);
      expect(workflow.steps[0].status).not.toBe('completed');
    });

    it('fails with expired lease', () => {
      const token = claimStep(workflow, 0, 'specialist-A')!;
      // Manually expire the lease
      workflow.steps[0].claim!.leasedUntil = expiredLease();

      const result = transitionStep(workflow, 0, token, 'completed');
      expect(result).toBe(false);
    });

    it('clears claim on terminal states (completed, failed, skipped)', () => {
      for (const status of ['completed', 'failed', 'skipped'] as const) {
        // Reset step for each iteration
        workflow.steps[0] = makeStep({ number: 1 });
        const token = claimStep(workflow, 0, 'specialist-A')!;
        transitionStep(workflow, 0, token, status);
        expect(workflow.steps[0].claim).toBeUndefined();
        expect(workflow.steps[0].claimToken).toBeUndefined();
      }
    });

    it('preserves claim on non-terminal states (in_progress)', () => {
      const token = claimStep(workflow, 0, 'specialist-A')!;
      transitionStep(workflow, 0, token, 'in_progress');
      expect(workflow.steps[0].claim).toBeDefined();
      expect(workflow.steps[0].claimToken).toBe(token);
    });

    it('increments version on transition', () => {
      const token = claimStep(workflow, 0, 'specialist-A')!;
      const versionAfterClaim = workflow.steps[0].version!;

      transitionStep(workflow, 0, token, 'in_progress');
      expect(workflow.steps[0].version).toBe(versionAfterClaim + 1);
    });

    it('returns false for invalid step index', () => {
      const result = transitionStep(workflow, 99, 'any-token', 'completed');
      expect(result).toBe(false);
    });

    it('returns false for step with no claim', () => {
      const result = transitionStep(workflow, 0, 'any-token', 'completed');
      expect(result).toBe(false);
    });
  });

  describe('reclaimExpiredSteps', () => {
    it('resets expired in_progress steps to pending', () => {
      workflow.steps[0].status = 'in_progress';
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'token-1',
        leasedUntil: expiredLease(),
      };
      workflow.steps[0].memberId = 'member-1';
      workflow.steps[0].codexJobId = 'codex-1';
      workflow.steps[0].executionMode = 'specialist';

      const reclaimed = reclaimExpiredSteps(workflow);
      expect(reclaimed).toBe(1);
      expect(workflow.steps[0].status).toBe('pending');
      expect(workflow.steps[0].claim).toBeUndefined();
      expect(workflow.steps[0].claimToken).toBeUndefined();
      expect(workflow.steps[0].memberId).toBeUndefined();
      expect(workflow.steps[0].codexJobId).toBeUndefined();
      expect(workflow.steps[0].executionMode).toBeUndefined();
    });

    it('does not touch steps with active leases', () => {
      workflow.steps[0].status = 'in_progress';
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'token-1',
        leasedUntil: activeLease(),
      };

      const reclaimed = reclaimExpiredSteps(workflow);
      expect(reclaimed).toBe(0);
      expect(workflow.steps[0].status).toBe('in_progress');
      expect(workflow.steps[0].claim).toBeDefined();
    });

    it('does not touch completed or pending steps even with expired claims', () => {
      workflow.steps[0].status = 'completed';
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'token-1',
        leasedUntil: expiredLease(),
      };

      workflow.steps[1].status = 'pending';

      const reclaimed = reclaimExpiredSteps(workflow);
      expect(reclaimed).toBe(0);
    });

    it('handles multiple expired steps', () => {
      for (const step of workflow.steps) {
        step.status = 'in_progress';
        step.claim = {
          owner: 'specialist-X',
          token: 'tok',
          leasedUntil: expiredLease(),
        };
      }

      const reclaimed = reclaimExpiredSteps(workflow);
      expect(reclaimed).toBe(2);
      expect(workflow.steps[0].status).toBe('pending');
      expect(workflow.steps[1].status).toBe('pending');
    });

    it('increments version when reclaiming', () => {
      workflow.steps[0].status = 'in_progress';
      workflow.steps[0].version = 3;
      workflow.steps[0].claim = {
        owner: 'specialist-A',
        token: 'token-1',
        leasedUntil: expiredLease(),
      };

      reclaimExpiredSteps(workflow);
      expect(workflow.steps[0].version).toBe(4);
    });

    it('returns 0 when no steps need reclaiming', () => {
      const reclaimed = reclaimExpiredSteps(workflow);
      expect(reclaimed).toBe(0);
    });
  });
});
