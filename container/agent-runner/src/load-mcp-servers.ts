/**
 * Load external MCP servers from MCPorter config and convert to Claude SDK format.
 *
 * MCPorter discovers MCP server definitions from config/mcporter.json.
 * We convert them to the shape the Claude Agent SDK expects in query({ mcpServers }).
 */
import { loadServerDefinitions, type ServerDefinition } from 'mcporter';
import * as path from 'node:path';
import * as fs from 'node:fs';

type McpServerConfig =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { command: string; args?: string[]; env?: Record<string, string> };

/**
 * Resolve ${VAR} and $env:VAR placeholders in a string using process.env.
 */
function resolveEnvPlaceholders(value: string): string {
  // Handle ${VAR} and ${VAR:-default}
  let result = value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...defaultParts] = expr.split(':-');
    const defaultValue = defaultParts.join(':-');
    return process.env[varName!] ?? defaultValue ?? '';
  });
  // Handle $env:VAR
  result = result.replace(/\$env:(\w+)/g, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });
  return result;
}

/**
 * Resolve all env placeholders in a headers object.
 */
function resolveHeaders(headers: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = resolveEnvPlaceholders(value);
  }
  return resolved;
}

/**
 * Convert a MCPorter ServerDefinition to Claude SDK McpServerConfig.
 */
function toSdkConfig(def: ServerDefinition): McpServerConfig | null {
  if (def.command.kind === 'http') {
    const headers = def.command.headers ? resolveHeaders(def.command.headers) : undefined;
    // Skip servers with unresolved/empty auth tokens
    if (headers?.Authorization && (headers.Authorization === 'Bearer ' || headers.Authorization === '')) {
      console.error(`[mcp-loader] Skipping '${def.name}': missing auth token (env var not set)`);
      return null;
    }
    return {
      type: 'http',
      url: def.command.url.toString(),
      ...(headers && Object.keys(headers).length > 0 && { headers }),
    };
  }

  if (def.command.kind === 'stdio') {
    const env = def.env ? resolveHeaders(def.env) : undefined;
    return {
      command: def.command.command,
      args: def.command.args,
      ...(env && Object.keys(env).length > 0 && { env }),
    };
  }

  return null;
}

/**
 * Load external MCP servers from MCPorter config.
 * Returns a Record<string, McpServerConfig> ready for Claude SDK query().
 *
 * Gracefully returns empty object on any error — the agent still works
 * with just the built-in nanoclaw MCP server.
 */
export async function loadExternalMcpServers(projectDir?: string): Promise<Record<string, McpServerConfig>> {
  const mcpServers: Record<string, McpServerConfig> = {};

  try {
    const rootDir = projectDir ?? process.env.NANOCLAW_PROJECT_DIR ?? process.cwd();
    const configPath = path.join(rootDir, 'config', 'mcporter.json');

    if (!fs.existsSync(configPath)) {
      return mcpServers;
    }

    const definitions = await loadServerDefinitions({
      configPath,
      rootDir,
    });

    for (const def of definitions) {
      const config = toSdkConfig(def);
      if (config) {
        mcpServers[def.name] = config;
        console.error(`[mcp-loader] Loaded external MCP: ${def.name} (${def.command.kind})`);
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      console.error(`[mcp-loader] ${Object.keys(mcpServers).length} external MCP server(s) ready`);
    }
  } catch (err) {
    console.error(`[mcp-loader] Failed to load external MCPs (agent will continue without them):`, err);
  }

  return mcpServers;
}
