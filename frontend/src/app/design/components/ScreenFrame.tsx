'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, FileCode2, History, Image as ImageIcon, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { DesignScreen } from '@/lib/design';

interface ScreenFrameProps {
  screen: DesignScreen;
  width: number;
  height: number;
  /** The design's own background colour, so the frame is never white while its page is still loading. */
  background: string;
  building: boolean;
  error?: string;
  active: boolean;
  registerFrame: (screenId: number, el: HTMLIFrameElement | null) => void;
  onActivate: () => void;
  onRetry: () => void;
  onExportHtml: () => void;
  onExportPng: () => void;
  onHistory: () => void;
  onDelete: () => void;
}

const headerButton =
  'rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40';

export default function ScreenFrame({
  screen, width, height, background, building, error, active, registerFrame,
  onActivate, onRetry, onExportHtml, onExportPng, onHistory, onDelete,
}: ScreenFrameProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const built = Boolean(screen.html);

  return (
    <div style={{ width }} className="select-none">
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={onActivate}
          className={`truncate rounded-md px-2 py-1 text-sm font-medium transition-colors ${
            active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
          }`}
          title="Edit this screen with chat"
        >
          {screen.name}
        </button>
        <div className="ml-auto flex items-center">
          {confirmDelete ? (
            <>
              <span className="mr-1 text-xs text-muted-foreground">Delete?</span>
              <button onClick={onDelete} className={headerButton} aria-label="Confirm delete"><Check size={14} /></button>
              <button onClick={() => setConfirmDelete(false)} className={headerButton} aria-label="Cancel delete"><X size={14} /></button>
            </>
          ) : (
            <>
              <button onClick={onHistory} disabled={!built} className={headerButton} aria-label="Version history" title="Version history"><History size={14} /></button>
              <button onClick={onExportHtml} disabled={!built} className={headerButton} aria-label="Export HTML" title="Export HTML"><FileCode2 size={14} /></button>
              <button onClick={onExportPng} disabled={!built} className={headerButton} aria-label="Export PNG" title="Export PNG"><ImageIcon size={14} /></button>
              <button onClick={() => setConfirmDelete(true)} className={headerButton} aria-label="Delete screen" title="Delete screen"><Trash2 size={14} /></button>
            </>
          )}
        </div>
      </div>

      <div
        style={{ width, height, background }}
        className={`relative overflow-hidden rounded-2xl border shadow-lg ${
          active ? 'border-primary ring-2 ring-primary/40' : 'border-border'
        }`}
      >
        {built ? (
          // No allow-same-origin: generated scripts can run, but cannot reach Pragna's cookies, storage or DOM.
          <iframe
            ref={(el) => registerFrame(screen.id, el)}
            title={screen.name}
            sandbox="allow-scripts"
            srcDoc={screen.html ?? ''}
            style={{ width, height, background }}
            className="block border-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
            {building ? (
              <>
                <Loader2 size={22} className="animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Designing {screen.name}…</span>
              </>
            ) : (
              <>
                <AlertCircle size={22} className="text-red-400" />
                <span className="text-sm text-muted-foreground">{error || 'This screen has not been built yet.'}</span>
                <button
                  onClick={onRetry}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  <RotateCcw size={13} /> Retry
                </button>
              </>
            )}
          </div>
        )}
        {built && building && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <Loader2 size={24} className="animate-spin text-white" />
          </div>
        )}
      </div>
    </div>
  );
}
