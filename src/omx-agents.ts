/**
 * OmX Pattern 2: Agent Catalog
 *
 * JSON-driven agent registry replacing the hardcoded OmxSpecialistType enum.
 * Loads agent definitions from data/omx-agent-catalog.json with hot-reload
 * on file change (mtime check).
 *
 * Backward-compatible: the 5 core types (dev, research, review, gate, commit)
 * are guaranteed to exist. The catalog extends them with 30+ additional roles.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { DATA_DIR } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Model class shorthand — maps to full Claude model IDs */
export type OmxModelClass = 'sonnet' | 'opus' | 'haiku';

/** Agent posture determines what the agent is allowed to do */
export type OmxAgentPosture = 'advisory' | 'autonomous' | 'gatekeeper';

/** Routing role determines how the supervisor handles the agent's output */
export type OmxAgentRoutingRole = 'specialist' | 'gate' | 'commit' | 'planner';

/** Agent category for filtering and organization */
export type OmxAgentCategory =
  | 'core'
  | 'quality'
  | 'testing'
  | 'documentation'
  | 'architecture'
  | 'devops'
  | 'analysis'
  | 'content'
  | 'planning';

/** A single agent definition from the catalog */
export interface OmxAgentDefinition {
  name: string;
  displayName: string;
  category: OmxAgentCategory;
  description: string;
  modelClass: OmxModelClass;
  posture: OmxAgentPosture;
  routingRole: OmxAgentRoutingRole;
  profilePath: string;
  tools: string[];
  capabilities: string[];
}

/** Raw JSON structure of the catalog file */
interface OmxAgentCatalogFile {
  $schema?: string;
  version: number;
  agents: OmxAgentDefinition[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATALOG_PATH = path.join(DATA_DIR, 'omx-agent-catalog.json');

/** Full model ID mapping from shorthand classes */
const MODEL_MAP: Record<OmxModelClass, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/** Core agents that MUST exist — backward compatibility guarantee */
const REQUIRED_AGENTS = ['dev', 'research', 'review', 'gate', 'commit'] as const;

// ── Cache ─────────────────────────────────────────────────────────────────────

let cachedAgents: Map<string, OmxAgentDefinition> | null = null;
let cachedMtime: number = 0;

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load the agent catalog from disk. Caches results and hot-reloads
 * when the file's mtime changes.
 */
export function loadAgentCatalog(): Map<string, OmxAgentDefinition> {
  let mtime: number;
  try {
    mtime = fs.statSync(CATALOG_PATH).mtimeMs;
  } catch {
    logger.warn({ path: CATALOG_PATH }, 'omx-agents: catalog file not found, returning empty');
    return cachedAgents ?? new Map();
  }

  // Return cache if file hasn't changed
  if (cachedAgents && mtime === cachedMtime) {
    return cachedAgents;
  }

  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    const catalog: OmxAgentCatalogFile = JSON.parse(raw);

    const agentMap = new Map<string, OmxAgentDefinition>();
    for (const agent of catalog.agents) {
      if (agentMap.has(agent.name)) {
        logger.warn({ name: agent.name }, 'omx-agents: duplicate agent name, skipping');
        continue;
      }
      agentMap.set(agent.name, agent);
    }

    // Verify backward compatibility
    for (const required of REQUIRED_AGENTS) {
      if (!agentMap.has(required)) {
        logger.error({ name: required }, 'omx-agents: required core agent missing from catalog');
      }
    }

    cachedAgents = agentMap;
    cachedMtime = mtime;
    logger.info(
      { agents: agentMap.size, version: catalog.version },
      'omx-agents: catalog loaded',
    );
    return agentMap;
  } catch (err) {
    logger.error({ err }, 'omx-agents: failed to parse catalog');
    return cachedAgents ?? new Map();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a single agent definition by name.
 * Returns null if the agent doesn't exist in the catalog.
 */
export function getAgent(name: string): OmxAgentDefinition | null {
  const catalog = loadAgentCatalog();
  return catalog.get(name) ?? null;
}

/**
 * List all agents, optionally filtered by category.
 */
export function listAgents(category?: OmxAgentCategory): OmxAgentDefinition[] {
  const catalog = loadAgentCatalog();
  const all = Array.from(catalog.values());
  if (!category) return all;
  return all.filter(a => a.category === category);
}

/**
 * Resolve a model class shorthand to a full Claude model ID.
 * Returns the default (sonnet) if the class is unknown.
 */
export function resolveModel(modelClass: string): string {
  return MODEL_MAP[modelClass as OmxModelClass] ?? MODEL_MAP.sonnet;
}

/**
 * Check if an agent name exists in the catalog.
 */
export function isValidAgent(name: string): boolean {
  const catalog = loadAgentCatalog();
  return catalog.has(name);
}

/**
 * Find all agents that declare a given capability.
 */
export function getAgentsByCapability(capability: string): OmxAgentDefinition[] {
  const catalog = loadAgentCatalog();
  return Array.from(catalog.values()).filter(a => a.capabilities.includes(capability));
}

/**
 * Get the profile file content for an agent (reads from disk).
 * Returns null if the profile doesn't exist.
 */
export function getAgentProfile(name: string): string | null {
  const agent = getAgent(name);
  if (!agent) return null;

  const fullPath = path.join(process.cwd(), 'groups', 'main', agent.profilePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    logger.debug({ name, profilePath: agent.profilePath }, 'omx-agents: profile file not found');
    return null;
  }
}

/**
 * Resolve the full model ID for a given agent, with optional annotation override.
 * Priority: annotation override > agent catalog default > sonnet fallback.
 */
export function resolveModelForAgent(name: string, annotationOverride?: string): string {
  if (annotationOverride) {
    return resolveModel(annotationOverride);
  }
  const agent = getAgent(name);
  return agent ? resolveModel(agent.modelClass) : MODEL_MAP.sonnet;
}
