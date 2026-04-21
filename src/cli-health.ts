/**
 * CLI Health Check — Verify availability and auth for Codex, Claude, and Gemini CLIs.
 *
 * Used by the OmX team runner to validate worker CLIs before spawning tmux panes.
 * Each check runs `<cli> --version` (or equivalent) and returns availability + version info.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

export interface CliStatus {
  /** CLI binary name */
  cli: 'codex' | 'claude' | 'gemini';
  /** Whether the CLI binary is found on PATH */
  installed: boolean;
  /** Detected version string */
  version: string | null;
  /** Whether auth credentials are configured (not necessarily valid) */
  authConfigured: boolean;
  /** Human-readable status message */
  message: string;
}

/**
 * Check if a command exists on PATH and return its version.
 */
function checkCli(command: string, versionFlag = '--version'): { installed: boolean; version: string | null } {
  try {
    const output = execSync(`${command} ${versionFlag}`, {
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim();
    return { installed: true, version: output.split('\n')[0] || output };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Check Codex CLI status.
 * Auth: looks for OPENAI_API_KEY env var or ~/.codex/config.toml with auth config.
 */
export function checkCodexCli(): CliStatus {
  const { installed, version } = checkCli('codex');

  if (!installed) {
    return {
      cli: 'codex',
      installed: false,
      version: null,
      authConfigured: false,
      message: 'Codex CLI not installed. Run: npm install -g @openai/codex',
    };
  }

  // Check auth: OPENAI_API_KEY env var or codex config
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const codexConfigPath = path.join(home, '.codex', 'config.toml');
  const hasConfigFile = fs.existsSync(codexConfigPath);

  // If config.toml exists, auth is likely configured (ChatGPT login or API key)
  const authConfigured = hasApiKey || hasConfigFile;

  return {
    cli: 'codex',
    installed: true,
    version,
    authConfigured,
    message: authConfigured
      ? `Codex CLI ${version} — auth configured`
      : `Codex CLI ${version} — auth NOT configured. Run: codex login`,
  };
}

/**
 * Check Claude CLI status.
 * Auth: looks for ANTHROPIC_API_KEY or Claude Code login session.
 */
export function checkClaudeCli(): CliStatus {
  const { installed, version } = checkCli('claude');

  if (!installed) {
    return {
      cli: 'claude',
      installed: false,
      version: null,
      authConfigured: false,
      message: 'Claude CLI not installed. Run: npm install -g @anthropic-ai/claude-code',
    };
  }

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
  const authConfigured = hasApiKey || hasAuthToken;

  return {
    cli: 'claude',
    installed: true,
    version,
    authConfigured,
    message: authConfigured
      ? `Claude CLI ${version} — auth configured`
      : `Claude CLI ${version} — auth NOT configured. Set ANTHROPIC_API_KEY or run: claude login`,
  };
}

/**
 * Check Gemini CLI status.
 * Auth: looks for GOOGLE_API_KEY or GEMINI_API_KEY env var.
 */
export function checkGeminiCli(): CliStatus {
  const { installed, version } = checkCli('gemini');

  if (!installed) {
    return {
      cli: 'gemini',
      installed: false,
      version: null,
      authConfigured: false,
      message: 'Gemini CLI not installed. Run: npm install -g @anthropic-ai/gemini-cli (or check Google docs)',
    };
  }

  const hasGoogleKey = !!process.env.GOOGLE_API_KEY;
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const authConfigured = hasGoogleKey || hasGeminiKey;

  return {
    cli: 'gemini',
    installed: true,
    version,
    authConfigured,
    message: authConfigured
      ? `Gemini CLI ${version} — auth configured`
      : `Gemini CLI ${version} — auth NOT configured. Set GOOGLE_API_KEY or GEMINI_API_KEY`,
  };
}

/**
 * Run all CLI health checks and return a summary.
 */
export function checkAllClis(): {
  codex: CliStatus;
  claude: CliStatus;
  gemini: CliStatus;
  summary: string;
} {
  const codex = checkCodexCli();
  const claude = checkClaudeCli();
  const gemini = checkGeminiCli();

  const available = [codex, claude, gemini].filter(c => c.installed && c.authConfigured);
  const installed = [codex, claude, gemini].filter(c => c.installed);

  const summary = `${available.length}/3 CLIs ready, ${installed.length}/3 installed`;

  logger.info(
    { codex: codex.message, claude: claude.message, gemini: gemini.message },
    `CLI health check: ${summary}`,
  );

  return { codex, claude, gemini, summary };
}
