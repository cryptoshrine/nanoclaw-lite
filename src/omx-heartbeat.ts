/**
 * OmX Heartbeat System
 *
 * File-based heartbeat for specialist health monitoring.
 *
 * Specialist-side: writes heartbeat.json every 60s to data/ipc/teammates/{memberId}/
 * Supervisor-side: reads heartbeat files to detect dead/stuck workers.
 *
 * Heartbeat payload:
 *   { pid, workflowId, stepNumber, turnCount, lastTurnAt, memoryMB, alive, updatedAt }
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeartbeatData {
  pid: number;
  workflowId: string;
  stepNumber?: number;
  turnCount: number;
  lastTurnAt: string;
  memoryMB: number;
  alive: boolean;
  updatedAt: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

/** Base directory for teammate IPC files. */
const DEFAULT_IPC_BASE = join(process.cwd(), 'data', 'ipc', 'teammates');

/** How often the heartbeat writes (ms). */
const HEARTBEAT_INTERVAL_MS = 60_000;

/** Default threshold for declaring a worker dead: 3 missed beats at 60s = 180s. */
const DEFAULT_DEAD_THRESHOLD_MS = 180_000;

/** Threshold for detecting stuck-in-loop: same turnCount for this long. */
const STUCK_LOOP_THRESHOLD_MS = 180_000;

// ── Internal State ───────────────────────────────────────────────────────────

/** Active heartbeat intervals keyed by memberId. */
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>();

/** Last-known turnCount per memberId for stuck-loop detection. */
const turnCountSnapshots = new Map<string, { turnCount: number; observedAt: number }>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function heartbeatPath(memberId: string, ipcBase?: string): string {
  return join(ipcBase || DEFAULT_IPC_BASE, memberId, 'heartbeat.json');
}

function ensureDir(memberId: string, ipcBase?: string): void {
  mkdirSync(join(ipcBase || DEFAULT_IPC_BASE, memberId), { recursive: true });
}

function getMemoryMB(): number {
  try {
    return Math.round(process.memoryUsage.rss() / 1024 / 1024);
  } catch {
    try {
      return Math.round(process.memoryUsage().rss / 1024 / 1024);
    } catch {
      return 0;
    }
  }
}

// ── Specialist-Side (Write Heartbeats) ───────────────────────────────────────

/**
 * Start writing heartbeat files at 60s intervals.
 * Called when a specialist starts working on a step.
 */
export function startHeartbeat(
  memberId: string,
  workflowId: string,
  stepNumber?: number,
  ipcBase?: string,
): void {
  // Clear any existing interval for this member
  stopHeartbeat(memberId, ipcBase);

  ensureDir(memberId, ipcBase);

  // Write initial heartbeat immediately
  const data: HeartbeatData = {
    pid: process.pid,
    workflowId,
    stepNumber,
    turnCount: 0,
    lastTurnAt: new Date().toISOString(),
    memoryMB: getMemoryMB(),
    alive: true,
    updatedAt: new Date().toISOString(),
  };

  try {
    writeFileSync(heartbeatPath(memberId, ipcBase), JSON.stringify(data, null, 2));
  } catch {
    // Non-fatal — supervisor will just see a missing heartbeat
  }

  // Schedule recurring writes
  const interval = setInterval(() => {
    try {
      const existing = readHeartbeat(memberId, ipcBase);
      const updated: HeartbeatData = {
        pid: process.pid,
        workflowId,
        stepNumber: existing?.stepNumber ?? stepNumber,
        turnCount: existing?.turnCount ?? 0,
        lastTurnAt: existing?.lastTurnAt ?? new Date().toISOString(),
        memoryMB: getMemoryMB(),
        alive: true,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(heartbeatPath(memberId, ipcBase), JSON.stringify(updated, null, 2));
    } catch {
      // Best-effort — don't crash the specialist over heartbeat failure
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Unref so the interval doesn't prevent process exit
  if (interval.unref) interval.unref();

  activeIntervals.set(memberId, interval);
}

/**
 * Stop writing heartbeat files. Writes a final `alive: false` marker.
 * Called when a specialist finishes or crashes.
 */
export function stopHeartbeat(memberId: string, ipcBase?: string): void {
  const interval = activeIntervals.get(memberId);
  if (interval) {
    clearInterval(interval);
    activeIntervals.delete(memberId);
  }

  // Write final dead marker
  try {
    const existing = readHeartbeat(memberId, ipcBase);
    if (existing) {
      existing.alive = false;
      existing.updatedAt = new Date().toISOString();
      writeFileSync(heartbeatPath(memberId, ipcBase), JSON.stringify(existing, null, 2));
    }
  } catch {
    // Best-effort
  }
}

/**
 * Increment the turn count and update lastTurnAt.
 * Called by the agent runner after each SDK query() turn.
 */
export function bumpTurnCount(memberId: string, ipcBase?: string): void {
  try {
    const existing = readHeartbeat(memberId, ipcBase);
    if (existing) {
      existing.turnCount++;
      existing.lastTurnAt = new Date().toISOString();
      existing.updatedAt = new Date().toISOString();
      writeFileSync(heartbeatPath(memberId, ipcBase), JSON.stringify(existing, null, 2));
    }
  } catch {
    // Best-effort — don't crash the specialist
  }
}

// ── Supervisor-Side (Read & Validate Heartbeats) ─────────────────────────────

/**
 * Read a specialist's heartbeat data from disk.
 * Returns null if the file doesn't exist or is corrupted.
 */
export function readHeartbeat(memberId: string, ipcBase?: string): HeartbeatData | null {
  const filePath = heartbeatPath(memberId, ipcBase);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as HeartbeatData;

    // Validate required fields
    if (typeof data.updatedAt !== 'string' || typeof data.alive !== 'boolean') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Check if a worker is dead (no heartbeat or heartbeat too old).
 *
 * @param memberId - The teammate member ID
 * @param thresholdMs - How old the heartbeat can be before considered dead (default: 180s = 3 missed beats)
 * @param ipcBase - Optional override for IPC base path
 */
export function isWorkerDead(
  memberId: string,
  thresholdMs: number = DEFAULT_DEAD_THRESHOLD_MS,
  ipcBase?: string,
): boolean {
  const hb = readHeartbeat(memberId, ipcBase);

  // No heartbeat file at all → dead
  if (!hb) return true;

  // Explicitly marked as not alive → dead
  if (!hb.alive) return true;

  // Heartbeat too old → dead
  const age = Date.now() - new Date(hb.updatedAt).getTime();
  return age > thresholdMs;
}

/**
 * Check if a worker is stuck in a loop (same turnCount for too long).
 *
 * Uses an internal snapshot map to track when the turnCount was last different.
 * Must be called repeatedly (e.g. every supervisor tick) to work.
 *
 * @param memberId - The teammate member ID
 * @param ipcBase - Optional override for IPC base path
 */
export function isWorkerStuckInLoop(memberId: string, ipcBase?: string): boolean {
  const hb = readHeartbeat(memberId, ipcBase);
  if (!hb) return false; // No heartbeat → not stuck (might be dead instead)

  const now = Date.now();
  const snapshot = turnCountSnapshots.get(memberId);

  if (!snapshot || snapshot.turnCount !== hb.turnCount) {
    // turnCount changed — update snapshot
    turnCountSnapshots.set(memberId, { turnCount: hb.turnCount, observedAt: now });
    return false;
  }

  // turnCount hasn't changed — check how long
  return now - snapshot.observedAt > STUCK_LOOP_THRESHOLD_MS;
}

/**
 * Delete the heartbeat file after a step completes or the worker is cleaned up.
 */
export function cleanupHeartbeat(memberId: string, ipcBase?: string): void {
  // Clear internal state
  activeIntervals.delete(memberId);
  turnCountSnapshots.delete(memberId);

  // Delete file
  try {
    const filePath = heartbeatPath(memberId, ipcBase);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup
  }
}
