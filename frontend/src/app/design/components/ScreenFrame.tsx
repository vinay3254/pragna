'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileCode2,
  History,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { DesignScreen } from '@/lib/design';

interface Props {
  screen: DesignScreen;
  width: number;
  height: number;
  background: string;
  building: boolean;
  error?: string;
  active: boolean;
  busy: boolean;
  registerFrame: (id: number, el: HTMLIFrameElement | null) => void;
  onReady: (id: number) => void;
  onActivate: () => void;
  onRetry: () => void;
  onExportHtml: () => void;
  onExportPng: () => void;
  onHistory: () => void;
  onDelete: () => void;
}

export default function ScreenFrame({
  screen,
  width,
  height,
  background,
  building,
  error,
  active,
  busy,
  registerFrame,
  onReady,
  onActivate,
  onRetry,
  onExportHtml,
  onExportPng,
  onHistory,
  onDelete,
}: Props) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirm(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(false);
        setConfirm(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const built = Boolean(screen.html);
  const actions = [
    { label: 'Version history', Icon: History, action: onHistory },
    { label: 'Download HTML', Icon: FileCode2, action: onExportHtml },
    { label: 'Download PNG', Icon: ImageIcon, action: onExportPng },
  ];
  return (
    <div style={{ width }} className="select-none">
      <div className="mb-2 flex h-9 items-center gap-2">
        <button
          onClick={onActivate}
          aria-pressed={active}
          className={`min-w-0 truncate rounded-md px-2 py-1.5 text-base font-medium ${active ? 'bg-[var(--design-selected)] text-primary' : 'text-foreground hover:bg-muted'}`}
          title={`Select ${screen.name}`}
        >
          {screen.name}
        </button>
        {building && <Loader2 size={15} className="shrink-0 animate-spin text-primary" />}
        <div ref={menuRef} className="relative ml-auto">
          <button
            className="design-icon-button"
            onClick={() => setMenu((v) => !v)}
            aria-label={`Options for ${screen.name}`}
            aria-expanded={menu}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={21} />
          </button>
          {menu && (
            <div
              role="menu"
              aria-label={`${screen.name} actions`}
              className="design-popover absolute right-0 top-10 z-50 w-52 rounded-xl border border-border bg-card p-1.5"
            >
              {actions.map(({ label, Icon, action }) => (
                <button
                  role="menuitem"
                  key={label}
                  disabled={!built || busy}
                  onClick={() => {
                    action();
                    setMenu(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted disabled:opacity-40"
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
              <div className="mt-1 border-t border-border pt-1">
                {confirm ? (
                  <div className="flex items-center gap-1 px-2">
                    <span className="mr-auto text-xs">Delete screen?</span>
                    <button
                      disabled={busy}
                      className="design-icon-button text-red-600"
                      onClick={() => {
                        onDelete();
                        setMenu(false);
                        setConfirm(false);
                      }}
                      aria-label="Confirm delete screen"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="design-icon-button"
                      onClick={() => setConfirm(false)}
                      aria-label="Cancel delete screen"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    role="menuitem"
                    disabled={busy}
                    onClick={() => setConfirm(true)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-red-600 hover:bg-muted disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                    Delete screen
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        style={{ width, height, background }}
        className={`relative overflow-hidden rounded-xl border shadow-[0_8px_32px_rgb(0_0_0_/_7%)] ${active ? 'border-primary ring-[3px] ring-gold-500/20' : 'border-border'}`}
      >
        {built ? (
          <iframe
            ref={(el) => registerFrame(screen.id, el)}
            title={screen.name}
            sandbox="allow-scripts allow-forms"
            srcDoc={screen.html ?? ''}
            onLoad={() => onReady(screen.id)}
            style={{ width, height, background }}
            className="block border-0"
          />
        ) : (
          <div className="flex h-full flex-col bg-card p-7">
            <div className="mb-7 flex items-center gap-3">
              <div className="size-9 rounded-xl bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
            <div className="h-10 w-3/4 rounded bg-muted" />
            <div className="mt-3 h-3 w-full rounded bg-muted" />
            <div className="mt-2 h-3 w-4/5 rounded bg-muted" />
            <div className="mt-6 flex-1 rounded-2xl bg-muted opacity-60" />
            <div className="mt-auto flex flex-col items-center gap-3 py-7 text-center">
              {building ? (
                <>
                  <Loader2 size={25} className="animate-spin text-primary" />
                  <p className="text-base font-medium">Designing {screen.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Your screen will appear here as soon as it’s ready.
                  </p>
                </>
              ) : (
                <>
                  <AlertCircle size={25} className="text-red-600" />
                  <p className="max-w-md text-sm text-muted-foreground">
                    {error || 'This screen is waiting to be built.'}
                  </p>
                  <button
                    disabled={busy}
                    onClick={onRetry}
                    className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
                  >
                    <RotateCcw size={15} />
                    Build screen
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {built && building && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-primary py-2.5 text-sm text-primary-foreground">
            <Loader2 size={15} className="animate-spin" />
            Updating {screen.name}…
          </div>
        )}
        {built && error && !building && (
          <div
            role="alert"
            className="absolute inset-x-3 bottom-3 rounded-lg border border-red-300 bg-card p-3 text-sm"
          >
            <p>{error}</p>
            <button disabled={busy} className="mt-2 text-primary underline" onClick={onRetry}>
              Retry change
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
