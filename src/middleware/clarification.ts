/**
 * ClarificationMiddleware — catches clearly incomplete prompts before agent invocation.
 *
 * DeerFlow Phase 2: Prevents wasting agent sessions on empty or trivially ambiguous input.
 *
 * This uses heuristics, not API calls — zero latency overhead on normal messages.
 * The agent itself handles nuanced ambiguity via the AskUserQuestion tool.
 */

import { logger } from '../logger.js';

import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';

/** Minimum content length after stripping XML/trigger prefix to proceed */
const MIN_CONTENT_LENGTH = 2;

/**
 * Extract the actual user content from the XML-formatted prompt.
 * Prompts arrive as: <messages><message sender="..." time="...">content</message></messages>
 */
function extractUserContent(prompt: string): string {
  // Extract text from the last <message> tag (most recent message)
  const matches = [...prompt.matchAll(/<message[^>]*>([\s\S]*?)<\/message>/g)];
  if (matches.length === 0) return prompt.trim();

  const lastContent = matches[matches.length - 1][1];
  return lastContent.trim();
}

export function createClarificationMiddleware(): Middleware {
  return {
    name: 'ClarificationMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext | MiddlewareResult> {
      const content = extractUserContent(ctx.prompt);

      // Empty or near-empty after extraction — nothing to process
      if (content.length < MIN_CONTENT_LENGTH) {
        logger.info(
          { group: ctx.group.name, contentLength: content.length },
          'Clarification: empty prompt, short-circuiting',
        );
        return {
          response: "I got your message but it seems empty. What would you like me to help with?",
          error: undefined,
        };
      }

      return ctx;
    },
  };
}
