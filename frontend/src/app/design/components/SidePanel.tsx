'use client';

import React, { useEffect, useState } from 'react';
import { Check, History as HistoryIcon, Loader2, Palette, RotateCcw, Type, X } from 'lucide-react';
import { toast } from 'sonner';
import ThemeColorField from './ThemeColorField';
import {
  DesignScreen,
  DesignTheme,
  DesignVersion,
  THEME_COLORS,
  THEME_FONTS,
  THEME_RADII,
  designApi,
} from '@/lib/design';

export type PanelTab = 'theme' | 'history' | 'inspect';
export interface ElementSelection {
  screenId: number;
  tag: string;
  html: string;
  selector: string;
  text: string;
  canEdit: boolean;
}
interface Props {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  theme: DesignTheme;
  onTheme: (theme: DesignTheme) => void;
  screen: DesignScreen | null;
  historyKey: number;
  onRestore: (versionId: number) => Promise<void>;
  selection: ElementSelection | null;
  onText: (text: string) => Promise<boolean>;
  busy: boolean;
  savingTheme: boolean;
}

const PRESETS: { name: string; theme: Partial<DesignTheme> }[] = [
  {
    name: 'Ivory',
    theme: {
      primary: '#d4af37',
      on_primary: '#1a1405',
      surface: '#ffffff',
      background: '#f7f5ef',
      foreground: '#2a2415',
      muted: '#7a6f58',
      border: '#ddd4bf',
      font: 'Inter',
      radius: '12px',
    },
  },
  {
    name: 'Obsidian',
    theme: {
      primary: '#d4af37',
      on_primary: '#1a1405',
      surface: '#141414',
      background: '#0a0a0a',
      foreground: '#f0e6d3',
      muted: '#a89878',
      border: '#2d2a24',
      font: 'Inter',
      radius: '12px',
    },
  },
  {
    name: 'Gold',
    theme: {
      primary: '#d4af37',
      on_primary: '#1a1405',
      surface: '#ffffff',
      background: '#fbf8ed',
      foreground: '#2a2415',
      muted: '#7a6f58',
      border: '#eedca0',
      font: 'Inter',
      radius: '12px',
    },
  },
];

export default function SidePanel({
  tab,
  onTab,
  onClose,
  theme,
  onTheme,
  screen,
  historyKey,
  onRestore,
  selection,
  onText,
  busy,
  savingTheme,
}: Props) {
  return (
    <aside
      className="design-popover absolute inset-y-0 right-0 z-30 flex w-[292px] max-w-[85vw] shrink-0 flex-col border-l border-border bg-background 2xl:static 2xl:shadow-none"
      aria-label="Design controls"
    >
      <div
        className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3"
        role="tablist"
        aria-label="Design controls tabs"
      >
        {(
          [
            { value: 'inspect', label: 'Inspect', Icon: Type },
            { value: 'theme', label: 'Theme', Icon: Palette },
            { value: 'history', label: 'History', Icon: HistoryIcon },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => onTab(value)}
            className={`flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs ${tab === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
        <button
          className="design-icon-button ml-auto !size-7"
          onClick={onClose}
          aria-label="Close design controls"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" role="tabpanel">
        {tab === 'theme' ? (
          <ThemeControls theme={theme} onTheme={onTheme} busy={busy} saving={savingTheme} />
        ) : tab === 'history' ? (
          <VersionHistory
            screen={screen}
            historyKey={historyKey}
            onRestore={onRestore}
            busy={busy}
          />
        ) : (
          <Inspector selection={selection} onText={onText} busy={busy} screen={screen} />
        )}
      </div>
    </aside>
  );
}

function ThemeControls({
  theme,
  onTheme,
  busy,
  saving,
}: {
  theme: DesignTheme;
  onTheme: (theme: DesignTheme) => void;
  busy: boolean;
  saving: boolean;
}) {
  const [editingColor, setEditingColor] = useState<keyof DesignTheme | null>(null);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium">Design system</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          One visual language for every screen. Changes apply without regenerating your design.
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium">Start with a palette</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map(({ name, theme: t }) => (
            <button
              key={name}
              disabled={busy}
              onClick={() => onTheme({ ...theme, ...t })}
              className="rounded-lg border border-border p-2 text-left hover:bg-muted disabled:opacity-50"
            >
              <div className="mb-2 flex -space-x-1">
                {[t.primary, t.background, t.foreground].map((color, i) => (
                  <span
                    key={i}
                    style={{ background: color }}
                    className="size-5 rounded-full border border-border"
                  />
                ))}
              </div>
              <span className="text-xs">{name}</span>
            </button>
          ))}
        </div>
      </div>
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-50">
        <legend className="mb-3 text-xs font-medium">Colors</legend>
        {THEME_COLORS.map(({ key, label }) => (
          <ThemeColorField
            key={key}
            label={label}
            value={theme[key]}
            onChange={color => onTheme({ ...theme, [key]: color })}
            open={editingColor === key}
            onToggle={() => setEditingColor(current => current === key ? null : key)}
            disabled={busy}
          />
        ))}
      </fieldset>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-50">
        <legend className="mb-3 text-xs font-medium">Typography & shape</legend>
        <label className="block text-xs">
          <span className="mb-2 block">Typeface</span>
          <select
            value={theme.font}
            onChange={(e) => onTheme({ ...theme, font: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5"
          >
            {THEME_FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-2 block">Corner radius</span>
          <select
            value={theme.radius}
            onChange={(e) => onTheme({ ...theme, radius: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5"
          >
            {THEME_RADII.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </fieldset>
      <div
        className="rounded-xl border border-border p-4"
        style={{ background: theme.background, color: theme.foreground, fontFamily: theme.font }}
      >
        <p className="text-[10px] uppercase tracking-widest" style={{ color: theme.muted }}>
          Live palette
        </p>
        <p className="mt-2 text-lg font-semibold">Make it your own.</p>
        <p className="mt-1 text-xs" style={{ color: theme.muted }}>
          Small details. A cohesive design.
        </p>
        <div
          className="mt-4 inline-block px-3 py-2 text-xs font-medium"
          style={{ background: theme.primary, color: theme.on_primary, borderRadius: theme.radius }}
        >
          Your primary action
        </div>
      </div>
      <p role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {saving ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Applying to screens…
          </>
        ) : (
          <>
            <Check size={12} />
            Theme saved
          </>
        )}
      </p>
    </div>
  );
}

function Inspector({
  selection,
  onText,
  busy,
  screen,
}: {
  selection: ElementSelection | null;
  onText: (text: string) => Promise<boolean>;
  busy: boolean;
  screen: DesignScreen | null;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(selection?.text ?? ''), [selection]);
  return (
    <div>
      <h2 className="text-sm font-medium">Make a precise change</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Use Select, then click an element on the canvas. Edit its text here or describe a change in
        the conversation.
      </p>
      {selection ? (
        <>
          <div className="mt-5 rounded-lg bg-muted px-3 py-2.5">
            <p className="text-xs font-medium">{screen?.name}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              &lt;{selection.tag}&gt;
            </p>
          </div>
          {selection.canEdit ? (
            <>
              <label className="mt-5 block text-xs font-medium" htmlFor="element-text">
                Text content
              </label>
              <textarea
                id="element-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={4000}
                rows={5}
                disabled={busy || saving}
                className="mt-2 w-full resize-y rounded-lg border border-border bg-card p-3 text-sm leading-6"
              />
              <button
                disabled={busy || saving || text === selection.text}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onText(text);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="mt-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Apply
                text change
              </button>
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                Saves a new version instantly. No AI generation needed.
              </p>
            </>
          ) : (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              This element contains a layout or image. Use the conversation to change it, or select
              a single text element.
            </p>
          )}
        </>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border p-7 text-center">
          <Type size={25} className="text-muted-foreground" />
          <p className="mt-3 text-xs text-muted-foreground">Your selection appears here.</p>
        </div>
      )}
    </div>
  );
}

function VersionHistory({
  screen,
  historyKey,
  onRestore,
  busy,
}: {
  screen: DesignScreen | null;
  historyKey: number;
  onRestore: (id: number) => Promise<void>;
  busy: boolean;
}) {
  const [versions, setVersions] = useState<DesignVersion[] | null>(null);
  const [error, setError] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const id = screen?.id;
  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setError(false);
    if (id != null)
      designApi
        .listVersions(id)
        .then((v) => {
          if (!cancelled) setVersions(v);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    return () => {
      cancelled = true;
    };
  }, [id, historyKey, reload]);
  if (!screen)
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        Select a screen to browse and restore earlier versions.
      </p>
    );
  return (
    <div>
      <h2 className="text-sm font-medium">Version history</h2>
      <p className="mt-2 mb-5 text-xs text-muted-foreground">{screen.name}</p>
      {error ? (
        <div role="alert">
          <p className="text-xs">Could not load history.</p>
          <button onClick={() => setReload((r) => r + 1)} className="mt-2 text-xs text-primary">
            Try again
          </button>
        </div>
      ) : versions === null ? (
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      ) : !versions.length ? (
        <p className="text-xs text-muted-foreground">No saved versions yet.</p>
      ) : (
        <ul className="space-y-3">
          {versions.map((v, i) => {
            const current = v.id === screen.version_id;
            return (
              <li
                key={v.id}
                className={`rounded-xl border p-3 ${current ? 'border-gold-500/50 bg-[var(--design-selected)]' : 'border-border'}`}
              >
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>Version {versions.length - i}</span>
                  {current && (
                    <span className="flex items-center gap-1 text-primary">
                      <Check size={12} />
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-5">
                  {v.prompt || 'Initial design'}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()}
                </p>
                {!current && (
                  <button
                    disabled={busy || restoring !== null}
                    onClick={async () => {
                      setRestoring(v.id);
                      try {
                        await onRestore(v.id);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : 'Could not restore version'
                        );
                      } finally {
                        setRestoring(null);
                      }
                    }}
                    className="mt-3 flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs disabled:opacity-40"
                  >
                    {restoring === v.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Restore version
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
