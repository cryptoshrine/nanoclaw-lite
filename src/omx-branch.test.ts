import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  createWorkflowBranch,
  mergeWorkflowBranch,
  cleanupBranch,
  getCurrentBranch,
} from './omx-branch.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function initTmpRepo(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'omx-branch-'));
  execSync('git init -b main', { cwd: tmpDir });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir });
  execSync('git config user.name "Test"', { cwd: tmpDir });
  // Need an actual file for the initial commit so branches work
  writeFileSync(join(tmpDir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "init"', { cwd: tmpDir });
  return tmpDir;
}

function getBranch(cwd: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
}

function branchExists(cwd: string, name: string): boolean {
  const list = execSync(`git branch --list ${name}`, { cwd, encoding: 'utf-8' }).trim();
  return list.length > 0;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('omx-branch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initTmpRepo();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows cleanup can be flaky — ignore
    }
  });

  describe('createWorkflowBranch', () => {
    it('creates a new git branch named omx/{id}', () => {
      createWorkflowBranch(tmpDir, 'test-workflow-1');
      expect(getBranch(tmpDir)).toBe('omx/test-workflow-1');
      expect(branchExists(tmpDir, 'omx/test-workflow-1')).toBe(true);
    });

    it('returns the branch name', () => {
      const name = createWorkflowBranch(tmpDir, 'wf-123');
      expect(name).toBe('omx/wf-123');
    });

    it('switches to existing branch if already created', () => {
      createWorkflowBranch(tmpDir, 'wf-exist');
      // Switch back to main
      execSync('git checkout main', { cwd: tmpDir });
      expect(getBranch(tmpDir)).toBe('main');

      // Should just check out the existing branch, not error
      const name = createWorkflowBranch(tmpDir, 'wf-exist');
      expect(name).toBe('omx/wf-exist');
      expect(getBranch(tmpDir)).toBe('omx/wf-exist');
    });

    it('uses custom base branch when specified', () => {
      // Create a develop branch
      execSync('git checkout -b develop', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'dev.txt'), 'dev content\n');
      execSync('git add . && git commit -m "dev commit"', { cwd: tmpDir });
      execSync('git checkout main', { cwd: tmpDir });

      const name = createWorkflowBranch(tmpDir, 'from-develop', 'develop');
      expect(name).toBe('omx/from-develop');
      expect(getBranch(tmpDir)).toBe('omx/from-develop');
    });
  });

  describe('mergeWorkflowBranch', () => {
    it('merges back to original branch and returns success=true', () => {
      createWorkflowBranch(tmpDir, 'merge-test');
      // Make a commit on the workflow branch
      writeFileSync(join(tmpDir, 'feature.ts'), 'export const x = 1;\n');
      execSync('git add . && git commit -m "add feature"', { cwd: tmpDir });

      const result = mergeWorkflowBranch(tmpDir, 'merge-test');
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(getBranch(tmpDir)).toBe('main');
    });

    it('returns success=false on conflict', () => {
      // Create diverging changes
      createWorkflowBranch(tmpDir, 'conflict-test');
      writeFileSync(join(tmpDir, 'README.md'), 'branch version\n');
      execSync('git add . && git commit -m "branch change"', { cwd: tmpDir });

      // Make a conflicting change on main
      execSync('git checkout main', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'README.md'), 'main version\n');
      execSync('git add . && git commit -m "main change"', { cwd: tmpDir });

      // Switch back to the workflow branch, then try merge
      execSync('git checkout omx/conflict-test', { cwd: tmpDir });

      const result = mergeWorkflowBranch(tmpDir, 'conflict-test');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Should have aborted the merge and be back on main (clean state)
      expect(getBranch(tmpDir)).toBe('main');
    });

    it('creates a merge commit (--no-ff)', () => {
      createWorkflowBranch(tmpDir, 'noff-test');
      writeFileSync(join(tmpDir, 'new.ts'), 'export const y = 2;\n');
      execSync('git add . && git commit -m "new file"', { cwd: tmpDir });

      mergeWorkflowBranch(tmpDir, 'noff-test');
      // The latest commit on main should be a merge commit
      const log = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' });
      expect(log).toContain('merge: omx/noff-test');
    });
  });

  describe('cleanupBranch', () => {
    it('deletes the workflow branch', () => {
      createWorkflowBranch(tmpDir, 'cleanup-test');
      // Need to make a commit and merge before we can delete with -d
      writeFileSync(join(tmpDir, 'temp.ts'), 'x\n');
      execSync('git add . && git commit -m "temp"', { cwd: tmpDir });
      mergeWorkflowBranch(tmpDir, 'cleanup-test');

      expect(branchExists(tmpDir, 'omx/cleanup-test')).toBe(true);
      cleanupBranch(tmpDir, 'cleanup-test');
      expect(branchExists(tmpDir, 'omx/cleanup-test')).toBe(false);
    });

    it('does not throw for non-existent branch', () => {
      // cleanupBranch should handle this gracefully
      expect(() => cleanupBranch(tmpDir, 'does-not-exist')).not.toThrow();
    });
  });

  describe('getCurrentBranch', () => {
    it('returns main for freshly initialized repo', () => {
      expect(getCurrentBranch(tmpDir)).toBe('main');
    });

    it('returns workflow branch name after creation', () => {
      createWorkflowBranch(tmpDir, 'current-test');
      expect(getCurrentBranch(tmpDir)).toBe('omx/current-test');
    });
  });
});
