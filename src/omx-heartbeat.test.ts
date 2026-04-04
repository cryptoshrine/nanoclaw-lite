import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  startHeartbeat,
  stopHeartbeat,
  bumpTurnCount,
  readHeartbeat,
  isWorkerDead,
  isWorkerStuckInLoop,
  cleanupHeartbeat,
} from './omx-heartbeat.js';

// ── Setup / Teardown ────────────────────────────────────────────────────────

let tmpIpcBase: string;

beforeEach(() => {
  tmpIpcBase = path.join(os.tmpdir(), `omx-heartbeat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpIpcBase, { recursive: true });
});

afterEach(() => {
  // Clean up any active intervals via cleanup
  try { cleanupHeartbeat('member-1', tmpIpcBase); } catch { /* noop */ }
  try { cleanupHeartbeat('member-2', tmpIpcBase); } catch { /* noop */ }
  fs.rmSync(tmpIpcBase, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('omx-heartbeat', () => {
  const MEMBER_ID = 'member-1';
  const WORKFLOW_ID = 'wf-test-1';

  describe('startHeartbeat', () => {
    it('creates heartbeat.json file', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      const hbPath = path.join(tmpIpcBase, MEMBER_ID, 'heartbeat.json');
      expect(fs.existsSync(hbPath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(hbPath, 'utf-8'));
      expect(data.workflowId).toBe(WORKFLOW_ID);
      expect(data.stepNumber).toBe(1);
      expect(data.alive).toBe(true);
      expect(data.turnCount).toBe(0);

      // Cleanup interval
      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });
  });

  describe('readHeartbeat', () => {
    it('returns data after start', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 2, tmpIpcBase);

      const hb = readHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(hb).not.toBeNull();
      expect(hb!.workflowId).toBe(WORKFLOW_ID);
      expect(hb!.stepNumber).toBe(2);
      expect(hb!.alive).toBe(true);
      expect(hb!.turnCount).toBe(0);
      expect(hb!.pid).toBe(process.pid);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });

    it('returns null for non-existent member', () => {
      const hb = readHeartbeat('ghost-member', tmpIpcBase);
      expect(hb).toBeNull();
    });
  });

  describe('stopHeartbeat', () => {
    it('writes alive=false', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);
      stopHeartbeat(MEMBER_ID, tmpIpcBase);

      const hb = readHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(hb).not.toBeNull();
      expect(hb!.alive).toBe(false);
    });
  });

  describe('bumpTurnCount', () => {
    it('increments turnCount', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      const before = readHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(before!.turnCount).toBe(0);

      bumpTurnCount(MEMBER_ID, tmpIpcBase);
      const after1 = readHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(after1!.turnCount).toBe(1);

      bumpTurnCount(MEMBER_ID, tmpIpcBase);
      const after2 = readHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(after2!.turnCount).toBe(2);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });
  });

  describe('isWorkerDead', () => {
    it('returns true for missing heartbeat', () => {
      expect(isWorkerDead('no-such-member', 180_000, tmpIpcBase)).toBe(true);
    });

    it('returns true for alive=false', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);
      stopHeartbeat(MEMBER_ID, tmpIpcBase);

      expect(isWorkerDead(MEMBER_ID, 180_000, tmpIpcBase)).toBe(true);
    });

    it('returns true for stale heartbeat', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      // Manually set updatedAt to 5 minutes ago
      const hb = readHeartbeat(MEMBER_ID, tmpIpcBase)!;
      hb.updatedAt = new Date(Date.now() - 300_000).toISOString();
      const hbPath = path.join(tmpIpcBase, MEMBER_ID, 'heartbeat.json');
      fs.writeFileSync(hbPath, JSON.stringify(hb, null, 2));

      // With 180s threshold, 300s old = dead
      expect(isWorkerDead(MEMBER_ID, 180_000, tmpIpcBase)).toBe(true);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });

    it('returns false for fresh heartbeat', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      expect(isWorkerDead(MEMBER_ID, 180_000, tmpIpcBase)).toBe(false);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });
  });

  describe('isWorkerStuckInLoop', () => {
    it('returns false on first call (no baseline)', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      // First call establishes baseline — should not be stuck
      expect(isWorkerStuckInLoop(MEMBER_ID, tmpIpcBase)).toBe(false);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });

    it('returns true when turnCount unchanged for too long', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      // First call — establish baseline
      isWorkerStuckInLoop(MEMBER_ID, tmpIpcBase);

      // Simulate time passing by using vi.spyOn on Date.now
      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 200_000); // 200s later

      // turnCount hasn't changed, 200s > 180s threshold
      expect(isWorkerStuckInLoop(MEMBER_ID, tmpIpcBase)).toBe(true);

      vi.restoreAllMocks();
      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });

    it('returns false when turnCount is progressing', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      // First call — baseline
      isWorkerStuckInLoop(MEMBER_ID, tmpIpcBase);

      // Bump turn count to show progress
      bumpTurnCount(MEMBER_ID, tmpIpcBase);

      // Second call — turnCount changed, should reset snapshot
      expect(isWorkerStuckInLoop(MEMBER_ID, tmpIpcBase)).toBe(false);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
    });
  });

  describe('cleanupHeartbeat', () => {
    it('removes file and internal state', () => {
      startHeartbeat(MEMBER_ID, WORKFLOW_ID, 1, tmpIpcBase);

      const hbPath = path.join(tmpIpcBase, MEMBER_ID, 'heartbeat.json');
      expect(fs.existsSync(hbPath)).toBe(true);

      cleanupHeartbeat(MEMBER_ID, tmpIpcBase);
      expect(fs.existsSync(hbPath)).toBe(false);

      // readHeartbeat should return null now
      expect(readHeartbeat(MEMBER_ID, tmpIpcBase)).toBeNull();
    });
  });
});
