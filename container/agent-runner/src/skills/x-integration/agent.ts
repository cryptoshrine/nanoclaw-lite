/**
 * X Integration - MCP Tool Definitions (Agent/Container Side)
 *
 * These tools run inside the container and communicate with the host via IPC.
 * The host-side implementation is in host.ts.
 *
 * Note: This file is compiled in the container, not on the host.
 * The @ts-ignore is needed because the SDK is only available in the container.
 */

// @ts-ignore - SDK available in container environment only
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// IPC directories (env var for local mode, fallback for container)
const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const RESULTS_DIR = path.join(IPC_DIR, 'x_results');

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
  return filename;
}

async function waitForResult(requestId: string, maxWait = 60000): Promise<{ success: boolean; message: string }> {
  const resultFile = path.join(RESULTS_DIR, `${requestId}.json`);
  const pollInterval = 1000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
        fs.unlinkSync(resultFile);
        return result;
      } catch (err) {
        return { success: false, message: `Failed to read result: ${err}` };
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  return { success: false, message: 'Request timed out' };
}

export interface SkillToolsContext {
  groupFolder: string;
  isMain: boolean;
}

/**
 * Create X integration MCP tools
 */
export function createXTools(ctx: SkillToolsContext) {
  const { groupFolder, isMain } = ctx;

  return [
    tool(
      'x_post',
      `Post a tweet to X (Twitter). Main group only.

The host machine will execute the browser automation to post the tweet.
Make sure the content is appropriate and within X's character limit (280 chars for text).`,
      {
        content: z.string().max(280).describe('The tweet content to post (max 280 characters)')
      },
      async (args: { content: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can post tweets.' }],
            isError: true
          };
        }

        if (args.content.length > 280) {
          return {
            content: [{ type: 'text', text: `Tweet exceeds 280 character limit (current: ${args.content.length})` }],
            isError: true
          };
        }

        const requestId = `xpost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_post',
          requestId,
          content: args.content,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_like',
      `Like a tweet on X (Twitter). Main group only.

Provide the tweet URL or tweet ID to like.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID')
      },
      async (args: { tweet_url: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xlike-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_like',
          requestId,
          tweetUrl: args.tweet_url,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_reply',
      `Reply to a tweet on X (Twitter). Main group only.

Provide the tweet URL and your reply content.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID'),
        content: z.string().max(280).describe('The reply content (max 280 characters)')
      },
      async (args: { tweet_url: string; content: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xreply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_reply',
          requestId,
          tweetUrl: args.tweet_url,
          content: args.content,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_retweet',
      `Retweet a tweet on X (Twitter). Main group only.

Provide the tweet URL to retweet.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID')
      },
      async (args: { tweet_url: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xretweet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_retweet',
          requestId,
          tweetUrl: args.tweet_url,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_quote',
      `Quote tweet on X (Twitter). Main group only.

Retweet with your own comment added.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID'),
        comment: z.string().max(280).describe('Your comment for the quote tweet (max 280 characters)')
      },
      async (args: { tweet_url: string; comment: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xquote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_quote',
          requestId,
          tweetUrl: args.tweet_url,
          comment: args.comment,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    // === Reading / Monitoring Tools ===

    tool(
      'x_search',
      `Search for posts on X (Twitter). Main group only.

Search for posts by keyword, hashtag, or phrase. Returns post text, author, stats, and URLs.
Useful for monitoring topics, finding discussions, or researching trends.`,
      {
        query: z.string().describe('Search query (e.g., "football analytics", "#xG", "from:StatsBomb")'),
        sort: z.enum(['top', 'latest']).optional().describe('Sort order: "top" for popular posts, "latest" for newest (default: "latest")'),
        count: z.number().optional().describe('Maximum number of posts to return (default: 10, max: 20)')
      },
      async (args: { query: string; sort?: 'top' | 'latest'; count?: number }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xsearch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_search',
          requestId,
          query: args.query,
          sort: args.sort || 'latest',
          count: Math.min(args.count || 10, 20),
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId, 90000); // longer timeout for search
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_read_feed',
      `Read the home feed or a user's timeline on X (Twitter). Main group only.

Read your home feed for latest posts, or view a specific user's profile and recent posts.`,
      {
        type: z.enum(['home', 'user']).describe('"home" for your feed, "user" for a specific user\'s timeline'),
        username: z.string().optional().describe('Username to read (required if type is "user", e.g., "StatsBomb" or "@StatsBomb")'),
        count: z.number().optional().describe('Maximum number of posts to return (default: 10, max: 20)')
      },
      async (args: { type: 'home' | 'user'; username?: string; count?: number }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        if (args.type === 'user' && !args.username) {
          return {
            content: [{ type: 'text', text: 'Username is required when type is "user"' }],
            isError: true
          };
        }

        const requestId = `xfeed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_read_feed',
          requestId,
          feedType: args.type,
          username: args.username,
          count: Math.min(args.count || 10, 20),
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId, 90000);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_read_post',
      `Read a specific post and its replies on X (Twitter). Main group only.

Get the full text, stats, and top replies for a specific tweet. Useful for understanding
engagement, reading discussions, or checking responses to a post.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID'),
        include_replies: z.boolean().optional().describe('Whether to include replies (default: true)'),
        reply_count: z.number().optional().describe('Maximum number of replies to return (default: 5, max: 15)')
      },
      async (args: { tweet_url: string; include_replies?: boolean; reply_count?: number }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_read_post',
          requestId,
          tweetUrl: args.tweet_url,
          includeReplies: args.include_replies !== false,
          replyCount: Math.min(args.reply_count || 5, 15),
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId, 90000);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_check_stats',
      `Check the stats/metrics for a specific post on X (Twitter). Main group only.

Returns views, likes, retweets, replies, and bookmarks for a specific tweet.
Useful for tracking post performance.`,
      {
        tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123) or tweet ID')
      },
      async (args: { tweet_url: string }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xstats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_check_stats',
          requestId,
          tweetUrl: args.tweet_url,
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    ),

    tool(
      'x_notifications',
      `Check your notifications on X (Twitter). Main group only.

View recent notifications including likes, retweets, replies, follows, and mentions.
Useful for tracking engagement and responding to interactions.`,
      {
        count: z.number().optional().describe('Maximum number of notifications to return (default: 10, max: 20)'),
        tab: z.enum(['all', 'mentions']).optional().describe('"all" for all notifications, "mentions" for mentions only (default: "all")')
      },
      async (args: { count?: number; tab?: 'all' | 'mentions' }) => {
        if (!isMain) {
          return {
            content: [{ type: 'text', text: 'Only the main group can interact with X.' }],
            isError: true
          };
        }

        const requestId = `xnotif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeIpcFile(TASKS_DIR, {
          type: 'x_notifications',
          requestId,
          count: Math.min(args.count || 10, 20),
          tab: args.tab || 'all',
          groupFolder,
          timestamp: new Date().toISOString()
        });

        const result = await waitForResult(requestId, 90000);
        return {
          content: [{ type: 'text', text: result.message }],
          isError: !result.success
        };
      }
    )
  ];
}
