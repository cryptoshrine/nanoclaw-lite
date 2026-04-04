/**
 * OmX Pattern 7: Branch Isolation
 *
 * Each OmX workflow gets a dedicated git branch (omx/{workflowId}).
 * Specialists work on the branch, and changes are merged back to the
 * base branch on workflow completion.
 *
 * v2 scope: Branch-per-workflow only (no worktrees).
 * Worktrees reserved for future parallel step execution.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * Create a workflow branch and check it out.
 * If the branch already exists, just switch to it.
 */
export function createWorkflowBranch(
  projectPath: string,
  workflowId: string,
  baseBranch = 'main',
): string {
  const branchName = `omx/${workflowId}`;

  try {
    // Check if the branch already exists
    const existing = git(projectPath, `branch --list ${branchName}`).trim();
    if (existing) {
      git(projectPath, `checkout ${branchName}`);
      logger.info({ workflowId, branchName }, 'Checked out existing OmX branch');
    } else {
      // Ensure we're on the base branch before creating
      git(projectPath, `checkout ${baseBranch}`);
      git(projectPath, `checkout -b ${branchName}`);
      logger.info({ workflowId, branchName, baseBranch }, 'Created OmX workflow branch');
    }
  } catch (err) {
    // If checkout fails (dirty tree, etc.), try creating anyway
    try {
      git(projectPath, `checkout -b ${branchName}`);
    } catch {
      // Branch might already exist — force switch
      git(projectPath, `checkout ${branchName}`);
    }
    logger.warn(
      { workflowId, error: err instanceof Error ? err.message : String(err) },
      'OmX branch creation had issues — recovered',
    );
  }

  return branchName;
}

/**
 * Merge the workflow branch back into the base branch.
 * Returns success/failure with optional error details.
 */
export function mergeWorkflowBranch(
  projectPath: string,
  workflowId: string,
  baseBranch = 'main',
): { success: boolean; error?: string } {
  const branchName = `omx/${workflowId}`;

  try {
    git(projectPath, `checkout ${baseBranch}`);
    git(projectPath, `merge ${branchName} --no-ff -m "merge: ${branchName}"`);
    logger.info({ workflowId, branchName, baseBranch }, 'OmX branch merged successfully');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ workflowId, branchName, error: errorMsg }, 'OmX branch merge failed');

    // Abort the failed merge to leave the repo in a clean state
    try {
      git(projectPath, 'merge --abort');
    } catch {
      // merge --abort can fail if there's no merge in progress
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Delete the workflow branch after successful merge.
 */
export function cleanupBranch(projectPath: string, workflowId: string): void {
  const branchName = `omx/${workflowId}`;

  try {
    git(projectPath, `branch -d ${branchName}`);
    logger.info({ workflowId, branchName }, 'OmX branch cleaned up');
  } catch (err) {
    // Non-fatal — branch might not exist or might have unmerged changes
    logger.warn(
      { workflowId, error: err instanceof Error ? err.message : String(err) },
      'OmX branch cleanup failed (non-fatal)',
    );
  }
}

/**
 * Get the current branch name for a project.
 */
export function getCurrentBranch(projectPath: string): string {
  return git(projectPath, 'rev-parse --abbrev-ref HEAD').trim();
}

// ── Internal ───────────────────────────────────────────────────────────────────

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 30_000 });
}
