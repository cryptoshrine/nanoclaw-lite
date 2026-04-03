/**
 * Local Runner for NanoClaw
 * Spawns agent-runner as a direct Node.js child process (no Docker).
 * Mirrors container-runner.ts behavior but without Docker overhead.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  AGENT_RUNNER_ENTRY,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  DEFAULT_TEAMMATE_MODEL,
  GROUPS_DIR,
  PROJECT_ROOT,
  TEAM_DIR,
  TEAMMATE_TIMEOUT,
} from './config.js';
import { ContainerInput, ContainerOutput, TeammateContainerInput } from './container-runner.js';
import { logger } from './logger.js';
import { broadcast as wsBroadcast } from './ws-server.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Stream chunk sentinels (must match agent-runner)
const STREAM_CHUNK_MARKER = '---NANOCLAW_STREAM_CHUNK---';
const STREAM_CHUNK_END = '---NANOCLAW_STREAM_END---';

/**
 * Per-process partial buffer for stream chunks that may span data events.
 * Keyed by a unique run identifier (group folder is sufficient since only one
 * agent runs per group at a time).
 */
const streamPartials = new Map<string, string>();

/**
 * Extract and process stream chunks from a raw stdout data string.
 * Returns the data with stream chunks removed (so they don't pollute the output buffer).
 * Handles chunks that span multiple data events via a partial buffer.
 */
function extractStreamChunks(data: string, groupId: string): string {
  // Prepend any partial data from a previous event
  const partial = streamPartials.get(groupId) || '';
  let combined = partial + data;
  streamPartials.delete(groupId);

  let cleanData = '';
  let cursor = 0;

  while (cursor < combined.length) {
    const startIdx = combined.indexOf(STREAM_CHUNK_MARKER, cursor);

    if (startIdx === -1) {
      // No more markers — rest is clean data
      cleanData += combined.slice(cursor);
      break;
    }

    // Add everything before the marker to clean data
    cleanData += combined.slice(cursor, startIdx);

    const endIdx = combined.indexOf(STREAM_CHUNK_END, startIdx);
    if (endIdx === -1) {
      // Incomplete chunk — save as partial for next data event
      streamPartials.set(groupId, combined.slice(startIdx));
      break;
    }

    // Complete chunk found — broadcast it
    const chunkText = combined.slice(startIdx + STREAM_CHUNK_MARKER.length, endIdx);
    if (chunkText.length > 0) {
      wsBroadcast('chat.stream', {
        groupId,
        text: chunkText.slice(0, 500),
        role: 'assistant',
        delta: true,
      });
    }

    cursor = endIdx + STREAM_CHUNK_END.length;
    // Skip trailing newline from console.log
    if (cursor < combined.length && combined[cursor] === '\n') cursor++;
  }

  return cleanData;
}

const ALLOWED_ENV_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'ZAPIER_MCP_TOKEN'];

/**
 * Progressive skill loading: instead of copying full skill files (~500K+),
 * generate lightweight stubs with just frontmatter. The agent reads the
 * full skill on demand via the Read tool when it needs to invoke one.
 *
 * Stub format preserves the YAML frontmatter (name, description, triggers)
 * and appends a pointer to the full file path.
 */
function syncSkillStubs(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir)) {
    const srcPath = path.join(sourceDir, entry);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      // Skill in a subdirectory — find the .md file inside
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
      // Skill as a standalone .md file
      const content = fs.readFileSync(srcPath, 'utf-8');
      const stub = generateSkillStub(content, srcPath);
      fs.writeFileSync(path.join(targetDir, entry), stub);
    }
  }
}

/**
 * Extract YAML frontmatter and generate a stub.
 * If no frontmatter exists, copy the first 500 chars as-is.
 */
function generateSkillStub(content: string, fullPath: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    // Preserve full frontmatter, replace body with pointer
    return `${fmMatch[0]}\n\n<!-- Full skill content available at: ${fullPath} -->\n<!-- Use the Read tool to load the full skill when you need to invoke it. -->\n`;
  }

  // No frontmatter — keep first 500 chars as context
  const preview = content.slice(0, 500);
  return `${preview}\n\n<!-- Full skill content available at: ${fullPath} -->\n<!-- Use the Read tool to load the full skill when you need to invoke it. -->\n`;
}

/**
 * Read allowed env vars from .env file, returning them as a record.
 */
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

/**
 * Parse structured output from the agent-runner stdout using sentinel markers.
 */
function parseAgentOutput(stdout: string, code: number | null, stderr: string): ContainerOutput {
  // Try to extract structured output via sentinel markers
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

  // Fallback: try last line (backwards compatibility)
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

  // Per-group IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'memory'), { recursive: true });

  // Per-group sessions directory (HOME for Claude SDK)
  const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder);
  const groupClaudeDir = path.join(groupSessionsDir, '.claude');
  fs.mkdirSync(groupClaudeDir, { recursive: true });

  // Progressive skill loading: generate lightweight stubs instead of
  // copying full skill files. Saves ~500K+ of context per session.
  // The agent reads the full skill file on demand when it needs to use it.
  const projectSkillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');
  const sessionSkillsDir = path.join(groupClaudeDir, 'skills');
  if (fs.existsSync(projectSkillsDir)) {
    syncSkillStubs(projectSkillsDir, sessionSkillsDir);
  }

  // Build environment: inherit full host env, then override specifics
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
      let chunk = data.toString();

      // Extract and broadcast stream chunks before buffering
      chunk = extractStreamChunks(chunk, group.folder);

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

      // Once we see a complete output block (start + end markers), signal the
      // agent to exit by writing the _close sentinel to its IPC input dir.
      // Without this the agent loops forever waiting for more IPC messages.
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
        logger.warn(
          { group: group.name, size: stderr.length },
          'Local agent stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      logger.error({ group: group.name }, 'Local agent timeout, killing');
      timedOut = true;
      child.kill('SIGKILL');
      // Don't resolve here — let child.on('close') handle it so we can
      // attempt to parse any stdout that was already written before the kill.
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Clean up stream partial buffer
      streamPartials.delete(group.folder);

      // Write log file
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
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
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
      logger.debug({ logFile, verbose: isVerbose }, 'Local agent log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr: stderr.slice(-500),
            logFile,
          },
          'Local agent exited with error',
        );
      } else {
        logger.info(
          { group: group.name, duration },
          'Local agent completed',
        );
      }

      // Try to parse stdout even if killed by timeout — agent may have already
      // written its response before entering the idle IPC wait loop.
      const parsed = parseAgentOutput(stdout, code, stderr);
      if (timedOut && parsed.status === 'error') {
        // Timeout killed the process but no parseable output — genuine timeout.
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

export async function runLocalTeammate(
  input: TeammateContainerInput,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  // Team shared workspace
  const teamDir = path.join(TEAM_DIR, input.teamId);
  fs.mkdirSync(teamDir, { recursive: true });

  // Lead group folder for context
  const leadGroupDir = path.join(GROUPS_DIR, input.leadGroup);

  // Teammate-specific sessions directory (HOME for Claude SDK)
  const teammateSessionsDir = path.join(DATA_DIR, 'sessions', 'teammates', input.memberId);
  const teammateClaudeDir = path.join(teammateSessionsDir, '.claude');
  fs.mkdirSync(teammateClaudeDir, { recursive: true });

  // Progressive skill loading for teammates
  const projectSkillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');
  const sessionSkillsDir = path.join(teammateClaudeDir, 'skills');
  if (fs.existsSync(projectSkillsDir)) {
    syncSkillStubs(projectSkillsDir, sessionSkillsDir);
  }

  // Teammate IPC namespace
  const teammateIpcDir = path.join(DATA_DIR, 'ipc', 'teammates', input.memberId);
  fs.mkdirSync(path.join(teammateIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(teammateIpcDir, 'tasks'), { recursive: true });

  // Build environment: inherit full host env, then override specifics
  const envVars = loadAllowedEnvVars();
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    ...envVars,
    NANOCLAW_IPC_DIR: teammateIpcDir,
    NANOCLAW_GROUP_DIR: leadGroupDir,
    NANOCLAW_TEAM_DIR: teamDir,
    NANOCLAW_PROJECT_DIR: PROJECT_ROOT,
    NANOCLAW_CHAT_JID: input.chatJid || '',
    NANOCLAW_SOURCE_CHANNEL: input.sourceChannel || 'telegram',
    NANOCLAW_MODEL: input.model || process.env.NANOCLAW_MODEL || DEFAULT_TEAMMATE_MODEL,
    HOME: teammateSessionsDir,
    USERPROFILE: teammateSessionsDir,
  };

  // Prepare teammate-specific input
  const childInput = {
    prompt: input.prompt,
    groupFolder: input.leadGroup,
    chatJid: input.chatJid || '', // Pass chatJid so teammate can send messages to originating chat
    isMain: false,
    isTeammate: true,
    teamId: input.teamId,
    memberId: input.memberId,
    memberName: input.memberName,
    teammateModel: input.model,
    sourceChannel: input.sourceChannel || 'telegram',
  };

  logger.info(
    {
      memberId: input.memberId,
      teamId: input.teamId,
      name: input.memberName,
    },
    'Spawning local teammate',
  );

  const logsDir = path.join(TEAM_DIR, input.teamId, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const child = spawn('node', [AGENT_RUNNER_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: teamDir,
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdin.write(JSON.stringify(childInput));
    child.stdin.end();

    child.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { memberId: input.memberId, size: stdout.length },
          'Local teammate stdout truncated',
        );
      } else {
        stdout += chunk;
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ teammate: input.memberName }, line);
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
      logger.error({ memberId: input.memberId }, 'Local teammate timeout, killing');
      timedOut = true;
      child.kill('SIGKILL');
      // Don't resolve here — let child.on('close') handle it so the
      // finally block in runTeammateInContainer runs in the right order
      // and DB status gets updated properly.
    }, TEAMMATE_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Write log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `teammate-${input.memberName}-${timestamp}.log`);

      const logLines = [
        `=== Local Teammate Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Team: ${input.teamId}`,
        `Member: ${input.memberName} (${input.memberId})`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Timed Out: ${timedOut}`,
        ``,
        `=== Stderr ===`,
        stderr.slice(-2000),
        ``,
        `=== Stdout ===`,
        stdout.slice(-2000),
      ];

      fs.writeFileSync(logFile, logLines.join('\n'));

      if (code !== 0) {
        logger.error(
          {
            memberId: input.memberId,
            code,
            duration,
            timedOut,
            stderr: stderr.slice(-500),
          },
          'Local teammate exited with error',
        );
      } else {
        logger.info(
          { memberId: input.memberId, duration },
          'Local teammate completed',
        );
      }

      // Try to parse stdout even if killed by timeout — agent may have
      // already written its response before entering the idle IPC wait loop.
      const parsed = parseAgentOutput(stdout, code, stderr);
      if (timedOut && parsed.status === 'error') {
        resolve({
          status: 'error',
          result: null,
          error: `Local teammate timed out after ${TEAMMATE_TIMEOUT}ms`,
        });
      } else {
        resolve(parsed);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ memberId: input.memberId, error: err }, 'Local teammate spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Local teammate spawn error: ${err.message}`,
      });
    });
  });
}
