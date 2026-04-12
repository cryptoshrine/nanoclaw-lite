#!/usr/bin/env node
/**
 * NanoClaw Interactive Setup Wizard
 *
 * Walks a new user through the minimum configuration needed to run NanoClaw:
 *   1. Telegram bot token
 *   2. Claude authentication (OAuth token or API key)
 *   3. Assistant name
 *   4. Optional: model selection
 *
 * Writes a .env file and validates the configuration.
 * Run with: npm run setup
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const PROJECT_ROOT = process.cwd();
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(PROJECT_ROOT, '.env.example');

// ─── Terminal helpers ───────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function banner(): void {
  console.log('');
  console.log(`${BOLD}${CYAN}  ┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${BOLD}${CYAN}  │         NanoClaw Setup Wizard           │${RESET}`);
  console.log(`${BOLD}${CYAN}  │   Personal Claude Assistant on Telegram │${RESET}`);
  console.log(`${BOLD}${CYAN}  └─────────────────────────────────────────┘${RESET}`);
  console.log('');
}

function step(n: number, total: number, title: string): void {
  console.log(`\n${BOLD}${GREEN}[${n}/${total}]${RESET} ${BOLD}${title}${RESET}`);
}

function info(msg: string): void {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function success(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ${YELLOW}!${RESET} ${msg}`);
}

function error(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

// ─── Readline prompt ────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${DIM}(${defaultValue})${RESET}` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    // We can't truly hide input in a cross-platform way without raw mode,
    // but we can at least warn the user
    rl.question(`  ${question}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askChoice(question: string, options: string[]): Promise<number> {
  console.log(`  ${question}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${BOLD}${i + 1}${RESET}. ${options[i]}`);
  }
  while (true) {
    const answer = await ask('Choose', '1');
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return num - 1;
    }
    warn(`Please enter a number between 1 and ${options.length}`);
  }
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(`${question} ${DIM}(${hint})${RESET}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

// ─── Validation ─────────────────────────────────────────────────────

async function validateTelegramToken(token: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!resp.ok) return false;
    const data = (await resp.json()) as { ok: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      success(`Bot found: @${data.result.username}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── .env read/write ────────────────────────────────────────────────

function readExistingEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(ENV_PATH)) return vars;

  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) vars[key] = value;
  }
  return vars;
}

function writeEnv(vars: Record<string, string>): void {
  // Read the example template and fill in values
  let template: string;
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    template = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  } else {
    // Fallback: generate minimal .env
    template = '';
  }

  const lines: string[] = [];
  const written = new Set<string>();

  if (template) {
    for (const line of template.split('\n')) {
      const trimmed = line.trim();
      // Comment or empty line — keep as-is
      if (!trimmed || trimmed.startsWith('#')) {
        // If it's a commented-out var that we have a value for, uncomment it
        const commentMatch = trimmed.match(/^#\s*(\w+)=/);
        if (commentMatch) {
          const key = commentMatch[1];
          if (vars[key]) {
            lines.push(`${key}=${vars[key]}`);
            written.add(key);
            continue;
          }
        }
        lines.push(line);
        continue;
      }

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        lines.push(line);
        continue;
      }

      const key = trimmed.slice(0, eqIdx).trim();
      if (vars[key] !== undefined) {
        lines.push(`${key}=${vars[key]}`);
        written.add(key);
      } else {
        lines.push(line);
      }
    }
  }

  // Append any vars not in template
  for (const [key, value] of Object.entries(vars)) {
    if (!written.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
}

// ─── Main wizard flow ───────────────────────────────────────────────

async function main(): Promise<void> {
  banner();

  const existing = readExistingEnv();
  const hasExisting = Object.keys(existing).length > 0;

  if (hasExisting) {
    warn('Existing .env file detected.');
    const keep = await askYesNo('Keep existing values and only fill in missing ones?');
    if (!keep) {
      // Start fresh
      Object.keys(existing).forEach((k) => delete existing[k]);
    }
  }

  const vars: Record<string, string> = { ...existing };
  const TOTAL_STEPS = 4;

  // ── Step 1: Telegram Bot Token ──────────────────────────────────

  step(1, TOTAL_STEPS, 'Telegram Bot Token');

  if (vars.TELEGRAM_BOT_TOKEN) {
    success(`Already configured: ${vars.TELEGRAM_BOT_TOKEN.slice(0, 10)}...`);
    const reconfig = await askYesNo('Reconfigure?', false);
    if (!reconfig) {
      // Validate existing token
      info('Validating existing token...');
      const valid = await validateTelegramToken(vars.TELEGRAM_BOT_TOKEN);
      if (!valid) {
        warn('Existing token failed validation. You may want to update it.');
      }
    } else {
      delete vars.TELEGRAM_BOT_TOKEN;
    }
  }

  if (!vars.TELEGRAM_BOT_TOKEN) {
    info('You need a Telegram bot token from @BotFather.');
    info('Open Telegram, search for @BotFather, send /newbot, follow the prompts.');
    info('');

    while (true) {
      const token = await askSecret('Paste your bot token');
      if (!token) {
        warn('Token is required.');
        continue;
      }

      info('Validating...');
      const valid = await validateTelegramToken(token);
      if (valid) {
        vars.TELEGRAM_BOT_TOKEN = token;
        break;
      } else {
        error('Invalid token. Make sure you copied the full token from BotFather.');
        const retry = await askYesNo('Try again?');
        if (!retry) {
          error('Cannot continue without a valid Telegram token.');
          rl.close();
          process.exit(1);
        }
      }
    }
  }

  // ── Step 2: Claude Authentication ───────────────────────────────

  step(2, TOTAL_STEPS, 'Claude Authentication');

  const hasOAuth = !!vars.CLAUDE_CODE_OAUTH_TOKEN;
  const hasApiKey = !!vars.ANTHROPIC_API_KEY;

  if (hasOAuth || hasApiKey) {
    const method = hasOAuth ? 'OAuth token' : 'API key';
    success(`Already configured: ${method}`);
    const reconfig = await askYesNo('Reconfigure?', false);
    if (reconfig) {
      delete vars.CLAUDE_CODE_OAUTH_TOKEN;
      delete vars.ANTHROPIC_API_KEY;
    }
  }

  if (!vars.CLAUDE_CODE_OAUTH_TOKEN && !vars.ANTHROPIC_API_KEY) {
    const choice = await askChoice('How do you authenticate with Claude?', [
      'Claude Pro/Max subscription (recommended)',
      'Anthropic API key',
    ]);

    if (choice === 0) {
      // OAuth token
      info('');
      info('Run this command in another terminal:');
      console.log(`\n    ${BOLD}claude setup-token${RESET}\n`);
      info('Copy the token it outputs and paste it here.');
      info('');

      while (true) {
        const token = await askSecret('Paste your OAuth token');
        if (!token) {
          warn('Token is required.');
          continue;
        }
        vars.CLAUDE_CODE_OAUTH_TOKEN = token;
        success('OAuth token saved.');
        break;
      }
    } else {
      // API key
      info('');
      info('Get your API key from: https://console.anthropic.com/settings/keys');
      info('');

      while (true) {
        const key = await askSecret('Paste your API key');
        if (!key) {
          warn('API key is required.');
          continue;
        }
        if (!key.startsWith('sk-ant-')) {
          warn('That doesn\'t look like an Anthropic API key (should start with sk-ant-).');
          const proceed = await askYesNo('Use it anyway?', false);
          if (!proceed) continue;
        }
        vars.ANTHROPIC_API_KEY = key;
        success('API key saved.');
        break;
      }
    }
  }

  // ── Step 3: Assistant Name ──────────────────────────────────────

  step(3, TOTAL_STEPS, 'Assistant Name');
  info('This is the name your assistant responds to.');
  info('In group chats, messages starting with @Name are sent to Claude.');

  const currentName = vars.ASSISTANT_NAME || 'Andy';
  const name = await ask('Assistant name', currentName);
  if (name && name !== 'Andy') {
    vars.ASSISTANT_NAME = name;
  } else if (vars.ASSISTANT_NAME === 'Andy') {
    // Remove if it's the default — no need to set it
    delete vars.ASSISTANT_NAME;
  }

  success(`Assistant will respond to: @${name || 'Andy'}`);

  // ── Step 4: Model Selection ─────────────────────────────────────

  step(4, TOTAL_STEPS, 'Model Selection');

  const currentModel = vars.NANOCLAW_MODEL || 'claude-sonnet-4-6';
  const modelChoice = await askChoice('Which Claude model should your assistant use?', [
    `Sonnet 4.6 — fast and capable (default)`,
    `Opus 4.6 — most capable, slower`,
    `Haiku 4.5 — fastest, cheapest`,
    `Keep current: ${currentModel}`,
  ]);

  const models = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', currentModel];
  const selectedModel = models[modelChoice];

  if (selectedModel !== 'claude-sonnet-4-6') {
    vars.NANOCLAW_MODEL = selectedModel;
  } else {
    delete vars.NANOCLAW_MODEL;
  }

  success(`Model: ${selectedModel}`);

  // ── Write .env ──────────────────────────────────────────────────

  console.log('');
  console.log(`${BOLD}Writing configuration...${RESET}`);
  writeEnv(vars);
  success(`.env file written to ${ENV_PATH}`);

  // ── Build check ─────────────────────────────────────────────────

  const agentEntry = path.join(PROJECT_ROOT, 'container', 'agent-runner', 'dist', 'index.js');
  const mainEntry = path.join(PROJECT_ROOT, 'dist', 'index.js');

  if (!fs.existsSync(agentEntry) || !fs.existsSync(mainEntry)) {
    console.log('');
    warn('Project not built yet. Run:');
    console.log(`\n    ${BOLD}npm run build${RESET}\n`);
  }

  // ── Summary ─────────────────────────────────────────────────────

  console.log('');
  console.log(`${BOLD}${GREEN}Setup complete!${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Next steps:${RESET}`);
  console.log(`    1. Build the project:     ${BOLD}npm run build${RESET}`);
  console.log(`    2. Start the assistant:    ${BOLD}npm start${RESET}`);
  console.log(`    3. Message your bot on Telegram — it will auto-register the chat.`);
  console.log('');
  console.log(`  ${DIM}For development with hot reload: npm run dev${RESET}`);
  console.log(`  ${DIM}To reconfigure:                 npm run setup${RESET}`);
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
