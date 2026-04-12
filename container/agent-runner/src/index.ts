/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per multi-turn result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';
import { loadExternalMcpServers } from './load-mcp-servers.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  sourceChannel?: string;
  secrets?: Record<string, string>;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

// Resolve workspace paths from environment variables (local-runner on Windows)
// or fall back to Docker container paths (/workspace/*)
const GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
const IPC_BASE_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const PROJECT_DIR = process.env.NANOCLAW_PROJECT_DIR || '/workspace/project';
const MODEL = process.env.NANOCLAW_MODEL || 'claude-sonnet-4-6';

const IPC_INPUT_DIR = path.join(IPC_BASE_DIR, 'input');
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Stream chunk sentinels: used to send incremental text to the parent process
// so it can broadcast to KlawHQ in real-time (separate from the final output markers).
const STREAM_CHUNK_MARKER = '---NANOCLAW_STREAM_CHUNK---';
const STREAM_CHUNK_END = '---NANOCLAW_STREAM_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

/**
 * Write a streaming text chunk to stdout for real-time KlawHQ display.
 * Debounced: only emits if enough text has accumulated or enough time has passed.
 */
let streamBuffer = '';
let streamTimer: ReturnType<typeof setTimeout> | null = null;
const STREAM_FLUSH_INTERVAL = 300; // ms
const STREAM_MIN_CHARS = 40; // minimum chars before flushing

function flushStreamBuffer(): void {
  if (streamBuffer.length === 0) return;
  const chunk = streamBuffer;
  streamBuffer = '';
  if (streamTimer) {
    clearTimeout(streamTimer);
    streamTimer = null;
  }
  console.log(`${STREAM_CHUNK_MARKER}${chunk}${STREAM_CHUNK_END}`);
}

function writeStreamChunk(text: string): void {
  streamBuffer += text;
  if (streamBuffer.length >= STREAM_MIN_CHARS) {
    flushStreamBuffer();
  } else if (!streamTimer) {
    streamTimer = setTimeout(flushStreamBuffer, STREAM_FLUSH_INTERVAL);
  }
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Custom instructions for the compaction summarizer.
 * Returned via systemMessage in the PreCompact hook — the SDK injects this
 * into the compaction prompt as "Additional Instructions".
 */
const COMPACTION_INSTRUCTIONS = `When summarizing this conversation, ALWAYS preserve verbatim:
- Memory context references (SOUL.md, USER.md, knowledge index, daily log entries)
- All file paths, function names, variable names, and line numbers mentioned
- Specific error messages, stack traces, and their resolutions
- Decisions made and their rationale (why X was chosen over Y)
- Active work thread status and next steps
- Scheduled task IDs, cron expressions, and configuration values
- Session handoff blocks (<handoff> content)
- API keys, endpoint URLs, script paths (names only, never actual secrets)
- Tool call results that informed decisions
- References to any active/ credential files (e.g. "credentials saved to active/gumroad-creds.md")

IMPORTANT — User-provided credentials:
If the user shared login credentials, API keys, passwords, or tokens during this conversation,
note that they were saved to an active/ file (include the filename) so the agent can re-read them.
Never include the actual secret values in the summary — only reference the file path.

Aggressively compress:
- Verbose tool outputs (file listings, grep results) — keep only the relevant matches
- Repeated file reads of the same file — keep only the final state
- Intermediate search/exploration steps that led nowhere
- System reminder tags and boilerplate
- Long code blocks — summarize what changed, keep diffs minimal`;

/**
 * Archive the full transcript to conversations/ before compaction,
 * and return custom compaction instructions via systemMessage.
 */
function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return { systemMessage: COMPACTION_INSTRUCTIONS };
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return { systemMessage: COMPACTION_INSTRUCTIONS };
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = path.join(GROUP_DIR, 'conversations');
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { systemMessage: COMPACTION_INSTRUCTIONS };
  };
}

// Secrets to strip from Bash tool subprocess environments.
// These are needed by claude-code for API auth but should never
// be visible to commands Kit runs.
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

function createSanitizeBashHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}

/**
 * In-process file cache keyed on mtime — avoids re-reading unchanged files
 * across multiple agent invocations in the same process (e.g. IPC message loop).
 */
const fileCache = new Map<string, { mtimeMs: number; content: string | null }>();

/**
 * Read a file safely, returning its content or null if not found/error.
 * Uses mtime cache to skip re-reads of unchanged files.
 */
function readFileSafe(filePath: string, maxChars = 10000): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.content ? cached.content.slice(0, maxChars) : null;
    }

    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const result = content || null;
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, content: result });

    // Cap cache size to prevent unbounded growth
    if (fileCache.size > 50) {
      const first = fileCache.keys().next().value;
      if (first) fileCache.delete(first);
    }

    return result ? result.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

/**
 * Get today's (or yesterday's) daily log path.
 */
function getDailyLogPath(groupDir: string, daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const dateStr = d.toISOString().split('T')[0];
  return path.join(groupDir, 'daily', `${dateStr}.md`);
}

/**
 * Build memory context from SOUL.md, USER.md, MEMORY.md, and daily log.
 * Injected into the system prompt so agents start with full context.
 */
function buildMemoryContext(groupDir: string): string | null {
  const parts: string[] = [];
  let totalChars = 0;
  const MAX_CONTEXT = 20000;

  const addPart = (label: string, content: string | null) => {
    if (!content || totalChars >= MAX_CONTEXT) return;
    const section = `## ${label}\n${content}`;
    const remaining = MAX_CONTEXT - totalChars;
    if (section.length > remaining) {
      parts.push(section.slice(0, remaining));
      totalChars = MAX_CONTEXT;
    } else {
      parts.push(section);
      totalChars += section.length;
    }
  };

  addPart('Soul', readFileSafe(path.join(groupDir, 'SOUL.md')));
  addPart('User', readFileSafe(path.join(groupDir, 'USER.md')));
  // Prefer knowledge/_index.md (PARA structured) over flat MEMORY.md
  const knowledgeIndex = readFileSafe(path.join(groupDir, 'knowledge', '_index.md'));
  if (knowledgeIndex) {
    addPart('Knowledge Index', knowledgeIndex);
  } else {
    addPart('Long-Term Memory', readFileSafe(path.join(groupDir, 'MEMORY.md'), 15000));
  }

  // Today's daily log, falling back to yesterday
  const todayLog = readFileSafe(getDailyLogPath(groupDir, 0), 12000);
  const yesterdayLog = !todayLog ? readFileSafe(getDailyLogPath(groupDir, 1), 5000) : null;
  if (todayLog) {
    addPart('Daily Log (Today)', todayLog);
  } else if (yesterdayLog) {
    addPart('Daily Log (Yesterday)', yesterdayLog);
  }

  // Active work threads — files in active/ that track in-progress multi-session work
  const activeDir = path.join(groupDir, 'active');
  if (fs.existsSync(activeDir)) {
    try {
      const activeFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.md'));
      if (activeFiles.length > 0) {
        const threadParts: string[] = [];
        for (const file of activeFiles.slice(0, 5)) { // Cap at 5 active threads
          const content = readFileSafe(path.join(activeDir, file), 2000);
          if (content) {
            threadParts.push(`### ${file}\n${content}`);
          }
        }
        if (threadParts.length > 0) {
          addPart('Active Work Threads', threadParts.join('\n\n'));
        }
      }
    } catch {
      // Non-fatal — active/ may not exist yet
    }
  }

  // Learned patterns from Aha Cards (written by nightly consolidation cron)
  const patternsPath = path.join(groupDir, 'learnings', 'patterns.json');
  const patternsRaw = readFileSafe(patternsPath, 3000);
  if (patternsRaw) {
    try {
      const { patterns } = JSON.parse(patternsRaw) as {
        patterns: Array<{ title: string; frequency: number; confidence: number }>;
      };
      if (patterns?.length > 0) {
        const topPatterns = patterns
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10)
          .map(p => `- [${p.title}] (seen ${p.frequency}x, ${(p.confidence * 100).toFixed(0)}% confidence)`)
          .join('\n');
        addPart('Learned Patterns', topPatterns);
      }
    } catch {
      // Non-fatal — patterns.json may be malformed
    }
  }

  // Extracted facts from the memory queue (written by SnapshotMiddleware)
  const factsPath = path.join(IPC_BASE_DIR, 'memory_facts.json');
  const factsRaw = readFileSafe(factsPath, 5000);
  if (factsRaw) {
    try {
      const facts = JSON.parse(factsRaw) as Array<{
        content: string;
        category: string;
        confidence: number;
      }>;
      if (facts.length > 0) {
        const formatted = facts
          .map((f) => `- [${f.category}] ${f.content} (${(f.confidence * 100).toFixed(0)}%)`)
          .join('\n');
        addPart('Extracted Facts', formatted);
      }
    } catch {
      // Non-fatal — facts file may be corrupt
    }
  }

  if (parts.length === 0) return null;

  return `\n\n# Injected Memory Context\nThe following memory files were loaded from your group directory at session start. Use this context to maintain continuity across sessions.\n\n${parts.join('\n\n')}`;
}

/**
 * Read pending agent inbox messages and mark them as processed.
 * Returns formatted context string to inject into system prompt, or null if empty.
 */
function readAgentInboxContext(ipcBaseDir: string): string | null {
  const inboxDir = path.join(ipcBaseDir, 'agent-inbox');
  if (!fs.existsSync(inboxDir)) return null;

  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return null;

  const processedDir = path.join(inboxDir, 'processed');
  fs.mkdirSync(processedDir, { recursive: true });

  const messages: string[] = [];
  for (const file of files) {
    const filePath = path.join(inboxDir, file);
    try {
      const msg = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
        id: string;
        from: string;
        subject?: string;
        message: string;
        inReplyTo?: string | null;
        timestamp: string;
      };
      const subjectLine = msg.subject ? `\n**Subject:** ${msg.subject}` : '';
      const replyLine = msg.inReplyTo ? `\n**Re:** ${msg.inReplyTo}` : '';
      messages.push(
        `**ID:** ${msg.id}\n**From:** ${msg.from}${subjectLine}\n**Time:** ${msg.timestamp}${replyLine}\n\n${msg.message}`,
      );
      // Mark as read by moving to processed/
      fs.renameSync(filePath, path.join(processedDir, file));
    } catch {
      // Skip corrupt files
    }
  }

  if (messages.length === 0) return null;

  const header = `\n\n# Agent Inbox\nYou have ${messages.length} pending message${messages.length !== 1 ? 's' : ''} from other agents. Reply using the \`send_agent_message\` tool.`;
  return `${header}\n\n${messages.join('\n\n---\n\n')}`;
}

/**
 * Append an entry to today's daily log.
 */
function appendToDailyLog(groupDir: string, entry: string): void {
  try {
    const dailyDir = path.join(groupDir, 'daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    const logPath = getDailyLogPath(groupDir, 0);

    // Create file with header if it doesn't exist
    if (!fs.existsSync(logPath)) {
      const dateStr = new Date().toISOString().split('T')[0];
      fs.writeFileSync(logPath, `# Daily Log — ${dateStr}\n\n`);
    }

    fs.appendFileSync(logPath, entry + '\n\n');
  } catch (err) {
    log(`Failed to append to daily log: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Append a session entry to DEVLOG.md in the project root.
 */
function appendToDevLog(projectDir: string, entry: string): void {
  try {
    const devlogPath = path.join(projectDir, 'DEVLOG.md');
    if (fs.existsSync(devlogPath)) {
      fs.appendFileSync(devlogPath, entry + '\n\n');
    }
  } catch (err) {
    log(`Failed to append to DEVLOG: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Parse a <handoff> block from agent output.
 * Returns structured fields or null if no handoff found.
 */
function parseHandoff(text: string): Record<string, string> | null {
  const match = text.match(/<handoff>([\s\S]*?)<\/handoff>/i);
  if (!match) return null;

  const block = match[1];
  const fields: Record<string, string> = {};

  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      fields[key] = value;
    }
  }

  return Object.keys(fields).length > 0 ? fields : null;
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : 'Andy';
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
/** Max retries for dangling tool call recovery */
const MAX_DANGLING_RETRIES = 1;

/**
 * Detect if an error is likely caused by a dangling/interrupted tool call.
 * These happen when the model hits max tokens mid-tool_use, leaving an
 * incomplete tool_use block with no matching tool_result.
 */
function isDanglingToolCallError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const patterns = [
    'tool_use',
    'tool_result',
    'malformed',
    'unexpected end',
    'incomplete',
    'dangling',
  ];
  const lower = msg.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean; lastResultText?: string; lastResultError?: string }> {
  const stream = new MessageStream();
  stream.push(prompt);

  // Poll IPC for follow-up messages and _close sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let lastResultText: string | undefined;
  let lastResultError: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = path.join(path.dirname(GROUP_DIR), 'global', 'CLAUDE.md');
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // SessionStart: Build memory context from SOUL.md, USER.md, MEMORY.md, daily log
  const memoryContext = buildMemoryContext(GROUP_DIR);
  if (memoryContext) {
    log(`Memory context loaded (${memoryContext.length} chars)`);
  }

  // Inject pending agent inbox messages (from other agents)
  const inboxContext = readAgentInboxContext(IPC_BASE_DIR);
  if (inboxContext) {
    log(`Agent inbox injected (${inboxContext.length} chars)`);
  }

  // Combine global CLAUDE.md + memory context + inbox into system prompt append
  const systemAppend = [globalClaudeMd, memoryContext, inboxContext].filter(Boolean).join('\n\n') || undefined;

  // Discover additional directories:
  // 1. /workspace/extra/* (Docker mount convention)
  // 2. NANOCLAW_TEAM_DIR (shared workspace for specialists — DeerFlow Phase 2)
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  // Load external MCP servers from MCPorter config (config/mcporter.json)
  const externalMcpServers = await loadExternalMcpServers(
    process.env.NANOCLAW_PROJECT_DIR
  );
  const externalMcpToolPatterns = Object.keys(externalMcpServers).map(
    (name) => `mcp__${name}__*`
  );

  for await (const message of query({
    prompt: stream,
    options: {
      model: MODEL,
      betas: ['context-1m-2025-08-07'],
      cwd: GROUP_DIR,
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: systemAppend
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: systemAppend }
        : undefined,
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
        ...externalMcpToolPatterns,
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
            NANOCLAW_SOURCE_CHANNEL: containerInput.sourceChannel || 'telegram',
          },
        },
        ...externalMcpServers,
      },
      hooks: {
        PreCompact: [{ hooks: [createPreCompactHook()] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
      },
    }
  })) {
    messageCount++;
    const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    // Stream assistant text chunks to parent for real-time KlawHQ display
    if (message.type === 'assistant' && 'message' in message) {
      const msg = message as { message?: { content?: Array<{ type: string; text?: string }> } };
      const textParts = msg.message?.content?.filter(c => c.type === 'text').map(c => c.text || '') || [];
      const text = textParts.join('');
      if (text.length > 0) {
        writeStreamChunk(text);
      }
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
      const tn = message as { task_id: string; status: string; summary: string };
      log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
    }

    if (message.type === 'result') {
      // Flush any remaining stream buffer before emitting the final result
      flushStreamBuffer();

      resultCount++;
      const textResult = 'result' in message ? (message as { result?: string }).result : null;
      if (textResult) lastResultText = textResult;

      // Detect dangling tool call errors in result messages
      const resultError = 'error' in message ? (message as { error?: string }).error : null;
      if (resultError) {
        lastResultError = resultError;
      }

      log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}${resultError ? ` error=${resultError.slice(0, 200)}` : ''}`);
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId
      });
    }
  }

  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery, lastResultText, lastResultError };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    // Delete the temp file the entrypoint wrote — it contains secrets
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Build SDK env: merge secrets into process.env for the SDK only.
  // Secrets never touch process.env itself, so Bash subprocesses can't see them.
  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(containerInput.secrets || {})) {
    sdkEnv[key] = value;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  const sessionStartTime = Date.now();
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Write progress.json so CENTCOMM Live dashboard can track this session
  const progressPath = path.join(IPC_BASE_DIR, 'progress.json');
  const sessionIdForProgress = containerInput.sessionId || `new-${Date.now()}`;
  const writeProgress = (status: 'running' | 'completed' | 'error', error: string | null = null) => {
    try {
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      fs.writeFileSync(progressPath, JSON.stringify({
        groupFolder: containerInput.groupFolder,
        groupName: containerInput.groupFolder,
        sessionId: sessionIdForProgress,
        status,
        startedAt: new Date(sessionStartTime).toISOString(),
        lastUpdate: new Date().toISOString(),
        prompt: containerInput.prompt.slice(0, 500),
        steps: [],
        currentStep: null,
        logs: [],
        error,
      }));
    } catch { /* non-fatal */ }
  };
  writeProgress('running');

  // DevLog: record session start
  const devlogTs = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const devlogPromptPreview = containerInput.prompt.slice(0, 150).replace(/\n/g, ' ');
  const devlogType = containerInput.isScheduledTask ? 'Scheduled Task' : 'Session';
  appendToDevLog(PROJECT_DIR,
    `### [${devlogTs()}] SESSION_START | ${devlogType} — ${containerInput.groupFolder}\n` +
    `- Prompt: ${devlogPromptPreview}${containerInput.prompt.length > 150 ? '...' : ''}`
  );

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  let lastResultText: string | undefined;
  try {
    let danglingRetries = 0;

    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      let queryResult;
      try {
        queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt);
      } catch (queryErr) {
        // Dangling tool call recovery: if the query failed due to an
        // interrupted tool call, retry once with a recovery prompt instead
        // of letting ErrorRecoveryMiddleware nuke the entire session.
        if (isDanglingToolCallError(queryErr) && danglingRetries < MAX_DANGLING_RETRIES) {
          danglingRetries++;
          log(`Dangling tool call detected (retry ${danglingRetries}/${MAX_DANGLING_RETRIES}), recovering...`);
          prompt = 'The previous tool call was interrupted. Please continue from where you left off.';
          // Keep the same sessionId and resumeAt to continue the session
          continue;
        }
        throw queryErr;
      }

      // Check if the result contains a dangling tool call error
      if (queryResult.lastResultError && isDanglingToolCallError(queryResult.lastResultError) && danglingRetries < MAX_DANGLING_RETRIES) {
        danglingRetries++;
        log(`Dangling tool call in result (retry ${danglingRetries}/${MAX_DANGLING_RETRIES}), recovering...`);
        // Update session tracking before retry
        if (queryResult.newSessionId) sessionId = queryResult.newSessionId;
        if (queryResult.lastAssistantUuid) resumeAt = queryResult.lastAssistantUuid;
        prompt = 'The previous tool call was interrupted. Please continue from where you left off.';
        continue;
      }

      // Reset retry counter on successful query
      danglingRetries = 0;

      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }
      if (queryResult.lastResultText) {
        lastResultText = queryResult.lastResultText;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
    // SessionEnd: Append session summary to daily log with handoff context
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const durationMin = Math.round((Date.now() - sessionStartTime) / 60000);
    const isScheduled = containerInput.isScheduledTask ? ' [Scheduled Task]' : '';
    const promptPreview = containerInput.prompt.slice(0, 120).replace(/\n/g, ' ');

    // Parse handoff block from the agent's last output
    const handoff = lastResultText ? parseHandoff(lastResultText) : null;

    let sessionEntry =
      `## Session @ ${timeStr}${isScheduled}\n` +
      `- Duration: ${durationMin}min\n` +
      `- Prompt: ${promptPreview}${containerInput.prompt.length > 120 ? '...' : ''}`;

    if (handoff) {
      sessionEntry += `\n- Topic: ${handoff.topic || 'unknown'}`;
      sessionEntry += `\n- Status: ${handoff.status || 'completed'}`;
      if (handoff.summary) sessionEntry += `\n- Summary: ${handoff.summary}`;
      if (handoff.pending && handoff.pending !== 'none') sessionEntry += `\n- Pending: ${handoff.pending}`;
      if (handoff.next_step && handoff.next_step !== 'none') sessionEntry += `\n- Next step: ${handoff.next_step}`;
      if (handoff.active_threads && handoff.active_threads !== 'none') sessionEntry += `\n- Active threads: ${handoff.active_threads}`;
      log(`Handoff parsed: topic=${handoff.topic}, status=${handoff.status}`);
    } else {
      sessionEntry += `\n- Status: Completed`;
      if (lastResultText) {
        log('No <handoff> block found in agent output');
      }
    }

    appendToDailyLog(GROUP_DIR, sessionEntry);
    log('Session summary appended to daily log');
    writeProgress('completed');
    appendToDevLog(PROJECT_DIR,
      `### [${devlogTs()}] SESSION_END | ${devlogType} — ${containerInput.groupFolder}\n` +
      `- Status: Completed\n` +
      `- Duration: ${durationMin}min`
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);

    // Log error to daily log
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    appendToDailyLog(GROUP_DIR,
      `## Session @ ${timeStr} [ERROR]\n` +
      `- Error: ${errorMessage.slice(0, 200)}\n` +
      `- Prompt: ${containerInput.prompt.slice(0, 80).replace(/\n/g, ' ')}...`
    );
    writeProgress('error', errorMessage.slice(0, 500));
    appendToDevLog(PROJECT_DIR,
      `### [${devlogTs()}] SESSION_END | ${devlogType} — ${containerInput.groupFolder}\n` +
      `- Status: ERROR\n` +
      `- Error: ${errorMessage.slice(0, 300)}`
    );

    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }

  // Force exit: after the query loop ends, the MCP server child process
  // and SDK internals may keep handles alive, preventing Node from draining
  // the event loop. In Docker this doesn't matter (container cleanup), but
  // in local mode the process hangs indefinitely without this.
  process.exit(0);
}

main();
