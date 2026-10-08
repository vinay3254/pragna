'use client';

import React, { useEffect, useState } from 'react';
import { Trash2, Brain, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ApiMemory, deleteMemory, fetchMemories } from '@/lib/api';

export default function MemorySettings() {
  const [memories, setMemories] = useState<ApiMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchMemories();
      setMemories(data);
    } catch {
      toast.error('Failed to load memories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      toast.success('Memory deleted');
    } catch {
      toast.error('Failed to delete memory');
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Brain className="text-primary" size={20} />
            Persistent Personalized Memory
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Durable facts and preferences Pragna has learned about you across conversations.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground transition-colors"
          title="Refresh memory list"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading memories…</div>
      ) : memories.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground bg-muted/20 border border-dashed border-border rounded-xl">
          No personalized memories saved yet. Talk to Pragna and state your preferences!
        </div>
      ) : (
        <div className="space-y-2.5">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-card shadow-sm hover:border-border/80 transition-colors"
            >
              <div className="min-w-0 flex-1 pr-4">
                <p className="text-sm font-medium text-foreground leading-relaxed">{mem.content}</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono-data">
                  Captured: {new Date(mem.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(mem.id)}
                className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shrink-0"
                title="Delete memory"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
