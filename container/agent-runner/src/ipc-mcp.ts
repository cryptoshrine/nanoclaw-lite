/**
 * IPC-based MCP Server for NanoClaw
 * Writes messages and tasks to files for the host process to pick up
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const MEMORY_DIR = path.join(IPC_DIR, 'memory');

const MEMORY_IPC_POLL_MS = 100;
const MEMORY_IPC_TIMEOUT_MS = 30000;

export interface IpcMcpContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

/**
 * Send a memory IPC request and wait for a response (polling).
 * Used for memory_search and memory_get which need host-side processing.
 */
async function memoryIpcRequest(
  type: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; results?: unknown[]; content?: string; error?: string }> {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reqData = { type, id, ...payload };

  // Write request file (atomic)
  const reqPath = path.join(MEMORY_DIR, `req-${id}.json`);
  const tmpPath = `${reqPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(reqData));
  fs.renameSync(tmpPath, reqPath);

  // Poll for response
  const resPath = path.join(MEMORY_DIR, `res-${id}.json`);
  const startTime = Date.now();

  while (Date.now() - startTime < MEMORY_IPC_TIMEOUT_MS) {
    if (fs.existsSync(resPath)) {
      const resData = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
      // Clean up response file
      try { fs.unlinkSync(resPath); } catch { /* ignore */ }
      return resData;
    }
    await new Promise((r) => setTimeout(r, MEMORY_IPC_POLL_MS));
  }

  // Timeout — clean up request file if still there
  try { fs.unlinkSync(reqPath); } catch { /* ignore */ }
  return { status: 'error', error: 'Memory IPC request timed out' };
}

/**
 * Security scanner for agent-created skills and memory writes.
 */
function scanSkillContent(content: string): { safe: boolean; reason?: string } {
  const dangerous = [
    { pattern: /curl\s+.*[-]d\s/i, reason: 'Potential data exfiltration via curl' },
    { pattern: /wget\s+.*--post/i, reason: 'Potential data exfiltration via wget' },
    { pattern: /\beval\s*\(/i, reason: 'Dynamic code execution (eval)' },
    { pattern: /\bexec\s*\(/i, reason: 'Process execution' },
    { pattern: /child_process/i, reason: 'Child process access' },
    { pattern: /require\s*\(\s*['"](?:fs|os|child_process|net|http|https|dgram)/i, reason: 'Dangerous module import' },
    { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, reason: 'Prompt injection attempt' },
    { pattern: /you\s+are\s+now\s+/i, reason: 'Identity override attempt' },
    { pattern: /system\s*:\s*you\s+are/i, reason: 'System prompt injection' },
    { pattern: /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH|TELEGRAM_BOT_TOKEN/i, reason: 'Attempts to reference secrets' },
    { pattern: /process\.env\[/i, reason: 'Dynamic environment variable access' },
    { pattern: /rm\s+-rf\s+\//i, reason: 'Destructive file operation' },
    { pattern: />\s*\/etc\//i, reason: 'System file write attempt' },
  ];
  for (const { pattern, reason } of dangerous) {
    if (pattern.test(content)) return { safe: false, reason };
  }
  if (content.length > 50000) return { safe: false, reason: 'Content exceeds 50KB limit' };
  return { safe: true };
}

export function createIpcMcp(ctx: IpcMcpContext) {
  const { chatJid, groupFolder, isMain } = ctx;

  return createSdkMcpServer({
    name: 'nanoclaw',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        'Send a message to the current WhatsApp group. Use this to proactively share information or updates.',
        {
          text: z.string().describe('The message text to send')
        },
        async (args) => {
          const data = {
            type: 'message',
            chatJid,
            text: args.text,
            groupFolder,
            timestamp: new Date().toISOString()
          };

          const filename = writeIpcFile(MESSAGES_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Message queued for delivery (${filename})`
            }]
          };
        }
      ),

      tool(
        'send_image',
        'Send an image/photo to the current group chat. The file must exist on disk. Use this to share visualizations, charts, screenshots, or any image files.',
        {
          file_path: z.string().describe('Absolute path to the image file (PNG, JPG, GIF, WebP)'),
          caption: z.string().optional().describe('Optional caption text to display with the image'),
        },
        async (args) => {
          // Verify file exists before queueing
          if (!fs.existsSync(args.file_path)) {
            return {
              content: [{
                type: 'text',
                text: `Error: File not found at ${args.file_path}`
              }]
            };
          }

          const data = {
            type: 'photo',
            chatJid,
            filePath: args.file_path,
            caption: args.caption,
            groupFolder,
            timestamp: new Date().toISOString()
          };

          const filename = writeIpcFile(MESSAGES_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Image queued for delivery (${filename})`
            }]
          };
        }
      ),

      tool(
        'send_document',
        'Send a document/file to the current group chat. Use this to share PDFs, spreadsheets, text files, or any non-image file. The file must exist on disk.',
        {
          file_path: z.string().describe('Absolute path to the file (PDF, DOCX, XLSX, CSV, TXT, etc.)'),
          caption: z.string().optional().describe('Optional caption text to display with the document'),
        },
        async (args) => {
          if (!fs.existsSync(args.file_path)) {
            return {
              content: [{
                type: 'text',
                text: `Error: File not found at ${args.file_path}`
              }]
            };
          }

          const data = {
            type: 'document',
            chatJid,
            filePath: args.file_path,
            caption: args.caption,
            groupFolder,
            timestamp: new Date().toISOString()
          };

          const filename = writeIpcFile(MESSAGES_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Document queued for delivery (${filename})`
            }]
          };
        }
      ),

      tool(
        'schedule_task',
        `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
• "group" (recommended for most tasks): Task runs in the group's conversation context, with access to chat history and memory. Use for tasks that need context about ongoing discussions, user preferences, or previous interactions.
• "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, ask the user. Examples:
- "Remind me about our discussion" → group (needs conversation context)
- "Check the weather every morning" → isolated (self-contained task)
- "Follow up on my request" → group (needs to know what was requested)
- "Generate a daily report" → isolated (just needs instructions in prompt)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
• cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
• interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
• once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
        {
          prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
          schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
          schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
          context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
          target_group: z.string().optional().describe('Target group folder (main only, defaults to current group)')
        },
        async (args) => {
          // Validate schedule_value before writing IPC
          if (args.schedule_type === 'cron') {
            try {
              CronExpressionParser.parse(args.schedule_value);
            } catch (err) {
              return {
                content: [{ type: 'text', text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
                isError: true
              };
            }
          } else if (args.schedule_type === 'interval') {
            const ms = parseInt(args.schedule_value, 10);
            if (isNaN(ms) || ms <= 0) {
              return {
                content: [{ type: 'text', text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
                isError: true
              };
            }
          } else if (args.schedule_type === 'once') {
            const date = new Date(args.schedule_value);
            if (isNaN(date.getTime())) {
              return {
                content: [{ type: 'text', text: `Invalid timestamp: "${args.schedule_value}". Use ISO 8601 format like "2026-02-01T15:30:00.000Z".` }],
                isError: true
              };
            }
          }

          // Non-main groups can only schedule for themselves
          const targetGroup = isMain && args.target_group ? args.target_group : groupFolder;

          const data = {
            type: 'schedule_task',
            prompt: args.prompt,
            schedule_type: args.schedule_type,
            schedule_value: args.schedule_value,
            context_mode: args.context_mode || 'group',
            groupFolder: targetGroup,
            chatJid,
            createdBy: groupFolder,
            timestamp: new Date().toISOString()
          };

          const filename = writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}`
            }]
          };
        }
      ),

      // Reads from current_tasks.json which host keeps updated
      tool(
        'list_tasks',
        'List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group\'s tasks.',
        {},
        async () => {
          const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

          try {
            if (!fs.existsSync(tasksFile)) {
              return {
                content: [{
                  type: 'text',
                  text: 'No scheduled tasks found.'
                }]
              };
            }

            const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

            const tasks = isMain
              ? allTasks
              : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

            if (tasks.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: 'No scheduled tasks found.'
                }]
              };
            }

            const formatted = tasks.map((t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
              `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`
            ).join('\n');

            return {
              content: [{
                type: 'text',
                text: `Scheduled tasks:\n${formatted}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`
              }]
            };
          }
        }
      ),

      tool(
        'pause_task',
        'Pause a scheduled task. It will not run until resumed.',
        {
          task_id: z.string().describe('The task ID to pause')
        },
        async (args) => {
          const data = {
            type: 'pause_task',
            taskId: args.task_id,
            groupFolder,
            isMain,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} pause requested.`
            }]
          };
        }
      ),

      tool(
        'resume_task',
        'Resume a paused task.',
        {
          task_id: z.string().describe('The task ID to resume')
        },
        async (args) => {
          const data = {
            type: 'resume_task',
            taskId: args.task_id,
            groupFolder,
            isMain,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} resume requested.`
            }]
          };
        }
      ),

      tool(
        'cancel_task',
        'Cancel and delete a scheduled task.',
        {
          task_id: z.string().describe('The task ID to cancel')
        },
        async (args) => {
          const data = {
            type: 'cancel_task',
            taskId: args.task_id,
            groupFolder,
            isMain,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} cancellation requested.`
            }]
          };
        }
      ),

      tool(
        'register_group',
        `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
        {
          jid: z.string().describe('The WhatsApp JID (e.g., "123456789@g.us")'),
          name: z.string().describe('Display name for the group'),
          folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
          trigger: z.string().describe('Trigger word (e.g., "@Andy")')
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can register new groups.' }],
              isError: true
            };
          }

          const data = {
            type: 'register_group',
            jid: args.jid,
            name: args.name,
            folder: args.folder,
            trigger: args.trigger,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Group "${args.name}" registered. It will start receiving messages immediately.`
            }]
          };
        }
      ),

      // ============ DM Allowlist Tools ============

      tool(
        'dm_allowlist_add',
        'Add a Telegram user ID to the DM allowlist so they can message the bot directly.',
        {
          user_id: z.number().describe('Telegram user ID to allow'),
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can manage the DM allowlist.' }],
              isError: true,
            };
          }
          writeIpcFile(TASKS_DIR, {
            type: 'dm_allowlist_add',
            user_id: args.user_id,
            timestamp: new Date().toISOString(),
          });
          return {
            content: [{ type: 'text', text: `User ${args.user_id} added to DM allowlist.` }],
          };
        }
      ),

      tool(
        'dm_allowlist_remove',
        'Remove a Telegram user ID from the DM allowlist.',
        {
          user_id: z.number().describe('Telegram user ID to remove'),
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can manage the DM allowlist.' }],
              isError: true,
            };
          }
          writeIpcFile(TASKS_DIR, {
            type: 'dm_allowlist_remove',
            user_id: args.user_id,
            timestamp: new Date().toISOString(),
          });
          return {
            content: [{ type: 'text', text: `User ${args.user_id} removed from DM allowlist.` }],
          };
        }
      ),

      tool(
        'dm_allowlist_list',
        'List all allowed DM users and pending access requests.',
        {},
        async () => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can view the DM allowlist.' }],
              isError: true,
            };
          }
          // Read the allowlist file directly (agent has filesystem access in local mode)
          const projectDir = process.env.NANOCLAW_PROJECT_DIR || path.join(IPC_DIR, '..', '..');
          const allowlistPath = path.join(projectDir, 'data', 'dm-allowlist.json');
          try {
            const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          } catch {
            return {
              content: [{ type: 'text', text: 'No DM allowlist found.' }],
            };
          }
        }
      ),

      // ============ Memory Tools ============

      tool(
        'memory_search',
        `Search the group's memory (past conversations, notes, uploaded files) for relevant information.
Use this to recall prior discussions, find user preferences, or look up information from past interactions.
Returns the most relevant text snippets with their source file and line numbers.`,
        {
          query: z.string().describe('Natural language search query (e.g., "user preferences for notifications", "discussion about API design")'),
          max_results: z.number().optional().describe('Maximum results to return (default: 6)'),
          min_score: z.number().optional().describe('Minimum relevance score 0-1 (default: 0.35)')
        },
        async (args) => {
          const response = await memoryIpcRequest('memory_search', {
            query: args.query,
            maxResults: args.max_results,
            minScore: args.min_score,
          });

          if (response.status === 'error') {
            return {
              content: [{
                type: 'text',
                text: `Memory search error: ${response.error || 'Unknown error'}`
              }],
              isError: true
            };
          }

          const results = response.results as Array<{
            path: string;
            source: string;
            start_line: number;
            end_line: number;
            text: string;
            score: number;
          }> || [];

          if (results.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No relevant results found in memory.'
              }]
            };
          }

          const formatted = results.map((r, i) =>
            `### Result ${i + 1} (score: ${r.score.toFixed(2)})\n**Source:** ${r.path}:${r.start_line}-${r.end_line} (${r.source})\n\`\`\`\n${r.text}\n\`\`\``
          ).join('\n\n');

          return {
            content: [{
              type: 'text',
              text: `Found ${results.length} results:\n\n${formatted}`
            }]
          };
        }
      ),

      tool(
        'memory_get',
        `Read a specific file or section from the group's memory. Use after memory_search to get full context around a result.`,
        {
          path: z.string().describe('Relative path within the group folder (e.g., "CLAUDE.md", "conversations/2024-01.md")'),
          start_line: z.number().optional().describe('Start line number (0-indexed)'),
          end_line: z.number().optional().describe('End line number (0-indexed, inclusive)')
        },
        async (args) => {
          const response = await memoryIpcRequest('memory_get', {
            path: args.path,
            startLine: args.start_line,
            endLine: args.end_line,
          });

          if (response.status === 'error') {
            return {
              content: [{
                type: 'text',
                text: `Memory get error: ${response.error || 'Unknown error'}`
              }],
              isError: true
            };
          }

          return {
            content: [{
              type: 'text',
              text: response.content || '(empty file)'
            }]
          };
        }
      ),

      // ============ Agent-to-Agent Messaging Tools ============

      tool(
        'send_agent_message',
        `Send a message directly to another agent (another registered group).
The message will appear in their inbox at the start of their next run.

Use this to:
- Delegate tasks to specialist agents (e.g., "dev-team", "analytics")
- Share information across groups without going through Telegram
- Reply to messages you received in your inbox

The receiving agent will see the message in their "Agent Inbox" section.
They can reply using the same tool with your group folder as the target.`,
        {
          target_group: z.string().describe('Target group folder name (e.g., "dev-team", "analytics", "main")'),
          message: z.string().describe('Message body to send to the agent'),
          subject: z.string().optional().describe('Optional subject line for the message'),
          in_reply_to: z.string().optional().describe('Message ID this is replying to (from inbox)'),
        },
        async (args) => {
          const data = {
            type: 'agent_message',
            targetGroup: args.target_group,
            message: args.message,
            subject: args.subject || '',
            inReplyTo: args.in_reply_to || null,
            from: groupFolder,
            timestamp: new Date().toISOString(),
          };

          const filename = writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Message queued for delivery to agent "${args.target_group}" (${filename})`
            }]
          };
        }
      ),

      tool(
        'read_agent_inbox',
        `Read pending messages in your agent inbox — messages sent by other agents.

Messages are automatically injected into your context at the start of each run,
but use this tool to check for new messages that arrived during the current session.

Messages are marked as read once retrieved.`,
        {},
        async () => {
          const inboxDir = path.join(IPC_DIR, 'agent-inbox');

          try {
            if (!fs.existsSync(inboxDir)) {
              return {
                content: [{ type: 'text', text: 'Inbox is empty.' }]
              };
            }

            const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json'));

            if (files.length === 0) {
              return {
                content: [{ type: 'text', text: 'Inbox is empty.' }]
              };
            }

            const processedDir = path.join(inboxDir, 'processed');
            fs.mkdirSync(processedDir, { recursive: true });

            const messages: string[] = [];
            for (const file of files) {
              const filePath = path.join(inboxDir, file);
              try {
                const msg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                const replyInfo = msg.inReplyTo ? `\n**Re:** ${msg.inReplyTo}` : '';
                const subjectLine = msg.subject ? `\n**Subject:** ${msg.subject}` : '';
                messages.push(
                  `**ID:** ${msg.id}\n**From:** ${msg.from}${subjectLine}\n**Time:** ${msg.timestamp}${replyInfo}\n\n${msg.message}`
                );
                // Mark as read
                fs.renameSync(filePath, path.join(processedDir, file));
              } catch {
                // Skip corrupt files
              }
            }

            if (messages.length === 0) {
              return {
                content: [{ type: 'text', text: 'Inbox is empty.' }]
              };
            }

            return {
              content: [{
                type: 'text',
                text: `Agent inbox (${messages.length} message${messages.length !== 1 ? 's' : ''}):\n\n${messages.join('\n\n---\n\n')}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error reading inbox: ${err instanceof Error ? err.message : String(err)}`
              }],
              isError: true
            };
          }
        }
      ),

      // ============ System Status Tool ============

      tool(
        'system_status',
        `Get current system status: running agents, queued messages, active teams, and scheduled tasks.
Use this when the user asks "what's running?", "status", or you need to check system state.`,
        {},
        async () => {
          const parts: string[] = [];

          // Running agents & queued messages
          const statusFile = path.join(IPC_DIR, 'system_status.json');
          try {
            if (fs.existsSync(statusFile)) {
              const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));

              if (status.activeAgents?.length > 0) {
                const agents = status.activeAgents.map(
                  (a: { name: string; group: string }) => `  • ${a.name} (${a.group})`
                ).join('\n');
                parts.push(`*Running Agents:* ${status.totalActiveAgents}\n${agents}`);
              } else {
                parts.push('*Running Agents:* None');
              }

              if (status.totalQueuedMessages > 0) {
                const queues = status.queuedMessages
                  .filter((q: { count: number }) => q.count > 0)
                  .map((q: { group: string; count: number }) => `  • ${q.group}: ${q.count} messages`)
                  .join('\n');
                parts.push(`*Queued Messages:* ${status.totalQueuedMessages}\n${queues}`);
              } else {
                parts.push('*Queued Messages:* None');
              }

              parts.push(`_Status as of: ${status.timestamp}_`);
            } else {
              parts.push('*System status:* No data available (status file not found)');
            }
          } catch (err) {
            parts.push(`*System status error:* ${err instanceof Error ? err.message : String(err)}`);
          }

          // Scheduled tasks summary
          const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
          try {
            if (fs.existsSync(tasksFile)) {
              const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
              const active = allTasks.filter((t: { status: string }) => t.status === 'active');
              const paused = allTasks.filter((t: { status: string }) => t.status === 'paused');
              const failed = allTasks.filter((t: { status: string }) => t.status === 'failed');
              parts.push(`*Scheduled Tasks:* ${active.length} active, ${paused.length} paused, ${failed.length} failed`);
            }
          } catch {
            // Ignore task listing errors
          }

          return {
            content: [{
              type: 'text',
              text: parts.join('\n\n')
            }]
          };
        }
      ),

      // ============ Agent-Writable Skills (P1) ============

      tool(
        'create_skill',
        `Create a new reusable skill. Skills are step-by-step procedures that persist across sessions.
Use this after completing a non-trivial task that required multi-step workflows, trial and error,
or discovering non-obvious approaches. The skill will be available to all future agent sessions.`,
        {
          name: z.string().describe('Skill name (kebab-case, e.g., "deploy-docker")'),
          description: z.string().describe('One-line description'),
          content: z.string().describe('Full skill content in markdown'),
          category: z.string().optional().describe('Category folder'),
        },
        async (args) => {
          const scan = scanSkillContent(args.content);
          if (!scan.safe) {
            return { content: [{ type: 'text', text: `Skill creation blocked: ${scan.reason}` }], isError: true };
          }
          if (!/^[a-z0-9-]+$/.test(args.name)) {
            return { content: [{ type: 'text', text: 'Skill name must be kebab-case.' }], isError: true };
          }
          const projectDir = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';
          const skillDir = path.join(projectDir, '.claude', 'skills', args.name);
          if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
            return { content: [{ type: 'text', text: `Skill "${args.name}" already exists. Use patch_skill to update.` }], isError: true };
          }
          fs.mkdirSync(skillDir, { recursive: true });
          const skillContent = `---\nname: "${args.name}"\ndescription: "${args.description.replace(/"/g, '\\"')}"\nversion: "1.0.0"\ncreated: "${new Date().toISOString()}"\ncreated_by: "agent"\ncategory: "${args.category || 'general'}"\n---\n\n${args.content}\n`;
          fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);
          return { content: [{ type: 'text', text: `Skill "${args.name}" created at .claude/skills/${args.name}/SKILL.md` }] };
        }
      ),

      tool(
        'patch_skill',
        `Update an existing skill. Use when a skill has incorrect steps or needs refinement.`,
        {
          name: z.string().describe('Skill name to patch'),
          section: z.string().optional().describe('Section header to replace. If omitted, replaces entire body.'),
          new_content: z.string().describe('New content'),
        },
        async (args) => {
          const projectDir = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';
          const skillPath = path.join(projectDir, '.claude', 'skills', args.name, 'SKILL.md');
          if (!fs.existsSync(skillPath)) {
            return { content: [{ type: 'text', text: `Skill "${args.name}" not found.` }], isError: true };
          }
          const scan = scanSkillContent(args.new_content);
          if (!scan.safe) {
            return { content: [{ type: 'text', text: `Skill patch blocked: ${scan.reason}` }], isError: true };
          }
          let content = fs.readFileSync(skillPath, 'utf-8');
          if (args.section) {
            const regex = new RegExp(`(${args.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n)([\\s\\S]*?)(?=\\n## |$)`);
            if (regex.test(content)) {
              content = content.replace(regex, `$1${args.new_content}\n`);
            } else {
              content += `\n${args.section}\n${args.new_content}\n`;
            }
          } else {
            const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
            if (fmEnd !== -1) {
              content = `${content.slice(0, fmEnd + 3)}\n\n${args.new_content}\n`;
            } else {
              content = args.new_content;
            }
          }
          content = content.replace(/version:\s*"(\d+)\.(\d+)\.(\d+)"/, (_, maj: string, min: string, pat: string) => `version: "${maj}.${min}.${parseInt(pat) + 1}"`);
          fs.writeFileSync(skillPath, content);
          return { content: [{ type: 'text', text: `Skill "${args.name}" patched.` }] };
        }
      ),

      tool(
        'list_skills',
        'List all available skills with names and descriptions.',
        {},
        async () => {
          const projectDir = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';
          const skillsDir = path.join(projectDir, '.claude', 'skills');
          if (!fs.existsSync(skillsDir)) {
            return { content: [{ type: 'text', text: 'No skills directory found.' }] };
          }
          const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
          if (entries.length === 0) {
            return { content: [{ type: 'text', text: 'No skills found.' }] };
          }
          const skills: string[] = [];
          for (const entry of entries) {
            const sp = path.join(skillsDir, entry.name, 'SKILL.md');
            if (!fs.existsSync(sp)) continue;
            const c = fs.readFileSync(sp, 'utf-8');
            const desc = c.match(/description:\s*"([^"]+)"/)?.[1] || 'No description';
            const ver = c.match(/version:\s*"([^"]+)"/)?.[1] || '?';
            const by = c.match(/created_by:\s*"([^"]+)"/)?.[1] || 'unknown';
            skills.push(`• ${entry.name} (v${ver}, by ${by}): ${desc}`);
          }
          return { content: [{ type: 'text', text: `Available skills (${skills.length}):\n\n${skills.join('\n')}` }] };
        }
      ),

      tool(
        'view_skill',
        'Load the full content of a specific skill.',
        {
          name: z.string().describe('Skill name to view'),
          file: z.string().optional().describe('Supporting file within skill directory'),
        },
        async (args) => {
          const projectDir = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';
          const baseDir = path.join(projectDir, '.claude', 'skills', args.name);
          const targetFile = args.file ? path.join(baseDir, args.file) : path.join(baseDir, 'SKILL.md');
          if (!fs.existsSync(targetFile)) {
            return { content: [{ type: 'text', text: `Skill file not found: ${args.name}/${args.file || 'SKILL.md'}` }], isError: true };
          }
          const resolved = path.resolve(targetFile);
          if (!resolved.startsWith(path.resolve(baseDir))) {
            return { content: [{ type: 'text', text: 'Path traversal blocked.' }], isError: true };
          }
          const fileContent = fs.readFileSync(targetFile, 'utf-8');
          return { content: [{ type: 'text', text: fileContent.slice(0, 30000) }] };
        }
      ),

      // ============ Session Search (P2) ============

      tool(
        'search_sessions',
        `Search past conversation sessions for relevant context. Uses full-text search across archived conversations.`,
        {
          query: z.string().describe('Search query'),
          max_results: z.number().optional().describe('Max sessions to return (default 5)'),
          days_back: z.number().optional().describe('Days to search back (default 30)'),
        },
        async (args) => {
          const groupDir = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
          const conversationsDir = path.join(groupDir, 'conversations');
          if (!fs.existsSync(conversationsDir)) {
            return { content: [{ type: 'text', text: 'No conversation archives found.' }] };
          }
          const maxResults = args.max_results || 5;
          const daysBack = args.days_back || 30;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - daysBack);
          const cutoffStr = cutoff.toISOString().split('T')[0];
          const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.md') && f >= cutoffStr).sort().reverse();
          if (files.length === 0) {
            return { content: [{ type: 'text', text: 'No conversations found in range.' }] };
          }
          const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          if (queryWords.length === 0) {
            return { content: [{ type: 'text', text: 'Query too short.' }], isError: true };
          }
          const results: Array<{ file: string; score: number; excerpt: string }> = [];
          for (const file of files) {
            const content = fs.readFileSync(path.join(conversationsDir, file), 'utf-8');
            const lower = content.toLowerCase();
            let score = 0;
            for (const word of queryWords) { score += lower.split(word).length - 1; }
            if (score === 0) continue;
            const idx = queryWords.reduce((best, w) => { const i = lower.indexOf(w); return i !== -1 && (best === -1 || i < best) ? i : best; }, -1);
            const excerpt = content.slice(Math.max(0, idx - 200), Math.min(content.length, idx + 500)).trim();
            results.push({ file, score, excerpt });
          }
          results.sort((a, b) => b.score - a.score);
          const top = results.slice(0, maxResults);
          if (top.length === 0) {
            return { content: [{ type: 'text', text: `No matches for "${args.query}".` }] };
          }
          const formatted = top.map((r, i) => `### ${i + 1}. ${r.file} (relevance: ${r.score})\n\n${r.excerpt.slice(0, 500)}${r.excerpt.length > 500 ? '...' : ''}`).join('\n\n---\n\n');
          return { content: [{ type: 'text', text: `Found ${top.length} sessions:\n\n${formatted}` }] };
        }
      ),

      // ============ Bounded Memory Write (P3) ============

      tool(
        'memory_write',
        `Write a declarative fact to the group's memory. Bounded to 5000 chars. Oldest entries trimmed automatically.`,
        {
          content: z.string().describe('The fact to remember (1-2 sentences)'),
          target: z.enum(['memory', 'user']).describe('"memory" = agent notes, "user" = user preferences'),
        },
        async (args) => {
          const groupDir = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
          const MEMORY_LIMIT = 5000;
          const USER_LIMIT = 3000;
          const scan = scanSkillContent(args.content);
          if (!scan.safe) {
            return { content: [{ type: 'text', text: `Memory write blocked: ${scan.reason}` }], isError: true };
          }
          const targetFile = args.target === 'user' ? path.join(groupDir, 'USER.md') : path.join(groupDir, 'MEMORY.md');
          const charLimit = args.target === 'user' ? USER_LIMIT : MEMORY_LIMIT;
          let existing = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf-8') : '';
          const entry = `\n§ ${args.content} [${new Date().toISOString().split('T')[0]}]`;
          let updated = existing + entry;
          while (updated.length > charLimit) {
            const first = updated.indexOf('\n§ ', 1);
            if (first === -1) break;
            const second = updated.indexOf('\n§ ', first + 1);
            if (second === -1) break;
            updated = updated.slice(0, first) + updated.slice(second);
          }
          const tmpPath = `${targetFile}.tmp`;
          fs.writeFileSync(tmpPath, updated);
          fs.renameSync(tmpPath, targetFile);
          return { content: [{ type: 'text', text: `Memory updated (${args.target}). ${charLimit - updated.length} chars remaining.` }] };
        }
      ),

    ]
  });
}
