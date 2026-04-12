# NanoClaw Specification

A personal Claude assistant accessible via Telegram, with persistent memory per conversation, scheduled tasks, and extensible integrations.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Folder Structure](#folder-structure)
3. [Configuration](#configuration)
4. [Memory System](#memory-system)
5. [Session Management](#session-management)
6. [Message Flow](#message-flow)
7. [Commands](#commands)
8. [Scheduled Tasks](#scheduled-tasks)
9. [MCP Servers](#mcp-servers)
10. [Deployment](#deployment)
11. [Security Considerations](#security-considerations)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          HOST (any OS)                               │
│                     (Main Node.js Process)                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │  Telegram     │────────────────────▶│   SQLite Database  │        │
│  │  (bot API)    │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   store/send        └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Message Loop    │    │  Scheduler Loop  │    │  IPC Watcher  │  │
│  │  (polls SQLite)  │    │  (checks tasks)  │    │  (file-based) │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ spawns agent                                 │
│                       ▼                                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT (Claude Agent SDK)                   │   │
│  │  Local mode: Node.js child process                           │   │
│  │  Docker mode: Isolated Linux container                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Telegram Connection | Node.js (node-telegram-bot-api) | Connect to Telegram, send/receive messages |
| Message Storage | SQLite (better-sqlite3) | Store messages for polling |
| Container Runtime | Docker or Apple Container (optional) | Isolated agents |
| Agent | @anthropic-ai/claude-agent-sdk | Run Claude with tools and MCP servers |
| Browser Automation | agent-browser + Chromium | Web interaction and screenshots |
| Runtime | Node.js 20+ | Host process for routing and scheduling |

---

## Folder Structure

```
nanoclaw/
├── CLAUDE.md                      # Project context for Claude Code
├── docs/
│   ├── SPEC.md                    # This specification document
│   ├── REQUIREMENTS.md            # Architecture decisions
│   └── SECURITY.md                # Security model
├── README.md                      # User documentation
├── package.json                   # Node.js dependencies
├── tsconfig.json                  # TypeScript configuration
├── .env.example                   # Example environment variables
├── .gitignore
│
├── src/
│   ├── index.ts                   # Orchestrator: Telegram bot, message loop, agent invocation
│   ├── local-runner.ts            # Spawns agent as local Node.js child process
│   ├── container-runner.ts        # Spawns agent in Docker container
│   ├── ipc.ts                     # IPC watcher and task processing
│   ├── router.ts                  # Message formatting and outbound routing
│   ├── config.ts                  # Configuration constants
│   ├── types.ts                   # TypeScript interfaces
│   ├── logger.ts                  # Pino logger setup
│   ├── db.ts                      # SQLite database operations
│   ├── group-queue.ts             # Per-group queue with global concurrency limit
│   ├── task-scheduler.ts          # Runs scheduled tasks when due
│   └── setup-wizard.ts            # Interactive first-time setup
│
├── container/
│   ├── Dockerfile                 # Container image
│   ├── build.sh                   # Build script for container image
│   ├── agent-runner/              # Code that runs inside the container
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # Entry point (query loop, IPC polling, session resume)
│   │       └── ipc-mcp-stdio.ts   # Stdio-based MCP server for host communication
│   └── skills/
│       └── agent-browser.md       # Browser automation skill
│
├── dist/                          # Compiled JavaScript (gitignored)
│
├── .claude/
│   └── skills/                    # Claude Code skills
│       ├── setup/SKILL.md
│       ├── customize/SKILL.md
│       ├── debug/SKILL.md
│       ├── add-telegram/SKILL.md
│       ├── add-gmail/SKILL.md
│       ├── add-voice-transcription/SKILL.md
│       ├── code-assistant/SKILL.md
│       └── task/SKILL.md
│
├── groups/
│   ├── CLAUDE.md                  # Global memory (all groups read this)
│   ├── main/                      # Self-chat (main control channel)
│   │   ├── CLAUDE.md              # Main channel memory
│   │   └── logs/                  # Task execution logs
│   └── {group-name}/              # Per-group folders
│       ├── CLAUDE.md              # Group-specific memory
│       └── *.md                   # Files created by the agent
│
├── store/                         # Local data (gitignored)
│   └── messages.db                # SQLite database
│
├── data/                          # Application state (gitignored)
│   ├── sessions/                  # Per-group session data
│   └── ipc/                       # IPC (messages/, tasks/)
│
└── logs/                          # Runtime logs (gitignored)
    ├── nanoclaw.log
    └── nanoclaw.error.log
```

---

## Configuration

Configuration constants are in `src/config.ts`:

```typescript
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const TRIGGER_PATTERN = new RegExp(`^@${ASSISTANT_NAME}\\b`, 'i');
```

### Changing the Assistant Name

Set the `ASSISTANT_NAME` environment variable:

```bash
ASSISTANT_NAME=Bot npm start
```

Or edit the default in `src/config.ts`. This changes:
- The trigger pattern (messages must start with `@YourName`)
- The response prefix (`YourName:` added automatically)

### Claude Authentication

Configure in `.env`:

**Option 1: Claude Subscription (OAuth token)**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

**Option 2: Pay-per-use API Key**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

---

## Memory System

NanoClaw uses a hierarchical memory system based on CLAUDE.md files.

### Memory Hierarchy

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/CLAUDE.md` | All groups | Main only | Preferences, facts shared across all conversations |
| **Group** | `groups/{name}/CLAUDE.md` | That group | That group | Group-specific context, conversation memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents |

### How Memory Works

1. **Agent Context Loading**
   - Agent runs with `cwd` set to `groups/{group-name}/`
   - Claude Agent SDK automatically loads both global and group CLAUDE.md files

2. **Writing Memory**
   - "Remember this" → agent writes to group's CLAUDE.md
   - "Remember this globally" (main channel only) → writes to global CLAUDE.md

---

## Session Management

Sessions enable conversation continuity — Claude remembers what you talked about.

1. Each group has a session ID stored in SQLite
2. Session ID is passed to Claude Agent SDK's `resume` option
3. Claude continues the conversation with full context
4. Session transcripts are stored as JSONL files in `data/sessions/{group}/.claude/`

---

## Message Flow

```
1. User sends Telegram message
2. Message stored in SQLite
3. Polling loop checks every 2 seconds
4. Router checks: registered group? trigger match?
5. Conversation catch-up: all messages since last agent interaction
6. Agent invoked with conversation context
7. Response sent back via Telegram
```

### Trigger Word Matching

Messages must start with the trigger pattern (default: `@Andy`):
- `@Andy what's the weather?` → Triggers Claude
- `@andy help me` → Triggers (case insensitive)
- `Hey @Andy` → Ignored (trigger not at start)

---

## Scheduled Tasks

### Schedule Types

| Type | Value Format | Example |
|------|--------------|---------|
| `cron` | Cron expression | `0 9 * * 1` (Mondays at 9am) |
| `interval` | Milliseconds | `3600000` (every hour) |
| `once` | ISO timestamp | `2024-12-25T09:00:00` |

### Managing Tasks

- List tasks, pause/resume/cancel from any group
- Main channel can manage all groups' tasks
- Schedule tasks for other groups via `target_group_jid`

---

## MCP Servers

### NanoClaw MCP (built-in)

| Tool | Purpose |
|------|---------|
| `schedule_task` | Schedule a recurring or one-time task |
| `list_tasks` | Show tasks |
| `pause_task` | Pause a task |
| `resume_task` | Resume a paused task |
| `cancel_task` | Delete a task |
| `send_message` | Send a message to the group |

---

## Deployment

### Running as a Service

**macOS (launchd):**
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

**Linux (systemd):**
```bash
systemctl --user enable --now nanoclaw
```

**Windows:**
```bash
npm start  # or use pm2 for background execution
```

---

## Security Considerations

### Execution Modes

- **Local mode**: Agents run as child processes with inherited permissions
- **Docker mode**: Agents run in isolated containers, can only access mounted directories

### Prompt Injection Mitigations

- Only registered groups are processed
- Trigger word required (reduces accidental processing)
- Container isolation limits blast radius (in Docker mode)
- Claude's built-in safety training

### Recommendations

- Only register trusted groups
- Review directory mounts carefully
- Review scheduled tasks periodically

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No response to messages | Check if service is running |
| Session not continuing | Check SQLite sessions table |
| Bot not responding | Verify Telegram token, check logs |

### Debug Mode

```bash
LOG_LEVEL=debug npm start
```
