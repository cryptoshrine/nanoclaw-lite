/**
 * ErrorRecoveryMiddleware — clears failed sessions to prevent retry loops.
 * Extracted from runAgent() lines 331-358 in index.ts.
 */

import { logger } from '../logger.js';

import { MiddlewareServices } from './services.js';
import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export function createErrorRecoveryMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'ErrorRecoveryMiddleware',

    async after(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
      if (result.error) {
        const errorMsg = result.error.toLowerCase();

        // Don't nuke the session for dangling tool call errors —
        // the agent-runner handles these with targeted recovery.
        const isDangling = ['tool_use', 'tool_result', 'malformed', 'incomplete', 'dangling']
          .some(p => errorMsg.includes(p));

        if (isDangling) {
          logger.warn(
            { group: ctx.group.name, error: result.error },
            'Dangling tool call error — preserving session for agent-runner recovery',
          );
          return { ...result, response: null };
        }

        logger.error(
          { group: ctx.group.name, error: result.error },
          'Agent error detected',
        );

        const sessions = services.getSessions();
        if (sessions[ctx.group.folder]) {
          logger.info(
            { group: ctx.group.name, sessionId: sessions[ctx.group.folder] },
            'Clearing failed session to prevent retry loop',
          );
          services.clearSession(ctx.group.folder);
          services.saveSessions();
        }

        // Nullify response on error (matches original behavior)
        return { ...result, response: null };
      }

      return result;
    },

    async onError(ctx: MiddlewareContext, error: Error): Promise<void> {
      logger.error({ group: ctx.group.name, err: error }, 'Pipeline error — clearing session');
      const sessions = services.getSessions();
      if (sessions[ctx.group.folder]) {
        services.clearSession(ctx.group.folder);
        services.saveSessions();
      }
    },
  };
}
