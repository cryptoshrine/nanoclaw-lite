/**
 * PromptSanitizeMiddleware — cleans up prompts before agent invocation.
 *
 * 1. Strips trigger prefix (@Klaw, @AssistantName) from non-main groups
 * 2. Strips large inline file contents from upload messages, replacing with
 *    a path reference (keeps file accessible via Read tool, but prevents
 *    bloating the prompt with huge base64 or code dumps)
 * 3. Strips base64 data URIs (e.g. from pasted images)
 */

import { ASSISTANT_NAME } from '../config.js';
import { logger } from '../logger.js';

import { Middleware, MiddlewareContext } from './types.js';

/** Max inline file content before we truncate and point to the file path */
const MAX_INLINE_FILE_CHARS = 2000;

/** Regex to match [Uploaded file: filename]\n```\n...content...\n``` */
const UPLOAD_BLOCK_RE =
  /\[Uploaded file: ([^\]]+)\]\n```\n([\s\S]*?)```/g;

/** Regex to match base64 data URIs */
const BASE64_URI_RE = /data:[a-zA-Z]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{100,}/g;

export function createPromptSanitizeMiddleware(): Middleware {
  return {
    name: 'PromptSanitizeMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      let prompt = ctx.prompt;

      // 1. Strip trigger prefix for non-main groups
      if (!ctx.isMain) {
        const triggerPattern = new RegExp(
          `^\\s*@${escapeRegex(ASSISTANT_NAME)}\\s*`,
          'i',
        );
        // The prompt is XML-wrapped, so the trigger is inside <message> tags
        prompt = prompt.replace(
          new RegExp(
            `(>)\\s*@${escapeRegex(ASSISTANT_NAME)}\\s*`,
            'gi',
          ),
          '$1',
        );
      }

      // 2. Truncate large inline file uploads
      prompt = prompt.replace(UPLOAD_BLOCK_RE, (_match, fileName: string, content: string) => {
        if (content.length <= MAX_INLINE_FILE_CHARS) {
          // Small file — keep inline
          return `[Uploaded file: ${fileName}]\n\`\`\`\n${content}\`\`\``;
        }
        // Large file — truncate and point to uploads/
        const preview = content.slice(0, 500);
        const truncatedLines = content.split('\n').length;
        logger.debug(
          { fileName, originalSize: content.length, truncatedLines },
          'Truncated large inline upload',
        );
        return (
          `[Uploaded file: ${fileName} — ${truncatedLines} lines, truncated. Full file at uploads/${fileName}]\n` +
          `\`\`\`\n${preview}\n... (${content.length - 500} more chars — use Read tool on uploads/${fileName} for full content)\n\`\`\``
        );
      });

      // 3. Strip base64 data URIs
      prompt = prompt.replace(BASE64_URI_RE, (match) => {
        const sizeKb = Math.round((match.length * 3) / 4 / 1024);
        return `[base64 data removed — ${sizeKb}KB]`;
      });

      if (prompt !== ctx.prompt) {
        const saved = ctx.prompt.length - prompt.length;
        if (saved > 100) {
          logger.info(
            { group: ctx.group.name, savedChars: saved },
            'Prompt sanitized',
          );
        }
        return { ...ctx, prompt };
      }

      return ctx;
    },
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
