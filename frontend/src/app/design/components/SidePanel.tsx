'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  DesignScreen,
  DesignTheme,
  DesignVersion,
  THEME_COLORS,
  THEME_FONTS,
  THEME_RADII,
  designApi,
} from '@/lib/design';

export type PanelTab = 'theme' | 'history';

interface SidePanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  theme: DesignTheme;
  onTheme: (theme: DesignTheme) => void;
  /** The screen whose history is shown. */
  screen: DesignScreen | null;
  /** Changes whenever a screen gains a version, so the list refreshes. */
  historyKey: number;
  onRestore: (versionId: number) => Promise<void>;
}

const selectClass = 'w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none';

export default function SidePanel({ tab, onTab, onClose, theme, onTheme, screen, historyKey, onRestore }: SidePanelProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card" aria-label="Design panel">
      <div className="flex items-center border-b border-border px-2 py-1.5">
        {(['theme', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            className={`rounded-md px-3 py-1 text-sm capitalize transition-colors ${
              tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close panel">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'theme' ? (
          <ThemeControls theme={theme} onTheme={onTheme} />
        ) : (
          <History screen={screen} historyKey={historyKey} onRestore={onRestore} />
        )}
      </div>
    </aside>
  );
}

function ThemeControls({ theme, onTheme }: { theme: DesignTheme; onTheme: (theme: DesignTheme) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Applies to every screen instantly, with no regeneration.</p>
      <div className="space-y-2">
        {THEME_COLORS.map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm text-foreground">
            {label}
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{theme[key]}</span>
              <input
                type="color"
                value={theme[key]}
                onChange={(e) => onTheme({ ...theme, [key]: e.target.value })}
                className="size-7 cursor-pointer rounded border border-border bg-transparent p-0"
                aria-label={`${label} color`}
              />
            </span>
          </label>
        ))}
      </div>
      <label className="block text-sm text-foreground">
        <span className="mb-1 block">Font</span>
        <select value={theme.font} onChange={(e) => onTheme({ ...theme, font: e.target.value })} className={selectClass}>
          {THEME_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="block text-sm text-foreground">
        <span className="mb-1 block">Corner radius</span>
        <select value={theme.radius} onChange={(e) => onTheme({ ...theme, radius: e.target.value })} className={selectClass}>
          {THEME_RADII.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
    </div>
  );
}

function History({ screen, historyKey, onRestore }: Pick<SidePanelProps, 'screen' | 'historyKey' | 'onRestore'>) {
  const [versions, setVersions] = useState<DesignVersion[] | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const screenId = screen?.id;

  useEffect(() => {
    if (screenId == null) return;
    let cancelled = false;
    setVersions(null);
    designApi.listVersions(screenId).then((v) => !cancelled && setVersions(v)).catch(() => !cancelled && setVersions([]));
    return () => { cancelled = true; };
  }, [screenId, historyKey]);

  if (!screen) return <p className="text-sm text-muted-foreground">Select a screen to see its versions.</p>;
  if (versions === null) return <Loader2 size={16} className="animate-spin text-muted-foreground" />;
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No versions yet.</p>;

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{screen.name}</p>
      <ul className="space-y-1.5">
        {versions.map((v) => {
          const current = v.id === screen.version_id;
          return (
            <li key={v.id}>
              <button
                disabled={current || restoring !== null}
                onClick={async () => {
                  setRestoring(v.id);
                  try { await onRestore(v.id); } finally { setRestoring(null); }
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  current ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="line-clamp-2 text-sm text-foreground">{v.prompt || 'Generated'}</div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(v.created_at).toLocaleString()}</span>
                  {current ? <span className="text-primary">Current</span> : restoring === v.id ? <Loader2 size={12} className="animate-spin" /> : <span>Restore</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
