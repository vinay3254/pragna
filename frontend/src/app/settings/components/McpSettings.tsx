'use client';

import React, { useEffect, useState } from 'react';
import { Plug, RefreshCw, CheckCircle2, XCircle, CircleDashed } from 'lucide-react';
import { toast } from 'sonner';

interface McpServerStatus {
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  connected: boolean;
  toolCount: number;
  error?: string;
}

export default function McpSettings() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcp/status');
      const data = await res.json();
      setServers(Array.isArray(data.servers) ? data.servers : []);
    } catch {
      toast.error('Failed to load MCP server status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Plug className="text-primary" size={20} />
            MCP Servers
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            External tool servers, added by editing{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">frontend/data/mcp_servers.json</code>.
            Their tools become available to the model alongside the built-in ones automatically.
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="border border-border rounded-xl p-6 bg-card text-center">
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Loading…'
              : 'No MCP servers configured yet. Add an entry to mcp_servers.json to connect one.'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card divide-y divide-border overflow-hidden">
          {servers.map((s) => (
            <div key={s.name} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3 min-w-0">
                {!s.enabled ? (
                  <CircleDashed size={16} className="text-muted-foreground/60 shrink-0" />
                ) : s.connected ? (
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={16} className="text-rose-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.transport}
                    {s.error ? ` — ${s.error}` : ''}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-mono-data text-foreground">
                  {s.enabled ? `${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}` : 'disabled'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
