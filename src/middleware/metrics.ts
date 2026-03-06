/**
 * MetricsMiddleware — timing and logging for each agent session.
 */

import { logger } from '../logger.js';

import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

export function createMetricsMiddleware(): Middleware {
  return {
    name: 'MetricsMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      ctx.meta.startTime = Date.now();
      logger.info(
        { group: ctx.group.name, isMain: ctx.isMain },
        'Pipeline started',
      );
      return ctx;
    },

    async after(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
      const startTime = ctx.meta.startTime as number | undefined;
      const duration = startTime ? Date.now() - startTime : 0;
      logger.info(
        {
          group: ctx.group.name,
          duration,
          hasResponse: !!result.response,
          hasError: !!result.error,
        },
        'Pipeline completed',
      );
      return result;
    },
  };
}
