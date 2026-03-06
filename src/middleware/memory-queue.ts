/**
 * MemoryQueueMiddleware — queues completed conversations for async fact extraction.
 *
 * After hook: if the agent produced a response, enqueue the conversation
 * transcript for the FactExtractor to process in the background.
 */

import { logger } from '../logger.js';
import { FactExtractor } from '../memory/fact-extractor.js';

import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export function createMemoryQueueMiddleware(factExtractor: FactExtractor): Middleware {
  return {
    name: 'MemoryQueueMiddleware',

    async after(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
      // Only extract from successful sessions with actual responses
      if (!result.response || result.error) return result;

      // Build a lightweight transcript from the prompt + response
      // (The full SDK transcript is inside the child process — we don't have it here.
      //  But prompt + response captures the key information for fact extraction.)
      const transcript = `User:\n${ctx.prompt}\n\nAssistant:\n${result.response}`;

      try {
        factExtractor.enqueue(
          ctx.group.folder,
          transcript,
          result.newSessionId || ctx.sessionId,
        );
      } catch (err) {
        logger.warn({ group: ctx.group.name, err }, 'Failed to enqueue for fact extraction');
      }

      return result;
    },
  };
}
