/**
 * GitHub Integration — Direct API access for repo activity, PRs, issues.
 *
 * Used by heartbeat to check repo health without going through Claude.
 */

import { logger } from '../logger.js';
import type { IntegrationModule } from './registry.js';

const GITHUB_API = 'https://api.github.com';
const REPOS = ['cryptoshrine/BALL-AI-2']; // Repos to monitor

async function githubFetch(endpoint: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');

  const response = await fetch(`${GITHUB_API}${endpoint}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'NanoClaw',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

interface GithubPR {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  created_at: string;
  html_url: string;
}

const github: IntegrationModule = {
  async healthCheck() {
    try {
      await githubFetch('/user');
      return { ok: true, message: 'GitHub API accessible' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async gatherContext() {
    const parts: string[] = [];

    for (const repo of REPOS) {
      try {
        // Open PRs
        const prs = (await githubFetch(
          `/repos/${repo}/pulls?state=open&sort=updated&per_page=5`,
        )) as GithubPR[];

        if (prs.length > 0) {
          parts.push(`**${repo} — Open PRs:**`);
          for (const pr of prs) {
            parts.push(`- #${pr.number}: ${pr.title} (by ${pr.user.login})`);
          }
        }

        // Recent issues
        const issues = (await githubFetch(
          `/repos/${repo}/issues?state=open&sort=updated&per_page=5`,
        )) as GithubIssue[];

        const realIssues = issues.filter(
          (i) => !('pull_request' in (i as unknown as Record<string, unknown>)),
        );
        if (realIssues.length > 0) {
          parts.push(`**${repo} — Open Issues:**`);
          for (const issue of realIssues) {
            const labels = issue.labels.map((l) => l.name).join(', ');
            parts.push(
              `- #${issue.number}: ${issue.title}${labels ? ` [${labels}]` : ''}`,
            );
          }
        }
      } catch (err) {
        logger.warn({ repo, err }, 'Failed to fetch GitHub data');
        parts.push(`**${repo}:** Error fetching data`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  },
};

export default github;
