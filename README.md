<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw Lite" width="400">
</p>

<p align="center">
  Personal Claude assistant on Telegram. Small, local-first, endlessly customizable.
</p>

## What is NanoClaw Lite?

NanoClaw Lite is a **personal AI assistant** powered by the Claude Agent SDK, accessible via Telegram. It runs as a single Node.js process on your machine — no containers, no cloud services, no microservices. Just you and Claude, connected through Telegram.

It's designed to be **small enough to understand** (~12K lines of TypeScript across 60 files), **powerful enough to be useful** (scheduling, memory, browser automation, agent teams, autonomous workflows), and **simple enough to hack on** (modify the code directly — no configuration sprawl).

## Quick Start

```bash
git clone https://github.com/cryptoshrine/nanoclaw-lite.git
cd nanoclaw-lite
npm install
npm run setup    # Interactive wizard: Telegram token, Claude auth, assistant name
npm run build
npm start
```

The setup wizard walks you through everything interactively. Or run `claude` then `/setup` for AI-guided setup with troubleshooting.

## Features

### Core
- **Telegram I/O** — message Claude from your phone via Telegram bot (`grammy`)
- **Isolated group context** — each group has its own `CLAUDE.md` memory and isolated filesystem
- **Main channel** — your private chat for admin control; every other group is sandboxed
- **Scheduled tasks** — recurring cron jobs, intervals, or one-time tasks that run Claude and message you back
- **Web access** — search the web and fetch content from URLs
- **Two execution modes** — local (Node.js child process, default) or Docker for OS-level isolation
- **Structured logging** — `pino`-based structured logger across the entire system
- **MCP server support** — extend with Model Context Protocol servers

### Memory
- **Hybrid memory search** — BM25 keyword search (FTS5) + local vector embeddings (`all-MiniLM-L6-v2` via `@xenova/transformers`) with `sqlite-vec`. Zero external API cost
- **Fact extraction** — automatic extraction and indexing of facts from conversations for long-term memory
- **Background review** — post-session learning agent that reviews conversations and extracts insights

### Agents & Automation
- **Agent teams** — spin up teams of specialized agents that collaborate on complex tasks
- **OmX autonomous workflows** — step-file orchestration with specialist routing, dependency chains, and test gates
- **PAL Router** — 3-tier model cost escalation (Haiku → Sonnet → Opus) that auto-upgrades on retries
- **OmX tmux workers** — parallel CLI worker engine that dispatches tasks to Codex, Claude, or Gemini CLI tools
- **Ouroboros integration** — deliberative planning (Double Diamond), evaluation (3-stage), and evolutionary iteration (Ralph mode) via Python MCP bridge. Feature-flagged behind `OUROBOROS_ENABLED=true`

### Interaction
- **Browser automation** — `agent-browser` CLI with Chromium for web scraping and interaction
- **Voice transcription** — transcribe voice messages via Whisper so the agent can read them
- **Inline approvals** — Telegram inline keyboards for human-in-the-loop flows
- **DM allowlist** — control which users can DM the bot directly

### Self-Improvement
- **Middleware pipeline** — composable before/after hooks (metrics, prompt sanitization, session management, error recovery)
- **Agent-writable skills** — agents can create new skills during execution and use them in future sessions
- **Session search** — search past conversation history for context
- **Bounded memory with frozen snapshots** — memory files are snapshotted at session start, writes take effect next session

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday and update the README if there's drift
@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your private chat), no trigger needed — just talk:
```
list all scheduled tasks across groups
pause the Monday briefing task
what did we discuss yesterday?
```

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Claude Code walk you through it.

**Secure by isolation.** Agents can run in Docker containers where they can only see what's explicitly mounted. In local mode, agents run as isolated child processes on the host.

**Built for one user.** This isn't a framework. It's working software you fork and make your own. Have Claude Code customize it to match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** Minimal setup wizard for essentials, Claude Code guides everything else. No monitoring dashboard; ask Claude what's happening. No debugging tools; describe the problem, Claude fixes it.

**Skills over features.** Contributors don't add features to the codebase. Instead, they contribute [Claude Code skills](https://code.claude.com/docs/en/skills) like `/add-slack` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** This runs on the Claude Agent SDK, which means you're running Claude Code directly. A good harness gives smart models superpowers.

## Customizing

There are no configuration files to learn. Just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Architecture

```
Telegram (grammy) → SQLite → Polling Loop → Middleware Pipeline → Agent (Claude Agent SDK) → Response
```

Single Node.js process. Two execution modes:
- **Local mode** (`EXECUTION_MODE=local`): Agents run as direct Node.js child processes. No containers needed. Works on Windows, macOS, Linux.
- **Docker mode** (`EXECUTION_MODE=docker`): Agents run in isolated Linux containers with mounted directories. Full OS-level sandboxing.

Per-group message queue with concurrency control. IPC via filesystem.

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: Telegram bot, message loop, scheduler, IPC watcher |
| `src/local-runner.ts` | Spawns agent as local Node.js child process |
| `src/container-runner.ts` | Spawns agent in Docker container |
| `container/agent-runner/src/index.ts` | Agent entry point (Claude SDK `query()`) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/group-queue.ts` | Per-group queue with global concurrency limit |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations (messages, groups, sessions, state) |
| `src/setup-wizard.ts` | Interactive first-run setup |
| `src/logger.ts` | Structured logging (`pino`) |
| `src/inline-keyboards.ts` | Telegram inline keyboards for approval flows |
| `src/dm-allowlist.ts` | DM access control |
| `src/transcription.ts` | Voice message transcription |
| `src/browser-daemon.ts` | Persistent browser daemon for automation |
| `src/omx-pal.ts` | PAL Router — 3-tier model cost escalation |
| `src/omx-tmux.ts` | Parallel CLI worker engine (Codex/Claude/Gemini) |
| `src/omx-ouroboros.ts` | Ouroboros bridge — deliberative planning + Ralph mode |
| `src/omx-context.ts` | OmX shared context management |
| `groups/*/CLAUDE.md` | Per-group memory |

### Middleware Pipeline (`src/middleware/`)

Composable before/after hooks, like Express/Koa:

| File | Purpose |
|------|---------|
| `pipeline.ts` | Ordered before/after hook execution |
| `metrics.ts` | Timing and logging |
| `snapshot.ts` | Write task/group/fact snapshots to IPC |
| `memory-sync.ts` | Sync memory index before agent runs |
| `prompt-sanitize.ts` | Strip triggers, truncate uploads, remove base64 |
| `clarification.ts` | Catch empty or incomplete prompts |
| `session.ts` | Resolve and persist session IDs |
| `agent.ts` | Invoke the agent (core middleware) |
| `memory-queue.ts` | Queue conversations for fact extraction |
| `error-recovery.ts` | Clear failed sessions |
| `background-review.ts` | Post-session learning and review |

### Memory System (`src/memory/`)

| File | Purpose |
|------|---------|
| `manager.ts` | File indexing, embedding, and hybrid search |
| `hybrid.ts` | BM25 + vector merge with configurable weights |
| `embeddings.ts` | Local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2, 384 dims) |
| `chunker.ts` | Markdown chunking for embedding |
| `fact-extractor.ts` | Extract facts from conversations for long-term memory |
| `schema.ts` | SQLite schema for FTS5 + `sqlite-vec` tables |

### Folder Structure

```
nanoclaw-lite/
├── src/                          # Main TypeScript source (~60 files)
│   ├── middleware/                # Composable middleware pipeline
│   ├── memory/                   # Hybrid search + fact extraction
│   └── *.ts                      # Core modules
├── container/                    # Docker/agent runtime
│   ├── agent-runner/             # Agent SDK wrapper
│   │   └── src/                  # Agent entry point + MCP servers
│   ├── Dockerfile                # Node 22 + Chromium
│   └── skills/                   # Built-in skills (agent-browser)
├── .claude/skills/               # Claude Code skills (9 skills)
├── addons/                       # Optional add-ons (oh-my-codex, clawhip)
├── browser-harness/              # Persistent CDP daemon with skill accumulation (Python)
├── docs/                         # Architecture docs
├── groups/                       # Per-group isolated workspaces
│   └── {group}/CLAUDE.md         # Group-specific memory
├── store/                        # SQLite database (gitignored)
├── data/                         # Application state (gitignored)
│   ├── sessions/                 # Per-group Claude sessions
│   ├── ipc/                      # IPC messaging
│   └── registered_groups.json    # Group registry
└── dist/                         # Compiled JavaScript (gitignored)
```

## Add-Ons

Optional extensions that add capabilities without being required dependencies. See [`addons/README.md`](addons/README.md).

| Add-On | Description | Requires |
|--------|-------------|----------|
| **oh-my-codex** | Routes coding tasks through Codex/Claude/Gemini CLI workers via tmux | `omx-tmux` feature enabled |
| **clawhip** | Discord bridge for agent lifecycle events (#mission-control) | Discord bot token |

Install with:
```bash
bash addons/oh-my-codex/install.sh   # Unix
.\addons\oh-my-codex\install.ps1     # Windows
```

## Browser Harness

Persistent CDP (Chrome DevTools Protocol) daemon with skill accumulation. The daemon survives across agent sessions and learns browser interaction patterns over time. See [`browser-harness/README.md`](browser-harness/README.md).

```bash
cd browser-harness
pip install -e .
browser-harness
```

Provides JSON-RPC methods: `navigate`, `evaluate`, `click`, `fill`, `screenshot`, `wait_for`, `get_html`, `get_text`, plus skill accumulation (`skill_record`, `skill_find`, `skill_execute`).

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
# Required
TELEGRAM_BOT_TOKEN=              # From @BotFather on Telegram

# Claude auth (pick one):
CLAUDE_CODE_OAUTH_TOKEN=         # Claude Pro/Max — run `claude setup-token`
ANTHROPIC_API_KEY=               # Anthropic API key

# Optional
ASSISTANT_NAME=Andy              # Trigger word (default: Andy)
NANOCLAW_MODEL=claude-sonnet-4-6 # Claude model
CONTAINER_TIMEOUT=300000         # Agent timeout in ms (default: 5 minutes)
MAX_HISTORY_AGE_MS=14400000      # Message history window (default: 4 hours)
OPENAI_API_KEY=                  # For voice transcription (optional)
GITHUB_TOKEN=                    # For agent git operations (optional)
LOG_LEVEL=info                   # fatal, error, warn, info, debug, trace
OUROBOROS_ENABLED=false           # Enable Ouroboros deliberative planning (optional)
```

## Skills

Built-in skills you can run with Claude Code:

| Skill | Purpose |
|-------|---------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Troubleshooting issues, logs, diagnostics |
| `/add-telegram` | Add Telegram as a channel |
| `/add-gmail` | Add Gmail read/send integration |
| `/add-voice-transcription` | Add voice message transcription via Whisper |
| `/code-assistant` | Code assistance workflows |
| `/task` | Task scheduling and management |
| `/browser-harness` | Install and configure the persistent browser daemon |

## Contributing

**Don't add features. Add skills.**

If you want to add Slack support, don't create a PR that adds Slack alongside Telegram. Instead, contribute a skill file (`.claude/skills/add-slack/SKILL.md`) that teaches Claude Code how to transform a NanoClaw Lite installation to use Slack.

Users then run `/add-slack` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd love to see:

**Communication Channels**
- `/add-slack` — Add Slack as a channel
- `/add-discord` — Add Discord as a channel
- `/add-whatsapp` — Add WhatsApp as a channel (via Baileys)
- `/add-sms` — Add SMS via Twilio

**Integrations**
- `/add-calendar` — Google Calendar integration

**Session Management**
- `/add-clear` — Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session)

### What gets accepted into the codebase?

Security fixes, bug fixes, and clear improvements to the base configuration. That's it.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills. This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Requirements

- Windows, macOS, or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- Optional: [Docker](https://docker.com/products/docker-desktop) for container isolation
- Optional: Python 3.11+ for browser harness

## FAQ

**Why Telegram?**

Telegram has a clean Bot API, no unofficial library hacks, and works on every platform. The channel is swappable via skills — run `/add-slack` or `/add-discord` to switch. That's the whole point of the skills approach.

**What's local mode vs Docker mode?**

Local mode (`EXECUTION_MODE=local`) spawns agents as direct Node.js child processes — no Docker needed, works on any OS. Docker mode spawns agents inside Linux containers for full OS-level isolation. Choose based on your security needs and platform.

**Can I run this on Windows?**

Yes. Runs natively on Windows (Git Bash recommended). Local mode works out of the box — no containers or WSL2 needed.

**Is this secure?**

In Docker mode, agents run in containers with OS-level isolation — they can only access explicitly mounted directories. In local mode, agents run as child processes with inherited permissions. The codebase is small enough that you can actually review it. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

No configuration sprawl. Every user should customize it so that the code matches exactly what they want rather than configuring a generic system. If you like having config files, tell Claude to add them.

**What's OmX / PAL / Ouroboros?**

Advanced orchestration modules ported from the production NanoClaw. **OmX** handles autonomous multi-step workflows with specialist routing. **PAL** auto-escalates model tiers on retries to save cost. **Ouroboros** adds deliberative planning and evolutionary iteration loops. All are opt-in — the base system works without them.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach. Or run `/debug` for guided troubleshooting.

## License

MIT
