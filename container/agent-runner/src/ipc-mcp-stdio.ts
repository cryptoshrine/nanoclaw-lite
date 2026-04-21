/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';
const sourceChannel = process.env.NANOCLAW_SOURCE_CHANNEL || 'telegram';

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

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      sourceChannel,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use ISO 8601 format like "2026-02-01T15:30:00.000Z".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const data = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
  {
    jid: z.string().describe('The WhatsApp JID (e.g., "123456789@g.us")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// Log a posted tweet to Discord #posted channel
server.tool(
  'log_tweet',
  'Log a posted tweet to the Discord #posted channel. Call this after posting any tweet via Zapier or the media script.',
  {
    text: z.string().describe('The tweet text that was posted'),
    url: z.string().optional().describe('The tweet URL (e.g., https://x.com/your_handle/status/...)'),
    source: z.string().optional().describe('How the tweet was posted (e.g., "zapier", "media-script", "autonomous-engagement")'),
  },
  async (args) => {
    const data = {
      type: 'discord_post',
      text: args.text,
      url: args.url || '',
      source: args.source || 'autonomous',
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Tweet logged to Discord #posted channel.` }],
    };
  },
);

// Start a step-file workflow for multi-session task execution.
server.tool(
  'start_workflow',
  `Start a step-file workflow for complex multi-session tasks.
The workflow file is a markdown file with steps defined as "## Step N: Title".
Each step is executed one at a time, with state persisted to disk.
If the session ends mid-workflow, the workflow auto-continues in a new session.

Use this for tasks that:
- Span multiple steps that need sequential execution
- Might take longer than a single session
- Need human checkpoints between steps
- Benefit from structured, auditable execution`,
  {
    workflow_path: z.string().describe('Absolute path to the workflow markdown file'),
    task_description: z.string().describe('What this workflow is accomplishing'),
  },
  async (args) => {
    const data = {
      type: 'start_workflow',
      workflowPath: args.workflow_path,
      taskDescription: args.task_description,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Wait briefly for the host to create the workflow and return its ID
    await new Promise(r => setTimeout(r, 2000));

    // Try to read the response
    const responsesDir = path.join(IPC_DIR, 'responses');
    let response = 'Workflow start requested. Check workflow status for the ID.';
    try {
      const files = fs.existsSync(responsesDir)
        ? fs.readdirSync(responsesDir).filter(f => f.startsWith('workflow-')).sort().reverse()
        : [];
      if (files.length > 0) {
        const respFile = path.join(responsesDir, files[0]);
        const resp = JSON.parse(fs.readFileSync(respFile, 'utf-8'));
        response = JSON.stringify(resp);
        try { fs.unlinkSync(respFile); } catch { /* ignore */ }
      }
    } catch { /* fall back to generic */ }

    return {
      content: [{ type: 'text' as const, text: response }],
    };
  },
);

// Advance to the next step in an active workflow.
server.tool(
  'advance_workflow',
  `Report completion of the current workflow step and advance to the next.
Call this after successfully completing the current step's instructions.`,
  {
    workflow_id: z.string().describe('The workflow ID'),
    step_output: z.string().describe('Summary of what was accomplished in this step'),
  },
  async (args) => {
    const data = {
      type: 'advance_workflow',
      workflowId: args.workflow_id,
      stepOutput: args.step_output,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Wait briefly for the host to process the advancement
    await new Promise(r => setTimeout(r, 2000));

    // Read updated workflow state to return the next step inline
    const workflowsDir = path.join(IPC_DIR, '..', '..', 'workflows');
    let nextStepInfo = 'Advance requested. Check workflow status for the next step.';
    try {
      const wfFile = path.join(workflowsDir, `${args.workflow_id}.json`);
      if (fs.existsSync(wfFile)) {
        const state = JSON.parse(fs.readFileSync(wfFile, 'utf-8'));
        const nextIdx = state.currentStep - 1;
        if (nextIdx >= 0 && nextIdx < state.steps.length) {
          const next = state.steps[nextIdx];
          nextStepInfo = `Next step (${next.number}/${state.steps.length}): ${next.title}\n\n${next.content}`;
        } else if (state.status === 'completed') {
          nextStepInfo = 'Workflow completed! All steps are done.';
        }
      }
    } catch { /* fall back to generic message */ }

    return {
      content: [{ type: 'text' as const, text: nextStepInfo }],
    };
  },
);

// Block the current workflow step (escalate).
server.tool(
  'block_workflow',
  `Report that the current workflow step is blocked and needs escalation.
The workflow will be paused and the user notified.`,
  {
    workflow_id: z.string().describe('The workflow ID'),
    reason: z.string().describe('Why the step is blocked'),
    findings: z.string().optional().describe('What was learned before getting blocked'),
  },
  async (args) => {
    const data = {
      type: 'block_workflow',
      workflowId: args.workflow_id,
      reason: args.reason,
      findings: args.findings || '',
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{
        type: 'text' as const,
        text: `Workflow blocked. The user has been notified. Reason: ${args.reason}`,
      }],
    };
  },
);

// Request user approval via Telegram inline keyboard buttons.
// Agent can wait for the response by polling the IPC response file.
server.tool(
  'request_approval',
  `Request user approval via Telegram inline keyboard buttons.
After calling this tool, poll for the response using check_approval.
The user will see buttons in Telegram and can approve or reject.

Use this for human checkpoints in long-running tasks:
- Before deploying code
- Before sending external messages (tweets, emails)
- Before destructive operations
- At decision points in multi-step workflows`,
  {
    description: z.string().describe('What you are asking approval for. Shown to the user.'),
    approve_label: z.string().optional().describe('Custom approve button label (default: "Approve")'),
    reject_label: z.string().optional().describe('Custom reject button label (default: "Reject")'),
    options: z.array(z.string()).optional().describe('Custom options for multi-choice approval (replaces approve/reject)'),
  },
  async (args) => {
    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'request_approval',
      requestId,
      chatJid,
      description: args.description,
      approveLabel: args.approve_label,
      rejectLabel: args.reject_label,
      options: args.options,
      ipcDir: IPC_DIR,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{
        type: 'text' as const,
        text: `Approval requested (${requestId}). Use check_approval with this ID to poll for the user's response.`,
      }],
    };
  },
);

// Check for approval response from user
server.tool(
  'check_approval',
  `Check if the user has responded to an approval request.
Call this after request_approval to poll for the response.
The response will appear once the user taps a button in Telegram.`,
  {
    request_id: z.string().describe('The approval request ID returned by request_approval'),
    wait_seconds: z.number().optional().describe('How long to wait for a response (default: 30, max: 120)'),
  },
  async (args) => {
    const responsesDir = path.join(IPC_DIR, 'responses');
    const responseFile = path.join(responsesDir, `approval-${args.request_id}.json`);

    const waitMs = Math.min((args.wait_seconds || 30), 120) * 1000;
    const startTime = Date.now();

    // Poll for the response file
    while (Date.now() - startTime < waitMs) {
      if (fs.existsSync(responseFile)) {
        try {
          const response = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          // Clean up the response file
          try { fs.unlinkSync(responseFile); } catch { /* ignore */ }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: response.status,
                choice: response.choice,
                requestId: response.requestId,
              }),
            }],
          };
        } catch {
          // File might be partially written, retry
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'pending',
          message: `No response after ${Math.round(waitMs / 1000)}s. The user hasn't tapped a button yet. Try again.`,
        }),
      }],
    };
  },
);

// Browser daemon commands — persistent browser that survives session boundaries.
server.tool(
  'browser_open',
  `Open a URL in the persistent browser daemon. The browser state (cookies, localStorage)
survives across agent sessions. Use this instead of agent-browser for tasks that need
persistent auth or multi-session browsing.

After opening, you can still use regular agent-browser commands for interactions.
The daemon auto-saves/loads state between sessions.`,
  {
    url: z.string().describe('URL to navigate to'),
    context_id: z.string().optional().describe('Browser context ID (default: current group folder). Use different IDs for separate browser sessions.'),
  },
  async (args) => {
    const requestId = `br-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contextId = args.context_id || groupFolder;
    const browserTasksDir = path.join(IPC_DIR, '..', '..', 'ipc', 'browser', 'commands');
    fs.mkdirSync(browserTasksDir, { recursive: true });

    const cmdFile = path.join(browserTasksDir, `${requestId}.json`);
    fs.writeFileSync(cmdFile, JSON.stringify({
      type: 'open',
      contextId,
      url: args.url,
      requestId,
    }));

    // Wait for result
    const resultsDir = path.join(IPC_DIR, '..', '..', 'ipc', 'browser', 'results');
    const resultFile = path.join(resultsDir, `${requestId}.json`);
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
          try { fs.unlinkSync(resultFile); } catch { /* ignore */ }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch { /* retry */ }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    return {
      content: [{ type: 'text' as const, text: 'Browser daemon did not respond in time. It may not be running.' }],
    };
  },
);

server.tool(
  'browser_status',
  'Check the browser daemon status: whether it is running, active contexts, etc.',
  {},
  async () => {
    const statusFile = path.join(IPC_DIR, '..', '..', 'ipc', 'browser', 'status.json');
    if (!fs.existsSync(statusFile)) {
      return {
        content: [{ type: 'text' as const, text: 'Browser daemon is not running (no status file).' }],
      };
    }

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: 'text' as const, text: 'Failed to read browser daemon status.' }],
      };
    }
  },
);

// ============ Agent Teams Tools ============

server.tool(
  'create_team',
  `Create a new agent team. You become the team lead and can spawn teammates to work on tasks in parallel.

Use this when you have a complex task that can be broken down into independent subtasks that can run concurrently.
Returns the team ID which you need for spawn_teammate.`,
  {
    name: z.string().describe('Unique name for the team (e.g., "refactor-auth-2024")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can create teams.' }],
        isError: true,
      };
    }

    const requestId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const data = {
      type: 'create_team',
      teamName: args.name,
      requestId,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Poll for the response (host writes team ID to responses dir)
    const responsesDir = path.join(IPC_DIR, 'responses');
    const responseFile = path.join(responsesDir, `${requestId}.json`);
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      if (fs.existsSync(responseFile)) {
        try {
          const resp = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          try { fs.unlinkSync(responseFile); } catch { /* ignore */ }
          if (resp.error) {
            return {
              content: [{ type: 'text' as const, text: `Failed to create team: ${resp.error}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: `Team created. ID: ${resp.teamId}\nUse this ID with spawn_teammate to add specialists.` }],
          };
        } catch { /* file may be partially written, retry */ }
      }
      await new Promise(r => setTimeout(r, 200));
    }

    return {
      content: [{ type: 'text' as const, text: `Team "${args.name}" creation requested but no confirmation received. Use list_teams to find the team ID.` }],
    };
  },
);

server.tool(
  'spawn_teammate',
  `Spawn a new teammate agent in a separate process. The teammate will work autonomously on the given task.

Teammates have access to:
- The team's shared workspace directory
- Your group's files (read-only)
- send_message tool to report results

Teammates run with sonnet by default for cost efficiency. Use opus for complex reasoning tasks.
Returns confirmation with member ID, or an error if the spawn failed (e.g. team not found, concurrency cap).`,
  {
    team_id: z.string().describe('The team ID to add the teammate to'),
    name: z.string().describe('A short name for this teammate (e.g., "api-refactor", "test-writer")'),
    prompt: z.string().describe('The task for this teammate to complete. Be specific and include all context needed.'),
    model: z.enum(['claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-opus-4-6']).optional().describe('Model to use (default: claude-sonnet-4-6)'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can spawn teammates.' }],
        isError: true,
      };
    }

    const requestId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const data = {
      type: 'spawn_teammate',
      teamId: args.team_id,
      teammateName: args.name,
      teammatePrompt: args.prompt,
      teammateModel: args.model,
      chatJid,
      sourceChannel,
      requestId,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Poll for the response (host confirms spawn or returns error)
    const responsesDir = path.join(IPC_DIR, 'responses');
    const responseFile = path.join(responsesDir, `${requestId}.json`);
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      if (fs.existsSync(responseFile)) {
        try {
          const resp = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          try { fs.unlinkSync(responseFile); } catch { /* ignore */ }
          if (resp.error) {
            return {
              content: [{ type: 'text' as const, text: `Failed to spawn teammate: ${resp.error}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: `Teammate "${args.name}" spawned successfully.\nMember ID: ${resp.memberId}\nModel: ${resp.model}\nThe teammate is now working autonomously. Their messages will appear in chat.` }],
          };
        } catch { /* file may be partially written, retry */ }
      }
      await new Promise(r => setTimeout(r, 300));
    }

    return {
      content: [{ type: 'text' as const, text: `Teammate "${args.name}" spawn requested for team ${args.team_id}. No confirmation yet — use list_teams to check status.` }],
    };
  },
);

// ============ Team Status Tools (ported from SDK MCP) ============

server.tool(
  'list_teams',
  `List all active teams and their members. Shows team ID, name, status, and member details.
Use this after create_team to verify the team was created, or to find team IDs.`,
  {},
  async () => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can list teams.' }],
        isError: true,
      };
    }

    // Read team snapshot files from IPC directory
    const groupIpcDir = path.dirname(TASKS_DIR); // IPC_DIR is the group's IPC dir
    try {
      const files = fs.existsSync(groupIpcDir)
        ? fs.readdirSync(groupIpcDir).filter(f => f.startsWith('team-') && f.endsWith('.json'))
        : [];

      if (files.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active teams found.' }] };
      }

      const teams = files.map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(groupIpcDir, f), 'utf-8'));
        } catch { return null; }
      }).filter(Boolean);

      if (teams.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active teams found.' }] };
      }

      const formatted = teams.map((t: { team: { id: string; name: string; status: string }; members: Array<{ id: string; name: string; role: string; status: string }>; lastUpdated: string }) => {
        const memberList = t.members
          .map((m: { name: string; role: string; status: string; id: string }) => `  - ${m.name} (${m.role}) [${m.status}] id:${m.id}`)
          .join('\n');
        return `Team: ${t.team.name}\n  ID: ${t.team.id}\n  Status: ${t.team.status}\n  Members:\n${memberList}`;
      }).join('\n\n');

      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing teams: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'cleanup_team',
  'End a team and stop all active teammates. Use when the team has finished its work.',
  {
    team_id: z.string().describe('The team ID to clean up'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can cleanup teams.' }],
        isError: true,
      };
    }

    const data = {
      type: 'cleanup_team',
      teamId: args.team_id,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Clean up local snapshot file
    const groupIpcDir = path.dirname(TASKS_DIR);
    const snapshotFile = path.join(groupIpcDir, `team-${args.team_id}.json`);
    try { if (fs.existsSync(snapshotFile)) fs.unlinkSync(snapshotFile); } catch { /* ignore */ }

    return {
      content: [{ type: 'text' as const, text: `Team ${args.team_id} cleanup requested. All active teammates will be stopped.` }],
    };
  },
);

server.tool(
  'system_status',
  `Check the current system status: active teams, running specialists, scheduled tasks, and queued messages.
Use this to understand what's happening across the system.`,
  {},
  async () => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can check system status.' }],
        isError: true,
      };
    }

    const parts: string[] = [];

    // Active teams from snapshots
    const groupIpcDir = path.dirname(TASKS_DIR);
    try {
      const teamFiles = fs.existsSync(groupIpcDir)
        ? fs.readdirSync(groupIpcDir).filter(f => f.startsWith('team-') && f.endsWith('.json'))
        : [];
      if (teamFiles.length > 0) {
        const teamSummaries = teamFiles.map(f => {
          try {
            const t = JSON.parse(fs.readFileSync(path.join(groupIpcDir, f), 'utf-8'));
            const active = t.members?.filter((m: { status: string }) => m.status === 'active').length || 0;
            const total = t.members?.length || 0;
            return `  ${t.team.name} (${t.team.id}): ${active}/${total} members active`;
          } catch { return null; }
        }).filter(Boolean);
        parts.push(`*Teams (${teamFiles.length}):*\n${teamSummaries.join('\n')}`);
      } else {
        parts.push('*Teams:* None active');
      }
    } catch { parts.push('*Teams:* Error reading'); }

    // Scheduled tasks
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
    try {
      if (fs.existsSync(tasksFile)) {
        const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
        const active = tasks.filter((t: { status: string }) => t.status === 'active').length;
        const paused = tasks.filter((t: { status: string }) => t.status === 'paused').length;
        parts.push(`*Scheduled tasks:* ${active} active, ${paused} paused, ${tasks.length} total`);
      } else {
        parts.push('*Scheduled tasks:* None');
      }
    } catch { parts.push('*Scheduled tasks:* Error reading'); }

    // Active teammate IPC directories (proxy for running specialists)
    const teammatesDir = path.join(path.dirname(groupIpcDir), 'teammates');
    try {
      if (fs.existsSync(teammatesDir)) {
        const memberDirs = fs.readdirSync(teammatesDir).filter(f => {
          try { return fs.statSync(path.join(teammatesDir, f)).isDirectory(); } catch { return false; }
        });
        parts.push(`*Active specialist IPC dirs:* ${memberDirs.length}`);
      } else {
        parts.push('*Active specialists:* None');
      }
    } catch { parts.push('*Active specialists:* Error reading'); }

    return {
      content: [{ type: 'text' as const, text: parts.join('\n\n') }],
    };
  },
);

// ============ Self-Learning Tools ============

const NANOCLAW_GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';

server.tool(
  'record_learning',
  `Record something you learned during this task. Write 1-5 cards after completing work.
Use this to capture patterns, gotchas, tool tips, workflow insights, and architecture notes.
These get stored as Aha Cards and are searchable by future agents via query_learnings.`,
  {
    title: z.string().describe('Short title (< 80 chars)'),
    learning: z.string().describe('What you learned — specific and actionable'),
    category: z.enum(['pattern', 'gotcha', 'tool-tip', 'workflow', 'architecture']),
    context: z.string().describe('What task/file/situation triggered this learning'),
    confidence: z.number().min(0).max(1).describe('How confident are you? 0.5=guess, 0.9=proven'),
    portable: z.boolean().describe('True if this applies beyond this specific project'),
    tags: z.array(z.string()).describe('Keywords for retrieval'),
  },
  async (args) => {
    const groupDir = NANOCLAW_GROUP_DIR;
    const cardsDir = path.join(groupDir, 'learnings', 'cards');
    fs.mkdirSync(cardsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const card = {
      id: `aha-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      source: process.env.NANOCLAW_AGENT_NAME || process.env.NANOCLAW_GROUP_FOLDER || 'klaw',
      task_type: 'general',
      ...args,
    };

    fs.appendFileSync(
      path.join(cardsDir, `${date}.jsonl`),
      JSON.stringify(card) + '\n',
    );

    return { content: [{ type: 'text' as const, text: `Recorded: "${args.title}" [${args.category}]` }] };
  },
);

server.tool(
  'query_learnings',
  `Search past learnings (Aha Cards) for relevant patterns, gotchas, and tips before starting a task.
Use this at the beginning of any implementation or debugging task to check if you or another agent already solved something similar.`,
  {
    query: z.string().describe('What are you about to work on? (keywords or description)'),
    category: z.enum(['pattern', 'gotcha', 'tool-tip', 'workflow', 'architecture', 'all']).optional(),
    limit: z.number().optional().default(10),
  },
  async (args) => {
    const groupDir = NANOCLAW_GROUP_DIR;
    const cardsDir = path.join(groupDir, 'learnings', 'cards');

    if (!fs.existsSync(cardsDir)) {
      return { content: [{ type: 'text' as const, text: 'No learnings recorded yet.' }] };
    }

    // Read last 30 days of cards
    const files = fs.readdirSync(cardsDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-30);

    const allCards: Array<{
      title: string;
      learning: string;
      tags?: string[];
      context: string;
      category: string;
      confidence: number;
      source?: string;
      timestamp?: string;
    }> = [];
    for (const file of files) {
      const lines = fs.readFileSync(path.join(cardsDir, file), 'utf-8')
        .split('\n')
        .filter(Boolean);
      for (const line of lines) {
        try { allCards.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
      }
    }

    // Simple keyword matching (upgrade to embeddings via sqlite-vec later if needed)
    const queryWords = args.query.toLowerCase().split(/\s+/);
    const scored = allCards.map(card => {
      const text = `${card.title} ${card.learning} ${card.tags?.join(' ') || ''} ${card.context}`.toLowerCase();
      const hits = queryWords.filter(w => text.includes(w)).length;
      return { card, score: hits };
    })
    .filter(s => s.score > 0)
    .filter(s => args.category === 'all' || !args.category || s.card.category === args.category)
    .sort((a, b) => b.score - a.score || b.card.confidence - a.card.confidence)
    .slice(0, args.limit);

    if (scored.length === 0) {
      return { content: [{ type: 'text' as const, text: `No relevant learnings found for "${args.query}". Proceed carefully.` }] };
    }

    const formatted = scored.map(s =>
      `[${s.card.category}] ${s.card.title} (${(s.card.confidence * 100).toFixed(0)}% confidence)\n  ${s.card.learning}\n  Context: ${s.card.context}\n  Tags: ${s.card.tags?.join(', ') || 'none'}`,
    ).join('\n\n');

    return { content: [{ type: 'text' as const, text: `Found ${scored.length} relevant learnings:\n\n${formatted}` }] };
  },
);

// Send a document/file to the chat
server.tool(
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
          type: 'text' as const,
          text: `Error: File not found at ${args.file_path}`,
        }],
      };
    }

    const data = {
      type: 'document',
      chatJid,
      filePath: args.file_path,
      caption: args.caption,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(MESSAGES_DIR, data);

    return {
      content: [{
        type: 'text' as const,
        text: `Document queued for delivery (${filename})`,
      }],
    };
  },
);

// ============ Security Scanner ============

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

const PROJECT_DIR = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';

// ============ Agent-Writable Skills (P1) ============

server.tool(
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
      return { content: [{ type: 'text' as const, text: `Skill creation blocked: ${scan.reason}` }], isError: true };
    }
    if (!/^[a-z0-9-]+$/.test(args.name)) {
      return { content: [{ type: 'text' as const, text: 'Skill name must be kebab-case.' }], isError: true };
    }
    const skillDir = path.join(PROJECT_DIR, '.claude', 'skills', args.name);
    if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      return { content: [{ type: 'text' as const, text: `Skill "${args.name}" already exists. Use patch_skill to update it.` }], isError: true };
    }
    fs.mkdirSync(skillDir, { recursive: true });
    const skillContent = `---
name: "${args.name}"
description: "${args.description.replace(/"/g, '\\"')}"
version: "1.0.0"
created: "${new Date().toISOString()}"
created_by: "agent"
category: "${args.category || 'general'}"
---

${args.content}
`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);
    return { content: [{ type: 'text' as const, text: `Skill "${args.name}" created at .claude/skills/${args.name}/SKILL.md` }] };
  },
);

server.tool(
  'patch_skill',
  `Update an existing skill. Use when a skill has incorrect steps or needs refinement.`,
  {
    name: z.string().describe('Skill name to patch'),
    section: z.string().optional().describe('Section header to replace. If omitted, replaces entire body.'),
    new_content: z.string().describe('New content'),
  },
  async (args) => {
    const skillPath = path.join(PROJECT_DIR, '.claude', 'skills', args.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      return { content: [{ type: 'text' as const, text: `Skill "${args.name}" not found.` }], isError: true };
    }
    const scan = scanSkillContent(args.new_content);
    if (!scan.safe) {
      return { content: [{ type: 'text' as const, text: `Skill patch blocked: ${scan.reason}` }], isError: true };
    }
    let content = fs.readFileSync(skillPath, 'utf-8');
    if (args.section) {
      const sectionRegex = new RegExp(
        `(${args.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n)([\\s\\S]*?)(?=\\n## |$)`,
      );
      if (sectionRegex.test(content)) {
        content = content.replace(sectionRegex, `$1${args.new_content}\n`);
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
    content = content.replace(
      /version:\s*"(\d+)\.(\d+)\.(\d+)"/,
      (_, major: string, minor: string, patch: string) => `version: "${major}.${minor}.${parseInt(patch) + 1}"`,
    );
    fs.writeFileSync(skillPath, content);
    return { content: [{ type: 'text' as const, text: `Skill "${args.name}" patched successfully.` }] };
  },
);

server.tool(
  'list_skills',
  'List all available skills with their names and descriptions.',
  {},
  async () => {
    const skillsDir = path.join(PROJECT_DIR, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) {
      return { content: [{ type: 'text' as const, text: 'No skills directory found.' }] };
    }
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    if (entries.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills found.' }] };
    }
    const skills: string[] = [];
    for (const entry of entries) {
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const content = fs.readFileSync(skillPath, 'utf-8');
      const desc = content.match(/description:\s*"([^"]+)"/)?.[1] || 'No description';
      const version = content.match(/version:\s*"([^"]+)"/)?.[1] || '?';
      const createdBy = content.match(/created_by:\s*"([^"]+)"/)?.[1] || 'unknown';
      skills.push(`• ${entry.name} (v${version}, by ${createdBy}): ${desc}`);
    }
    return { content: [{ type: 'text' as const, text: `Available skills (${skills.length}):\n\n${skills.join('\n')}` }] };
  },
);

server.tool(
  'view_skill',
  'Load the full content of a specific skill. Use after list_skills to get details.',
  {
    name: z.string().describe('Skill name to view'),
    file: z.string().optional().describe('Supporting file within skill directory'),
  },
  async (args) => {
    const baseDir = path.join(PROJECT_DIR, '.claude', 'skills', args.name);
    const targetFile = args.file ? path.join(baseDir, args.file) : path.join(baseDir, 'SKILL.md');
    if (!fs.existsSync(targetFile)) {
      return { content: [{ type: 'text' as const, text: `Skill file not found: ${args.name}/${args.file || 'SKILL.md'}` }], isError: true };
    }
    const resolved = path.resolve(targetFile);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      return { content: [{ type: 'text' as const, text: 'Path traversal blocked.' }], isError: true };
    }
    const content = fs.readFileSync(targetFile, 'utf-8');
    return { content: [{ type: 'text' as const, text: content.slice(0, 30000) }] };
  },
);

// ============ Session Search (P2) ============

server.tool(
  'search_sessions',
  `Search past conversation sessions for relevant context. Uses full-text search across archived conversations.`,
  {
    query: z.string().describe('Search query (keywords, phrases)'),
    max_results: z.number().optional().default(5).describe('Maximum sessions to return'),
    days_back: z.number().optional().default(30).describe('How many days back to search'),
  },
  async (args) => {
    const conversationsDir = path.join(NANOCLAW_GROUP_DIR, 'conversations');
    if (!fs.existsSync(conversationsDir)) {
      return { content: [{ type: 'text' as const, text: 'No conversation archives found.' }] };
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - args.days_back);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const files = fs.readdirSync(conversationsDir)
      .filter(f => f.endsWith('.md') && f >= cutoffStr)
      .sort()
      .reverse();
    if (files.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No conversations found in the specified time range.' }] };
    }
    const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) {
      return { content: [{ type: 'text' as const, text: 'Query too short. Use at least one word with 3+ characters.' }], isError: true };
    }
    type ScoredResult = { file: string; score: number; excerpt: string };
    const results: ScoredResult[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(conversationsDir, file), 'utf-8');
      const lower = content.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        score += lower.split(word).length - 1;
      }
      if (score === 0) continue;
      const firstMatchIdx = queryWords.reduce((best, word) => {
        const idx = lower.indexOf(word);
        return idx !== -1 && (best === -1 || idx < best) ? idx : best;
      }, -1);
      const excerpt = content.slice(Math.max(0, firstMatchIdx - 200), Math.min(content.length, firstMatchIdx + 500)).trim();
      results.push({ file, score, excerpt });
    }
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, args.max_results);
    if (topResults.length === 0) {
      return { content: [{ type: 'text' as const, text: `No matches found for "${args.query}".` }] };
    }
    const formatted = topResults.map((r, i) =>
      `### ${i + 1}. ${r.file} (relevance: ${r.score})\n\n${r.excerpt.slice(0, 500)}${r.excerpt.length > 500 ? '...' : ''}`,
    ).join('\n\n---\n\n');
    return { content: [{ type: 'text' as const, text: `Found ${topResults.length} matching sessions:\n\n${formatted}` }] };
  },
);

// ============ Bounded Memory Write (P3) ============

server.tool(
  'memory_write',
  `Write a declarative fact to the group's memory. Bounded to 5000 chars. Oldest entries trimmed automatically.`,
  {
    content: z.string().describe('The fact to remember (1-2 sentences, declarative)'),
    target: z.enum(['memory', 'user']).default('memory').describe('"memory" = agent notes, "user" = user preferences'),
  },
  async (args) => {
    const MEMORY_CHAR_LIMIT = 5000;
    const USER_CHAR_LIMIT = 3000;
    const targetFile = args.target === 'user'
      ? path.join(NANOCLAW_GROUP_DIR, 'USER.md')
      : path.join(NANOCLAW_GROUP_DIR, 'MEMORY.md');
    const charLimit = args.target === 'user' ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
    const scan = scanSkillContent(args.content);
    if (!scan.safe) {
      return { content: [{ type: 'text' as const, text: `Memory write blocked: ${scan.reason}` }], isError: true };
    }
    let existing = '';
    if (fs.existsSync(targetFile)) {
      existing = fs.readFileSync(targetFile, 'utf-8');
    }
    const entry = `\n§ ${args.content} [${new Date().toISOString().split('T')[0]}]`;
    let updated = existing + entry;
    while (updated.length > charLimit) {
      const firstDelim = updated.indexOf('\n§ ', 1);
      if (firstDelim === -1) break;
      const secondDelim = updated.indexOf('\n§ ', firstDelim + 1);
      if (secondDelim === -1) break;
      updated = updated.slice(0, firstDelim) + updated.slice(secondDelim);
    }
    const tmpPath = `${targetFile}.tmp`;
    fs.writeFileSync(tmpPath, updated);
    fs.renameSync(tmpPath, targetFile);
    const remaining = charLimit - updated.length;
    return { content: [{ type: 'text' as const, text: `Memory updated (${args.target}). ${remaining} chars remaining of ${charLimit} limit.` }] };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
