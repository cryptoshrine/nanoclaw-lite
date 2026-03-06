/**
 * MemorySyncMiddleware — syncs memory index before agent invocation.
 * Extracted from runAgent() lines 303-307 in index.ts.
 */

import { logger } from '../logger.js';

import { MiddlewareServices } from './services.js';
import { Middleware, MiddlewareContext } from './types.js';

export function createMemorySyncMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'MemorySyncMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      try {
        await services.getMemoryManager().sync(ctx.group.folder);
      } catch (err) {
        logger.warn({ group: ctx.group.name, err }, 'Memory sync failed (non-fatal)');
      }
      return ctx;
    },
  };
}
