<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  My personal Claude assistant. Lightweight and built to be understood and customized for your own needs.
</p>

<p align="center">
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="https://discord.gg/VGWXrf8x"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

**New:** First AI assistant to support [Agent Swarms](https://code.claude.com/docs/en/agent-teams). Spin up teams of agents that collaborate in your chat.

## Why I Built This

[OpenClaw](https://github.com/openclaw/openclaw) is an impressive project with a great vision. But I can't sleep well running software I don't understand with access to my life. OpenClaw has 52+ modules, 8 config management files, 45+ dependencies, and abstractions for 15 channel providers. Security is application-level (allowlists, pairing codes) rather than OS isolation. Everything runs in one Node process with shared memory.

NanoClaw gives you the same core functionality in a codebase you can understand in 8 minutes. One process. A handful of files. Agents run in actual Linux containers with filesystem isolation, not behind permission checks.

## Quick Start

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
claude
```

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup, service configuration.

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Claude Code walk you through it.

**Secure by isolation.** Agents can run in Linux containers (Apple Container on macOS, or Docker) where they can only see what's explicitly mounted. In local mode, agents run as isolated child processes on the host.

**Built for one user.** This isn't a framework. It's working software that fits my exact needs. You fork it and have Claude Code make it match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No installation wizard; Claude Code guides setup. No monitoring dashboard; ask Claude what's happening. No debugging tools; describe the problem, Claude fixes it.

**Skills over features.** Contributors shouldn't add features (e.g. support for Telegram) to the codebase. Instead, they contribute [claude code skills](https://code.claude.com/docs/en/skills) like `/add-telegram` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** This runs on Claude Agent SDK, which means you're running Claude Code directly. The harness matters. A bad harness makes even smart models seem dumb, a good harness gives them superpowers. Claude Code is (IMO) the best harness available.

## What It Supports

- **Telegram I/O** - Message Claude from your phone via Telegram bot (`node-telegram-bot-api`)
- **Isolated group context** - Each group has its own `CLAUDE.md` memory and isolated filesystem
- **Main channel** - Your private chat for admin control; every other group is isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content
- **Two execution modes** - Local (direct Node.js child process) or Docker/Apple Container for full OS-level isolation
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks (first personal AI assistant to support this)
- **Browser automation** - agent-browser CLI with Chromium for web scraping and interaction
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

## Usage

Talk to your assistant with the trigger word (default: `@klaw`):

```
@klaw send an overview of the sales pipeline every weekday morning at 9am
@klaw review the git history for the past week each Friday and update the README if there's drift
@klaw every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your private chat), you can manage groups and tasks:
```
@klaw list all scheduled tasks across groups
@klaw pause the Monday briefing task
@klaw add the Ball-AI Dev group
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

If you want to add Telegram support, don't create a PR that adds Telegram alongside WhatsApp. Instead, contribute a skill file (`.claude/skills/add-telegram/SKILL.md`) that teaches Claude Code how to transform a NanoClaw installation to use Telegram.

Users then run `/add-telegram` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd love to see:

**Communication Channels**
- `/add-telegram` - Add Telegram as channel. Should give the user option to replace WhatsApp or add as additional channel. Also should be possible to add it as a control channel (where it can trigger actions) or just a channel that can be used in actions triggered elsewhere
- `/add-slack` - Add Slack
- `/add-discord` - Add Discord

**Platform Support**
- `/setup-windows` - Windows via WSL2 + Docker

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
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Why Telegram?**

This fork uses Telegram via `node-telegram-bot-api`. The upstream project originally used WhatsApp (Baileys). The channel is swappable via skills — run `/add-telegram` or `/add-whatsapp` to change it. That's the whole point of the skills approach.

**What's local mode vs Docker mode?**

Local mode (`EXECUTION_MODE=local`) spawns agents as direct Node.js child processes — no Docker needed, works on any OS. Docker mode spawns agents inside Linux containers for full OS-level isolation. Choose based on your security needs and platform.

**Can I run this on Windows?**

Yes. This fork runs on Windows with Git Bash. Use local mode (no containers needed) or install Docker Desktop for container isolation.

**Can I run this on Linux?**

Yes. Run `/setup` and it will automatically configure Docker as the container runtime. Thanks to [@dotsetgreg](https://github.com/dotsetgreg) for contributing the `/convert-to-docker` skill.

**Is this secure?**

In Docker mode, agents run in containers with OS-level isolation — they can only access explicitly mounted directories. In local mode, agents run as child processes with inherited permissions. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize it to so that the code matches exactly what they want rather than configuring a generic system. If you like having config files, tell Claude to add them.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach.

**Why isn't the setup working for me?**

I don't know. Run `claude`, then run `/debug`. If claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Security fixes, bug fixes, and clear improvements to the base configuration. That's it.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VGWXrf8x).

## License

MIT
