# NanoClaw Requirements

Original requirements and design decisions.

---

## Why This Exists

This is a lightweight, secure alternative to complex multi-process AI assistant frameworks. Those projects become unwieldy — endless configuration files, integrations, and leaky workarounds for isolation. It's impossible for anyone to realistically understand the whole codebase.

NanoClaw gives you the core functionality without that mess.

---

## Philosophy

### Small Enough to Understand

The entire codebase should be something you can read and understand. One Node.js process. A handful of source files. No microservices, no message queues, no abstraction layers.

### Security Through True Isolation

Instead of application-level permission systems, agents can run in actual Linux containers (Docker or Apple Container). The isolation is at the OS level. Agents can only see what's explicitly mounted.

### Built for One User

This isn't a framework or a platform. It's working software for one person's specific needs. You fork it and customize it to match yours.

### Customization = Code Changes

No configuration sprawl. If you want different behavior, modify the code. The codebase is small enough that this is safe and practical.

### AI-Native Development

No monitoring dashboard — ask Claude what's happening. No debugging tools — describe the problem, Claude fixes it. The codebase assumes you have an AI collaborator.

### Skills Over Features

Contributors shouldn't add features to the codebase. They should contribute skills (like `/add-telegram`) that transform your fork. Users get clean code that does exactly what they need.

---

## RFS (Request for Skills)

Skills we'd love contributors to build:

### Communication Channels
- `/add-slack` - Add Slack as an input channel
- `/add-discord` - Add Discord as an input channel
- `/add-whatsapp` - Add WhatsApp as a channel (via Baileys)
- `/add-sms` - Add SMS via Twilio or similar

### Platform Support
- `/setup-linux` - Full Linux setup guide
- `/setup-windows` - Windows support via WSL2 + Docker

---

## Vision

A personal Claude assistant accessible via messaging, with minimal custom code.

**Core components:**
- **Claude Agent SDK** as the core agent
- **Two execution modes**: Local (Node.js child process) or Docker/Apple Container for OS-level isolation
- **Telegram** as the primary I/O channel (swappable via skills)
- **Persistent memory** per conversation and globally
- **Scheduled tasks** that run Claude and can message back
- **Web access** for search and browsing
- **Browser automation** via agent-browser with Chromium

---

## Architecture Decisions

### Message Routing
- Router listens to Telegram (via `node-telegram-bot-api` polling)
- Only registered groups/chats are processed
- Trigger: `@AssistantName` prefix (case insensitive), configurable via `ASSISTANT_NAME` env var

### Memory System
- **Per-group memory**: Each group has a folder with its own `CLAUDE.md`
- **Global memory**: Root `CLAUDE.md` is read by all groups, writable from main only
- Agent runs in the group's folder, automatically inherits both CLAUDE.md files

### Session Management
- Each group maintains a conversation session (via Claude Agent SDK)
- Sessions auto-compact when context gets too long

### Agent Execution
- **Local mode** (`EXECUTION_MODE=local`): Agent spawned as direct child process. No containers needed.
- **Docker mode** (`EXECUTION_MODE=docker`): Agent runs inside Docker container with mounted directories.

### Scheduled Tasks
- Cron expressions, intervals, or one-time timestamps
- Tasks run as full agents in their group's context
- Can send messages or complete silently

### Group Management
- Groups registered in SQLite via the main channel
- Each group gets a dedicated folder under `groups/`
- Groups can have additional directories mounted

---

## Integration Points

### Telegram
- Using `node-telegram-bot-api` with long-polling
- Messages stored in SQLite, polled by router
- Bot token authentication via `TELEGRAM_BOT_TOKEN` env var

### Scheduler
- Built-in scheduler on the host, spawns agents for task execution
- Custom MCP server provides scheduling tools
- Tasks stored in SQLite with run history

### Web Access
- Built-in WebSearch and WebFetch tools

### Browser Automation
- agent-browser CLI with Chromium
- Screenshots, PDFs, element interaction

---

## Setup & Customization

### Philosophy
- Minimal configuration
- Interactive setup wizard for essentials
- Claude Code guides everything else
- Each user gets a custom setup

### Deployment
- Windows: direct execution or pm2
- macOS: launchd
- Linux: systemd
