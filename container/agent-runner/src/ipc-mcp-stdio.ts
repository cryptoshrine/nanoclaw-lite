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
    jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
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
    url: z.string().optional().describe('The tweet URL (e.g., https://x.com/Ball_AI_Agent/status/...)'),
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

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
