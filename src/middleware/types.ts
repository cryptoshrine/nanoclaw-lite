/**
 * Middleware types for NanoClaw agent pipeline.
 *
 * Middlewares wrap the agent invocation with composable before/after hooks.
 * Before hooks run in order; after hooks run in reverse order.
 * A before hook can short-circuit by returning a MiddlewareResult instead of a context.
 */

import { ContainerOutput } from '../container-runner.js';
import { RegisteredGroup } from '../types.js';

export interface MiddlewareContext {
  group: RegisteredGroup;
  chatJid: string;
  prompt: string;
  sessionId?: string;
  isMain: boolean;
  sourceChannel?: 'telegram' | 'discord';
  /** Extensible metadata bag for inter-middleware communication */
  meta: Record<string, unknown>;
}

export interface MiddlewareResult {
  response: string | null;
  newSessionId?: string;
  sessionCleared?: boolean;
  error?: string;
  /** Raw container output for post-processing by downstream middlewares */
  rawOutput?: ContainerOutput;
}

export interface Middleware {
  name: string;
  /**
   * Runs before the agent invocation.
   * Return a modified MiddlewareContext to pass to the next middleware,
   * or a MiddlewareResult to short-circuit the pipeline (triggers after hooks).
   */
  before?(ctx: MiddlewareContext): Promise<MiddlewareContext | MiddlewareResult>;
  /**
   * Runs after the agent invocation (in reverse middleware order).
   * Can inspect or modify the result.
   */
  after?(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult>;
  /**
   * Called when an error occurs. Used for cleanup/logging only — does not modify flow.
   */
  onError?(ctx: MiddlewareContext, error: Error): Promise<void>;
}

/**
 * Type guard: distinguishes a short-circuit MiddlewareResult from a pass-through MiddlewareContext.
 */
export function isMiddlewareResult(
  value: MiddlewareContext | MiddlewareResult,
): value is MiddlewareResult {
  return 'response' in value;
}
