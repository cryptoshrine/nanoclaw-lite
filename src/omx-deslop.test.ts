import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { detectSlop, shouldDeslop, buildDeslopPrompt } from './omx-deslop.js';
import type { OmxStep } from './omx-supervisor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(specialist: string): OmxStep {
  return {
    number: 1,
    title: 'Test step',
    content: 'Do something',
    status: 'pending',
    annotations: { specialist: specialist as any },
    retryCount: 0,
  };
}

function initTmpRepo(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'omx-deslop-'));
  execSync('git init -b main', { cwd: tmpDir });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir });
  execSync('git config user.name "Test"', { cwd: tmpDir });
  execSync('git commit --allow-empty -m "init"', { cwd: tmpDir });
  return tmpDir;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('omx-deslop', () => {
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

  describe('detectSlop', () => {
    it('returns hasIssues=false for clean code', () => {
      // Add a clean file, commit, then modify cleanly
      writeFileSync(join(tmpDir, 'clean.ts'), 'export const x = 1;\n');
      execSync('git add . && git commit -m "add clean"', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'clean.ts'), 'export const x = 2;\n');

      const report = detectSlop(tmpDir);
      expect(report.hasIssues).toBe(false);
      expect(report.issues).toHaveLength(0);
    });

    it('detects TODO/FIXME additions', () => {
      writeFileSync(join(tmpDir, 'code.ts'), 'export const x = 1;\n');
      execSync('git add . && git commit -m "base"', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'code.ts'), 'export const x = 1;\n// TODO fix this later\n// FIXME broken\n');

      const report = detectSlop(tmpDir);
      expect(report.hasIssues).toBe(true);
      expect(report.issues.some(i => i.type === 'todo')).toBe(true);
      expect(report.issues.filter(i => i.type === 'todo').length).toBeGreaterThanOrEqual(2);
    });

    it('detects console.log debug statements', () => {
      writeFileSync(join(tmpDir, 'code.ts'), 'export const x = 1;\n');
      execSync('git add . && git commit -m "base"', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'code.ts'), 'export const x = 1;\nconsole.log("debug");\n');

      const report = detectSlop(tmpDir);
      expect(report.hasIssues).toBe(true);
      expect(report.issues.some(i => i.type === 'debug')).toBe(true);
    });

    it('detects print() debug statements', () => {
      writeFileSync(join(tmpDir, 'code.py'), 'x = 1\n');
      execSync('git add . && git commit -m "base"', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'code.py'), 'x = 1\nprint("debug value")\n');

      const report = detectSlop(tmpDir);
      expect(report.hasIssues).toBe(true);
      expect(report.issues.some(i => i.type === 'debug')).toBe(true);
    });

    it('returns empty report when no changes exist', () => {
      const report = detectSlop(tmpDir);
      expect(report.hasIssues).toBe(false);
      expect(report.files).toHaveLength(0);
      expect(report.issues).toHaveLength(0);
    });

    it('tracks affected files correctly', () => {
      writeFileSync(join(tmpDir, 'a.ts'), 'export const a = 1;\n');
      writeFileSync(join(tmpDir, 'b.ts'), 'export const b = 1;\n');
      execSync('git add . && git commit -m "base"', { cwd: tmpDir });
      writeFileSync(join(tmpDir, 'a.ts'), 'export const a = 1;\nconsole.log("x");\n');
      writeFileSync(join(tmpDir, 'b.ts'), 'export const b = 1;\n// TODO fix\n');

      const report = detectSlop(tmpDir);
      expect(report.files).toHaveLength(2);
      expect(report.files).toContain('a.ts');
      expect(report.files).toContain('b.ts');
    });
  });

  describe('shouldDeslop', () => {
    it('returns true for dev specialist steps', () => {
      expect(shouldDeslop(makeStep('dev'))).toBe(true);
    });

    it('returns true for commit specialist steps', () => {
      expect(shouldDeslop(makeStep('commit'))).toBe(true);
    });

    it('returns false for gate steps', () => {
      expect(shouldDeslop(makeStep('gate'))).toBe(false);
    });

    it('returns false for review steps', () => {
      expect(shouldDeslop(makeStep('review'))).toBe(false);
    });

    it('returns false for research steps', () => {
      expect(shouldDeslop(makeStep('research'))).toBe(false);
    });
  });

  describe('buildDeslopPrompt', () => {
    it('includes file list and issue descriptions', () => {
      const report = {
        hasIssues: true,
        files: ['src/auth.ts', 'src/db.ts'],
        issues: [
          { file: 'src/auth.ts', type: 'debug' as const, line: 'console.log("token")' },
          { file: 'src/db.ts', type: 'todo' as const, line: '// TODO fix query' },
        ],
      };

      const prompt = buildDeslopPrompt(report, '/tmp/project');

      expect(prompt).toContain('/tmp/project');
      expect(prompt).toContain('src/auth.ts');
      expect(prompt).toContain('src/db.ts');
      expect(prompt).toContain('[debug]');
      expect(prompt).toContain('[todo]');
      expect(prompt).toContain('console.log("token")');
      expect(prompt).toContain('// TODO fix query');
    });

    it('includes cleanup rules', () => {
      const report = {
        hasIssues: true,
        files: ['x.ts'],
        issues: [{ file: 'x.ts', type: 'debug' as const, line: 'console.log()' }],
      };

      const prompt = buildDeslopPrompt(report, '/tmp/p');
      expect(prompt).toContain('Remove debug prints');
      expect(prompt).toContain('Do NOT change any behavior');
    });
  });
});
