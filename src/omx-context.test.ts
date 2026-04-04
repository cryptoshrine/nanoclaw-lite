import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createSnapshot, appendToSnapshot, readSnapshot, SNAPSHOT_MAX_SIZE } from './omx-context.js';

// Mock OMX_WORKFLOWS_DIR to use a temp directory
let tmpDir: string;

vi.mock('./config.js', () => ({
  get OMX_WORKFLOWS_DIR() {
    return tmpDir;
  },
}));

// Suppress logger noise in tests
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('omx-context', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omx-context-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSnapshot', () => {
    it('creates file on disk', () => {
      createSnapshot('wf-1', 'Add auth', '/tmp/project', '## Step 1: Plan\nDo stuff');

      const snapshotPath = path.join(tmpDir, 'wf-1', 'context.md');
      expect(fs.existsSync(snapshotPath)).toBe(true);
    });

    it('includes task description and project path', () => {
      createSnapshot('wf-2', 'Fix the bug', '/home/user/repo', '## Step 1\nContent');

      const content = fs.readFileSync(path.join(tmpDir, 'wf-2', 'context.md'), 'utf-8');
      expect(content).toContain('**Task:** Fix the bug');
      expect(content).toContain('**Project:** /home/user/repo');
      expect(content).toContain('**Workflow ID:** wf-2');
    });

    it('includes workflow content', () => {
      const workflowMd = '## Step 1: Research\nDo research\n\n## Step 2: Build\nBuild it';
      createSnapshot('wf-3', 'Build feature', '/tmp/p', workflowMd);

      const content = fs.readFileSync(path.join(tmpDir, 'wf-3', 'context.md'), 'utf-8');
      expect(content).toContain('## Step 1: Research');
      expect(content).toContain('Do research');
    });

    it('creates the workflow directory if it does not exist', () => {
      const dir = path.join(tmpDir, 'wf-new');
      expect(fs.existsSync(dir)).toBe(false);

      createSnapshot('wf-new', 'New task', '/tmp/p', 'Steps here');
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('truncates very large workflow content to 4000 chars', () => {
      const hugeContent = 'x'.repeat(5000);
      createSnapshot('wf-big', 'Big task', '/tmp/p', hugeContent);

      const content = fs.readFileSync(path.join(tmpDir, 'wf-big', 'context.md'), 'utf-8');
      // The workflow content is sliced to 4000 chars, so total file < header + 4000
      expect(content.length).toBeLessThan(4200);
    });
  });

  describe('appendToSnapshot', () => {
    it('adds step output to existing snapshot', () => {
      createSnapshot('wf-a', 'Task A', '/tmp/p', 'Steps');
      appendToSnapshot('wf-a', 1, 'Research', 'Found 3 issues');

      const content = fs.readFileSync(path.join(tmpDir, 'wf-a', 'context.md'), 'utf-8');
      expect(content).toContain('### Step 1: Research');
      expect(content).toContain('Found 3 issues');
    });

    it('appends multiple step outputs', () => {
      createSnapshot('wf-b', 'Task B', '/tmp/p', 'Steps');
      appendToSnapshot('wf-b', 1, 'Plan', 'Plan output');
      appendToSnapshot('wf-b', 2, 'Build', 'Build output');

      const content = fs.readFileSync(path.join(tmpDir, 'wf-b', 'context.md'), 'utf-8');
      expect(content).toContain('### Step 1: Plan');
      expect(content).toContain('### Step 2: Build');
    });

    it('truncates to stay under SNAPSHOT_MAX_SIZE when too large', () => {
      createSnapshot('wf-trunc', 'Truncation test', '/tmp/p', 'Steps');

      // Append enough data to exceed the limit
      for (let i = 1; i <= 20; i++) {
        appendToSnapshot('wf-trunc', i, `Step ${i}`, 'A'.repeat(1500));
      }

      const content = fs.readFileSync(path.join(tmpDir, 'wf-trunc', 'context.md'), 'utf-8');
      const byteSize = Buffer.byteLength(content, 'utf-8');
      expect(byteSize).toBeLessThanOrEqual(SNAPSHOT_MAX_SIZE);
    });

    it('creates snapshot dir if it does not exist', () => {
      // Don't call createSnapshot first — appendToSnapshot should handle it
      appendToSnapshot('wf-no-init', 1, 'Step 1', 'Output here');

      const content = fs.readFileSync(path.join(tmpDir, 'wf-no-init', 'context.md'), 'utf-8');
      expect(content).toContain('### Step 1: Step 1');
    });

    it('truncates individual step output to 2000 chars', () => {
      createSnapshot('wf-long', 'Long output', '/tmp/p', 'Steps');
      appendToSnapshot('wf-long', 1, 'Verbose', 'Z'.repeat(5000));

      const content = fs.readFileSync(path.join(tmpDir, 'wf-long', 'context.md'), 'utf-8');
      // Count Z's — should be capped at 2000
      const zCount = (content.match(/Z/g) || []).length;
      expect(zCount).toBe(2000);
    });
  });

  describe('readSnapshot', () => {
    it('returns empty string for non-existent workflow', () => {
      const result = readSnapshot('does-not-exist');
      expect(result).toBe('');
    });

    it('returns content for existing snapshot', () => {
      createSnapshot('wf-read', 'Read test', '/tmp/p', 'My steps');
      const result = readSnapshot('wf-read');
      expect(result).toContain('Read test');
      expect(result).toContain('My steps');
    });

    it('returns updated content after append', () => {
      createSnapshot('wf-read2', 'Read test 2', '/tmp/p', 'Steps');
      appendToSnapshot('wf-read2', 1, 'Done', 'All good');

      const result = readSnapshot('wf-read2');
      expect(result).toContain('### Step 1: Done');
      expect(result).toContain('All good');
    });
  });
});
