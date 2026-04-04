import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// vi.hoisted runs in the hoisted scope so vi.mock factories can reference it
const { tmpDir } = vi.hoisted(() => {
  const _path = require('path');
  const _os = require('os');
  return { tmpDir: _path.join(_os.tmpdir(), `omx-events-test-${Date.now()}`) };
});

// Mock ws-server and discord-channels before importing the module
vi.mock('./ws-server.js', () => ({ broadcast: vi.fn() }));
vi.mock('./discord-channels.js', () => ({
  postToMissionControl: vi.fn().mockResolvedValue(undefined),
}));

// Mock config to use a temp directory for workflows
vi.mock('./config.js', () => ({
  OMX_WORKFLOWS_DIR: tmpDir,
}));

// Mock logger to suppress output
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Now import — mocks are hoisted above this
import { emitEvent, readEvents, getLatestEvent, tailEvents } from './omx-events.js';
import { broadcast } from './ws-server.js';
import { postToMissionControl } from './discord-channels.js';

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('omx-events', () => {
  const WF_ID = 'test-workflow-1';

  describe('emitEvent', () => {
    it('creates NDJSON file in workflow directory', () => {
      emitEvent(WF_ID, 'workflow.created', { message: 'started' });

      const filePath = path.join(tmpDir, WF_ID, 'events.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const event = JSON.parse(content);
      expect(event.type).toBe('workflow.created');
      expect(event.workflowId).toBe(WF_ID);
      expect(event.data).toEqual({ message: 'started' });
    });

    it('appends to existing log', () => {
      emitEvent(WF_ID, 'step.pending', { step: 1 });
      emitEvent(WF_ID, 'step.completed', { step: 1 });

      const filePath = path.join(tmpDir, WF_ID, 'events.jsonl');
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      const second = JSON.parse(lines[1]);
      expect(first.type).toBe('step.pending');
      expect(second.type).toBe('step.completed');
    });

    it('returns event with id, type, and timestamp', () => {
      const event = emitEvent(WF_ID, 'step.spawned', { memberId: 'm1' }, 2);

      expect(event.id).toBeTypeOf('string');
      expect(event.id).toHaveLength(36); // UUID
      expect(event.type).toBe('step.spawned');
      expect(event.timestamp).toBeTypeOf('string');
      expect(event.workflowId).toBe(WF_ID);
      expect(event.stepNumber).toBe(2);
      expect(event.data).toEqual({ memberId: 'm1' });
    });

    it('broadcasts via WebSocket', () => {
      emitEvent(WF_ID, 'step.claimed');
      expect(broadcast).toHaveBeenCalledWith('omx:event', expect.objectContaining({
        type: 'step.claimed',
        workflowId: WF_ID,
      }));
    });

    it('posts critical events to Discord #mission-control', () => {
      emitEvent(WF_ID, 'workflow.completed', { message: 'done' });
      expect(postToMissionControl).toHaveBeenCalledOnce();
    });

    it('does not post non-critical events to Discord', () => {
      emitEvent(WF_ID, 'step.pending');
      expect(postToMissionControl).not.toHaveBeenCalled();
    });

    it('handles missing workflow directory gracefully (creates it)', () => {
      // tmpDir exists but workflow subdirectory doesn't — emitEvent should create it
      const event = emitEvent('brand-new-wf', 'workflow.created');
      expect(event.type).toBe('workflow.created');

      const filePath = path.join(tmpDir, 'brand-new-wf', 'events.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('readEvents', () => {
    it('returns all events for a workflow', () => {
      emitEvent(WF_ID, 'step.pending', {}, 1);
      emitEvent(WF_ID, 'step.completed', {}, 1);
      emitEvent(WF_ID, 'step.pending', {}, 2);

      const events = readEvents(WF_ID);
      expect(events).toHaveLength(3);
    });

    it('returns empty array for non-existent workflow', () => {
      const events = readEvents('does-not-exist');
      expect(events).toEqual([]);
    });

    it('with type filter returns only matching events', () => {
      emitEvent(WF_ID, 'step.pending', {}, 1);
      emitEvent(WF_ID, 'step.completed', {}, 1);
      emitEvent(WF_ID, 'step.pending', {}, 2);

      const pending = readEvents(WF_ID, { type: 'step.pending' });
      expect(pending).toHaveLength(2);
      expect(pending.every(e => e.type === 'step.pending')).toBe(true);
    });

    it('with since filter returns only events after timestamp', () => {
      const e1 = emitEvent(WF_ID, 'step.pending');

      // Small delay to ensure different timestamps
      const midpoint = new Date().toISOString();

      const e2 = emitEvent(WF_ID, 'step.completed');

      // Use the first event's timestamp as the cutoff — everything at or after midpoint
      const events = readEvents(WF_ID, { since: midpoint });
      // At minimum, e2 should be included (its timestamp >= midpoint)
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some(e => e.type === 'step.completed')).toBe(true);
    });

    it('with stepNumber filter returns only matching step events', () => {
      emitEvent(WF_ID, 'step.pending', {}, 1);
      emitEvent(WF_ID, 'step.completed', {}, 1);
      emitEvent(WF_ID, 'step.pending', {}, 2);
      emitEvent(WF_ID, 'workflow.created'); // no stepNumber

      const step1 = readEvents(WF_ID, { stepNumber: 1 });
      expect(step1).toHaveLength(2);
      expect(step1.every(e => e.stepNumber === 1)).toBe(true);
    });
  });

  describe('getLatestEvent', () => {
    it('returns most recent event of given type', () => {
      emitEvent(WF_ID, 'step.pending', { idx: 1 }, 1);
      emitEvent(WF_ID, 'step.completed', { idx: 2 }, 1);
      emitEvent(WF_ID, 'step.pending', { idx: 3 }, 2);

      const latest = getLatestEvent(WF_ID, 'step.pending');
      expect(latest).toBeDefined();
      expect(latest!.data.idx).toBe(3);
      expect(latest!.stepNumber).toBe(2);
    });

    it('returns undefined if no events of that type exist', () => {
      emitEvent(WF_ID, 'step.pending');
      const latest = getLatestEvent(WF_ID, 'workflow.completed');
      expect(latest).toBeUndefined();
    });
  });

  describe('tailEvents', () => {
    it('returns last N events', () => {
      for (let i = 0; i < 10; i++) {
        emitEvent(WF_ID, 'step.pending', { idx: i }, i);
      }

      const tail = tailEvents(WF_ID, 3);
      expect(tail).toHaveLength(3);
      expect(tail[0].data.idx).toBe(7);
      expect(tail[1].data.idx).toBe(8);
      expect(tail[2].data.idx).toBe(9);
    });

    it('returns all events if fewer than N exist', () => {
      emitEvent(WF_ID, 'step.pending');
      emitEvent(WF_ID, 'step.completed');

      const tail = tailEvents(WF_ID, 20);
      expect(tail).toHaveLength(2);
    });

    it('returns empty array for non-existent workflow', () => {
      const tail = tailEvents('nope');
      expect(tail).toEqual([]);
    });
  });
});
