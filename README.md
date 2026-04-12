<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw Lite" width="400">
</p>

<p align="center">
  A lightweight fork of <a href="https://github.com/qwibitai/nanoclaw">NanoClaw</a> — personal Claude assistant on Telegram. Stripped down, easier to extend.
</p>

<p align="center">
  <a href="https://discord.gg/VGWXrf8x"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>
</p>

## What is NanoClaw Lite?

This is a **community fork** of [NanoClaw](https://github.com/qwibitai/nanoclaw) (27K+ stars) with the container-first architecture and credential proxy stripped out in favor of a simpler local-first approach. Same core — fewer moving parts.

### How it differs from the original

| Feature | [NanoClaw](https://github.com/qwibitai/nanoclaw) | NanoClaw Lite |
|---|---|---|
| **Execution model** | Container-first (Docker / Apple Container) | Local-first (Node.js child process), Docker optional |
| **Credential security** | OneCLI Agent Vault proxy — agents never hold raw keys | Direct env vars — simpler, you trust your own machine |
| **Channel support** | Multi-channel registry (auto-detects from env). Skills for Telegram, WhatsApp, Slack, Discord, Gmail, Emacs | Telegram built-in. Other channels via skills |
| **Mount security** | `mount-security.ts` — validates container mount paths | Not needed (local mode has no mount boundary) |
| **Remote control** | Host-level Claude Code access from inside containers | Not applicable (agents already run on host) |
| **Container runtime** | Apple Container (macOS), Docker, Docker Sandboxes (micro VMs) | Docker optional, local mode is default |
| **Skills** | 28 skills across 4 types (branch-based, utility, operational, container) | Core operational skills (`/setup`, `/customize`, `/debug`) + channel skills |
| **Dependencies** | 3 prod deps (`@onecli-sh/sdk`, `better-sqlite3`, `cron-parser`) | No OneCLI dependency. Same SQLite + cron |
| **Platform** | macOS-first (Apple Container), Linux (Docker), Windows (WSL2 required) | Windows-native (Git Bash), macOS, Linux — no WSL2 needed |
| **Setup** | AI-guided (`/setup` skill) | Interactive CLI wizard + AI-guided `/setup` |

### What we added

- **Hybrid memory search** — BM25 keyword search (FTS5) + local vector embeddings (`all-MiniLM-L6-v2`, 384 dims) with `sqlite-vec`. Zero API cost
- **Fact extraction** — automatic extraction and indexing of facts from conversations
- **Middleware pipeline** — composable before/after hooks (metrics, prompt sanitization, session management, error recovery)
- **Agent Swarms** — spin up teams of specialized agents that collaborate on tasks
- **Inline approvals** — Telegram inline keyboards for human-in-the-loop flows
- **Browser automation** — agent-browser CLI with Chromium
- **Voice transcription** — transcribe voice messages via Whisper
- **DM allowlist** — control which users can DM the bot
- **Structured logging** — `pino`-based logger

### Why fork?

The original NanoClaw is designed around container isolation with a credential proxy — great for security, but adds complexity if you're running on your own machine and don't need OS-level sandboxing. This fork trades container isolation for simplicity:

- **Runs anywhere** — Windows, macOS, Linux, no WSL2 or Docker required
- **Faster startup** — no container image to build or pull
- **Easier to hack on** — modify code, restart, see changes immediately
- **Same foundation** — identical core architecture (SQLite, polling loop, Claude Agent SDK)

> Want container isolation and the OneCLI credential proxy? Use the [original repo](https://github.com/qwibitai/nanoclaw).

## Origin

[OpenClaw](https://github.com/openclaw/openclaw) is an impressive project with a great vision. But I can't sleep well running software I don't understand with access to my life. OpenClaw has 52+ modules, 8 config management files, 45+ dependencies, and abstractions for 15 channel providers. Security is application-level (allowlists, pairing codes) rather than OS isolation. Everything runs in one Node process with shared memory.

NanoClaw gives you the same core functionality in a codebase you can understand in 8 minutes. One process. A handful of files. NanoClaw Lite takes it further — no containers to manage, just a local process you can start and stop.

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

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Claude Code walk you through it.

**Secure by isolation.** Agents can run in Linux containers (Apple Container on macOS, or Docker) where they can only see what's explicitly mounted. In local mode, agents run as isolated child processes on the host.

**Built for one user.** This isn't a framework. It's working software that fits my exact needs. You fork it and have Claude Code make it match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** Minimal setup wizard for essentials, Claude Code guides everything else. No monitoring dashboard; ask Claude what's happening. No debugging tools; describe the problem, Claude fixes it.

**Skills over features.** Contributors shouldn't add features (e.g. support for Telegram) to the codebase. Instead, they contribute [claude code skills](https://code.claude.com/docs/en/skills) like `/add-telegram` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** This runs on Claude Agent SDK, which means you're running Claude Code directly. The harness matters. A bad harness makes even smart models seem dumb, a good harness gives them superpowers. Claude Code is (IMO) the best harness available.

## What It Supports

- **Telegram I/O** - Message Claude from your phone via Telegram bot (`node-telegram-bot-api`)
- **Isolated group context** - Each group has its own `CLAUDE.md` memory and isolated filesystem
- **Main channel** - Your private chat for admin control; every other group is isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content
- **Two execution modes** - Local (direct Node.js child process) or Docker/Apple Container for full OS-level isolation
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks
- **Middleware pipeline** - Composable before/after hook system for metrics, prompt sanitization, session management, error recovery, and more
- **Hybrid memory search** - BM25 keyword search (FTS5) + local vector embeddings (`all-MiniLM-L6-v2`, 384 dims via `@xenova/transformers`) with `sqlite-vec`. Zero external API cost
- **Fact extraction** - Automatic extraction and indexing of facts from conversations for long-term memory
- **Browser automation** - agent-browser CLI with Chromium for web scraping and interaction
- **Voice transcription** - Transcribe voice messages so the agent can read and respond to them
- **Inline approvals** - Telegram inline keyboards for human-in-the-loop approval flows
- **DM allowlist** - Control which users can DM the bot directly
- **Structured logging** - `pino`-based structured logger across the entire system
- **Interactive setup wizard** - Guided first-run setup for Telegram token, Claude auth, and assistant name
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

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

## Customizing

There are no configuration files to learn. Just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Contributing

**Don't add features. Add skills.**

If you want to add Slack support, don't create a PR that adds Slack alongside Telegram. Instead, contribute a skill file (`.claude/skills/add-slack/SKILL.md`) that teaches Claude Code how to transform a NanoClaw installation to use Slack.

Users then run `/add-slack` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd love to see:

**Communication Channels**
- `/add-slack` - Add Slack as a channel
- `/add-discord` - Add Discord as a channel
- `/add-whatsapp` - Add WhatsApp as a channel (via Baileys)

**Integrations**
- `/add-gmail` - Gmail read/send integration (skill exists, needs OAuth setup)
- `/add-voice` - Voice message transcription via Whisper

**Session Management**
- `/add-clear` - Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session). Requires figuring out how to trigger compaction programmatically via the Claude Agent SDK.

## Requirements

- Windows, macOS, or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- Optional: [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) for container isolation

## Architecture

```
Telegram (node-telegram-bot-api) --> SQLite --> Polling loop --> Agent (Claude Agent SDK) --> Response
```

Single Node.js process. Two execution modes:
- **Local mode** (`EXECUTION_MODE=local`): Agents run as direct Node.js child processes. No containers needed. Works on Windows, macOS, Linux.
- **Docker mode** (`EXECUTION_MODE=docker`): Agents run in isolated Linux containers with mounted directories. Full OS-level sandboxing.

Per-group message queue with concurrency control. IPC via filesystem.

Key files:
- `src/index.ts` - Orchestrator: Telegram bot, message loop, agent invocation
- `src/local-runner.ts` - Spawns agent as local Node.js child process
- `src/container-runner.ts` - Spawns agent in Docker container
- `container/agent-runner/src/index.ts` - Agent entry point (Claude SDK `query()`)
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `src/setup-wizard.ts` - Interactive first-run setup (Telegram token, Claude auth, assistant name)
- `src/logger.ts` - Structured logging (`pino`)
- `src/inline-keyboards.ts` - Telegram inline keyboards for approval flows
- `src/dm-allowlist.ts` - DM access control
- `src/transcription.ts` - Voice message transcription
- `src/browser-daemon.ts` - Persistent browser daemon for automation
- `groups/*/CLAUDE.md` - Per-group memory

Middleware pipeline (`src/middleware/`):
- `pipeline.ts` - Ordered before/after hook execution (like Express/Koa)
- `metrics.ts` - Timing and logging
- `snapshot.ts` - Write task/group/fact snapshots to IPC
- `memory-sync.ts` - Sync memory index before agent runs
- `prompt-sanitize.ts` - Strip triggers, truncate uploads, remove base64
- `clarification.ts` - Catch empty or incomplete prompts
- `session.ts` - Resolve and persist session IDs
- `agent.ts` - Invoke the agent (core middleware)
- `memory-queue.ts` - Queue conversations for fact extraction
- `error-recovery.ts` - Clear failed sessions

Memory system (`src/memory/`):
- `manager.ts` - File indexing, embedding, and hybrid search
- `hybrid.ts` - BM25 + vector merge with configurable weights
- `embeddings.ts` - Local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2)
- `chunker.ts` - Markdown chunking for embedding
- `fact-extractor.ts` - Extract facts from conversations for long-term memory
- `schema.ts` - SQLite schema for FTS5 + `sqlite-vec` tables

## FAQ

**Why Telegram?**

Telegram has a clean Bot API, no unofficial library hacks, and works on every platform. The channel is swappable via skills — run `/add-slack` or `/add-discord` to switch. That's the whole point of the skills approach.

**What's local mode vs Docker mode?**

Local mode (`EXECUTION_MODE=local`) spawns agents as direct Node.js child processes — no Docker needed, works on any OS. Docker mode spawns agents inside Linux containers for full OS-level isolation. Choose based on your security needs and platform.

**How is this different from the original NanoClaw?**

The [original](https://github.com/qwibitai/nanoclaw) is container-first with an OneCLI credential proxy for enterprise-grade isolation. This fork strips that out for a simpler local-first experience — same core, fewer moving parts. We also added hybrid memory search, fact extraction, a middleware pipeline, and agent swarms.

**Can I run this on Windows?**

Yes. Runs natively on Windows (Git Bash recommended). Local mode works out of the box — no containers or WSL2 needed. The original NanoClaw requires WSL2 on Windows for Docker; this fork doesn't.

**Can I run this on Linux?**

Yes. Run `/setup` and it will automatically configure Docker as the container runtime.

**Is this secure?**

In Docker mode, agents run in containers with OS-level isolation — they can only access explicitly mounted directories. In local mode, agents run as child processes with inherited permissions. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize it so that the code matches exactly what they want rather than configuring a generic system. If you like having config files, tell Claude to add them.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach.

**Why isn't the setup working for me?**

Run `claude`, then run `/debug`. If Claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Security fixes, bug fixes, and clear improvements to the base configuration. That's it.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VGWXrf8x).

## License

MIT
