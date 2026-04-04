import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// vi.hoisted runs in the hoisted scope so vi.mock factories can reference it
const { tmpDir } = vi.hoisted(() => {
  const _path = require('path');
  const _os = require('os');
  return { tmpDir: _path.join(_os.tmpdir(), `omx-agents-test-${Date.now()}`) };
});

const catalogPath = path.join(tmpDir, 'omx-agent-catalog.json');

const TEST_CATALOG = {
  $schema: 'OmX Agent Catalog',
  version: 1,
  agents: [
    {
      name: 'dev',
      displayName: 'Developer',
      category: 'core',
      description: 'Implements features',
      modelClass: 'sonnet',
      posture: 'autonomous',
      routingRole: 'specialist',
      profilePath: 'specialists/ball-ai-dev.md',
      tools: ['read', 'write', 'bash'],
      capabilities: ['code-write', 'bug-fix'],
    },
    {
      name: 'research',
      displayName: 'Researcher',
      category: 'core',
      description: 'Deep research',
      modelClass: 'sonnet',
      posture: 'advisory',
      routingRole: 'specialist',
      profilePath: 'specialists/ball-ai-research.md',
      tools: ['read', 'web-search'],
      capabilities: ['research', 'analysis'],
    },
    {
      name: 'review',
      displayName: 'Code Reviewer',
      category: 'quality',
      description: 'Adversarial review',
      modelClass: 'opus',
      posture: 'advisory',
      routingRole: 'specialist',
      profilePath: 'specialists/adversarial-review.md',
      tools: ['read', 'grep'],
      capabilities: ['code-review'],
    },
    {
      name: 'gate',
      displayName: 'Test Gate',
      category: 'core',
      description: 'Runs test suites',
      modelClass: 'sonnet',
      posture: 'gatekeeper',
      routingRole: 'gate',
      profilePath: 'specialists/omx-gate.md',
      tools: ['read', 'bash'],
      capabilities: ['testing'],
    },
    {
      name: 'commit',
      displayName: 'Committer',
      category: 'core',
      description: 'Commits and pushes',
      modelClass: 'haiku',
      posture: 'autonomous',
      routingRole: 'commit',
      profilePath: 'specialists/omx-commit.md',
      tools: ['bash'],
      capabilities: ['git-ops'],
    },
  ],
};

// Mock config to point DATA_DIR at our temp dir
vi.mock('./config.js', () => ({
  DATA_DIR: tmpDir,
}));

// Mock logger to suppress output
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Import after mocks are set up
import { getAgent, resolveModel, listAgents, loadAgentCatalog } from './omx-agents.js';

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify(TEST_CATALOG, null, 2));
  // Force cache invalidation by reloading
  // The module caches by mtime, so writing a new file should bust the cache
  loadAgentCatalog();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('omx-agents', () => {
  describe('getAgent', () => {
    it('returns agent definition for known agent type', () => {
      const agent = getAgent('dev');
      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('dev');
      expect(agent!.displayName).toBe('Developer');
      expect(agent!.category).toBe('core');
      expect(agent!.modelClass).toBe('sonnet');
      expect(agent!.tools).toContain('read');
      expect(agent!.capabilities).toContain('code-write');
    });

    it('returns null for unknown agent type', () => {
      const agent = getAgent('nonexistent-agent');
      expect(agent).toBeNull();
    });
  });

  describe('resolveModel', () => {
    it('maps sonnet to full model ID', () => {
      const model = resolveModel('sonnet');
      expect(model).toBe('claude-sonnet-4-6');
    });

    it('maps opus to full model ID', () => {
      const model = resolveModel('opus');
      expect(model).toBe('claude-opus-4-6');
    });

    it('maps haiku to full model ID', () => {
      const model = resolveModel('haiku');
      expect(model).toBe('claude-haiku-4-5-20251001');
    });

    it('falls back to sonnet for unknown model class', () => {
      const model = resolveModel('unknown-model');
      expect(model).toBe('claude-sonnet-4-6');
    });
  });

  describe('listAgents', () => {
    it('returns all registered agents', () => {
      const agents = listAgents();
      expect(agents).toHaveLength(5);
      const names = agents.map(a => a.name);
      expect(names).toContain('dev');
      expect(names).toContain('research');
      expect(names).toContain('review');
      expect(names).toContain('gate');
      expect(names).toContain('commit');
    });

    it('filters by category', () => {
      const coreAgents = listAgents('core');
      expect(coreAgents.length).toBe(4); // dev, research, gate, commit
      expect(coreAgents.every(a => a.category === 'core')).toBe(true);

      const qualityAgents = listAgents('quality');
      expect(qualityAgents).toHaveLength(1);
      expect(qualityAgents[0].name).toBe('review');
    });

    it('returns empty array for category with no agents', () => {
      const agents = listAgents('devops');
      expect(agents).toEqual([]);
    });
  });
});
