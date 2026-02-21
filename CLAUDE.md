# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to Telegram (`node-telegram-bot-api`), routes messages to Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` v0.2.34) running as a local Node.js child process on Windows. Each group has isolated filesystem and memory.

**Current setup (this fork):**
- Channel: Telegram (migrated from WhatsApp on Feb 9, 2026)
- Execution: Local mode (`EXECUTION_MODE=local`) — no containers
- Host: Windows (Git Bash / MSYS2)
- Model: `claude-sonnet-4-6` with 1M context beta

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: Telegram bot, message loop, agent invocation |
| `src/local-runner.ts` | Spawns agent as local Node.js child process |
| `src/container-runner.ts` | Spawns agent in Docker container (not used in local mode) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, execution mode |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `container/agent-runner/src/index.ts` | Agent entry point (Claude SDK `query()`) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
```

### Message Flow (local mode)
```
Telegram (node-telegram-bot-api polling)
  → SQLite (store/messages.db)
  → Polling loop (src/index.ts)
  → spawn('node', [agent-runner]) — local child process
  → Claude Agent SDK query()
  → Response via stdout sentinel markers
  → Router → Telegram bot.sendMessage()
```

### Container Build (only needed if switching to docker mode)

```bash
./container/build.sh # Rebuild agent container
```

Apple Container's buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild:

```bash
container builder stop && container builder rm && container builder start
./container/build.sh
```

Always verify after rebuild: `container run -i --rm --entrypoint wc nanoclaw-agent:latest -l /app/src/index.ts`
