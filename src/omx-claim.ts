/**
 * OmX Pattern 1: Claim-Safe Task Lifecycle
 *
 * Prevents race conditions on step transitions using version tokens
 * and lease-based claims with 15-minute expiry.
 *
 * Single-process, no file locks needed — version bumps + lease expiry is sufficient.
 */

import crypto from 'crypto';
import { logger } from './logger.js';
import type { OmxStep, OmxWorkflow } from './omx-supervisor.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Lease duration in milliseconds (15 minutes) */
const LEASE_DURATION_MS = 15 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface StepClaim {
  owner: string;
  token: string;
  leasedUntil: string;
}

// ── Claim Functions ──────────────────────────────────────────────────────────

/**
 * Claim a step for execution. Sets a UUID token + 15min lease, bumps version.
 * Returns the claim token on success, or null if the step is already claimed
 * by another owner with an active lease.
 */
export function claimStep(
  workflow: OmxWorkflow,
  stepIndex: number,
  owner: string,
): string | null {
  const step = workflow.steps[stepIndex];
  if (!step) {
    logger.warn({ stepIndex }, 'claimStep: step not found');
    return null;
  }

  // If step already has an active (non-expired) claim by a different owner, reject
  if (step.claim && step.claim.owner !== owner) {
    const leaseEnd = new Date(step.claim.leasedUntil).getTime();
    if (Date.now() < leaseEnd) {
      logger.warn(
        { step: step.number, owner, existingOwner: step.claim.owner },
        'claimStep: step already claimed by another owner',
      );
      return null;
    }
    // Lease expired — allow reclaim
  }

  const token = crypto.randomUUID();
  const leasedUntil = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

  step.claim = { owner, token, leasedUntil };
  step.version = (step.version || 0) + 1;
  step.claimToken = token;

  logger.debug(
    { step: step.number, owner, version: step.version },
    'Step claimed',
  );

  return token;
}

/**
 * Transition a step to a new status. Validates the claim token and that the
 * lease hasn't expired. Bumps version on success.
 *
 * Returns true on success, false if validation fails.
 */
export function transitionStep(
  workflow: OmxWorkflow,
  stepIndex: number,
  token: string,
  newStatus: OmxStep['status'],
): boolean {
  const step = workflow.steps[stepIndex];
  if (!step) {
    logger.warn({ stepIndex }, 'transitionStep: step not found');
    return false;
  }

  // Validate claim token
  if (!step.claim || step.claim.token !== token) {
    logger.warn(
      { step: step.number, expectedToken: step.claim?.token, providedToken: token },
      'transitionStep: token mismatch',
    );
    return false;
  }

  // Validate lease not expired
  const leaseEnd = new Date(step.claim.leasedUntil).getTime();
  if (Date.now() > leaseEnd) {
    logger.warn(
      { step: step.number, leasedUntil: step.claim.leasedUntil },
      'transitionStep: lease expired',
    );
    return false;
  }

  // Apply transition
  step.status = newStatus;
  step.version = (step.version || 0) + 1;

  // Clear claim on terminal states
  if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'skipped') {
    step.claim = undefined;
    step.claimToken = undefined;
  }

  logger.debug(
    { step: step.number, newStatus, version: step.version },
    'Step transitioned',
  );

  return true;
}

/**
 * Scan all steps and reclaim any in_progress step whose lease has expired.
 * Resets them back to pending (clearing claim + memberId).
 *
 * Returns the number of steps reclaimed.
 */
export function reclaimExpiredSteps(workflow: OmxWorkflow): number {
  let reclaimed = 0;
  const now = Date.now();

  for (const step of workflow.steps) {
    if (step.status !== 'in_progress') continue;
    if (!step.claim) continue;

    const leaseEnd = new Date(step.claim.leasedUntil).getTime();
    if (now > leaseEnd) {
      logger.info(
        { step: step.number, owner: step.claim.owner, leasedUntil: step.claim.leasedUntil },
        'Reclaiming expired step',
      );

      step.status = 'pending';
      step.claim = undefined;
      step.claimToken = undefined;
      step.memberId = undefined;
      step.codexJobId = undefined;
      step.executionMode = undefined;
      step.version = (step.version || 0) + 1;
      reclaimed++;
    }
  }

  return reclaimed;
}
