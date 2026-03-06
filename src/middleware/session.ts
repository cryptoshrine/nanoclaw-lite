/**
 * SessionResolveMiddleware — resolves session ID from store before agent invocation.
 * SessionPersistMiddleware — persists new session ID after agent invocation.
 * Extracted from runAgent() in index.ts.
 */

import { logger } from '../logger.js';

import { MiddlewareServices } from './services.js';
import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export function createSessionResolveMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'SessionResolveMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      const sessions = services.getSessions();
      ctx.sessionId = sessions[ctx.group.folder];
      return ctx;
    },
  };
}

export function createSessionPersistMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'SessionPersistMiddleware',

    async after(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
      if (result.sessionCleared) {
        logger.warn(
          { group: ctx.group.name, oldSessionId: ctx.sessionId },
          'Agent recovered from corrupt session by starting fresh',
        );
      }

      if (result.newSessionId) {
        services.setSession(ctx.group.folder, result.newSessionId);
        services.saveSessions();
      }

      return result;
    },
  };
}
