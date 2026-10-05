'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowUp, ImagePlus, Loader2, Minus, Monitor, MousePointerClick, Palette, Plus, Smartphone, X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import ScreenFrame from '../components/ScreenFrame';
import SidePanel, { PanelTab } from '../components/SidePanel';
import {
  DEVICE_FRAME, DesignDevice, DesignProject, DesignScreen, DesignTheme, GenerateEvent,
  designApi, downloadDataUrl, downloadScreenHtml, readImageFile, slug, streamGenerate, takePendingStart,
} from '@/lib/design';

const GAP = 80;
const FRAME_HEADER = 36;
/** Frames per row: phones sit side by side, desktop pages wrap so they stay legible. */
const COLUMNS: Record<DesignDevice, number> = { mobile: 5, web: 2 };
const MIN_SCALE = 0.15;
const MAX_SCALE = 2;

interface View { x: number; y: number; scale: number }
interface Selection { screenId: number; tag: string; html: string }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function DesignCanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = Number(params.id);

  const [project, setProject] = useState<DesignProject | null>(null);
  const [screens, setScreens] = useState<DesignScreen[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [building, setBuilding] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [view, setView] = useState<View>({ x: 40, y: 60, scale: 0.6 });
  const [nameDraft, setNameDraft] = useState('');

  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const captures = useRef(new Map<number, { resolve: (url: string) => void; reject: (e: Error) => void }>());
  const purposes = useRef(new Map<number, string>());
  const screensRef = useRef<DesignScreen[]>([]);
  const projectRef = useRef<DesignProject | null>(null);
  const savedTheme = useRef<DesignTheme | null>(null);
  const themeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  screensRef.current = screens;
  projectRef.current = project;

  const loaded = project !== null;
  const device: DesignDevice = project?.device ?? 'mobile';
  const frame = DEVICE_FRAME[device];
  const activeScreen = screens.find((s) => s.id === activeId) ?? null;

  // --- view ----------------------------------------------------------------

  const fitView = useCallback((count: number, dev: DesignDevice) => {
    const el = viewportRef.current;
    if (!el || count < 1) return;
    const f = DEVICE_FRAME[dev];
    const cols = Math.min(count, COLUMNS[dev]);
    const rows = Math.ceil(count / COLUMNS[dev]);
    const contentW = cols * f.width + (cols - 1) * GAP;
    const contentH = rows * (f.height + FRAME_HEADER) + (rows - 1) * GAP;
    const scale = clamp(Math.min((el.clientWidth - 120) / contentW, (el.clientHeight - 200) / contentH), MIN_SCALE, 1);
    setView({ scale, x: (el.clientWidth - contentW * scale) / 2, y: 24 });
  }, []);

  const zoomBy = (factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    setView((v) => zoomAround(v, el.clientWidth / 2, el.clientHeight / 2, v.scale * factor));
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        setView((v) => zoomAround(v, e.clientX - rect.left, e.clientY - rect.top, v.scale * Math.exp(-e.deltaY * 0.002)));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loaded]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).dataset.pan) return; // only the empty canvas pans
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = () => { drag.current = null; };

  // --- loading -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    designApi
      .getProject(projectId)
      .then((detail) => {
        if (cancelled) return;
        setProject(detail.project);
        setNameDraft(detail.project.name);
        setScreens(detail.screens);
        savedTheme.current = detail.project.theme;
        setTimeout(() => fitView(detail.screens.length, detail.project.device), 0);
        const start = takePendingStart(projectId);
        if (start) runGenerate(start.prompt, start.image, false);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load this design'));
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // runGenerate only touches refs and setState, and must not re-run the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // --- iframe messages: selection and PNG capture ---------------------------

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.source !== 'pragna-design') return;
      // Trust only messages from one of our own screen iframes.
      let owner: number | null = null;
      frames.current.forEach((el, id) => { if (el.contentWindow === e.source) owner = id; });
      if (owner === null || owner !== data.screenId) return;

      if (data.type === 'select') {
        frames.current.forEach((el, id) => { if (id !== owner) el.contentWindow?.postMessage({ type: 'clear' }, '*'); });
        setSelection({ screenId: owner, tag: String(data.tag), html: String(data.html) });
        setActiveId(owner);
      } else if (data.type === 'png') {
        captures.current.get(owner)?.resolve(String(data.url));
      } else if (data.type === 'png-error') {
        captures.current.get(owner)?.reject(new Error(String(data.error)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const registerFrame = useCallback((id: number, el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(id, el);
    else frames.current.delete(id);
  }, []);

  const clearTarget = () => {
    frames.current.forEach((el) => el.contentWindow?.postMessage({ type: 'clear' }, '*'));
    setSelection(null);
    setActiveId(null);
  };

  // --- generate ------------------------------------------------------------

  const markDone = (id: number) =>
    setBuilding((prev) => { const next = new Set(prev); next.delete(id); return next; });

  const onGenerateEvent = (ev: GenerateEvent) => {
    switch (ev.type) {
      case 'plan': {
        const count = screensRef.current.length + ev.screens.length;
        setProject((p) => (p ? { ...p, name: ev.project_name || p.name, theme: ev.theme ?? p.theme } : p));
        savedTheme.current = ev.theme ?? savedTheme.current;
        setNameDraft((n) => ev.project_name || n);
        setScreens((prev) => [
          ...prev,
          ...ev.screens.map((s, i) => ({
            id: s.id, name: s.name, position: prev.length + i, version_id: null, body: null, html: null,
          })),
        ]);
        ev.screens.forEach((s) => purposes.current.set(s.id, s.purpose));
        setBuilding((prev) => new Set([...prev, ...ev.screens.map((s) => s.id)]));
        setTimeout(() => fitView(count, projectRef.current?.device ?? 'mobile'), 0);
        break;
      }
      case 'screen':
        setScreens((prev) => prev.map((s) => (s.id === ev.id ? { ...s, version_id: ev.version_id, body: ev.body, html: ev.html } : s)));
        setErrors((prev) => { const { [ev.id]: _gone, ...rest } = prev; return rest; });
        markDone(ev.id);
        setHistoryKey((k) => k + 1);
        break;
      case 'screen_error':
        setErrors((prev) => ({ ...prev, [ev.id]: ev.error }));
        markDone(ev.id);
        break;
      case 'error':
        toast.error(ev.error);
        break;
    }
  };

  async function runGenerate(text: string, img: string | undefined, add: boolean) {
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    try {
      await streamGenerate(projectId, { prompt: text, image: img, add }, onGenerateEvent, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      if (!controller.signal.aborted) {
        setGenerating(false);
        setBuilding(new Set()); // anything still marked building at stream end did not finish
      }
    }
  }

  // --- edit ----------------------------------------------------------------

  const replaceScreen = (updated: DesignScreen) =>
    setScreens((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

  async function runScreenAction(id: number, action: () => Promise<DesignScreen>) {
    setBuilding((prev) => new Set(prev).add(id));
    try {
      replaceScreen(await action());
      setErrors((prev) => { const { [id]: _gone, ...rest } = prev; return rest; });
      setHistoryKey((k) => k + 1);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That change failed');
      return false;
    } finally {
      markDone(id);
    }
  }

  const submit = async () => {
    const text = prompt.trim();
    if ((!text && !image) || generating) return;

    if (selection || (activeScreen?.body)) {
      const target = selection?.screenId ?? activeScreen!.id;
      if (!text) return;
      setPrompt('');
      const ok = await runScreenAction(target, () => designApi.editScreen(target, text, selection?.html));
      if (ok) clearTarget();
      else setPrompt(text);
      return;
    }

    const img = image ?? undefined;
    setPrompt('');
    setImage(null);
    await runGenerate(text, img, screens.length > 0);
  };

  const retry = (screen: DesignScreen) =>
    runScreenAction(screen.id, () => designApi.regenerateScreen(screen.id, purposes.current.get(screen.id)));

  const restore = async (versionId: number) => {
    if (!activeScreen) return;
    await runScreenAction(activeScreen.id, () => designApi.restoreVersion(activeScreen.id, versionId));
  };

  const removeScreen = async (screen: DesignScreen) => {
    try {
      await designApi.deleteScreen(screen.id);
      setScreens((prev) => prev.filter((s) => s.id !== screen.id));
      if (activeId === screen.id) clearTarget();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the screen');
    }
  };

  // --- project -------------------------------------------------------------

  const commitName = async () => {
    const name = nameDraft.trim();
    if (!project || !name || name === project.name) { setNameDraft(project?.name ?? ''); return; }
    try {
      const res = await designApi.updateProject(projectId, { name });
      setProject(res.project);
    } catch (err) {
      setNameDraft(project.name);
      toast.error(err instanceof Error ? err.message : 'Could not rename the project');
    }
  };

  const changeTheme = (theme: DesignTheme) => {
    setProject((p) => (p ? { ...p, theme } : p));
    clearTimeout(themeTimer.current);
    themeTimer.current = setTimeout(async () => {
      try {
        const res = await designApi.updateProject(projectId, { theme });
        savedTheme.current = res.project.theme;
        setScreens(res.screens);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not apply the theme');
        setProject((p) => (p && savedTheme.current ? { ...p, theme: savedTheme.current } : p));
      }
    }, 400);
  };

  // --- export --------------------------------------------------------------

  const exportHtml = (screen: DesignScreen) =>
    downloadScreenHtml(screen.id, screen.name).catch((err) =>
      toast.error(err instanceof Error ? err.message : 'Export failed'));

  const exportPng = async (screen: DesignScreen) => {
    const win = frames.current.get(screen.id)?.contentWindow;
    if (!win) return;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          captures.current.delete(screen.id);
          reject(new Error('PNG export timed out'));
        }, 20_000);
        captures.current.set(screen.id, {
          resolve: (u) => { clearTimeout(timer); captures.current.delete(screen.id); resolve(u); },
          reject: (e) => { clearTimeout(timer); captures.current.delete(screen.id); reject(e); },
        });
        win.postMessage({ type: 'capture' }, '*');
      });
      downloadDataUrl(url, `${slug(screen.name)}.png`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PNG export failed');
    }
  };

  const attach = async (file?: File) => {
    if (!file) return;
    try { setImage(await readImageFile(file)); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not attach that image'); }
  };

  // --- render --------------------------------------------------------------

  if (loadError) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button onClick={() => router.push('/design')} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Back to designs
          </button>
        </div>
      </AppLayout>
    );
  }

  const editing = Boolean(selection || activeScreen?.body);
  const placeholder = selection
    ? `Change this <${selection.tag}>…`
    : activeScreen?.body
      ? `Change "${activeScreen.name}"…`
      : screens.length === 0
        ? 'Describe what to design…'
        : 'Add another screen…';

  return (
    <AppLayout>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <button onClick={() => router.push('/design')} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground" aria-label="All designs">
            <ArrowLeft size={16} />
          </button>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            maxLength={80}
            className="min-w-0 max-w-xs rounded-md bg-transparent px-2 py-1 text-sm font-medium text-foreground outline-none focus:bg-muted"
            aria-label="Project name"
          />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {device === 'mobile' ? <Smartphone size={13} /> : <Monitor size={13} />}
            {device === 'mobile' ? 'Mobile' : 'Web'}
          </span>
          <button
            onClick={() => setPanel((p) => (p ? null : 'theme'))}
            className={`ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              panel ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Palette size={14} /> Theme & history
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            ref={viewportRef}
            data-pan="1"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative flex-1 cursor-grab touch-none overflow-hidden bg-muted/30 active:cursor-grabbing"
            style={{ backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.25) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          >
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
            )}
            <div
              data-pan="1"
              className="absolute left-0 top-0"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
            >
              {screens.map((screen, i) => (
                <div
                  key={screen.id}
                  className="absolute"
                  style={{
                    left: (i % COLUMNS[device]) * (frame.width + GAP),
                    top: Math.floor(i / COLUMNS[device]) * (frame.height + FRAME_HEADER + GAP),
                  }}
                >
                  <ScreenFrame
                    screen={screen}
                    width={frame.width}
                    height={frame.height}
                    background={project?.theme.background ?? "transparent"}
                    building={building.has(screen.id)}
                    error={errors[screen.id]}
                    active={activeId === screen.id}
                    registerFrame={registerFrame}
                    onActivate={() => {
                      if (activeId === screen.id) clearTarget();
                      else { setSelection(null); setActiveId(screen.id); }
                    }}
                    onRetry={() => retry(screen)}
                    onExportHtml={() => exportHtml(screen)}
                    onExportPng={() => exportPng(screen)}
                    onHistory={() => { setActiveId(screen.id); setPanel('history'); }}
                    onDelete={() => removeScreen(screen)}
                  />
                </div>
              ))}
            </div>

            {loaded && screens.length === 0 && !generating && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">
                Describe your app below to generate its screens.
              </div>
            )}

            <div className="absolute bottom-4 left-4 flex items-center rounded-lg border border-border bg-card text-muted-foreground">
              <button onClick={() => zoomBy(1 / 1.25)} className="p-2 hover:text-foreground" aria-label="Zoom out"><Minus size={14} /></button>
              <span className="w-12 text-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
              <button onClick={() => zoomBy(1.25)} className="p-2 hover:text-foreground" aria-label="Zoom in"><Plus size={14} /></button>
              <button onClick={() => fitView(screens.length, device)} className="border-l border-border px-2.5 py-2 text-xs hover:text-foreground">Fit</button>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-20">
              <div className="pointer-events-auto w-full max-w-xl">
                {(selection || activeScreen) && (
                  <div className="mb-1.5 flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-xs text-foreground">
                    <MousePointerClick size={12} className="text-primary" />
                    {selection ? `<${selection.tag}> in ${activeScreen?.name ?? 'screen'}` : `Editing ${activeScreen?.name}`}
                    <button onClick={clearTarget} aria-label="Clear target" className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
                  </div>
                )}
                {image && !editing && (
                  <div className="relative mb-1.5 inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="Reference" className="h-14 rounded-lg border border-border object-cover" />
                    <button onClick={() => setImage(null)} className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground" aria-label="Remove image"><X size={12} /></button>
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
                  {!editing && (
                    <button onClick={() => fileRef.current?.click()} className="rounded-lg p-2 text-muted-foreground hover:text-foreground" aria-label="Design from image" title="Design from image">
                      <ImagePlus size={16} />
                    </button>
                  )}
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    rows={1}
                    maxLength={editing ? 2000 : 4000}
                    placeholder={placeholder}
                    aria-label="Design prompt"
                    className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  <button
                    onClick={submit}
                    disabled={generating || (!prompt.trim() && !(image && !editing))}
                    className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                    aria-label="Send"
                  >
                    {generating ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {panel && project && (
            <SidePanel
              tab={panel}
              onTab={setPanel}
              onClose={() => setPanel(null)}
              theme={project.theme}
              onTheme={changeTheme}
              screen={activeScreen}
              historyKey={historyKey}
              onRestore={restore}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function zoomAround(v: View, px: number, py: number, nextScale: number): View {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const k = scale / v.scale;
  return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}
