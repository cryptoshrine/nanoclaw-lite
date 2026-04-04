/**
 * OmX Pattern 7B: Git Worktree Isolation
 *
 * Extends branch-per-workflow (omx-branch.ts) with per-worker git worktrees.
 * Each parallel step gets its own worktree directory so multiple workers can
 * modify the same project concurrently without stepping on each other.
 *
 * Worktrees live at: {projectPath}/.omx-worktrees/{workflowId}/step-{N}
 * Branches: omx/{workflowId}/step-{N}
 *
 * Lifecycle: create → work → merge (or discard) → cleanup
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Isolation mode determines how workers share (or don't) the git working dir */
export type WorktreeIsolationMode = 'isolated' | 'detached';

/** Status of a git worktree through its lifecycle */
export type WorktreeStatus = 'active' | 'merged' | 'conflicted' | 'cleaned';

/** Represents a single git worktree tied to an OmX step/worker */
export interface GitWorktree {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name for this worktree (omx/{workflowId}/step-{N}) */
  branch: string;
  /** Workflow this worktree belongs to */
  workflowId: string;
  /** Step number within the workflow */
  stepNumber: number;
  /** Tmux worker ID if this worktree is assigned to a tmux worker */
  workerId?: string;
  /** Current lifecycle status */
  status: WorktreeStatus;
  /** ISO timestamp of creation */
  createdAt: string;
  /** Isolation mode used */
  isolationMode: WorktreeIsolationMode;
}

/** Configuration for creating a new worktree */
export interface WorktreeConfig {
  /** Root of the git project */
  projectPath: string;
  /** OmX workflow ID */
  workflowId: string;
  /** Step number */
  stepNumber: number;
  /** Branch to base the worktree on (default: current HEAD) */
  baseBranch?: string;
  /** Isolation mode (default: 'isolated') */
  isolationMode?: WorktreeIsolationMode;
  /** Optional tmux worker ID to associate */
  workerId?: string;
}

/** Result of a merge operation */
export interface MergeResult {
  success: boolean;
  /** Files with merge conflicts (if any) */
  conflictFiles?: string[];
  /** Error message on failure */
  error?: string;
  /** The worktree that was merged */
  worktree: GitWorktree;
}

/** Persisted state for all worktrees in a workflow */
interface WorktreeRegistry {
  workflowId: string;
  projectPath: string;
  worktrees: GitWorktree[];
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Subdirectory within the project where worktrees live */
const WORKTREE_ROOT_NAME = '.omx-worktrees';

/** Git command timeout (ms) */
const GIT_TIMEOUT = 30_000;

// ── Internal Helpers ──────────────────────────────────────────────────────────

/** Run a git command in the given cwd, returning stdout */
function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Run a git command, returning null on failure instead of throwing */
function gitSafe(cwd: string, args: string): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** Build the worktree directory path */
function worktreeDirPath(projectPath: string, workflowId: string, stepNumber: number): string {
  return path.join(projectPath, WORKTREE_ROOT_NAME, workflowId, `step-${stepNumber}`);
}

/** Build the branch name for a worktree */
function worktreeBranchName(workflowId: string, stepNumber: number): string {
  return `omx/${workflowId}/step-${stepNumber}`;
}

/** Path to the registry file for a workflow */
function registryPath(workflowId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, `${workflowId}-worktrees.json`);
}

// ── Registry Persistence ──────────────────────────────────────────────────────

/** Load the worktree registry for a workflow from disk */
function loadRegistry(workflowId: string): WorktreeRegistry | null {
  const rp = registryPath(workflowId);
  try {
    if (!fs.existsSync(rp)) return null;
    return JSON.parse(fs.readFileSync(rp, 'utf-8'));
  } catch {
    return null;
  }
}

/** Save the worktree registry for a workflow to disk */
function saveRegistry(registry: WorktreeRegistry): void {
  fs.mkdirSync(OMX_WORKFLOWS_DIR, { recursive: true });
  registry.updatedAt = new Date().toISOString();
  const rp = registryPath(registry.workflowId);
  const tmpPath = `${rp}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
  fs.renameSync(tmpPath, rp);
}

/** Get or create the registry for a workflow */
function getRegistry(workflowId: string, projectPath: string): WorktreeRegistry {
  const existing = loadRegistry(workflowId);
  if (existing) return existing;
  return {
    workflowId,
    projectPath,
    worktrees: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Update a worktree entry in the registry */
function updateRegistryEntry(registry: WorktreeRegistry, worktree: GitWorktree): void {
  const idx = registry.worktrees.findIndex(
    w => w.workflowId === worktree.workflowId && w.stepNumber === worktree.stepNumber,
  );
  if (idx >= 0) {
    registry.worktrees[idx] = worktree;
  } else {
    registry.worktrees.push(worktree);
  }
}

// ── Worktree Lifecycle ────────────────────────────────────────────────────────

/**
 * Create a new git worktree for an OmX step.
 *
 * In 'isolated' mode (default), creates a full worktree directory with its own
 * branch. In 'detached' mode, just creates a branch without a separate directory.
 *
 * @throws If git worktree creation fails (e.g., branch already exists with conflicts)
 */
export function createWorktree(config: WorktreeConfig): GitWorktree {
  const {
    projectPath,
    workflowId,
    stepNumber,
    baseBranch,
    isolationMode = 'isolated',
    workerId,
  } = config;

  const branch = worktreeBranchName(workflowId, stepNumber);
  const wtPath = worktreeDirPath(projectPath, workflowId, stepNumber);
  const now = new Date().toISOString();

  // Resolve the base — use provided baseBranch or current HEAD
  const base = baseBranch || gitSafe(projectPath, 'rev-parse --abbrev-ref HEAD') || 'main';

  if (isolationMode === 'isolated') {
    // Ensure parent directories exist
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    // Check if worktree already exists at this path
    if (fs.existsSync(wtPath)) {
      logger.warn({ workflowId, stepNumber, wtPath }, 'Worktree path already exists — reusing');
      const existing = findExistingWorktree(projectPath, workflowId, stepNumber);
      if (existing) return existing;
      // Path exists but not in our registry — remove and recreate
      gitSafe(projectPath, `worktree remove --force "${wtPath}"`);
    }

    // Check if the branch already exists
    const branchExists = gitSafe(projectPath, `rev-parse --verify "${branch}"`) !== null;

    if (branchExists) {
      // Branch exists — add worktree pointing to it
      try {
        git(projectPath, `worktree add "${wtPath}" "${branch}"`);
      } catch (err) {
        // Branch might be checked out elsewhere; force it
        logger.warn({ branch, error: String(err) }, 'Worktree add failed — trying force');
        gitSafe(projectPath, `branch -D "${branch}"`);
        git(projectPath, `worktree add "${wtPath}" -b "${branch}" "${base}"`);
      }
    } else {
      // Create new branch from base
      git(projectPath, `worktree add "${wtPath}" -b "${branch}" "${base}"`);
    }

    // Add .omx-worktrees to .gitignore if not already there
    ensureGitignoreEntry(projectPath, WORKTREE_ROOT_NAME);
  } else {
    // Detached mode: just create the branch, no separate directory
    const branchExists = gitSafe(projectPath, `rev-parse --verify "${branch}"`) !== null;
    if (!branchExists) {
      git(projectPath, `branch "${branch}" "${base}"`);
    }
  }

  const worktree: GitWorktree = {
    path: isolationMode === 'isolated' ? wtPath : projectPath,
    branch,
    workflowId,
    stepNumber,
    workerId,
    status: 'active',
    createdAt: now,
    isolationMode,
  };

  // Persist to registry
  const registry = getRegistry(workflowId, projectPath);
  updateRegistryEntry(registry, worktree);
  saveRegistry(registry);

  logger.info(
    { workflowId, stepNumber, branch, isolationMode, wtPath: worktree.path },
    'Worktree created',
  );

  return worktree;
}

/**
 * Remove a git worktree and optionally its branch.
 *
 * @param worktree - The worktree to remove
 * @param deleteBranch - Whether to also delete the branch (default: true)
 */
export function removeWorktree(worktree: GitWorktree, deleteBranch = true): void {
  const projectPath = resolveProjectPath(worktree);

  if (worktree.isolationMode === 'isolated' && fs.existsSync(worktree.path)) {
    try {
      git(projectPath, `worktree remove --force "${worktree.path}"`);
    } catch (err) {
      // If git worktree remove fails, try manual cleanup
      logger.warn(
        { path: worktree.path, error: String(err) },
        'git worktree remove failed — falling back to manual cleanup',
      );
      try {
        fs.rmSync(worktree.path, { recursive: true, force: true });
        // Prune to clean up git's internal references
        gitSafe(projectPath, 'worktree prune');
      } catch (rmErr) {
        logger.error({ path: worktree.path, error: String(rmErr) }, 'Manual worktree cleanup failed');
      }
    }
  }

  if (deleteBranch) {
    // Force-delete the branch (it might have unmerged changes)
    gitSafe(projectPath, `branch -D "${worktree.branch}"`);
  }

  // Update registry
  worktree.status = 'cleaned';
  const registry = loadRegistry(worktree.workflowId);
  if (registry) {
    updateRegistryEntry(registry, worktree);
    saveRegistry(registry);
  }

  logger.info(
    { workflowId: worktree.workflowId, stepNumber: worktree.stepNumber, branch: worktree.branch },
    'Worktree removed',
  );
}

/**
 * List all git worktrees for a project by parsing `git worktree list --porcelain`.
 *
 * Returns both our managed worktrees (from registry) and any raw worktrees
 * detected by git. Our registry entries are authoritative for metadata.
 */
export function listWorktrees(projectPath: string): GitWorktree[] {
  const raw = gitSafe(projectPath, 'worktree list --porcelain');
  if (!raw) return [];

  const worktrees: GitWorktree[] = [];
  const blocks = raw.split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ')) {
        // branch refs/heads/omx/workflow-123/step-1
        branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
      } else if (line === 'bare') {
        isBare = true;
      }
    }

    // Skip bare repos and the main worktree
    if (isBare || !branch.startsWith('omx/')) continue;

    // Parse workflowId and stepNumber from branch name
    const match = branch.match(/^omx\/(.+)\/step-(\d+)$/);
    if (!match) continue;

    const [, workflowId, stepStr] = match;
    const stepNumber = parseInt(stepStr, 10);

    worktrees.push({
      path: wtPath,
      branch,
      workflowId,
      stepNumber,
      status: 'active',
      createdAt: '', // Unknown from git data alone
      isolationMode: 'isolated',
    });
  }

  return worktrees;
}

/**
 * Prune stale worktree entries from git's internal list.
 * Returns the count of pruned entries.
 */
export function pruneWorktrees(projectPath: string): number {
  const before = listWorktrees(projectPath).length;
  gitSafe(projectPath, 'worktree prune');
  const after = listWorktrees(projectPath).length;
  const pruned = Math.max(0, before - after);

  if (pruned > 0) {
    logger.info({ projectPath, pruned }, 'Pruned stale worktrees');
  }

  return pruned;
}

// ── Merging ───────────────────────────────────────────────────────────────────

/**
 * Merge a worktree's branch into a target branch.
 *
 * Performs the merge from the project root (not the worktree), checks out the
 * target branch, merges the worktree branch, and reports results.
 */
export function mergeWorktree(worktree: GitWorktree, targetBranch: string): MergeResult {
  const projectPath = resolveProjectPath(worktree);

  // Stash any uncommitted changes in the main tree first
  const stashed = stashIfDirty(projectPath);

  try {
    // Switch to target branch
    git(projectPath, `checkout "${targetBranch}"`);

    // Attempt the merge
    git(projectPath, `merge "${worktree.branch}" --no-ff -m "merge: ${worktree.branch} into ${targetBranch}"`);

    worktree.status = 'merged';
    updateWorktreeInRegistry(worktree);

    logger.info(
      { workflowId: worktree.workflowId, stepNumber: worktree.stepNumber, targetBranch },
      'Worktree merged successfully',
    );

    return { success: true, worktree };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Check if this is a merge conflict
    const conflictFiles = detectMergeConflicts(projectPath);

    if (conflictFiles.length > 0) {
      // Abort the conflicted merge
      gitSafe(projectPath, 'merge --abort');
      worktree.status = 'conflicted';
      updateWorktreeInRegistry(worktree);

      logger.warn(
        { workflowId: worktree.workflowId, stepNumber: worktree.stepNumber, conflictFiles },
        'Worktree merge had conflicts — aborted',
      );

      return { success: false, conflictFiles, error: errorMsg, worktree };
    }

    // Non-conflict failure — abort if possible
    gitSafe(projectPath, 'merge --abort');

    logger.error(
      { workflowId: worktree.workflowId, stepNumber: worktree.stepNumber, error: errorMsg },
      'Worktree merge failed',
    );

    return { success: false, error: errorMsg, worktree };
  } finally {
    // Restore stash if we saved one
    if (stashed) {
      gitSafe(projectPath, 'stash pop');
    }
  }
}

/**
 * Merge all worktrees for a workflow into a target branch, in step order.
 *
 * Steps are merged sequentially (step 1 first, then step 2, etc.) to preserve
 * the intended dependency ordering. If any merge fails, subsequent merges are skipped.
 */
export function mergeAllWorktrees(
  workflowId: string,
  projectPath: string,
  targetBranch: string,
): MergeResult[] {
  const registry = loadRegistry(workflowId);
  if (!registry) {
    logger.warn({ workflowId }, 'No worktree registry found — nothing to merge');
    return [];
  }

  // Sort by step number, only merge active/non-cleaned worktrees
  const toMerge = registry.worktrees
    .filter(w => w.status === 'active')
    .sort((a, b) => a.stepNumber - b.stepNumber);

  if (toMerge.length === 0) {
    logger.info({ workflowId }, 'No active worktrees to merge');
    return [];
  }

  const results: MergeResult[] = [];
  let aborted = false;

  for (const worktree of toMerge) {
    if (aborted) {
      results.push({
        success: false,
        error: 'Skipped — previous merge failed',
        worktree,
      });
      continue;
    }

    const result = mergeWorktree(worktree, targetBranch);
    results.push(result);

    if (!result.success) {
      aborted = true;
      logger.warn(
        { workflowId, failedStep: worktree.stepNumber },
        'Merge sequence aborted due to failure — remaining steps skipped',
      );
    }
  }

  return results;
}

// ── Conflict Detection ────────────────────────────────────────────────────────

/**
 * Detect which files have been modified in both worktrees relative to their
 * common ancestor. This is a pre-merge check to predict conflicts.
 *
 * Returns the list of files that would conflict if both branches were merged.
 */
export function detectConflicts(worktree1: GitWorktree, worktree2: GitWorktree): string[] {
  const projectPath = resolveProjectPath(worktree1);

  // Get files changed in each worktree's branch
  const files1 = getChangedFiles(projectPath, worktree1.branch);
  const files2 = getChangedFiles(projectPath, worktree2.branch);

  if (!files1 || !files2) return [];

  // Find intersection — files modified in both branches
  const set1 = new Set(files1);
  return files2.filter(f => set1.has(f));
}

/**
 * Pre-merge conflict check for all active worktrees in a workflow.
 * Returns a map of step pairs → conflicting files.
 */
export function detectAllConflicts(
  workflowId: string,
  projectPath: string,
): Map<string, string[]> {
  const registry = loadRegistry(workflowId);
  if (!registry) return new Map();

  const active = registry.worktrees.filter(w => w.status === 'active');
  const conflicts = new Map<string, string[]>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const shared = detectConflicts(active[i], active[j]);
      if (shared.length > 0) {
        const key = `step-${active[i].stepNumber}+step-${active[j].stepNumber}`;
        conflicts.set(key, shared);
      }
    }
  }

  if (conflicts.size > 0) {
    logger.warn(
      { workflowId, conflictPairs: conflicts.size },
      'Pre-merge conflict check found overlapping files',
    );
  }

  return conflicts;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Remove all worktrees and branches for a workflow.
 * Cleans up both the filesystem and git's internal worktree tracking.
 */
export function cleanupWorkflowWorktrees(workflowId: string, projectPath: string): void {
  const registry = loadRegistry(workflowId);

  if (registry) {
    for (const worktree of registry.worktrees) {
      if (worktree.status !== 'cleaned') {
        try {
          removeWorktree(worktree, true);
        } catch (err) {
          logger.warn(
            { workflowId, stepNumber: worktree.stepNumber, error: String(err) },
            'Failed to remove worktree during cleanup (continuing)',
          );
        }
      }
    }
  }

  // Also scan git for any worktrees we might have missed
  const gitWorktrees = listWorktrees(projectPath).filter(w => w.workflowId === workflowId);
  for (const wt of gitWorktrees) {
    try {
      if (wt.isolationMode === 'isolated' && fs.existsSync(wt.path)) {
        gitSafe(projectPath, `worktree remove --force "${wt.path}"`);
      }
      gitSafe(projectPath, `branch -D "${wt.branch}"`);
    } catch {
      // Best-effort cleanup
    }
  }

  // Prune stale worktree entries
  gitSafe(projectPath, 'worktree prune');

  // Remove the worktree directory for this workflow
  const workflowWorktreeDir = path.join(projectPath, WORKTREE_ROOT_NAME, workflowId);
  if (fs.existsSync(workflowWorktreeDir)) {
    try {
      fs.rmSync(workflowWorktreeDir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }

  // Remove empty .omx-worktrees dir if nothing left
  const rootDir = path.join(projectPath, WORKTREE_ROOT_NAME);
  if (fs.existsSync(rootDir)) {
    try {
      const remaining = fs.readdirSync(rootDir);
      if (remaining.length === 0) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort
    }
  }

  // Clean up registry file
  const rp = registryPath(workflowId);
  if (fs.existsSync(rp)) {
    try { fs.unlinkSync(rp); } catch { /* ignore */ }
  }

  logger.info({ workflowId, projectPath }, 'Workflow worktrees cleaned up');
}

/**
 * Clean up ALL worktrees across all workflows for a project.
 * Nuclear option — use only when resetting the project.
 */
export function cleanupAllWorktrees(projectPath: string): number {
  const worktrees = listWorktrees(projectPath);
  let cleaned = 0;

  for (const wt of worktrees) {
    try {
      if (fs.existsSync(wt.path)) {
        gitSafe(projectPath, `worktree remove --force "${wt.path}"`);
      }
      gitSafe(projectPath, `branch -D "${wt.branch}"`);
      cleaned++;
    } catch {
      // Continue cleaning others
    }
  }

  gitSafe(projectPath, 'worktree prune');

  // Remove the entire .omx-worktrees directory
  const rootDir = path.join(projectPath, WORKTREE_ROOT_NAME);
  if (fs.existsSync(rootDir)) {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }

  if (cleaned > 0) {
    logger.info({ projectPath, cleaned }, 'Cleaned up all OmX worktrees');
  }

  return cleaned;
}

// ── Internal Utilities ────────────────────────────────────────────────────────

/**
 * Resolve the project root path from a worktree.
 * For isolated worktrees, we navigate up from the worktree path.
 * For detached, the worktree path IS the project path.
 */
function resolveProjectPath(worktree: GitWorktree): string {
  if (worktree.isolationMode === 'detached') {
    return worktree.path;
  }

  // Isolated worktree is at {project}/.omx-worktrees/{workflowId}/step-{N}
  // So project root is 3 levels up
  const candidate = path.resolve(worktree.path, '..', '..', '..');

  // Verify it's a git repo
  if (gitSafe(candidate, 'rev-parse --git-dir') !== null) {
    return candidate;
  }

  // Fallback: use the worktree itself (it's a valid git dir via worktree linkage)
  return worktree.path;
}

/** Get files changed on a branch relative to its merge base with the default branch */
function getChangedFiles(projectPath: string, branch: string): string[] | null {
  try {
    // Find the merge base with HEAD (or the branch's upstream)
    const mergeBase = git(projectPath, `merge-base HEAD "${branch}"`);
    const output = git(projectPath, `diff --name-only "${mergeBase}" "${branch}"`);
    return output.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** Detect files in conflict during an active merge */
function detectMergeConflicts(projectPath: string): string[] {
  const output = gitSafe(projectPath, 'diff --name-only --diff-filter=U');
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

/** Stash uncommitted changes if the working tree is dirty. Returns true if stashed. */
function stashIfDirty(projectPath: string): boolean {
  const status = gitSafe(projectPath, 'status --porcelain');
  if (!status || status.trim() === '') return false;

  try {
    git(projectPath, 'stash push -m "omx-worktree: auto-stash before merge"');
    return true;
  } catch {
    return false;
  }
}

/** Ensure a pattern is in .gitignore (so worktree dirs aren't tracked) */
function ensureGitignoreEntry(projectPath: string, pattern: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');

  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }

    // Check if pattern is already present (with or without trailing slash)
    const lines = content.split('\n');
    const normalizedPattern = pattern.replace(/\/$/, '');
    const alreadyPresent = lines.some(line => {
      const trimmed = line.trim().replace(/\/$/, '');
      return trimmed === normalizedPattern;
    });

    if (!alreadyPresent) {
      const suffix = content.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(gitignorePath, `${content}${suffix}${pattern}/\n`);
      logger.info({ projectPath, pattern }, 'Added worktree dir to .gitignore');
    }
  } catch (err) {
    // Non-fatal — the .gitignore might not be writable
    logger.warn({ projectPath, error: String(err) }, 'Could not update .gitignore');
  }
}

/** Find a worktree in the registry by workflow + step */
function findExistingWorktree(
  projectPath: string,
  workflowId: string,
  stepNumber: number,
): GitWorktree | null {
  const registry = loadRegistry(workflowId);
  if (!registry) return null;

  return registry.worktrees.find(
    w => w.workflowId === workflowId && w.stepNumber === stepNumber && w.status === 'active',
  ) || null;
}

/** Update a worktree entry in its registry */
function updateWorktreeInRegistry(worktree: GitWorktree): void {
  const registry = loadRegistry(worktree.workflowId);
  if (!registry) return;
  updateRegistryEntry(registry, worktree);
  saveRegistry(registry);
}
