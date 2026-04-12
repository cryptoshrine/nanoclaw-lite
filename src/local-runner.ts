/**
 * Local Runner for NanoClaw Lite
 * Spawns agent-runner as a direct Node.js child process.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  AGENT_RUNNER_ENTRY,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  PROJECT_ROOT,
} from './config.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

const ALLOWED_ENV_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'ZAPIER_MCP_TOKEN'];

/**
 * Progressive skill loading: generate lightweight stubs with just frontmatter.
 * The agent reads the full skill on demand via the Read tool.
 */
function syncSkillStubs(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir)) {
    const srcPath = path.join(sourceDir, entry);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      const mdFiles = fs.readdirSync(srcPath).filter(f => f.endsWith('.md'));
      if (mdFiles.length === 0) continue;

      const mdFile = mdFiles[0];
      const fullPath = path.join(srcPath, mdFile);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const stub = generateSkillStub(content, fullPath);

      const targetSubDir = path.join(targetDir, entry);
      fs.mkdirSync(targetSubDir, { recursive: true });
      fs.writeFileSync(path.join(targetSubDir, mdFile), stub);
    } else if (entry.endsWith('.md')) {
      const content = fs.readFileSync(srcPath, 'utf-8');
      const stub = generateSkillStub(content, srcPath);
      fs.writeFileSync(path.join(targetDir, entry), stub);
    }
  }
}

function generateSkillStub(content: string, fullPath: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    return `${fmMatch[0]}\n\n<!-- Full skill content available at: ${fullPath} -->\n<!-- Use the Read tool to load the full skill when you need to invoke it. -->\n`;
  }
  const preview = content.slice(0, 500);
  return `${preview}\n\n<!-- Full skill content available at: ${fullPath} -->\n<!-- Use the Read tool to load the full skill when you need to invoke it. -->\n`;
}

function loadAllowedEnvVars(): Record<string, string> {
  const envFile = path.join(PROJECT_ROOT, '.env');
  const vars: Record<string, string> = {};

  if (!fs.existsSync(envFile)) return vars;

  const content = fs.readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const allowed of ALLOWED_ENV_VARS) {
      if (trimmed.startsWith(`${allowed}=`)) {
        const value = trimmed.slice(allowed.length + 1);
        vars[allowed] = value;
      }
    }
  }

  return vars;
}

function parseAgentOutput(stdout: string, code: number | null, stderr: string): ContainerOutput {
  const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
  const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    try {
      const jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
      return JSON.parse(jsonLine);
    } catch {
      // Fall through to error
    }
  }

  if (code === 0) {
    try {
      const lines = stdout.trim().split('\n');
      const jsonLine = lines[lines.length - 1];
      return JSON.parse(jsonLine);
    } catch {
      // Fall through to error
    }
  }

  return {
    status: 'error',
    result: null,
    error: code !== 0
      ? `Agent exited with code ${code}: ${stderr.slice(-200)}`
      : `Failed to parse agent output`,
  };
}

export async function runLocalAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'memory'), { recursive: true });

  const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder);
  const groupClaudeDir = path.join(groupSessionsDir, '.claude');
  fs.mkdirSync(groupClaudeDir, { recursive: true });

  const projectSkillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');
  const sessionSkillsDir = path.join(groupClaudeDir, 'skills');
  if (fs.existsSync(projectSkillsDir)) {
    syncSkillStubs(projectSkillsDir, sessionSkillsDir);
  }

  const envVars = loadAllowedEnvVars();
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    ...envVars,
    NANOCLAW_IPC_DIR: groupIpcDir,
    NANOCLAW_GROUP_DIR: groupDir,
    NANOCLAW_PROJECT_DIR: PROJECT_ROOT,
    NANOCLAW_MODEL: process.env.NANOCLAW_MODEL,
    HOME: groupSessionsDir,
    USERPROFILE: groupSessionsDir,
  };

  logger.info(
    {
      group: group.name,
      isMain: input.isMain,
      ipcDir: groupIpcDir,
      home: groupSessionsDir,
    },
    'Spawning local agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const child = spawn('node', [AGENT_RUNNER_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: groupDir,
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let closeSent = false;

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();

    const groupIpcInputDir = path.join(groupIpcDir, 'input');
    const closeSentinelPath = path.join(groupIpcInputDir, '_close');

    child.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();

      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { group: group.name, size: stdout.length },
          'Local agent stdout truncated due to size limit',
        );
      } else {
        stdout += chunk;
      }

      if (!closeSent && stdout.includes(OUTPUT_START_MARKER) && stdout.includes(OUTPUT_END_MARKER)) {
        closeSent = true;
        try {
          fs.mkdirSync(groupIpcInputDir, { recursive: true });
          fs.writeFileSync(closeSentinelPath, '');
          logger.debug({ group: group.name }, 'Wrote _close sentinel to signal agent exit');
        } catch (err) {
          logger.warn({ group: group.name, err }, 'Failed to write _close sentinel');
        }
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ agent: group.folder }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      logger.error({ group: group.name }, 'Local agent timeout, killing');
      timedOut = true;
      child.kill('SIGKILL');
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `local-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Local Agent Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        ``,
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Stderr ===`,
          stderr,
          ``,
          `=== Stdout ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
        );

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``,
          );
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));

      if (code !== 0) {
        logger.error(
          { group: group.name, code, duration, stderr: stderr.slice(-500), logFile },
          'Local agent exited with error',
        );
      } else {
        logger.info(
          { group: group.name, duration },
          'Local agent completed',
        );
      }

      const parsed = parseAgentOutput(stdout, code, stderr);
      if (timedOut && parsed.status === 'error') {
        resolve({
          status: 'error',
          result: null,
          error: `Local agent timed out after ${group.containerConfig?.timeout || CONTAINER_TIMEOUT}ms`,
        });
      } else {
        resolve(parsed);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, error: err }, 'Local agent spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Local agent spawn error: ${err.message}`,
      });
    });
  });
}
