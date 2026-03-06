/**
 * AgentMiddleware — the core middleware that invokes the agent.
 * This always returns a MiddlewareResult (short-circuits the before chain).
 * Extracted from runAgent() lines 309-317 in index.ts.
 */

import { MiddlewareServices } from './services.js';
import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export function createAgentMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'AgentMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareResult> {
      const output = await services.runAgent(ctx.group, {
        prompt: ctx.prompt,
        sessionId: ctx.sessionId,
        groupFolder: ctx.group.folder,
        chatJid: ctx.chatJid,
        isMain: ctx.isMain,
        sourceChannel: ctx.sourceChannel,
      });

      return {
        response: output.result,
        newSessionId: output.newSessionId,
        sessionCleared: output.sessionCleared,
        error: output.status === 'error' ? output.error : undefined,
        rawOutput: output,
      };
    },
  };
}
