import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpServerConfig {
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}

export interface McpToolSchemaEntry {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

interface ConnectedServer {
  client: Client;
  tools: { name: string; description?: string; inputSchema: Record<string, any> }[];
  error?: string;
}

// Connections + their discovered tools are cached for the life of the
// process -- reconnecting and re-listing tools on every chat request would
// be slow and, for stdio servers, would spawn a fresh process each time.
const _connections = new Map<string, ConnectedServer>();
// Dedupes concurrent connection attempts for the same server -- without this,
// two requests arriving before the first connect finishes would each spawn
// their own copy of a stdio server process.
const _connecting = new Map<string, Promise<ConnectedServer>>();
let _lastRefresh = 0;
const REFRESH_TTL_MS = 60_000;

function getConfigPath(): string {
  const baseDir = process.cwd().endsWith('frontend')
    ? process.cwd()
    : path.join(process.cwd(), 'frontend');
  return path.join(baseDir, 'data', 'mcp_servers.json');
}

export function loadMcpServerConfigs(): McpServerConfig[] {
  try {
    const filePath = getConfigPath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A tool name sent to the model must be a single safe identifier — MCP tool
// names can contain characters a model's function-calling schema won't like,
// so every MCP tool is exposed as `mcp_<server>_<tool>`, sanitized.
function toExposedName(serverName: string, toolName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp_${clean(serverName)}_${clean(toolName)}`;
}

async function connectServer(config: McpServerConfig): Promise<ConnectedServer> {
  const client = new Client({ name: 'PRAGNA 1-A', version: '1.0.0' });
  try {
    if (config.transport === 'stdio') {
      if (!config.command) throw new Error('stdio server config is missing "command"');
      const transport = new StdioClientTransport({ command: config.command, args: config.args || [] });
      await client.connect(transport);
    } else {
      if (!config.url) throw new Error('http server config is missing "url"');
      const transport = new StreamableHTTPClientTransport(new URL(config.url));
      await client.connect(transport);
    }
    const { tools } = await client.listTools();
    return { client, tools };
  } catch (err: any) {
    return { client, tools: [], error: err?.message || 'Failed to connect' };
  }
}

async function ensureConnected(config: McpServerConfig): Promise<ConnectedServer> {
  const existing = _connections.get(config.name);
  if (existing && !existing.error) return existing;

  const inFlight = _connecting.get(config.name);
  if (inFlight) return inFlight;

  const promise = connectServer(config).then((conn) => {
    _connections.set(config.name, conn);
    _connecting.delete(config.name);
    return conn;
  });
  _connecting.set(config.name, promise);
  return promise;
}

async function refreshConnections(): Promise<void> {
  const now = Date.now();
  const configs = loadMcpServerConfigs().filter((c) => c.enabled);
  const allCached = configs.every((c) => _connections.has(c.name));
  if (now - _lastRefresh < REFRESH_TTL_MS && allCached) return;
  _lastRefresh = now;

  const seen = new Set<string>();
  await Promise.all(
    configs.map(async (config) => {
      seen.add(config.name);
      await ensureConnected(config);
    })
  );

  // Drop connections for servers no longer in config (or disabled)
  for (const name of Array.from(_connections.keys())) {
    if (!seen.has(name)) {
      const conn = _connections.get(name);
      conn?.client.close().catch(() => {});
      _connections.delete(name);
    }
  }
}

export async function getMcpToolSchemas(): Promise<McpToolSchemaEntry[]> {
  const configs = loadMcpServerConfigs();
  if (configs.every((c) => !c.enabled)) return [];

  await refreshConnections();

  const schemas: McpToolSchemaEntry[] = [];
  for (const [serverName, conn] of _connections.entries()) {
    for (const tool of conn.tools) {
      schemas.push({
        type: 'function',
        function: {
          name: toExposedName(serverName, tool.name),
          description: `[MCP:${serverName}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      });
    }
  }
  return schemas;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp_');
}

export async function callMcpTool(exposedName: string, args: Record<string, any>): Promise<any> {
  await refreshConnections();

  for (const [serverName, conn] of _connections.entries()) {
    for (const tool of conn.tools) {
      if (toExposedName(serverName, tool.name) === exposedName) {
        try {
          const result = await conn.client.callTool({ name: tool.name, arguments: args });
          return { success: true, result };
        } catch (err: any) {
          return { success: false, error: err?.message || 'MCP tool call failed' };
        }
      }
    }
  }
  return { success: false, error: `No MCP tool matches "${exposedName}" — it may have disconnected.` };
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  connected: boolean;
  toolCount: number;
  error?: string;
}

export async function getMcpServerStatuses(): Promise<McpServerStatus[]> {
  const configs = loadMcpServerConfigs();
  await refreshConnections();
  return configs.map((config) => {
    const conn = _connections.get(config.name);
    return {
      name: config.name,
      enabled: config.enabled,
      transport: config.transport,
      connected: !!conn && !conn.error,
      toolCount: conn?.tools.length || 0,
      error: conn?.error,
    };
  });
}
