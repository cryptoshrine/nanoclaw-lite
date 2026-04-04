/**
 * OmX Pattern 6: Context Snapshot Reuse
 *
 * Persists a rolling context snapshot to disk so every specialist spawned
 * by an OmX workflow starts with shared knowledge instead of re-discovering
 * the same codebase facts.
 *
 * Snapshot lives at: data/omx-workflows/{workflow-id}/context.md
 * Max size: 12KB — oldest content is truncated from the front when exceeded.
 */

import fs from 'fs';
import path from 'path';
import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum snapshot size in bytes (12KB) */
export const SNAPSHOT_MAX_SIZE = 12_288;

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapshotDir(workflowId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, workflowId);
}

function snapshotPath(workflowId: string): string {
  return path.join(snapshotDir(workflowId), 'context.md');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create the initial context snapshot when a workflow is created.
 * Writes task description, project path, and the full workflow steps
 * so every specialist has baseline context from the start.
 */
export function createSnapshot(
  workflowId: string,
  taskDescription: string,
  projectPath: string,
  workflowContent: string,
): void {
  const dir = snapshotDir(workflowId);
  fs.mkdirSync(dir, { recursive: true });

  const header = [
    `# OmX Context Snapshot`,
    ``,
    `**Task:** ${taskDescription}`,
    `**Project:** ${projectPath}`,
    `**Workflow ID:** ${workflowId}`,
    ``,
    `## Workflow Steps`,
    ``,
    workflowContent.slice(0, 4000),
    ``,
    `---`,
    ``,
    `## Step Outputs`,
    ``,
  ].join('\n');

  // Truncate if the header itself exceeds the limit (unlikely but safe)
  const content = header.length > SNAPSHOT_MAX_SIZE
    ? header.slice(header.length - SNAPSHOT_MAX_SIZE)
    : header;

  fs.writeFileSync(snapshotPath(workflowId), content, 'utf-8');
  logger.debug({ workflowId }, 'OmX context snapshot created');
}

/**
 * Append a step's output summary to the snapshot.
 * If the total size would exceed SNAPSHOT_MAX_SIZE, content is
 * truncated from the front (oldest material removed first).
 */
export function appendToSnapshot(
  workflowId: string,
  stepNumber: number,
  stepTitle: string,
  output: string,
): void {
  const filePath = snapshotPath(workflowId);
  let existing = '';
  try {
    existing = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Snapshot doesn't exist yet — create a minimal one
    fs.mkdirSync(snapshotDir(workflowId), { recursive: true });
  }

  const entry = `\n### Step ${stepNumber}: ${stepTitle}\n${output.slice(0, 2000)}\n`;
  let combined = existing + entry;

  // Truncate from the front if over limit
  if (Buffer.byteLength(combined, 'utf-8') > SNAPSHOT_MAX_SIZE) {
    // Find a clean line break to trim to
    const excess = Buffer.byteLength(combined, 'utf-8') - SNAPSHOT_MAX_SIZE;
    const trimmed = combined.slice(excess);
    const firstNewline = trimmed.indexOf('\n');
    combined = firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed;
  }

  fs.writeFileSync(filePath, combined, 'utf-8');
  logger.debug({ workflowId, stepNumber }, 'OmX context snapshot updated');
}

/**
 * Read the current context snapshot. Returns empty string if not found.
 */
export function readSnapshot(workflowId: string): string {
  try {
    return fs.readFileSync(snapshotPath(workflowId), 'utf-8');
  } catch {
    return '';
  }
}
