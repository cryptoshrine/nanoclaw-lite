/**
 * BackgroundReview Middleware — Hermes-inspired post-session review agent.
 *
 * After every agent session completes, this middleware fires a lightweight
 * review agent in the background. The review agent gets the conversation
 * transcript and writes lessons learned, user preferences, and skill updates
 * to persistent storage.
 *
 * Key design decisions:
 *   - Fires in the `after` hook (non-blocking — doesn't delay the response to the user)
 *   - Uses Haiku model for cost efficiency (review doesn't need Opus/Sonnet reasoning)
 *   - Turn counter: only fires every N turns (configurable, default 5)
 *   - Writes to: groups/{folder}/learnings/cards/ (Aha Cards)
 *                groups/{folder}/MEMORY.md or knowledge/_index.md (memory updates)
 *                .claude/skills/{name}/SKILL.md (skill creation/patches)
 *   - Security: review agent has write access to group files only
 *   - Invisible to user except a one-line log entry
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';
import { Middleware, MiddlewareContext, MiddlewareResult } from './types.js';
import { MiddlewareServices } from './services.js';

// Turn counters per group (reset on process restart, which is fine)
const turnCounters = new Map<string, number>();

// Configurable via environment
const REVIEW_INTERVAL = parseInt(process.env.REVIEW_NUDGE_INTERVAL || '5', 10);
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'claude-haiku-4-5-20251001';
const REVIEW_ENABLED = process.env.BACKGROUND_REVIEW_ENABLED !== 'false'; // Default: on
const REVIEW_MIN_PROMPT_LENGTH = 50; // Skip review for trivially short sessions

const REVIEW_PROMPT = `You are a background review agent. Your job is to review the conversation that just happened and extract valuable learnings.

IMPORTANT: You are running AFTER the main agent has already responded to the user. The user will NOT see your output. You are writing to persistent storage only.

Review the conversation and consider:

1. **User Preferences**: Did the user reveal preferences about how they want things done? Communication style? Tool preferences? Decision-making patterns?

2. **Environment Facts**: Were there new facts about the codebase, infrastructure, APIs, or tools that future sessions should know?

3. **Patterns & Gotchas**: Did the agent encounter errors, workarounds, or non-obvious solutions that should be remembered?

4. **Skill Candidates**: Was a non-trivial multi-step workflow used that could be saved as a reusable skill?

For each finding, use the appropriate tool:
- Use record_learning for patterns, gotchas, and environment facts
- Use memory_write for user preferences and durable facts
- Use create_skill for reusable multi-step workflows

If nothing meaningful was learned (trivial Q&A, greetings, simple lookups), respond with "Nothing to save." and stop.

Be CONCISE. Write declarative facts, not instructions to yourself. Prioritize what reduces future user steering — the most valuable memory is one that prevents the user from having to correct or remind the agent again.

Here is the conversation to review:

`;

/**
 * Build a compact transcript from the prompt + response for review.
 */
function buildTranscript(ctx: MiddlewareContext, result: MiddlewareResult): string {
  const parts: string[] = [];

  // Include the user's prompt
  const promptPreview = ctx.prompt.length > 3000
    ? ctx.prompt.slice(0, 3000) + '\n...(truncated)'
    : ctx.prompt;
  parts.push(`**User**: ${promptPreview}`);

  // Include the agent's response
  if (result.response) {
    const responsePreview = result.response.length > 3000
      ? result.response.slice(0, 3000) + '\n...(truncated)'
      : result.response;
    parts.push(`**Agent**: ${responsePreview}`);
  }

  return parts.join('\n\n');
}

/**
 * Write a review task to IPC for the host to pick up and spawn as a background agent.
 * This is non-blocking — the main response has already been sent.
 */
function queueReviewTask(
  groupFolder: string,
  chatJid: string,
  transcript: string,
): void {
  const ipcTasksDir = path.join(DATA_DIR, 'ipc', groupFolder, 'tasks');
  fs.mkdirSync(ipcTasksDir, { recursive: true });

  const taskData = {
    type: 'background_review',
    groupFolder,
    chatJid,
    prompt: REVIEW_PROMPT + transcript,
    model: REVIEW_MODEL,
    timestamp: new Date().toISOString(),
  };

  const filename = `${Date.now()}-review-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(ipcTasksDir, filename);
  const tmpPath = `${filepath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(taskData, null, 2));
  fs.renameSync(tmpPath, filepath);

  logger.info(
    { groupFolder, filename },
    'Background review task queued',
  );
}

export function createBackgroundReviewMiddleware(
  _services: MiddlewareServices,
): Middleware {
  return {
    name: 'BackgroundReview',

    async after(ctx: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
      if (!REVIEW_ENABLED) return result;

      // Skip for errors, empty responses, scheduled tasks
      if (result.error || !result.response) return result;
      if (ctx.prompt.length < REVIEW_MIN_PROMPT_LENGTH) return result;

      // Increment turn counter for this group
      const groupKey = ctx.group.folder;
      const count = (turnCounters.get(groupKey) || 0) + 1;
      turnCounters.set(groupKey, count);

      // Only fire review every N turns
      if (count % REVIEW_INTERVAL !== 0) {
        logger.debug(
          { group: groupKey, turn: count, interval: REVIEW_INTERVAL },
          'Background review: skipping (turn counter)',
        );
        return result;
      }

      logger.info(
        { group: groupKey, turn: count },
        'Background review: firing post-session review',
      );

      try {
        const transcript = buildTranscript(ctx, result);
        queueReviewTask(ctx.group.folder, ctx.chatJid, transcript);
      } catch (err) {
        logger.error(
          { group: groupKey, err },
          'Background review: failed to queue review task',
        );
      }

      // Never delay the response
      return result;
    },
  };
}
