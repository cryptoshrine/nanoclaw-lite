---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, configure the bot, or start the service. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Guide the user through first-time setup. The interactive wizard handles most of the configuration, but Claude Code can help with troubleshooting and advanced setup.

**Principle:** When something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their manual action (e.g. creating a Telegram bot, pasting a token). If a dependency is missing, install it. If a service won't start, diagnose and repair.

## Quick Setup Path

For most users, setup is three commands:

```bash
npm install                    # Install dependencies
npm run setup                  # Interactive wizard (Telegram token, Claude auth, name)
npm run build && npm start     # Build and run
```

The wizard (`src/setup-wizard.ts`) handles:
1. Telegram bot token (validates via Telegram API)
2. Claude authentication (OAuth token or API key)
3. Assistant name (trigger word for group chats)
4. Model selection

After setup, the first message to the bot auto-registers the chat as the main channel.

## Detailed Setup Steps

### 1. Check Prerequisites

Verify Node.js 20+ is installed:
```bash
node --version
```

If not installed or too old, help the user install it:
- macOS: `brew install node@22` or install nvm
- Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
- Windows: Download from https://nodejs.org or use `winget install OpenJS.NodeJS.LTS`

Verify Claude Code is installed:
```bash
claude --version
```

If not: direct user to https://claude.ai/download

### 2. Install Dependencies

```bash
npm install
cd container/agent-runner && npm install && cd ../..
```

If native modules fail (better-sqlite3):
- macOS: `xcode-select --install`
- Linux: `sudo apt-get install build-essential python3`
- Windows: `npm install -g windows-build-tools` or install Visual Studio Build Tools

### 3. Run Setup Wizard

```bash
npm run setup
```

This walks through all required configuration interactively. If the user prefers manual setup, they can:
1. Copy `.env.example` to `.env`
2. Fill in `TELEGRAM_BOT_TOKEN` (from @BotFather)
3. Fill in `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`

### 4. Build

```bash
npm run build
```

This compiles both the main project and the agent runner. If TypeScript errors occur, diagnose and fix them.

### 5. Start

```bash
npm start
```

Or for development with hot reload:
```bash
npm run dev
```

### 6. First Message

Tell the user to send any message to their Telegram bot. The first chat is automatically registered as the main channel. No trigger word needed in the main channel — every message gets a response.

## Running as a Service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.nanoclaw.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nanoclaw</string>
  <key>WorkingDirectory</key><string>PROJECT_PATH</string>
  <key>ProgramArguments</key>
  <array>
    <string>NODE_PATH</string>
    <string>--env-file=.env</string>
    <string>dist/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>PROJECT_PATH/logs/nanoclaw.log</string>
  <key>StandardErrorPath</key><string>PROJECT_PATH/logs/nanoclaw.error.log</string>
</dict>
</plist>
```

Replace `PROJECT_PATH` with the actual project path and `NODE_PATH` with `which node` output.

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Linux (systemd)

Create `~/.config/systemd/user/nanoclaw.service`:
```ini
[Unit]
Description=NanoClaw Assistant

[Service]
WorkingDirectory=PROJECT_PATH
ExecStart=NODE_PATH --env-file=.env dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw
```

### Windows

Use Task Scheduler or run in a terminal:
```bash
npm start
```

For background execution, use `pm2`:
```bash
npx pm2 start dist/index.js --name nanoclaw -- --env-file=.env
npx pm2 save
npx pm2 startup
```

## Troubleshooting

**"Agent runner entry not found"** — Run `npm run build` first. Both the main project and agent runner need to be compiled.

**Bot not responding** — Check logs (`LOG_LEVEL=debug npm start`). Common causes:
- Wrong bot token (re-run `npm run setup`)
- Bot not started in Telegram (send /start to your bot)
- Chat not registered (send any message — auto-registration handles the first chat)

**"TELEGRAM_BOT_TOKEN not set"** — The .env file is missing or doesn't have the token. Run `npm run setup`.

**Permission errors on SQLite** — The `store/` directory needs write access. Usually fixed by running from the project directory.

**Voice transcription not working** — Set `OPENAI_API_KEY` in .env (optional feature).
