/**
 * Integration Registry — Metadata-only registry with lazy module loading.
 *
 * Integrations are direct API connections (Gmail, Calendar, etc.) that can be
 * used by the heartbeat and scheduled tasks for fast data gathering without
 * going through Claude's reasoning loop.
 *
 * Pattern inspired by claude-code-second-brain's registry.py:
 * - Only metadata stored here (no imports until needed)
 * - Auto-detects which integrations are configured via env vars
 * - Lazy-loads modules on first use
 *
 * To add a new integration:
 * 1. Add entry to REGISTRY below
 * 2. Create src/integrations/<name>.ts implementing IntegrationModule
 * 3. Set required env vars in .env
 */

import { logger } from '../logger.js';

export type AuthType = 'google_oauth' | 'token' | 'api_key' | 'none';

export interface IntegrationInfo {
  name: string;
  description: string;
  authType: AuthType;
  requiredConfig: string[]; // env var names that must be set
  optionalConfig?: string[];
  module: string; // relative import path (e.g., './gmail.js')
}

export interface IntegrationModule {
  /** Human-readable status check */
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  /** Gather context for heartbeat (return markdown string) */
  gatherContext?(options?: Record<string, unknown>): Promise<string | null>;
}

// ─── Registry ────────────────────────────────────────────────────

const REGISTRY: Record<string, IntegrationInfo> = {
  gmail: {
    name: 'Gmail',
    description: 'Read and send emails via Gmail API',
    authType: 'google_oauth',
    requiredConfig: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    module: './gmail.js',
  },
  calendar: {
    name: 'Google Calendar',
    description: 'Read calendar events and scheduling',
    authType: 'google_oauth',
    requiredConfig: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID'],
    module: './calendar.js',
  },
  github: {
    name: 'GitHub',
    description: 'Repository activity, PRs, issues',
    authType: 'token',
    requiredConfig: ['GITHUB_TOKEN'],
    module: './github.js',
  },
  // Future integrations:
  // slack: { ... },
  // notion: { ... },
  // linear: { ... },
};

// ─── Public API ──────────────────────────────────────────────────

/**
 * Get all registered integration definitions.
 */
export function getAllIntegrations(): Record<string, IntegrationInfo> {
  return { ...REGISTRY };
}

/**
 * Get only the integrations that have their required config set.
 * Checks env vars at call time (not import time).
 */
export function getEnabledIntegrations(): Record<string, IntegrationInfo> {
  const enabled: Record<string, IntegrationInfo> = {};

  for (const [key, info] of Object.entries(REGISTRY)) {
    const allConfigured = info.requiredConfig.every(
      (envVar) => !!process.env[envVar],
    );
    if (allConfigured) {
      enabled[key] = info;
    }
  }

  return enabled;
}

/**
 * Check if a specific integration is enabled (has required config).
 */
export function isEnabled(integrationName: string): boolean {
  const info = REGISTRY[integrationName];
  if (!info) return false;
  return info.requiredConfig.every((envVar) => !!process.env[envVar]);
}

/**
 * Lazy-load an integration module.
 * Returns null if integration is not registered or not enabled.
 */
const moduleCache = new Map<string, IntegrationModule>();

export async function loadIntegration(
  integrationName: string,
): Promise<IntegrationModule | null> {
  const info = REGISTRY[integrationName];
  if (!info) {
    logger.warn({ integration: integrationName }, 'Integration not registered');
    return null;
  }

  if (!isEnabled(integrationName)) {
    logger.debug(
      { integration: integrationName, requiredConfig: info.requiredConfig },
      'Integration not enabled (missing config)',
    );
    return null;
  }

  // Check cache
  if (moduleCache.has(integrationName)) {
    return moduleCache.get(integrationName)!;
  }

  try {
    const mod = await import(info.module);
    const instance: IntegrationModule = mod.default || mod;
    moduleCache.set(integrationName, instance);
    logger.info({ integration: integrationName }, 'Integration module loaded');
    return instance;
  } catch (err) {
    logger.error(
      { integration: integrationName, err },
      'Failed to load integration module',
    );
    return null;
  }
}

/**
 * Gather context from all enabled integrations (for heartbeat use).
 * Returns a combined markdown string, or null if no integrations are enabled.
 */
export async function gatherAllContext(): Promise<string | null> {
  const enabled = getEnabledIntegrations();
  const parts: string[] = [];

  for (const [key, info] of Object.entries(enabled)) {
    try {
      const mod = await loadIntegration(key);
      if (mod?.gatherContext) {
        const context = await mod.gatherContext();
        if (context) {
          parts.push(`### ${info.name}\n${context}`);
        }
      }
    } catch (err) {
      logger.error({ integration: key, err }, 'Error gathering context');
    }
  }

  if (parts.length === 0) return null;
  return `## Integration Context\n\n${parts.join('\n\n')}`;
}

/**
 * Run health checks on all enabled integrations.
 */
export async function healthCheckAll(): Promise<
  Record<string, { ok: boolean; message: string }>
> {
  const enabled = getEnabledIntegrations();
  const results: Record<string, { ok: boolean; message: string }> = {};

  for (const key of Object.keys(enabled)) {
    try {
      const mod = await loadIntegration(key);
      if (mod) {
        results[key] = await mod.healthCheck();
      } else {
        results[key] = { ok: false, message: 'Failed to load module' };
      }
    } catch (err) {
      results[key] = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return results;
}
