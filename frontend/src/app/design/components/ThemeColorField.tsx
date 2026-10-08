'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

interface HSV { h: number; s: number; v: number }

function fromHex(hex: string): HSV {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map(c => parseInt(c, 16) / 255) ?? [0, 0, 0];
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

function toHex({ h, s, v }: HSV): string {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function normalizeHex(value: string): string | null {
  const hex = value.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return '#' + hex.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) return '#' + hex.split('').map(c => c + c).join('').toUpperCase();
  return null;
}

export default function ThemeColorField({ label, value, onChange, open, onToggle, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const id = useId();
  const [hsv, setHsv] = useState(() => fromHex(value));
  const [draft, setDraft] = useState(value.toUpperCase());
  const lastValue = useRef(value.toUpperCase());

  useEffect(() => {
    const next = value.toUpperCase();
    setDraft(next);
    if (lastValue.current !== next) setHsv(fromHex(next));
    lastValue.current = next;
  }, [value]);

  const change = (next: HSV) => {
    const hex = toHex(next);
    lastValue.current = hex;
    setHsv(next);
    setDraft(hex);
    onChange(hex);
  };

  const commitHex = () => {
    const hex = normalizeHex(draft);
    if (hex) {
      setDraft(hex);
      setHsv(fromHex(hex));
      lastValue.current = hex;
      if (hex !== value.toUpperCase()) onChange(hex);
    } else setDraft(value.toUpperCase());
  };

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    change({ ...hsv, s, v });
  };

  return (
    <div className="min-w-0 space-y-2 text-xs">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <label htmlFor={`${id}-hex`} className="min-w-0">{label}</label>
        <div className="flex shrink-0 items-center gap-2">
          <input
            id={`${id}-hex`}
            aria-label={`${label} hex color`}
            value={draft}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            className="w-[84px] rounded-md border border-border bg-card px-2 py-2 font-mono text-[11px] uppercase"
            onChange={event => {
              const text = event.target.value;
              setDraft(text);
              if (/^#?[0-9a-f]{6}$/i.test(text)) {
                const hex = normalizeHex(text)!;
                lastValue.current = hex;
                setHsv(fromHex(hex));
                onChange(hex);
              }
            }}
            onBlur={commitHex}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commitHex(); }
              if (event.key === 'Escape') setDraft(value.toUpperCase());
            }}
          />
          <button
            type="button"
            aria-label={`Pick ${label.toLowerCase()} color`}
            aria-expanded={open}
            aria-controls={`${id}-picker`}
            onClick={onToggle}
            className="size-9 shrink-0 rounded-md border border-border p-1"
          >
            <span className="block size-full rounded-sm border border-black/10" style={{ background: value }} />
          </button>
        </div>
      </div>
      {open && (
        <div id={`${id}-picker`} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
          <div
            role="img"
            aria-label={`${label} color spectrum; use sliders below for keyboard selection`}
            className="relative h-28 w-full cursor-crosshair touch-none rounded-md"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
            onPointerDown={event => {
              if (disabled) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              pick(event);
            }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          >
            <span
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#000]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          {([
            { key: 'h', name: 'Hue', max: 359, factor: 1 },
            { key: 's', name: 'Saturation', max: 100, factor: 100 },
            { key: 'v', name: 'Brightness', max: 100, factor: 100 },
          ] as const).map(({ key, name, max, factor }) => (
            <label key={key} className="block space-y-1 text-[11px] text-muted-foreground">
              <span className="flex justify-between"><span>{name}</span><span>{Math.round(hsv[key] * factor)}{key === 'h' ? '°' : '%'}</span></span>
              <input
                type="range"
                aria-label={`${label} ${name.toLowerCase()}`}
                min={0}
                max={max}
                value={Math.round(hsv[key] * factor)}
                onChange={event => change({ ...hsv, [key]: Number(event.target.value) / factor })}
                className="block h-4 w-full cursor-pointer accent-primary"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
