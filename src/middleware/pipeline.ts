/**
 * MiddlewarePipeline — ordered execution of middleware hooks around agent invocation.
 *
 * Before hooks run in registration order.
 * After hooks run in reverse order (like Express/Koa).
 * Error hooks run in reverse order for all previously-executed middlewares.
 */

import { logger } from '../logger.js';

import { isMiddlewareResult, Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export class MiddlewarePipeline {
  private middlewares: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  async execute(initialCtx: MiddlewareContext): Promise<MiddlewareResult> {
    let ctx = initialCtx;
    const executed: Middleware[] = [];

    // Run before hooks in order
    for (const mw of this.middlewares) {
      if (!mw.before) {
        executed.push(mw);
        continue;
      }

      try {
        const result = await mw.before(ctx);
        executed.push(mw);

        if (isMiddlewareResult(result)) {
          // Short-circuit: run after hooks for all executed middlewares, then return
          return await this.runAfterHooks(executed, ctx, result);
        }

        ctx = result;
      } catch (error) {
        await this.runErrorHooks(executed, ctx, error as Error);
        throw error;
      }
    }

    // If no middleware produced a result (misconfiguration — AgentMiddleware should always short-circuit)
    const fallback: MiddlewareResult = {
      response: null,
      error: 'No middleware produced a result — is AgentMiddleware in the pipeline?',
    };
    return await this.runAfterHooks(executed, ctx, fallback);
  }

  private async runAfterHooks(
    executed: Middleware[],
    ctx: MiddlewareContext,
    result: MiddlewareResult,
  ): Promise<MiddlewareResult> {
    let current = result;
    for (const mw of [...executed].reverse()) {
      if (!mw.after) continue;
      try {
        current = await mw.after(ctx, current);
      } catch (error) {
        logger.error({ middleware: mw.name, error }, 'Middleware after-hook error');
      }
    }
    return current;
  }

  private async runErrorHooks(
    executed: Middleware[],
    ctx: MiddlewareContext,
    error: Error,
  ): Promise<void> {
    for (const mw of [...executed].reverse()) {
      if (!mw.onError) continue;
      try {
        await mw.onError(ctx, error);
      } catch {
        // Swallow errors in error handlers
      }
    }
  }
}
