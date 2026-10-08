'use client';

import React, { useRef, useState } from 'react';
import { ArrowUp, ImagePlus, Loader2, Monitor, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { DesignDevice, readImageFile } from '@/lib/design';

interface Props {
  prompt: string;
  onPrompt: (value: string) => void;
  device: DesignDevice;
  onDevice: (device: DesignDevice) => void;
  image: string | null;
  onImage: (image: string | null) => void;
  busy: boolean;
  onSubmit: () => void;
}

export default function BriefComposer({
  prompt,
  onPrompt,
  device,
  onDevice,
  image,
  onImage,
  busy,
  onSubmit,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const attach = async (file?: File) => {
    if (!file || busy) return;
    try {
      onImage(await readImageFile(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not attach image');
    }
  };
  return (
    <div
      className={`design-composer rounded-2xl border bg-card p-4 sm:p-5 ${dragging ? 'border-primary' : 'border-border'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        attach(e.dataTransfer.files[0]);
      }}
    >
      <textarea
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
          if (file) {
            e.preventDefault();
            attach(file);
          }
        }}
        disabled={busy}
        rows={3}
        maxLength={4000}
        aria-label="Design brief"
        placeholder="Describe what you want to design…"
        className="w-full resize-none bg-transparent text-[15px] leading-7 placeholder:text-muted-foreground focus-visible:!outline-none"
      />
      {image && (
        <div className="mb-3 flex w-fit items-center gap-3 rounded-lg border border-border p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="Attached design reference"
            className="h-12 w-14 rounded object-cover"
          />
          <div className="text-left text-xs">
            <p className="font-medium">Design reference</p>
            <p className="mt-1 text-muted-foreground">Use as visual inspiration</p>
          </div>
          <button
            disabled={busy}
            className="design-icon-button"
            onClick={() => onImage(null)}
            aria-label="Remove reference image"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            attach(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          disabled={busy}
          className="design-icon-button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach reference image"
          title="Attach, paste, or drop a reference image"
        >
          <ImagePlus size={19} />
        </button>
        <div
          className="flex items-center rounded-lg border border-border p-0.5"
          aria-label="Design format"
        >
          {(
            [
              { value: 'web', label: 'Website', Icon: Monitor },
              { value: 'mobile', label: 'Mobile app', Icon: Smartphone },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              disabled={busy}
              onClick={() => onDevice(value)}
              aria-pressed={device === value}
              className={`flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${device === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
          ⌘ / Ctrl + Enter
        </span>
        <button
          onClick={onSubmit}
          disabled={busy || (!prompt.trim() && !image)}
          className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 sm:ml-1"
          aria-label="Create design"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={20} />}
        </button>
      </div>
    </div>
  );
}
