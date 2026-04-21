/**
 * Middleware system — composable pipeline for agent invocation.
 */

export { MiddlewarePipeline } from './pipeline.js';
export type { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';
export type { MiddlewareServices } from './services.js';

export { createMetricsMiddleware } from './metrics.js';
export { createSnapshotMiddleware } from './snapshot.js';
export { createMemorySyncMiddleware } from './memory-sync.js';
export { createPromptSanitizeMiddleware } from './prompt-sanitize.js';
export { createSessionResolveMiddleware, createSessionPersistMiddleware } from './session.js';
export { createAgentMiddleware } from './agent.js';
export { createErrorRecoveryMiddleware } from './error-recovery.js';
export { createMemoryQueueMiddleware } from './memory-queue.js';
export { createClarificationMiddleware } from './clarification.js';
export { createBackgroundReviewMiddleware } from './background-review.js';

import { FactExtractor } from '../memory/fact-extractor.js';

import { MiddlewarePipeline } from './pipeline.js';
import { MiddlewareServices } from './services.js';

import { createAgentMiddleware } from './agent.js';
import { createBackgroundReviewMiddleware } from './background-review.js';
import { createClarificationMiddleware } from './clarification.js';
import { createErrorRecoveryMiddleware } from './error-recovery.js';
import { createMemoryQueueMiddleware } from './memory-queue.js';
import { createMemorySyncMiddleware } from './memory-sync.js';
import { createMetricsMiddleware } from './metrics.js';
import { createPromptSanitizeMiddleware } from './prompt-sanitize.js';
import { createSessionPersistMiddleware, createSessionResolveMiddleware } from './session.js';
import { createSnapshotMiddleware } from './snapshot.js';

/**
 * Create the default middleware pipeline with all standard middlewares.
 *
 * Pipeline order:
 *   1. Metrics           — timing + logging
 *   2. Snapshot          — write task/group/fact snapshots to IPC
 *   3. MemorySync        — sync memory index
 *   4. PromptSanitize    — strip triggers, truncate uploads, remove base64
 *   5. Clarification     — catch empty/trivially incomplete prompts (DeerFlow Phase 2)
 *   6. SessionResolve    — resolve session ID from store
 *   7. Agent             — invoke the agent (short-circuits, triggers after hooks)
 *   8. MemoryQueue       — queue conversation for fact extraction (after hook)
 *   9. BackgroundReview  — post-session review agent (after hook, fire-and-forget)
 *  10. SessionPersist    — save new session ID (after hook)
 *  11. ErrorRecovery     — clear failed sessions (after hook)
 */
export function createDefaultPipeline(
  services: MiddlewareServices,
  factExtractor?: FactExtractor | null,
): MiddlewarePipeline {
  const pipeline = new MiddlewarePipeline()
    .use(createMetricsMiddleware())
    .use(createSnapshotMiddleware(services))
    .use(createMemorySyncMiddleware(services))
    .use(createPromptSanitizeMiddleware())
    .use(createClarificationMiddleware())
    .use(createSessionResolveMiddleware(services))
    .use(createAgentMiddleware(services));

  // Memory queue (after hook) — only if fact extraction is available
  if (factExtractor?.isAvailable) {
    pipeline.use(createMemoryQueueMiddleware(factExtractor));
  }

  // Background review (after hook) — Hermes-inspired post-session learning
  pipeline.use(createBackgroundReviewMiddleware(services));

  pipeline
    .use(createSessionPersistMiddleware(services))
    .use(createErrorRecoveryMiddleware(services));

  return pipeline;
}
