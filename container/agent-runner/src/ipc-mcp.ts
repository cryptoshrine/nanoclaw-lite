/**
 * IPC-based MCP Server for NanoClaw
 * Writes messages and tasks to files for the host process to pick up
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
// @ts-ignore - Copied during Docker build from .claude/skills/x-integration/
import { createXTools } from './skills/x-integration/agent.js';

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
  // Team context (for teammates)
  isTeammate?: boolean;
  teamId?: string;
  memberId?: string;
  memberName?: string;
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

export function createIpcMcp(ctx: IpcMcpContext) {
  const { chatJid, groupFolder, isMain, isTeammate, teamId, memberId, memberName } = ctx;

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
        'send_canvas',
        `Push a visual artifact to the Live Canvas in CENTCOMM. Artifacts appear as draggable/resizable cards on a spatial workspace.

Supported types:
- "markdown": Rendered markdown text
- "code": Syntax-highlighted code block (set metadata.language)
- "svg": Raw SVG markup
- "image": URL or path to an image file
- "chart": JSON chart data (Recharts-compatible)
- "html": Raw HTML content

Artifacts appear in real-time on the canvas. Use for sharing visualizations, code, research findings, or any visual content.`,
        {
          type: z.enum(['markdown', 'code', 'svg', 'image', 'chart', 'html']).describe('Artifact type'),
          title: z.string().describe('Display title for the artifact card'),
          content: z.string().describe('Content: markdown text, code, SVG markup, image URL/path, chart JSON, or HTML'),
          metadata: z.record(z.string(), z.string()).optional().describe('Optional metadata (e.g., { language: "python" })'),
          width: z.number().optional().describe('Width in pixels (default: 400)'),
          height: z.number().optional().describe('Height in pixels (default: 300)'),
        },
        async (args) => {
          const artifactId = `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const posX = 50 + Math.floor(Math.random() * 200);
          const posY = 50 + Math.floor(Math.random() * 200);

          const artifact = {
            id: artifactId,
            type: args.type,
            title: args.title,
            content: args.content,
            metadata: args.metadata || {},
            position: { x: posX, y: posY },
            size: { width: args.width || 400, height: args.height || 300 },
            sourceAgent: groupFolder,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          writeIpcFile(TASKS_DIR, {
            type: 'canvas_update',
            canvas_action: 'add',
            artifact,
            groupFolder,
            timestamp: new Date().toISOString(),
          });

          return {
            content: [{
              type: 'text',
              text: `Artifact "${args.title}" (${args.type}) pushed to canvas (${artifactId})`
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
          jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
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

      // ============ Agent Teams Tools ============

      // Lead-only: Create a new team
      tool(
        'create_team',
        `Create a new agent team. You become the team lead and can spawn teammates to work on tasks in parallel.

Use this when you have a complex task that can be broken down into independent subtasks that can run concurrently.`,
        {
          name: z.string().describe('Unique name for the team (e.g., "refactor-auth-2024")')
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can create teams.' }],
              isError: true
            };
          }

          const data = {
            type: 'create_team',
            teamName: args.name,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Team "${args.name}" creation requested. Use list_teams to see available teams.`
            }]
          };
        }
      ),

      // Lead-only: Spawn a teammate
      tool(
        'spawn_teammate',
        `Spawn a new teammate agent in a separate container. The teammate will work autonomously on the given task.

Teammates have access to:
- The team's shared /workspace/team directory
- Your group's files (read-only)
- Team messaging and task tools

Teammates run with sonnet by default for cost efficiency. Use opus for complex reasoning tasks.`,
        {
          team_id: z.string().describe('The team ID to add the teammate to'),
          name: z.string().describe('A short name for this teammate (e.g., "api-refactor", "test-writer")'),
          prompt: z.string().describe('The task for this teammate to complete. Be specific and include all context needed.'),
          model: z.enum(['claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-opus-4-6']).optional().describe('Model to use (default: claude-sonnet-4-6)')
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can spawn teammates.' }],
              isError: true
            };
          }

          const data = {
            type: 'spawn_teammate',
            teamId: args.team_id,
            teammateName: args.name,
            teammatePrompt: args.prompt,
            teammateModel: args.model,
            chatJid,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Teammate "${args.name}" spawn requested for team ${args.team_id}.`
            }]
          };
        }
      ),

      // Lead-only: List teammates
      tool(
        'list_teammates',
        'List all teammates in a team with their current status.',
        {
          team_id: z.string().describe('The team ID')
        },
        async (args) => {
          const teamFile = path.join(IPC_DIR, `team-${args.team_id}.json`);

          try {
            if (!fs.existsSync(teamFile)) {
              return {
                content: [{ type: 'text', text: `Team ${args.team_id} not found.` }],
                isError: true
              };
            }

            const snapshot = JSON.parse(fs.readFileSync(teamFile, 'utf-8'));
            const members = snapshot.members || [];

            if (members.length === 0) {
              return {
                content: [{ type: 'text', text: 'No teammates in this team yet.' }]
              };
            }

            const formatted = members.map((m: { id: string; name: string; role: string; status: string }) =>
              `- [${m.id}] ${m.name} (${m.role}): ${m.status}`
            ).join('\n');

            return {
              content: [{
                type: 'text',
                text: `Team members:\n${formatted}\n\nLast updated: ${snapshot.lastUpdated}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error reading team: ${err instanceof Error ? err.message : String(err)}`
              }],
              isError: true
            };
          }
        }
      ),

      // Lead-only: Cleanup team
      tool(
        'cleanup_team',
        'End a team and stop all running teammates. Use when the team\'s work is complete.',
        {
          team_id: z.string().describe('The team ID to cleanup')
        },
        async (args) => {
          if (!isMain) {
            return {
              content: [{ type: 'text', text: 'Only the main group can cleanup teams.' }],
              isError: true
            };
          }

          const data = {
            type: 'cleanup_team',
            teamId: args.team_id,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Team ${args.team_id} cleanup requested.`
            }]
          };
        }
      ),

      // Team messaging: Send message to specific teammate or broadcast
      tool(
        'send_team_message',
        `Send a message to a specific teammate or broadcast to all team members.
Use this to coordinate work, share updates, or ask questions.`,
        {
          team_id: z.string().describe('The team ID'),
          content: z.string().describe('The message content'),
          to_member: z.string().optional().describe('Specific member ID to send to (omit to broadcast to all)')
        },
        async (args) => {
          const fromMember = isTeammate && memberId ? memberId : 'lead';

          const data = {
            type: 'team_message',
            teamId: args.team_id,
            fromMember,
            toMember: args.to_member || null,
            content: args.content,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          const target = args.to_member ? `to ${args.to_member}` : 'to all';
          return {
            content: [{
              type: 'text',
              text: `Message sent ${target}.`
            }]
          };
        }
      ),

      // Team messaging: Read unread messages
      tool(
        'read_team_messages',
        'Read unread messages sent to you or broadcast to the team.',
        {
          team_id: z.string().describe('The team ID')
        },
        async (args) => {
          const messagesFile = path.join(IPC_DIR, `team-${args.team_id}-messages.json`);

          try {
            if (!fs.existsSync(messagesFile)) {
              return {
                content: [{ type: 'text', text: 'No messages.' }]
              };
            }

            const messages = JSON.parse(fs.readFileSync(messagesFile, 'utf-8'));

            if (!messages || messages.length === 0) {
              return {
                content: [{ type: 'text', text: 'No messages.' }]
              };
            }

            const formatted = messages.map((m: { from_member: string; content: string; created_at: string }) =>
              `[${m.created_at}] ${m.from_member}: ${m.content}`
            ).join('\n\n');

            return {
              content: [{
                type: 'text',
                text: `Messages:\n${formatted}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error reading messages: ${err instanceof Error ? err.message : String(err)}`
              }],
              isError: true
            };
          }
        }
      ),

      // Team tasks: List available tasks
      tool(
        'get_team_tasks',
        'List all tasks for a team with their status and assignments.',
        {
          team_id: z.string().describe('The team ID')
        },
        async (args) => {
          const tasksFile = path.join(IPC_DIR, `team-${args.team_id}-tasks.json`);

          try {
            if (!fs.existsSync(tasksFile)) {
              return {
                content: [{ type: 'text', text: 'No tasks defined yet.' }]
              };
            }

            const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

            if (!tasks || tasks.length === 0) {
              return {
                content: [{ type: 'text', text: 'No tasks defined yet.' }]
              };
            }

            const formatted = tasks.map((t: { id: string; title: string; status: string; assigned_to: string | null; priority: number }) =>
              `- [${t.id}] ${t.title} (${t.status}${t.assigned_to ? `, assigned: ${t.assigned_to}` : ''}) priority: ${t.priority}`
            ).join('\n');

            return {
              content: [{
                type: 'text',
                text: `Team tasks:\n${formatted}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`
              }],
              isError: true
            };
          }
        }
      ),

      // Team tasks: Create a new task
      tool(
        'create_team_task',
        'Create a new task for the team. Tasks can be claimed by teammates.',
        {
          team_id: z.string().describe('The team ID'),
          title: z.string().describe('Short title for the task'),
          description: z.string().optional().describe('Detailed description of what needs to be done'),
          priority: z.number().optional().describe('Priority (higher = more important, default: 0)'),
          depends_on: z.string().optional().describe('Task ID this task depends on')
        },
        async (args) => {
          const data = {
            type: 'create_team_task',
            teamId: args.team_id,
            taskTitle: args.title,
            taskDescription: args.description,
            priority: args.priority,
            dependsOn: args.depends_on,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task "${args.title}" created.`
            }]
          };
        }
      ),

      // Team tasks: Claim a task
      tool(
        'claim_team_task',
        'Claim an available task to work on. Only one agent can claim a task.',
        {
          task_id: z.string().describe('The task ID to claim')
        },
        async (args) => {
          const claimingMember = isTeammate && memberId ? memberId : 'lead';

          const data = {
            type: 'claim_team_task',
            taskId: args.task_id,
            memberId: claimingMember,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} claim requested.`
            }]
          };
        }
      ),

      // Team tasks: Complete a task
      tool(
        'complete_team_task',
        'Mark a task as completed.',
        {
          task_id: z.string().describe('The task ID to complete')
        },
        async (args) => {
          const data = {
            type: 'complete_team_task',
            taskId: args.task_id,
            timestamp: new Date().toISOString()
          };

          writeIpcFile(TASKS_DIR, data);

          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} marked complete.`
            }]
          };
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

      // List active teams (for lead to see what teams exist)
      tool(
        'list_teams',
        'List all active teams.',
        {},
        async () => {
          // Look for team-*.json files in IPC directory
          try {
            const files = fs.readdirSync(IPC_DIR).filter(f => f.startsWith('team-') && f.endsWith('.json') && !f.includes('-messages') && !f.includes('-tasks'));

            if (files.length === 0) {
              return {
                content: [{ type: 'text', text: 'No active teams.' }]
              };
            }

            const teams = files.map(f => {
              try {
                const data = JSON.parse(fs.readFileSync(path.join(IPC_DIR, f), 'utf-8'));
                return `- [${data.team?.id}] ${data.team?.name} (${data.team?.status}) - ${data.members?.length || 0} members`;
              } catch {
                return null;
              }
            }).filter(Boolean);

            return {
              content: [{
                type: 'text',
                text: `Active teams:\n${teams.join('\n')}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error listing teams: ${err instanceof Error ? err.message : String(err)}`
              }],
              isError: true
            };
          }
        }
      ),
      // ============ Agent-to-Agent Messaging Tools ============

      tool(
        'send_agent_message',
        `Send a message directly to another agent (another registered group).
The message will appear in their inbox at the start of their next run.

Use this to:
- Delegate tasks to specialist agents (e.g., "ball-ai-dev", "ball-ai-analytics")
- Share information across groups without going through Telegram
- Reply to messages you received in your inbox

The receiving agent will see the message in their "Agent Inbox" section.
They can reply using the same tool with your group folder as the target.`,
        {
          target_group: z.string().describe('Target group folder name (e.g., "ball-ai-dev", "ball-ai-analytics", "main")'),
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

          // Active teams
          try {
            const teamFiles = fs.readdirSync(IPC_DIR).filter(
              f => f.startsWith('team-') && f.endsWith('.json') && !f.includes('-messages') && !f.includes('-tasks')
            );
            if (teamFiles.length > 0) {
              const teams = teamFiles.map(f => {
                try {
                  const data = JSON.parse(fs.readFileSync(path.join(IPC_DIR, f), 'utf-8'));
                  const memberCount = data.members?.length || 0;
                  const activeMembers = data.members?.filter((m: { status: string }) => m.status === 'active').length || 0;
                  return `  • ${data.team?.name} — ${activeMembers}/${memberCount} active`;
                } catch {
                  return null;
                }
              }).filter(Boolean);
              parts.push(`*Active Teams:* ${teamFiles.length}\n${teams.join('\n')}`);
            }
          } catch {
            // Ignore team listing errors
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

      ...createXTools({ groupFolder, isMain })
    ]
  });
}
