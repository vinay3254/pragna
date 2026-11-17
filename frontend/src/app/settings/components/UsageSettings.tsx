'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface UsageEntry {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const RATE_STORAGE_KEY = 'pragna-cost-rate-per-1k';
const DEFAULT_RATE = 0.003; // USD per 1K tokens -- a placeholder, not real billing data

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso).getTime();
  return Date.now() - d <= 7 * 24 * 60 * 60 * 1000;
}

function StatTile({ label, tokens, rate }: { label: string; tokens: number; rate: number }) {
  const cost = (tokens / 1000) * rate;
  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1 font-mono-data">{tokens.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-0.5">tokens &bull; ~${cost.toFixed(4)}</p>
    </div>
  );
}

export default function UsageSettings() {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(DEFAULT_RATE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RATE_STORAGE_KEY);
      if (stored) setRate(parseFloat(stored));
    } catch {
      // ignore
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/usage');
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      toast.error('Failed to load usage data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRateChange = (value: string) => {
    const parsed = parseFloat(value);
    const next = isNaN(parsed) ? 0 : parsed;
    setRate(next);
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const totals = useMemo(() => {
    const sum = (filter: (e: UsageEntry) => boolean) =>
      entries.filter(filter).reduce((acc, e) => acc + e.promptTokens + e.completionTokens, 0);
    return {
      today: sum((e) => isToday(e.timestamp)),
      week: sum((e) => isThisWeek(e.timestamp)),
      allTime: sum(() => true),
    };
  }, [entries]);

  const recent = useMemo(() => entries.slice(-25).reverse(), [entries]);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Gauge className="text-primary" size={20} />
            Usage &amp; Cost
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Token counts are estimated from character length, not a real tokenizer -- treat the cost
            figures below as directional, not a bill.
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card">
        <h3 className="text-sm font-semibold text-foreground mb-3">Estimated rate</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={rate}
            onChange={(e) => handleRateChange(e.target.value)}
            className="w-28 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm font-mono-data"
          />
          <span className="text-sm text-muted-foreground">per 1,000 tokens</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Today" tokens={totals.today} rate={rate} />
        <StatTile label="Last 7 days" tokens={totals.week} rate={rate} />
        <StatTile label="All time" tokens={totals.allTime} rate={rate} />
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Recent requests</h3>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground px-5 py-6 text-center">
            {loading ? 'Loading…' : 'No usage recorded yet -- send a message to see it show up here.'}
          </p>
        ) : (
          <div className="divide-y divide-border max-h-96 overflow-y-auto scrollbar-thin">
            {recent.map((e, i) => {
              const total = e.promptTokens + e.completionTokens;
              return (
                <div key={`${e.timestamp}-${i}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{e.model}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="font-mono-data text-foreground">{total.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">~${((total / 1000) * rate).toFixed(4)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
