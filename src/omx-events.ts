/**
 * OmX Event System
 *
 * Typed, append-only event log for OmX workflow lifecycle.
 * Events are written as NDJSON (one JSON object per line) to:
 *   data/omx-workflows/{workflowId}/events.jsonl
 *
 * Also broadcasts to WebSocket (KlawHQ) and Discord #mission-control
 * for critical events.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';
import { broadcast as wsBroadcast } from './ws-server.js';
import { postToMissionControl } from './discord-channels.js';

// ── Event Types ──────────────────────────────────────────────────────────────

const OMX_EVENT_TYPES = [
  // Workflow events
  'workflow.created',
  'workflow.completed',
  'workflow.failed',
  'workflow.stale',
  'workflow.approval_requested',
  'workflow.approval_granted',
  'workflow.approval_rejected',
  // Step events
  'step.pending',
  'step.claimed',
  'step.spawned',
  'step.in_progress',
  'step.completed',
  'step.failed',
  'step.retried',
  'step.skipped',
  'step.stalled',
  'step.timeout',
  'step.nudged',
  'step.deslop_started',
  'step.deslop_completed',
  'step.ambiguity_flagged',
  'step.ambiguity_enhanced',
  // Specialist events
  'specialist.spawned',
  'specialist.completed',
  'specialist.failed',
  'specialist.stalled',
  'specialist.timeout',
  'specialist.heartbeat_stale',
  'specialist.stuck_loop',
  // Codex events
  'codex.started',
  'codex.completed',
  'codex.failed',
  'codex.nudged',
  'codex.timeout',
  // Mailbox events
  'mailbox.message_written',
  'mailbox.message_delivered',
  // Branch events
  'branch.created',
  'branch.merged',
  'branch.merge_failed',
  'branch.cleaned',
  // System events
  'supervisor.tick',
  'supervisor.error',
] as const;

/** Union of all 38 OmX event types */
export type OmxEventType = (typeof OMX_EVENT_TYPES)[number];

/** A single OmX event */
export interface OmxEvent {
  id: string;
  type: OmxEventType;
  timestamp: string;
  workflowId: string;
  stepNumber?: number;
  data: Record<string, unknown>;
}

/** Filter options for readEvents() */
export interface EventFilter {
  type?: OmxEventType;
  since?: string;
  stepNumber?: number;
}

// ── Critical events that get forwarded to Discord #mission-control ───────────

const CRITICAL_EVENTS: ReadonlySet<OmxEventType> = new Set([
  'workflow.completed',
  'workflow.failed',
  'workflow.stale',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function eventsPath(workflowId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, workflowId, 'events.jsonl');
}

function ensureDir(workflowId: string): void {
  const dir = path.join(OMX_WORKFLOWS_DIR, workflowId);
  fs.mkdirSync(dir, { recursive: true });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit an OmX event. Writes to NDJSON log, broadcasts via WebSocket,
 * and forwards critical events to Discord #mission-control.
 *
 * Synchronous for the file write; WS broadcast and Discord post are fire-and-forget.
 */
export function emitEvent(
  workflowId: string,
  type: OmxEventType,
  data: Record<string, unknown> = {},
  stepNumber?: number,
): OmxEvent {
  const event: OmxEvent = {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    workflowId,
    stepNumber,
    data,
  };

  // 1. Append to NDJSON log (atomic: write to .tmp then rename won't work for
  //    append-only — use appendFileSync which is atomic enough for single-process)
  try {
    ensureDir(workflowId);
    fs.appendFileSync(eventsPath(workflowId), JSON.stringify(event) + '\n');
  } catch (err) {
    logger.warn({ workflowId, type, err }, 'Failed to write event to log');
  }

  // 2. WebSocket broadcast (fire-and-forget)
  try {
    wsBroadcast('omx:event', { ...event });
  } catch {
    // WS server might not be running — that's fine
  }

  // 3. Discord #mission-control for critical events (fire-and-forget)
  if (CRITICAL_EVENTS.has(type)) {
    const emoji = type === 'workflow.completed' ? '\u2705' : '\u274c';
    const title = `${emoji} OmX: ${type}`;
    const status = [
      `Workflow: \`${workflowId}\``,
      stepNumber != null ? `Step: ${stepNumber}` : '',
      data.message ? String(data.message) : '',
    ]
      .filter(Boolean)
      .join('\n');
    const color = type === 'workflow.completed' ? 0x22c55e : 0xef4444;

    postToMissionControl(title, status, color).catch(() => {
      // Discord might not be connected — non-critical
    });
  }

  logger.debug({ workflowId, type, stepNumber, eventId: event.id }, 'OmX event emitted');
  return event;
}

/**
 * Read events from a workflow's NDJSON log with optional filtering.
 *
 * @param workflowId - Workflow to read events for
 * @param filter - Optional filter by type, since timestamp, or step number
 */
export function readEvents(workflowId: string, filter?: EventFilter): OmxEvent[] {
  const filePath = eventsPath(workflowId);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const events: OmxEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as OmxEvent);
    } catch {
      // Corrupted line — skip
    }
  }

  if (!filter) return events;

  return events.filter((e) => {
    if (filter.type && e.type !== filter.type) return false;
    if (filter.since && e.timestamp < filter.since) return false;
    if (filter.stepNumber != null && e.stepNumber !== filter.stepNumber) return false;
    return true;
  });
}

/**
 * Get the most recent event of a given type for a workflow.
 *
 * @param workflowId - Workflow to search
 * @param type - Event type to find
 */
export function getLatestEvent(workflowId: string, type: OmxEventType): OmxEvent | undefined {
  const events = readEvents(workflowId, { type });
  return events.length > 0 ? events[events.length - 1] : undefined;
}

/**
 * Return the last N events from a workflow's log (tail).
 *
 * Reads the entire file and returns the final N entries.
 * For very large logs, consider streaming — but OmX workflows
 * are short-lived (< 1hr) so this is fine.
 *
 * @param workflowId - Workflow to read
 * @param n - Number of events to return (default: 20)
 */
export function tailEvents(workflowId: string, n: number = 20): OmxEvent[] {
  const all = readEvents(workflowId);
  return all.slice(-n);
}
