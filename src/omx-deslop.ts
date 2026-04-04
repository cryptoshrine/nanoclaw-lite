/**
 * OmX Pattern 5: Deslop Enforcement
 *
 * Detects sloppy code output from specialists (debug prints, TODOs, dead code)
 * and spawns a lightweight Haiku cleanup pass before proceeding.
 *
 * Only runs after dev/commit steps — skips gate, review, research.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';
import type { OmxStep } from './omx-supervisor.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlopIssue {
  file: string;
  type: 'todo' | 'debug' | 'dead_code';
  line: string;
}

export interface SlopReport {
  hasIssues: boolean;
  files: string[];
  issues: SlopIssue[];
}

// ── Detection Patterns ──────────────────────────────────────────────────────

/** Regex patterns for debug/logging artifacts in added lines */
const DEBUG_PATTERNS = [
  /console\.log\(/,
  /console\.debug\(/,
  /\bprint\s*\(/,
  /\bdebugger\b/,
  /console\.warn\(\s*['"`](?:DEBUG|TODO|TEMP|HACK|XXX)/i,
];

/** Regex patterns for TODO/FIXME markers in added lines */
const TODO_PATTERNS = [
  /\/\/\s*TODO\b/i,
  /\/\/\s*FIXME\b/i,
  /\/\/\s*HACK\b/i,
  /\/\/\s*XXX\b/i,
  /#\s*TODO\b/i,
  /#\s*FIXME\b/i,
];

/**
 * Heuristic for commented-out code (not doc comments).
 * Looks for lines starting with // or # that contain code-like tokens.
 */
const DEAD_CODE_PATTERNS = [
  /^[+]\s*\/\/\s*(const |let |var |function |import |export |return |if |for |while )/,
  /^[+]\s*#\s*(def |class |import |from |return |if |for |while )/,
];

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Returns true only for specialist types that produce code output.
 * Gate, review, and research steps are skipped.
 */
export function shouldDeslop(step: OmxStep): boolean {
  const codeTypes = new Set(['dev', 'commit']);
  return codeTypes.has(step.annotations.specialist);
}

/**
 * Scan git diff for sloppy patterns in modified files.
 * Checks both staged and unstaged changes.
 */
export function detectSlop(projectPath: string): SlopReport {
  const issues: SlopIssue[] = [];
  const affectedFiles = new Set<string>();

  // Get unified diff of all changes (staged + unstaged)
  let diffOutput = '';
  try {
    // Check staged changes first
    const staged = execSync('git diff --staged -U0', { cwd: projectPath, timeout: 15000, encoding: 'utf-8' });
    diffOutput += staged;
  } catch {
    // No staged changes or git error — continue
  }
  try {
    // Also check unstaged changes
    const unstaged = execSync('git diff -U0', { cwd: projectPath, timeout: 15000, encoding: 'utf-8' });
    diffOutput += unstaged;
  } catch {
    // No unstaged changes or git error — continue
  }

  if (!diffOutput) {
    return { hasIssues: false, files: [], issues: [] };
  }

  // Parse diff output — extract added lines per file
  let currentFile = '';
  for (const rawLine of diffOutput.split('\n')) {
    // Track current file from diff headers
    const fileMatch = rawLine.match(/^diff --git a\/.+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Only inspect added lines (start with +, but not +++ header)
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;

    // Check for debug prints
    for (const pattern of DEBUG_PATTERNS) {
      if (pattern.test(rawLine)) {
        affectedFiles.add(currentFile);
        issues.push({ file: currentFile, type: 'debug', line: rawLine.slice(1).trim() });
        break; // one match per line is enough
      }
    }

    // Check for TODO/FIXME
    for (const pattern of TODO_PATTERNS) {
      if (pattern.test(rawLine)) {
        affectedFiles.add(currentFile);
        issues.push({ file: currentFile, type: 'todo', line: rawLine.slice(1).trim() });
        break;
      }
    }

    // Check for commented-out code
    for (const pattern of DEAD_CODE_PATTERNS) {
      if (pattern.test(rawLine)) {
        affectedFiles.add(currentFile);
        issues.push({ file: currentFile, type: 'dead_code', line: rawLine.slice(1).trim() });
        break;
      }
    }
  }

  const files = Array.from(affectedFiles);
  logger.debug({ fileCount: files.length, issueCount: issues.length }, 'Deslop scan complete');

  return {
    hasIssues: issues.length > 0,
    files,
    issues,
  };
}

/**
 * Build a prompt for a lightweight cleanup specialist.
 * Tells the specialist exactly what to fix without changing behavior.
 */
export function buildDeslopPrompt(slopReport: SlopReport, projectPath: string): string {
  const issueLines = slopReport.issues
    .map(i => `  - [${i.type}] ${i.file}: ${i.line}`)
    .join('\n');

  return `You are a code cleanup agent. Your ONLY job is to remove sloppy artifacts from recently modified files.

PROJECT PATH: ${projectPath}

ISSUES DETECTED:
${issueLines}

FILES TO CLEAN:
${slopReport.files.map(f => `  - ${f}`).join('\n')}

RULES:
1. Remove debug prints (console.log, print(), debugger statements) — UNLESS they are intentional logging (e.g. logger.info, structured logging)
2. Remove TODO/FIXME/HACK/XXX comments — unless they document a known limitation that must remain
3. Remove commented-out code blocks — dead code belongs in git history, not in source
4. Do NOT change any behavior or logic
5. Do NOT add features, refactor, or "improve" the code
6. Do NOT add type annotations, docstrings, or comments
7. Keep changes minimal — only fix the listed issues
8. Use send_message to report what you cleaned up when done
`;
}
