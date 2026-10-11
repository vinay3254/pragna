'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Wrench,
  Undo2,
  Redo2,
  Presentation,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  FileCode2,
  FolderArchive,
  Hand,
  History,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Monitor,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Plus,
  Smartphone,
  Square,
  Tablet,
  Type,
  X,
} from 'lucide-react';
import ProjectTools from '../components/ProjectTools';
import { workspaceApi, downloadDesign, DesignComment } from '@/lib/designWorkspace';
import { API_BASE, getAuthToken } from '@/lib/api';
import ScreenFrame from '../components/ScreenFrame';
import SidePanel, { ElementSelection, PanelTab } from '../components/SidePanel';
import { AppearanceButton, DesignMark } from '../components/DesignChrome';
import { DesignChecks, DesignDirection, GenerationSteps } from '../components/DesignFeedback';
import {
  DEVICE_FRAME,
  DesignDevice,
  DesignBrief,
  DesignIssue,
  DesignMessage,
  DesignProject,
  DesignScreen,
  DesignTheme,
  GenerateEvent,
  GenerationStage,
  designApi,
  downloadDataUrl,
  downloadProjectZip,
  downloadScreenHtml,
  readImageFile,
  slug,
  streamGenerate,
  takePendingStart,
} from '@/lib/design';

const GAP = 64;
const FRAME_HEADER = 44;
const COLUMNS: Record<DesignDevice, number> = { mobile: 3, web: 2 };
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
type Scope = 'project' | 'screen' | 'add';
type CanvasMode = 'canvas' | 'preview' | 'code';
interface View {
  x: number;
  y: number;
  scale: number;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const newMessage = (role: DesignMessage['role'], content: string): DesignMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  created_at: new Date().toISOString(),
});

export default function DesignCanvasPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<DesignProject | null>(null);
  const [screens, setScreens] = useState<DesignScreen[]>([]);
  const [messages, setMessages] = useState<DesignMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [building, setBuilding] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage>('planning');
  const [designBrief, setDesignBrief] = useState<DesignBrief>({});
  const [direction, setDirection] = useState('');
  const [runtimeErrors, setRuntimeErrors] = useState<Record<number, string[]>>({});
  const [stopping, setStopping] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('add');
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [view, setView] = useState<View>({ x: 40, y: 60, scale: 0.6 });
  const [nameDraft, setNameDraft] = useState('');
  const [mode, setMode] = useState<CanvasMode>('canvas');
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [chatOpen, setChatOpen] = useState(true);
  const [sideTab, setSideTab] = useState<'chat' | 'screens'>('chat');
  const [showTools, setShowTools] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [guides, setGuides] = useState(false);
  const [aiDemo, setAiDemo] = useState(false);
  const aiDemoRef = useRef(false);
  aiDemoRef.current = aiDemo;
  const pendingSelect = useRef<{ id: number; selector: string } | null>(null);
  const commandRef = useRef<(data: Record<string, unknown>, owner: number) => void>(() => {});
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(1280);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

  const presentationFrame = useRef<HTMLIFrameElement>(null);
  const presentingRef = useRef(false);
  presentingRef.current = presenting;
  const currentArtboard = useRef<number | null>(null);
  currentArtboard.current = activeId;
  const viewportRef = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const captures = useRef(
    new Map<number, { resolve: (url: string) => void; reject: (error: Error) => void }>()
  );
  const selectedVersions = useRef(new Map<number, number>());
  const purposes = useRef(new Map<number, string>());
  const screensRef = useRef<DesignScreen[]>([]);
  const projectRef = useRef<DesignProject | null>(null);
  const busyRef = useRef(false);
  const modeRef = useRef<CanvasMode>('canvas');
  const savedTheme = useRef<DesignTheme | null>(null);
  const themeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeQueue = useRef<DesignTheme | null>(null);
  const themeWriting = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const previewGeneratedDesign = useRef(false);
  const [variants, setVariants] = useState(1);
  const [extraPolish, setExtraPolish] = useState(false);

  screensRef.current = screens;
  projectRef.current = project;
  modeRef.current = mode;
  const busy = operation !== null;
  const device = project?.device ?? 'web';
  const baseFrame = DEVICE_FRAME[device];
  const frame = {
    width: screens.find((s) => s.id === activeId)?.layout?.width || baseFrame.width,
    height: screens.find((s) => s.id === activeId)?.layout?.height || baseFrame.height,
  };
  const canEdit = !project?.access_role || ['owner', 'editor'].includes(project.access_role);
  const activeScreen = screens.find((s) => s.id === activeId) ?? null;
  const builtCount = screens.filter((s) => s.version_id !== null && s.html).length;
  const editableScreens = screens.filter((s) => s.body);

  const fitView = useCallback((count: number, dev: DesignDevice) => {
    const el = viewportRef.current;
    if (!el || count < 1) return;
    const f = DEVICE_FRAME[dev];
    const bounds = Array.from({ length: count }, (_, i) => {
      const layout = screensRef.current[i]?.layout;
      return {
        x: layout?.x ?? (i % COLUMNS[dev]) * (f.width + GAP),
        y: layout?.y ?? Math.floor(i / COLUMNS[dev]) * (f.height + FRAME_HEADER + GAP),
        width: layout?.width || f.width,
        height: (layout?.height || f.height) + FRAME_HEADER,
      };
    });
    const minX = Math.min(...bounds.map((b) => b.x)),
      minY = Math.min(...bounds.map((b) => b.y));
    const width = Math.max(...bounds.map((b) => b.x + b.width)) - minX,
      height = Math.max(...bounds.map((b) => b.y + b.height)) - minY;
    const scale = clamp(
      Math.min((el.clientWidth - 80) / width, (el.clientHeight - 100) / height),
      MIN_SCALE,
      1
    );
    setView({
      scale,
      x: (el.clientWidth - width * scale) / 2 - minX * scale,
      y: (el.clientHeight - height * scale) / 2 - minY * scale,
    });
  }, []);
  const focusScreen = (screen: DesignScreen) => {
    const el = viewportRef.current;
    if (!el) return;
    const index = screensRef.current.findIndex((s) => s.id === screen.id);
    const base = DEVICE_FRAME[projectRef.current?.device ?? 'web'];
    const f = {
      width: screen.layout?.width || base.width,
      height: screen.layout?.height || base.height,
    };
    const scale = clamp(
      Math.min(
        (el.clientWidth - 80) / f.width,
        (el.clientHeight - 100) / (f.height + FRAME_HEADER)
      ),
      MIN_SCALE,
      1
    );
    const cols = COLUMNS[projectRef.current?.device ?? 'web'];
    setView({
      scale,
      x:
        (el.clientWidth - f.width * scale) / 2 -
        (screen.layout?.x ?? (index % cols) * (base.width + GAP)) * scale,
      y:
        (el.clientHeight - (f.height + FRAME_HEADER) * scale) / 2 -
        (screen.layout?.y ?? Math.floor(index / cols) * (base.height + FRAME_HEADER + GAP)) * scale,
    });
  };
  const zoomBy = (factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    setView((v) => zoomAround(v, el.clientWidth / 2, el.clientHeight / 2, v.scale * factor));
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setViewportSize({ width: el.clientWidth, height: el.clientHeight })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);
  useEffect(() => {
    if (mode !== 'canvas') return;
    const el = viewportRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        setView((v) =>
          zoomAround(
            v,
            e.clientX - rect.left,
            e.clientY - rect.top,
            v.scale * Math.exp(-e.deltaY * 0.002)
          )
        );
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [loading, mode]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.key === 'Escape') {
        setPanel(null);
        setExportOpen(false);
        clearSelection();
      }
      if (e.key === '0') {
        e.preventDefault();
        fitView(screensRef.current.length, projectRef.current?.device ?? 'web');
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(1.2);
      }
      if (e.key === '-') {
        e.preventDefault();
        zoomBy(1 / 1.2);
      }
      if (e.key.toLowerCase() === 'v') setTool('select');
      if (e.key.toLowerCase() === 'h') setTool('hand');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView]);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: PointerEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [exportOpen]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, operation, sideTab]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    const captureRequests = captures.current;
    mounted.current = true;
    setLoading(true);
    setLoadError(null);
    if (!Number.isInteger(projectId) || projectId < 1) {
      setLoadError('This design link is invalid.');
      setLoading(false);
      return;
    }
    designApi
      .getProject(projectId)
      .then((detail) => {
        if (cancelled) return;
        setProject(detail.project);
        setNameDraft(detail.project.name);
        setScreens(detail.screens);
        setMessages(detail.messages ?? []);
        savedTheme.current = detail.project.theme;
        const first = detail.screens.find((s) => s.body);
        setActiveId(first?.id ?? null);
        setScope(first ? 'screen' : 'add');
        setPreviewWidth(DEVICE_FRAME[detail.project.device].width);
        setMode(first ? 'preview' : 'canvas');
        if (window.innerWidth < 768 && first) {
          setChatOpen(false);
          setMode('preview');
          setPreviewWidth(390);
        }
        setLoading(false);
        requestAnimationFrame(() => fitView(detail.screens.length, detail.project.device));
        const start = takePendingStart(projectId);
        if (start) runGenerate(start.prompt, start.image, false);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load design');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      abortRef.current?.abort();
      if (themeTimer.current) clearTimeout(themeTimer.current);
      captureRequests.forEach((capture) => capture.reject(new Error('Canvas closed')));
      captureRequests.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reload]);

  const sendMode = useCallback((id: number) => {
    frames.current
      .get(id)
      ?.contentWindow?.postMessage(
        { type: 'mode', mode: modeRef.current === 'preview' ? 'preview' : 'select' },
        '*'
      );
    if (pendingSelect.current?.id === id) {
      const target = pendingSelect.current;
      frames.current
        .get(id)
        ?.contentWindow?.postMessage({ type: 'select-selector', selector: target.selector }, '*');
      pendingSelect.current = null;
    }
  }, []);
  const registerFrame = useCallback((id: number, el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(id, el);
    else frames.current.delete(id);
  }, []);
  useEffect(() => {
    frames.current.forEach((_, id) => sendMode(id));
    if (mode !== 'canvas') setSelection(null);
  }, [mode, sendMode]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.source !== 'pragna-design') return;
      if (
        presentingRef.current &&
        e.source === presentationFrame.current?.contentWindow &&
        data.screenId === currentArtboard.current
      ) {
        if (data.type === 'ready')
          presentationFrame.current?.contentWindow?.postMessage(
            { type: 'mode', mode: 'presentation' },
            '*'
          );
        if (data.type === 'presentation-close') setPresenting(false);
        if (data.type === 'presentation-step')
          setActiveId((current) => {
            const list = screensRef.current;
            const index = list.findIndex((screen) => screen.id === current);
            return (
              list[clamp(index + (data.delta === 1 ? 1 : -1), 0, list.length - 1)]?.id ?? current
            );
          });
        return;
      }
      let owner: number | null = null;
      frames.current.forEach((el, id) => {
        if (el.contentWindow === e.source) owner = id;
      });
      if (owner === null || owner !== data.screenId) return;
      if (data.type === 'ready') sendMode(owner);
      if (
        [
          'canvas-change',
          'canvas-command',
          'text-edit',
          'history-command',
          'ai-request',
          'voice-request',
        ].includes(data.type)
      )
        commandRef.current(data, owner);
      if (data.type === 'runtime-error') {
        const screenId = owner;
        const error = String(data.error ?? 'Prototype script error').slice(0, 500);
        setRuntimeErrors((previous) => ({
          ...previous,
          [screenId]: [...new Set([...(previous[screenId] ?? []), error])].slice(0, 5),
        }));
      }
      if (data.type === 'select' && modeRef.current === 'canvas') {
        const version = screensRef.current.find((screen) => screen.id === owner)?.version_id;
        if (version) selectedVersions.current.set(owner, version);
        frames.current.forEach((el, id) => {
          if (id !== owner) el.contentWindow?.postMessage({ type: 'clear' }, '*');
        });
        setSelection({
          screenId: owner,
          versionId: version ?? undefined,
          tag: String(data.tag),
          html: String(data.html),
          selector: String(data.selector ?? ''),
          text: String(data.text ?? ''),
          canEdit: data.canEdit === true,
          styles: data.styles,
          selectors: Array.isArray(data.selectors)
            ? data.selectors.slice(0, 30).map(String)
            : undefined,
        });
        setActiveId(owner);
        setScope('screen');
        setPanel('inspect');
      } else if (data.type === 'png') captures.current.get(owner)?.resolve(String(data.url));
      else if (data.type === 'png-error')
        captures.current.get(owner)?.reject(new Error(String(data.error)));
      else if (data.type === 'navigate' && modeRef.current === 'preview') {
        let href = String(data.href ?? '');
        try {
          href = decodeURIComponent(href);
        } catch {
          // Keep the original destination when it contains malformed URL escapes.
        }
        const names = [
          normalize(String(data.label ?? '')),
          normalize(href.replace(/^.*\//, '').replace(/\.html?(?:[?#].*)?$/, '')),
        ].filter(Boolean);
        const next = screensRef.current.find(
          (s) => s.html && names.some((n) => n === normalize(s.name))
        );
        if (next) {
          setActiveId(next.id);
          return;
        }
        toast.info('This link has no matching screen yet. Add a screen to complete the flow.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendMode]);

  function clearSelection() {
    frames.current.forEach((el) => el.contentWindow?.postMessage({ type: 'clear' }, '*'));
    setSelection(null);
  }
  const activate = (screen: DesignScreen, focus = false) => {
    clearSelection();
    setActiveId(screen.id);
    setScope('screen');
    if (focus) focusScreen(screen);
  };
  const markDone = (id: number) =>
    setBuilding((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const replaceScreen = (updated: DesignScreen) => {
    setRuntimeErrors((previous) => ({ ...previous, [updated.id]: [] }));
    setSelection((selected) => (selected?.screenId === updated.id ? null : selected));
    setScreens((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };
  const append = (role: DesignMessage['role'], content: string) =>
    setMessages((prev) => [...prev, newMessage(role, content)]);
  const syncMessages = async () => {
    try {
      const detail = await designApi.getProject(projectId);
      if (mounted.current) setMessages(detail.messages ?? []);
    } catch {
      // Keep the current conversation visible while a transient reload fails.
    }
  };
  const begin = (label: string) => {
    if (busyRef.current || themeWriting.current || themeQueue.current) return false;
    busyRef.current = true;
    setOperation(label);
    startedAt.current = Date.now();
    setElapsed(0);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    if (mounted.current) {
      setOperation(null);
      setBuilding(new Set());
      setHistoryKey((k) => k + 1);
    }
  };
  const onGenerateEvent = (event: GenerateEvent) => {
    if (event.type === 'status') {
      setGenerationStage(event.stage);
      setOperation(event.message);
    } else if (event.type === 'quality') {
      setScreens((previous) =>
        previous.map((screen) =>
          screen.id === event.id && screen.version_id === event.version_id && screen.quality
            ? { ...screen, quality: { ...screen.quality, browser: event.browser } }
            : screen
        )
      );
    } else if (event.type === 'plan') {
      setGenerationStage('building');
      setDesignBrief(event.design_brief ?? {});
      setDirection(event.direction ?? '');
      const prevCount = screensRef.current.length;
      setProject((p) =>
        p ? { ...p, name: event.project_name || p.name, theme: event.theme ?? p.theme } : p
      );
      setNameDraft((name) => event.project_name || name);
      savedTheme.current = event.theme ?? savedTheme.current;
      setScreens((prev) => [
        ...prev,
        ...event.screens.map((s, i) => ({
          id: s.id,
          name: s.name,
          position: prev.length + i,
          version_id: null,
          body: null,
          html: null,
          layout: s.layout,
        })),
      ]);
      event.screens.forEach((s) => purposes.current.set(s.id, s.purpose));
      setBuilding(new Set(event.screens.map((s) => s.id)));
      setOperation('Building your design');
      requestAnimationFrame(() =>
        fitView(prevCount + event.screens.length, projectRef.current?.device ?? 'web')
      );
    } else if (event.type === 'notice') {
      toast.info(event.message);
    } else if (event.type === 'screen_draft') {
      // Drafts are visible, but only completed versions can be edited or exported.
      setScreens((previous) =>
        previous.map((screen) =>
          screen.id === event.id && screen.version_id === null
            ? { ...screen, html: event.html }
            : screen
        )
      );
      setActiveId((id) => id ?? event.id);
      if (previewGeneratedDesign.current) {
        setMode('preview');
        previewGeneratedDesign.current = false;
      }
    } else if (event.type === 'screen') {
      setRuntimeErrors((previous) => ({ ...previous, [event.id]: [] }));
      if (previewGeneratedDesign.current) {
        setMode('preview');
        previewGeneratedDesign.current = false;
      }
      setSelection((selected) => (selected?.screenId === event.id ? null : selected));
      setScreens((prev) =>
        prev.map((s) =>
          s.id === event.id
            ? {
                ...s,
                version_id: event.version_id,
                body: event.body,
                html: event.html,
                quality: event.quality,
              }
            : s
        )
      );
      setActiveId((id) => id ?? event.id);
      markDone(event.id);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
    } else if (event.type === 'screen_error') {
      setErrors((prev) => ({ ...prev, [event.id]: event.error }));
      setScreens((previous) =>
        previous.map((screen) =>
          screen.id === event.id && screen.version_id === null ? { ...screen, html: null } : screen
        )
      );
      markDone(event.id);
    } else if (event.type === 'error') {
      toast.error(event.error);
      append('assistant', event.error);
    }
  };

  async function runGenerate(text: string, img: string | undefined, add: boolean) {
    if (!canEdit) return;
    if (!begin(add ? 'Planning another screen' : 'Planning your design')) return;
    const controller = new AbortController();
    abortRef.current = controller;
    previewGeneratedDesign.current = !add;
    setGenerating(true);
    setGenerationStage('planning');
    setDesignBrief({});
    setDirection('');
    append('user', text || 'Design from this reference image');
    try {
      await streamGenerate(
        projectId,
        {
          prompt: text,
          image: img,
          add,
          polish: extraPolish,
          variants: project?.kind === 'presentation' ? 1 : variants,
        },
        onGenerateEvent,
        controller.signal
      );
      if (mounted.current) {
        const detail = await designApi.getProject(projectId);
        setScreens(detail.screens);
        setProject(detail.project);
        setNameDraft(detail.project.name);
        setMessages(detail.messages ?? []);
        setScope(detail.screens.some((s) => s.body) ? 'screen' : 'add');
        if (!detail.screens.some((s) => s.body)) {
          setPrompt(text);
          setImage(img ?? null);
        }
        setActiveId((id) => id ?? detail.screens.find((s) => s.body)?.id ?? null);
      }
    } catch (error) {
      if (mounted.current) {
        if (controller.signal.aborted) {
          append(
            'assistant',
            'Generation stopped. Completed screens are saved. Use Build screen to finish any remaining screens.'
          );
        } else {
          const message = error instanceof Error ? error.message : 'Generation failed';
          toast.error(message);
          append('assistant', message);
          setPrompt(text);
          setImage(img ?? null);
          setScope('add');
        }
      }
    } finally {
      abortRef.current = null;
      if (mounted.current) {
        setScreens((previous) =>
          previous.map((screen) =>
            screen.version_id === null ? { ...screen, html: null } : screen
          )
        );
        setGenerating(false);
        setStopping(false);
      }
      finish();
    }
  }

  async function runScreenAction(
    screen: DesignScreen,
    action: () => Promise<DesignScreen>,
    label: string
  ) {
    if (!canEdit || !begin(label)) return false;
    setBuilding(new Set([screen.id]));
    try {
      replaceScreen(await action());
      setErrors((prev) => {
        const next = { ...prev };
        delete next[screen.id];
        return next;
      });
      await syncMessages();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not apply change';
      toast.error(message);
      setErrors((prev) => ({ ...prev, [screen.id]: message }));
      return false;
    } finally {
      finish();
    }
  }

  const submit = async () => {
    const text = prompt.trim();
    if (busyRef.current || savingTheme || (!text && !(image && scope === 'add'))) return;
    if (scope === 'add' || screens.length === 0) {
      const img = image ?? undefined;
      setPrompt('');
      setImage(null);
      await runGenerate(text, img, screens.length > 0);
      return;
    }
    const targets =
      scope === 'project'
        ? screens.filter((s) => s.body)
        : activeScreen?.body
          ? [activeScreen]
          : [];
    if (!text || !targets.length) return;
    if (!begin(scope === 'project' ? 'Refining every screen' : `Updating ${targets[0].name}`))
      return;
    const targetHtml = scope === 'screen' ? selection?.html : undefined;
    setPrompt('');
    append('user', `${scope === 'project' ? 'Entire design' : targets[0].name}: ${text}`);
    setBuilding(new Set(targets.map((s) => s.id)));
    let failed = false;
    try {
      for (const target of targets) {
        try {
          replaceScreen(await designApi.editScreen(target.id, text, targetHtml));
          markDone(target.id);
          setErrors((prev) => {
            const next = { ...prev };
            delete next[target.id];
            return next;
          });
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : 'Could not apply change';
          setErrors((prev) => ({ ...prev, [target.id]: message }));
          markDone(target.id);
          toast.error(message);
        }
      }
      await syncMessages();
      clearSelection();
      if (failed) {
        setPrompt(text);
        append(
          'assistant',
          'Some changes failed. Your previous designs are saved; retry the affected screen.'
        );
      }
    } finally {
      finish();
    }
  };
  const retry = (screen: DesignScreen) =>
    runScreenAction(
      screen,
      () => designApi.regenerateScreen(screen.id, purposes.current.get(screen.id)),
      `Building ${screen.name}`
    );
  const repairIssues = async (issues: DesignIssue[]) => {
    if (!activeScreen?.body) return;
    clearSelection();
    const instruction = (
      'Repair these specific issues while preserving the design, content, working controls and theme tokens:\n' +
      issues.map((issue) => `- ${issue.message}`).join('\n')
    ).slice(0, 2000);
    await runScreenAction(
      activeScreen,
      () => designApi.editScreen(activeScreen.id, instruction),
      'Repairing prototype issues'
    );
  };
  const restore = async (versionId: number) => {
    if (!activeScreen) return;
    const ok = await runScreenAction(
      activeScreen,
      () => designApi.restoreVersion(activeScreen.id, versionId),
      `Restoring ${activeScreen.name}`
    );
    if (ok) {
      clearSelection();
      toast.success('Version restored');
    }
  };
  const updateText = async (text: string) => {
    if (!selection || !activeScreen?.version_id) return false;
    const selected = selection;
    const ok = await runScreenAction(
      activeScreen,
      () =>
        designApi.updateText(
          selected.screenId,
          selected.selector,
          text,
          selected.versionId ?? activeScreen.version_id!
        ),
      `Saving text in ${activeScreen.name}`
    );
    if (ok) {
      clearSelection();
      toast.success('Text updated');
    }
    return ok;
  };
  const task = async (label: string, action: () => Promise<unknown>) => {
    if (!begin(label)) return;
    try {
      await action();
      const detail = await designApi.getProject(projectId);
      setProject(detail.project);
      setScreens(detail.screens);
      setMessages(detail.messages || []);
      setNameDraft(detail.project.name);
      savedTheme.current = detail.project.theme;
      setActiveId((current) =>
        detail.screens.some((screen) => screen.id === current)
          ? current
          : (detail.screens[0]?.id ?? null)
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    } finally {
      finish();
    }
  };
  const selectLayer = (selector: string, screenId: number) => {
    pendingSelect.current = { id: screenId, selector };
    setActiveId(screenId);
    setMode('canvas');
    setTool('select');
    if (modeRef.current === 'canvas' && frames.current.has(screenId)) sendMode(screenId);
  };
  const canvasAction = async (
    operation: string,
    styles: Record<string, string> = {},
    target = selection
  ) => {
    const screen = screensRef.current.find((item) => item.id === target?.screenId);
    if (!target || !screen?.version_id || !canEdit) return false;
    return runScreenAction(
      screen,
      () =>
        workspaceApi.canvas(
          screen.id,
          target.selector,
          operation,
          target.versionId ?? screen.version_id!,
          styles,
          operation === 'group' ? target.selectors : undefined
        ),
      'Saving canvas changes'
    );
  };
  const stylePreview = (styles: Record<string, string> | null) => {
    if (selection)
      frames.current
        .get(selection.screenId)
        ?.contentWindow?.postMessage({ type: 'style-preview', styles }, '*');
  };
  const historyStep = async (redo: boolean, screenId = activeId) => {
    const screen = screensRef.current.find((item) => item.id === screenId);
    if (!screen?.version_id || !canEdit || busyRef.current) return;
    try {
      const versions = await designApi.listVersions(screen.id);
      const index = versions.findIndex((v) => v.id === screen.version_id);
      const target = versions[index + (redo ? -1 : 1)];
      if (target)
        await runScreenAction(
          screen,
          () => designApi.restoreVersion(screen.id, target.id),
          redo ? 'Redoing edit' : 'Undoing edit'
        );
      else toast.info(redo ? 'No newer version' : 'No earlier version');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'History unavailable');
    }
  };
  const applyComment = async (comment: DesignComment) => {
    const screen = screensRef.current.find((item) => item.id === comment.screen_id);
    if (!screen?.body) return;
    let element: string | undefined;
    if (comment.selector) {
      try {
        element = new DOMParser()
          .parseFromString(screen.body, 'text/html')
          .querySelector(comment.selector)?.outerHTML;
      } catch {
        /* Missing comment anchors fall back to a screen edit. */
      }
    }
    const ok = await runScreenAction(
      screen,
      () => designApi.editScreen(screen.id, comment.content, element),
      'Applying comment'
    );
    if (ok) {
      await workspaceApi.resolve(projectId, comment.id, true);
      setShowTools(false);
    }
  };
  commandRef.current = (data, owner) => {
    if (data.type === 'voice-request') {
      const requestId = String(data.requestId || '').slice(0, 80),
        reply = (content: string, error = false) =>
          frames.current
            .get(owner)
            ?.contentWindow?.postMessage(
              { type: 'voice-response', requestId, content, error },
              '*'
            );
      if (modeRef.current !== 'preview' || !canEdit) {
        reply('Voice input is available in the editable preview.', true);
        return;
      }
      type Recognition = {
        start: () => void;
        stop: () => void;
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult:
          ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((event: { error: string }) => void) | null;
        onend: (() => void) | null;
      };
      const globals = window as unknown as {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      };
      const Constructor = globals.SpeechRecognition || globals.webkitSpeechRecognition;
      if (!Constructor) {
        reply('Voice input is unavailable in this browser. Type your request instead.', true);
        return;
      }
      const recognition = new Constructor();
      let done = false;
      const timeout = setTimeout(() => {
        recognition.stop();
        if (!done) {
          done = true;
          reply('No speech heard. Try again.', true);
        }
      }, 14000);
      const finishVoice = (content: string, error = false) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        reply(content, error);
      };
      recognition.lang = navigator.language;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => finishVoice(event.results[0]?.[0]?.transcript || '');
      recognition.onerror = (event) =>
        finishVoice(`Voice input: ${event.error}. You can type instead.`, true);
      recognition.onend = () => {
        if (!done) finishVoice('No speech heard. Try again.', true);
      };
      try {
        recognition.start();
      } catch {
        finishVoice('Microphone unavailable. Check browser permission or type instead.', true);
      }
      return;
    }
    if (data.type === 'ai-request') {
      const requestId = String(data.requestId || '').slice(0, 80),
        reply = (content: string, error = false) =>
          frames.current
            .get(owner)
            ?.contentWindow?.postMessage({ type: 'ai-response', requestId, content, error }, '*');
      if (!aiDemoRef.current || !canEdit) {
        reply('Enable AI demo in the Pragna preview toolbar to use this feature.', true);
        return;
      }
      if (busyRef.current) {
        reply('Please wait for the current operation.', true);
        return;
      }
      const text = String(data.prompt || '').slice(0, 2000);
      if (!text.trim()) return;
      task('Running AI demo', async () => {
        try {
          reply((await workspaceApi.assistant(owner, text)).content);
        } catch (error) {
          reply(error instanceof Error ? error.message : 'AI unavailable', true);
        }
      });
      return;
    }
    if (!canEdit || busyRef.current || modeRef.current !== 'canvas') return;
    if (data.type === 'history-command') {
      historyStep(data.redo === true, owner);
      return;
    }
    const target = {
      screenId: owner,
      selector: String(data.selector || ''),
      versionId: selectedVersions.current.get(owner),
      selectors: Array.isArray(data.selectors)
        ? data.selectors.slice(0, 30).map(String)
        : undefined,
      tag: '',
      html: '',
      text: '',
      canEdit: true,
    };
    if (data.type === 'canvas-change')
      canvasAction('style', data.styles as Record<string, string>, target);
    if (data.type === 'canvas-command') {
      const operation = String(data.operation);
      if (operation !== 'delete' || window.confirm('Delete selected element?'))
        canvasAction(operation, {}, target);
    }
    if (data.type === 'text-edit') {
      const screen = screensRef.current.find((item) => item.id === owner);
      if (screen?.version_id)
        runScreenAction(
          screen,
          () =>
            designApi.updateText(
              owner,
              target.selector,
              String(data.text).slice(0, 4000),
              target.versionId ?? screen.version_id!
            ),
          'Saving text'
        );
    }
  };
  useEffect(() => {
    if (!projectId || loading) return;
    let previous = '',
      stopped = false;
    const poll = async () => {
      if (
        busyRef.current ||
        themeWriting.current ||
        themeQueue.current ||
        document.hidden ||
        stopped
      )
        return;
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE}/api/design/projects/${projectId}/revision`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (previous && previous !== data.revision) {
          const detail = await designApi.getProject(projectId);
          if (!stopped && !busyRef.current) {
            setSelection((selected) => {
              if (
                selected &&
                detail.screens.find((screen) => screen.id === selected.screenId)?.version_id !==
                  selected.versionId
              ) {
                frames.current
                  .get(selected.screenId)
                  ?.contentWindow?.postMessage({ type: 'clear' }, '*');
                return null;
              }
              return selected;
            });
            setProject(detail.project);
            setScreens(detail.screens);
            setMessages(detail.messages || []);
            savedTheme.current = detail.project.theme;
            setNameDraft(detail.project.name);
          }
        }
        previous = data.revision;
      } catch {
        /* Retry on the next collaboration poll. */
      }
    };
    poll();
    const timer = setInterval(poll, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [projectId, loading]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))
        return;
      if (presenting) {
        if (event.key === 'Escape') setPresenting(false);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const index = screens.findIndex((s) => s.id === activeId);
          setActiveId(
            screens[
              Math.max(
                0,
                Math.min(screens.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))
              )
            ]?.id ?? null
          );
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        historyStep(event.shiftKey);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'g') setGuides((value) => !value);
      if (event.key === 'Escape') {
        setShowTools(false);
        stylePreview(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const removeScreen = async (screen: DesignScreen) => {
    if (!canEdit || !begin(`Deleting ${screen.name}`)) return;
    try {
      await designApi.deleteScreen(screen.id);
      setScreens((prev) => {
        const next = prev.filter((s) => s.id !== screen.id);
        if (activeId === screen.id) setActiveId(next[0]?.id ?? null);
        return next;
      });
      clearSelection();
      setErrors((prev) => {
        const next = { ...prev };
        delete next[screen.id];
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete screen');
    } finally {
      finish();
    }
  };
  const commitName = async () => {
    const name = nameDraft.trim();
    if (!project || !name || name === project.name) {
      setNameDraft(project?.name ?? '');
      return;
    }
    if (busyRef.current) return;
    try {
      const detail = await designApi.updateProject(projectId, { name });
      setProject((p) => (p ? { ...p, name: detail.project.name } : p));
    } catch (error) {
      setNameDraft(project.name);
      toast.error(error instanceof Error ? error.message : 'Could not rename design');
    }
  };

  // Serialize theme writes so a slow earlier response cannot overwrite a newer palette.
  const flushTheme = async () => {
    if (themeWriting.current || !themeQueue.current) return;
    themeWriting.current = true;
    try {
      while (themeQueue.current) {
        const theme = themeQueue.current;
        themeQueue.current = null;
        try {
          const detail = await designApi.updateProject(projectId, { theme });
          savedTheme.current = detail.project.theme;
          if (mounted.current && !themeQueue.current) {
            setScreens(detail.screens);
            setProject((p) => (p ? { ...p, theme: detail.project.theme } : p));
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not apply theme');
          if (mounted.current && !themeQueue.current)
            setProject((p) => (p && savedTheme.current ? { ...p, theme: savedTheme.current } : p));
        }
      }
    } finally {
      themeWriting.current = false;
      if (mounted.current) setSavingTheme(false);
    }
  };
  const changeTheme = (theme: DesignTheme) => {
    if (busyRef.current) return;
    setProject((p) => (p ? { ...p, theme } : p));
    setSavingTheme(true);
    themeQueue.current = theme;
    if (themeTimer.current) clearTimeout(themeTimer.current);
    themeTimer.current = setTimeout(flushTheme, 300);
  };

  const exportHtml = (screen: DesignScreen) =>
    downloadScreenHtml(screen.id, screen.name).catch((error) =>
      toast.error(error instanceof Error ? error.message : 'Export failed')
    );
  const exportPng = async (screen: DesignScreen) => {
    const win = frames.current.get(screen.id)?.contentWindow;
    if (!win) {
      toast.info('Open this screen in Canvas or Preview before exporting PNG.');
      return;
    }
    if (captures.current.has(screen.id)) return;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          captures.current.delete(screen.id);
          reject(new Error('PNG export timed out. Try downloading HTML.'));
        }, 30000);
        captures.current.set(screen.id, {
          resolve: (url) => {
            clearTimeout(timer);
            captures.current.delete(screen.id);
            resolve(url);
          },
          reject: (error) => {
            clearTimeout(timer);
            captures.current.delete(screen.id);
            reject(error);
          },
        });
        win.postMessage({ type: 'capture' }, '*');
      });
      downloadDataUrl(url, `${slug(screen.name)}.png`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'PNG export failed');
    }
  };
  const exportZip = async () => {
    setExporting(true);
    setExportOpen(false);
    try {
      await downloadProjectZip(projectId, project?.name ?? 'design');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };
  const attach = async (file?: File) => {
    if (!file) return;
    try {
      setImage(await readImageFile(file));
      setScope('add');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not attach reference');
    }
  };
  const setCanvasMode = (next: CanvasMode) => {
    if (next !== 'canvas' && !activeScreen?.html) {
      const first = screens.find((s) => s.html);
      if (first) setActiveId(first.id);
    }
    setMode(next);
  };

  if (loadError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <DesignMark size={32} />
        <h1 className="design-heading text-3xl">Couldn’t open this design</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {loadError}
        </p>
        <div className="flex gap-4">
          <Link href="/design" className="rounded-lg border border-border px-4 py-2 text-sm">
            All designs
          </Link>
          <button
            onClick={() => setReload((n) => n + 1)}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );

  const placeholder =
    scope === 'add'
      ? screens.length
        ? 'Describe a screen to add…'
        : 'Describe your idea…'
      : scope === 'project'
        ? 'What should change across your design?'
        : selection
          ? `What should change in this ${selection.tag}?`
          : `How should ${activeScreen?.name ?? 'this screen'} change?`;
  const progressLabel = operation;
  const previewScale = clamp((viewportSize.width - 32) / previewWidth, 0.1, 1);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-5">
        <Link
          href="/design"
          className="design-icon-button"
          aria-label="All designs"
          title="All designs"
        >
          <ArrowLeft size={18} />
        </Link>
        <button
          onClick={() => setChatOpen((open) => !open)}
          className="design-icon-button md:hidden"
          aria-label={chatOpen ? 'Hide mobile conversation' : 'Show mobile conversation'}
          aria-expanded={chatOpen}
        >
          <MessageSquare size={17} />
        </button>
        <span className="hidden text-primary sm:block">
          <DesignMark size={22} />
        </span>
        <ChevronRight size={13} className="hidden text-muted-foreground sm:block" />
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setNameDraft(project?.name ?? '');
              e.currentTarget.blur();
            }
          }}
          disabled={loading || busy || !canEdit}
          maxLength={80}
          aria-label="Project name"
          placeholder="Loading design…"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 text-sm font-medium sm:max-w-[280px]"
        />
        <span
          role="status"
          className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex"
        >
          {busy || savingTheme ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {savingTheme ? 'Saving theme' : 'Working'}
            </>
          ) : (
            <>
              <Check size={13} />
              Saved
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              setShowTools((value) => !value);
              setPanel(null);
            }}
            className="design-icon-button"
            aria-label="Project tools"
            title="Brands, sources, comments, sharing and exports"
            aria-pressed={showTools}
          >
            <Wrench size={17} />
          </button>
          <button
            onClick={() => historyStep(false)}
            disabled={!activeScreen?.version_id || busy || !canEdit}
            className="design-icon-button hidden sm:flex"
            aria-label="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            onClick={() => historyStep(true)}
            disabled={!activeScreen?.version_id || busy || !canEdit}
            className="design-icon-button hidden sm:flex"
            aria-label="Redo"
          >
            <Redo2 size={17} />
          </button>
          {builtCount > 0 && (
            <button
              onClick={() => {
                setPresenting(true);
                setMode('preview');
              }}
              className="design-icon-button"
              aria-label="Present artboards"
            >
              <Presentation size={17} />
            </button>
          )}
          <AppearanceButton />
          <button
            onClick={() => setPanel((p) => (p === 'theme' ? null : 'theme'))}
            className="design-icon-button"
            aria-label="Design system"
            aria-pressed={panel === 'theme'}
            title="Design system"
          >
            <Palette size={17} />
          </button>
          <button
            onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))}
            className="design-icon-button hidden sm:flex"
            aria-label="Version history"
            aria-pressed={panel === 'history'}
            title="Version history"
          >
            <History size={17} />
          </button>
          {mode === 'preview' && canEdit && (
            <label className="hidden min-h-10 items-center gap-2 px-2 text-xs sm:flex">
              <input
                type="checkbox"
                checked={aiDemo}
                onChange={(event) => setAiDemo(event.target.checked)}
              />
              AI demo
            </label>
          )}
          <div ref={exportRef} className="relative">
            <button
              disabled={!builtCount || busy || savingTheme || exporting}
              onClick={() => setExportOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="ml-2 flex min-h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium disabled:opacity-40"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="hidden sm:inline">Export</span>
              <ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div
                role="menu"
                className="design-popover absolute right-0 top-11 z-50 w-60 rounded-xl border border-border bg-card p-1.5"
              >
                <p className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Take your work with you
                </p>
                <button
                  role="menuitem"
                  onClick={exportZip}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-muted"
                >
                  <FolderArchive size={15} />
                  <div>
                    All screens (.zip)
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      HTML files and design tokens
                    </p>
                  </div>
                </button>
                {(['pdf', 'pptx', 'handoff'] as const).map((format) => (
                  <button
                    key={format}
                    role="menuitem"
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      setExportOpen(false);
                      task('Exporting ' + format, () => downloadDesign(projectId, format));
                    }}
                  >
                    <Download size={15} />
                    {format === 'handoff'
                      ? 'Coding handoff (.zip)'
                      : format === 'pptx'
                        ? 'PowerPoint (.pptx)'
                        : 'Document (.pdf)'}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  role="menuitem"
                  disabled={!activeScreen?.html}
                  onClick={() => {
                    if (activeScreen) exportHtml(activeScreen);
                    setExportOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-muted disabled:opacity-40"
                >
                  <FileCode2 size={15} />
                  Selected screen (.html)
                </button>
                <button
                  role="menuitem"
                  disabled={!activeScreen?.html || mode === 'code'}
                  onClick={() => {
                    if (activeScreen) exportPng(activeScreen);
                    setExportOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-muted disabled:opacity-40"
                >
                  <Download size={15} />
                  Selected screen (.png)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {chatOpen && (
          <aside
            className="absolute inset-y-0 left-0 z-20 flex w-[320px] max-w-[90vw] shrink-0 flex-col border-r border-border bg-background shadow-xl md:static md:w-[310px] md:shadow-none xl:w-[340px]"
            aria-label="Design conversation"
          >
            <div
              className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4"
              role="tablist"
              aria-label="Workspace sidebar"
            >
              <button
                role="tab"
                aria-selected={sideTab === 'chat'}
                onClick={() => setSideTab('chat')}
                className={`flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs ${sideTab === 'chat' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                <MessageSquare size={14} />
                Conversation
              </button>
              <button
                role="tab"
                aria-selected={sideTab === 'screens'}
                onClick={() => setSideTab('screens')}
                className={`flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs ${sideTab === 'screens' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                <LayoutGrid size={14} />
                Screens <span className="text-[10px]">{screens.length}</span>
              </button>
              <button
                onClick={() => setChatOpen(false)}
                aria-label="Hide conversation"
                className="design-icon-button ml-auto !size-7"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            {sideTab === 'chat' ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6" role="tabpanel">
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                    <span className="text-primary">
                      <DesignMark size={18} />
                    </span>
                    Pragna Design
                  </div>
                  <p className="text-sm leading-6">
                    A space to turn your idea into something you can see, shape, and share.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Describe changes here, select an element for a precise edit, or explore your
                    screens in Preview.
                  </p>
                </div>
                <div className="space-y-5">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`design-message ${message.role === 'user' ? 'ml-3 rounded-xl bg-muted px-4 py-3' : 'pr-1'}`}
                    >
                      {message.role === 'user' && message.author_name && (
                        <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                          {message.author_name}
                        </p>
                      )}
                      {message.role === 'assistant' && (
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                          <span className="text-primary">
                            <DesignMark size={14} />
                          </span>
                          Pragna
                        </div>
                      )}
                      {message.role === 'assistant' ? (
                        <div className="design-response break-words text-xs leading-[1.85]">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-xs leading-[1.85]">
                          {message.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {busy && (
                  <div className="mt-5 rounded-xl border border-border bg-card p-4" role="status">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Loader2 size={14} className="animate-spin text-primary" />
                      <span>{progressLabel}</span>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                      {generating
                        ? 'Explore the first draft while Pragna checks interactions and refines the final design.'
                        : 'Your existing design stays visible while this change runs.'}
                    </p>
                    {generating && <GenerationSteps stage={generationStage} />}
                    <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {generating ? `${builtCount} screens on canvas` : 'Saving a new version'}
                      </span>
                      <span className="tabular-nums">
                        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                      </span>
                    </div>
                    {generating && (
                      <button
                        onClick={() => {
                          setStopping(true);
                          abortRef.current?.abort();
                        }}
                        disabled={stopping}
                        className="mt-3 flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs disabled:opacity-40"
                      >
                        <Square size={10} />
                        {stopping ? 'Stopping…' : 'Stop generation'}
                      </button>
                    )}
                  </div>
                )}
                <DesignDirection brief={designBrief} direction={direction} />
                {activeScreen?.html && (
                  <DesignChecks
                    quality={activeScreen.quality}
                    runtimeErrors={runtimeErrors[activeScreen.id] ?? []}
                    busy={busy || savingTheme}
                    onRepair={repairIssues}
                  />
                )}
                <div ref={chatEnd} />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
                <p className="mb-4 text-xs text-muted-foreground">
                  {screens.length} screens · {builtCount} ready
                </p>
                <div className="space-y-2">
                  {screens.map((screen, i) => (
                    <button
                      key={screen.id}
                      onClick={() => {
                        activate(screen, true);
                        if (window.innerWidth < 768) setChatOpen(false);
                      }}
                      aria-pressed={activeId === screen.id}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left ${activeId === screen.id ? 'border-gold-500/40 bg-[var(--design-selected)]' : 'border-border bg-card hover:bg-muted'}`}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                        {building.has(screen.id) ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          String(i + 1).padStart(2, '0')
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{screen.name}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {building.has(screen.id)
                            ? 'Building'
                            : screen.html
                              ? 'Ready to refine'
                              : errors[screen.id]
                                ? 'Needs a retry'
                                : 'Not built yet'}
                        </p>
                      </div>
                      <ChevronRight size={13} className="ml-auto shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    setScope('add');
                    setSideTab('chat');
                    promptRef.current?.focus();
                  }}
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <Plus size={14} />
                  Add a screen
                </button>
              </div>
            )}
            <div className="shrink-0 border-t border-border p-3">
              <label className="mb-2 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                Apply to
                <select
                  value={scope}
                  disabled={busy || savingTheme || !canEdit}
                  onChange={(e) => {
                    setScope(e.target.value as Scope);
                    clearSelection();
                  }}
                  aria-label="Edit scope"
                  className="min-w-0 flex-1 rounded-md border-0 bg-transparent py-1 text-xs font-medium text-foreground"
                >
                  <option value="add">{screens.length ? 'A new screen' : 'New design'}</option>
                  <option value="screen" disabled={!activeScreen?.body}>
                    {screens.length === 1
                      ? 'Current design'
                      : `Selected screen${activeScreen ? ` · ${activeScreen.name}` : ''}`}
                  </option>
                  {screens.length > 1 && (
                    <option value="project" disabled={!editableScreens.length}>
                      Entire design
                    </option>
                  )}
                </select>
              </label>
              {selection && scope === 'screen' && (
                <div className="mb-2 flex items-center gap-1.5 rounded-md bg-[var(--design-selected)] px-2 py-1.5 text-[10px]">
                  <MousePointer2 size={12} />
                  <span className="truncate">
                    &lt;{selection.tag}&gt; · {activeScreen?.name}
                  </span>
                  <button
                    onClick={clearSelection}
                    className="ml-auto rounded p-1"
                    aria-label="Clear element selection"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {image && scope === 'add' && (
                <div className="relative mb-2 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt="Design reference"
                    className="h-16 rounded-lg border border-border"
                  />
                  <button
                    onClick={() => setImage(null)}
                    aria-label="Remove reference"
                    className="absolute -right-1 -top-1 rounded-full border border-border bg-card p-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="design-composer rounded-xl border border-border bg-card p-2.5">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  onPaste={(e) => {
                    if (scope === 'add') {
                      const file = Array.from(e.clipboardData.files).find((f) =>
                        f.type.startsWith('image/')
                      );
                      if (file) {
                        e.preventDefault();
                        attach(file);
                      }
                    }
                  }}
                  rows={3}
                  maxLength={scope === 'add' ? 4000 : 2000}
                  placeholder={placeholder}
                  aria-label="Design prompt"
                  className="max-h-40 min-h-20 w-full resize-none bg-transparent px-1 text-xs leading-6 placeholder:text-muted-foreground focus-visible:!outline-none"
                />
                <div className="mt-1 flex items-center">
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
                  {scope === 'add' ? (
                    <button
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                      className="design-icon-button !size-8"
                      aria-label="Attach reference image"
                    >
                      <ImagePlus size={16} />
                    </button>
                  ) : (
                    <span className="pl-1 text-[10px] text-muted-foreground">
                      Shift + Enter for a new line
                    </span>
                  )}
                  <button
                    disabled={
                      loading ||
                      busy ||
                      savingTheme ||
                      !canEdit ||
                      (!prompt.trim() && !(image && scope === 'add')) ||
                      (scope === 'screen' && !activeScreen?.body)
                    }
                    onClick={submit}
                    aria-label="Send design request"
                    className="ml-auto flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </div>
              {scope === 'add' && (
                <>
                  <label className="mt-2 flex min-h-9 items-center gap-2 px-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={extraPolish}
                      disabled={busy}
                      onChange={(event) => setExtraPolish(event.target.checked)}
                    />
                    Extra design polish (takes longer)
                  </label>
                  <label className="mt-2 flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                    Design directions
                    <select
                      aria-label="Design directions"
                      disabled={busy || !!image || project?.kind === 'presentation' || !canEdit}
                      value={variants}
                      onChange={(event) => setVariants(Number(event.target.value))}
                      className="min-h-9 rounded-md border border-border bg-card px-2"
                    >
                      <option value={1}>1 · fastest</option>
                      <option value={2}>2 alternatives</option>
                      <option value={3}>3 alternatives</option>
                    </select>
                  </label>
                </>
              )}
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                {scope === 'add'
                  ? screens.length
                    ? 'Build another screen from your brief'
                    : 'Build one complete design from your brief'
                  : scope === 'project'
                    ? 'Changes apply to every completed screen'
                    : screens.length === 1
                      ? 'Refine your design with each message'
                      : 'Changes apply only to your selected screen'}
              </p>
            </div>
          </aside>
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3">
            {!chatOpen && (
              <button
                onClick={() => setChatOpen(true)}
                aria-label="Show conversation"
                className="design-icon-button"
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <div className="flex gap-0.5 rounded-lg bg-muted p-0.5" aria-label="Workspace view">
              {(
                [
                  { value: 'canvas', label: 'Canvas', Icon: LayoutGrid },
                  { value: 'preview', label: 'Preview', Icon: Monitor },
                  { value: 'code', label: 'Code', Icon: Code2 },
                ] as const
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setCanvasMode(value)}
                  aria-pressed={mode === value}
                  disabled={
                    (value === 'preview' && !screens.some((screen) => screen.html)) ||
                    (value === 'code' && !builtCount)
                  }
                  className={`flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs disabled:opacity-40 ${mode === value ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                >
                  <Icon size={13} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {mode === 'canvas' ? (
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  className="design-icon-button !size-8"
                  onClick={() => setTool('select')}
                  aria-label="Select elements"
                  aria-pressed={tool === 'select'}
                  title="Select elements (V)"
                >
                  <MousePointer2 size={16} />
                </button>
                <button
                  className="design-icon-button !size-8"
                  onClick={() => setTool('hand')}
                  aria-label="Pan canvas"
                  aria-pressed={tool === 'hand'}
                  title="Pan canvas (H)"
                >
                  <Hand size={16} />
                </button>
                <span className="mx-1 h-5 border-r border-border" />
                <button
                  className="design-icon-button !size-8"
                  onClick={() => setPanel((p) => (p === 'inspect' ? null : 'inspect'))}
                  aria-label="Inspect selected element"
                  aria-pressed={panel === 'inspect'}
                  title="Inspect"
                >
                  <Type size={16} />
                </button>
              </div>
            ) : (
              <div className="ml-auto flex items-center gap-2">
                {screens.filter((screen) => screen.html).length > 1 && (
                  <select
                    aria-label="Preview screen"
                    value={activeId ?? ''}
                    onChange={(e) => {
                      setActiveId(Number(e.target.value));
                      clearSelection();
                    }}
                    className="max-w-36 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                  >
                    {screens
                      .filter((s) => s.html)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                )}
                {mode === 'preview' && (
                  <div className="flex items-center gap-0.5">
                    {(
                      [
                        { width: 1280, label: 'Desktop preview', Icon: Monitor },
                        { width: 768, label: 'Tablet preview', Icon: Tablet },
                        { width: 390, label: 'Mobile preview', Icon: Smartphone },
                      ] as const
                    ).map(({ width, label, Icon }) => (
                      <button
                        key={width}
                        className="design-icon-button !size-8"
                        aria-label={label}
                        aria-pressed={previewWidth === width}
                        onClick={() => setPreviewWidth(width)}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div
            ref={viewportRef}
            data-pan="1"
            onPointerDown={(e) => {
              if (mode !== 'canvas' || !(e.target as HTMLElement).dataset.pan) return;
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const dx = e.clientX - drag.current.x,
                dy = e.clientY - drag.current.y;
              drag.current = { x: e.clientX, y: e.clientY };
              setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            className={`relative min-h-0 flex-1 overflow-hidden ${mode === 'canvas' ? 'design-canvas touch-none' : 'bg-background'}`}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={18} className="animate-spin" />
                Opening your workspace…
              </div>
            ) : mode === 'canvas' ? (
              <>
                <div
                  data-pan="1"
                  className="absolute left-0 top-0"
                  style={{
                    transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
                    transformOrigin: '0 0',
                  }}
                >
                  {screens.map((screen, i) => (
                    <div
                      key={screen.id}
                      className="absolute"
                      style={{
                        left: screen.layout?.x ?? (i % COLUMNS[device]) * (baseFrame.width + GAP),
                        top:
                          screen.layout?.y ??
                          Math.floor(i / COLUMNS[device]) * (baseFrame.height + FRAME_HEADER + GAP),
                      }}
                    >
                      <ScreenFrame
                        screen={screen}
                        width={screen.layout?.width || baseFrame.width}
                        height={screen.layout?.height || baseFrame.height}
                        background={project?.theme.background ?? 'transparent'}
                        building={building.has(screen.id)}
                        error={errors[screen.id]}
                        active={activeId === screen.id}
                        busy={busy || savingTheme || !canEdit}
                        registerFrame={registerFrame}
                        onReady={sendMode}
                        onActivate={() => activate(screen)}
                        onRetry={() => retry(screen)}
                        onExportHtml={() => exportHtml(screen)}
                        onExportPng={() => exportPng(screen)}
                        onHistory={() => {
                          activate(screen);
                          setPanel('history');
                        }}
                        onDelete={() => removeScreen(screen)}
                      />
                      {tool === 'hand' && (
                        <div
                          data-pan="1"
                          className="absolute inset-x-0 bottom-0 cursor-grab active:cursor-grabbing"
                          style={{ height: frame.height }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {!screens.length && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                    <span className="mb-5 text-muted-foreground">
                      <LayoutGrid size={38} strokeWidth={1} />
                    </span>
                    <h2 className="design-heading text-3xl">A blank canvas. A good beginning.</h2>
                    <p className="mt-3 max-w-sm text-xs leading-6 text-muted-foreground">
                      {generating
                        ? 'Pragna is planning your screens. They’ll take shape here.'
                        : 'Tell Pragna what you have in mind. Your screens will appear here, ready to refine.'}
                    </p>
                  </div>
                )}
                <div className="absolute bottom-4 left-4 flex items-center rounded-xl border border-border bg-card p-0.5 shadow-sm">
                  <button
                    onClick={() => zoomBy(1 / 1.25)}
                    className="design-icon-button !size-8"
                    aria-label="Zoom out"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-11 text-center text-[11px] tabular-nums">
                    {Math.round(view.scale * 100)}%
                  </span>
                  <button
                    onClick={() => zoomBy(1.25)}
                    className="design-icon-button !size-8"
                    aria-label="Zoom in"
                  >
                    <Plus size={14} />
                  </button>
                  <span className="mx-1 h-4 border-l border-border" />
                  <button
                    onClick={() => fitView(screens.length, device)}
                    className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] hover:bg-muted"
                    title="Fit all screens (0)"
                  >
                    <Maximize2 size={13} />
                    Fit
                  </button>
                  {activeScreen && (
                    <button
                      onClick={() => focusScreen(activeScreen)}
                      className="hidden min-h-8 rounded-lg px-2 text-[11px] hover:bg-muted xl:block"
                    >
                      Focus screen
                    </button>
                  )}
                </div>
                <div className="pointer-events-none absolute bottom-5 right-5 hidden text-[10px] text-muted-foreground xl:block">
                  {tool === 'hand' ? 'Drag to pan' : 'Click to select'} · Ctrl / ⌘ + scroll to zoom
                </div>
              </>
            ) : mode === 'preview' && activeScreen?.html ? (
              <>
                {!!runtimeErrors[activeScreen.id]?.length && (
                  <div
                    role="alert"
                    className="absolute inset-x-4 top-4 z-10 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-card px-4 py-3 shadow-lg"
                  >
                    <p className="flex-1 text-xs">
                      This prototype has a script error. Pragna can repair it.
                    </p>
                    <button
                      disabled={busy || savingTheme || !canEdit}
                      onClick={() =>
                        repairIssues(
                          (runtimeErrors[activeScreen.id] ?? []).map((message) => ({
                            code: 'runtime_error',
                            message,
                            severity: 'error',
                          }))
                        )
                      }
                      className="min-h-10 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
                    >
                      Repair
                    </button>
                  </div>
                )}
                <div className="absolute inset-0 overflow-auto">
                  <div
                    className="relative mx-auto my-4"
                    style={{
                      width: previewWidth * previewScale,
                      height: frame.height * previewScale,
                    }}
                  >
                    <iframe
                      key={activeScreen.id}
                      ref={(el) => registerFrame(activeScreen.id, el)}
                      onLoad={() => sendMode(activeScreen.id)}
                      title={`${activeScreen.name} interactive preview`}
                      srcDoc={activeScreen.html}
                      sandbox="allow-scripts allow-forms"
                      className="absolute left-0 top-0 rounded-lg border border-border bg-card shadow-xl"
                      style={{
                        width: previewWidth,
                        height: frame.height,
                        transform: `scale(${Math.max(0.1, previewScale)})`,
                        transformOrigin: 'top left',
                      }}
                    />
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[10px] text-muted-foreground">
                  {previewWidth}px viewport · Scroll and interact with your design
                </div>
              </>
            ) : mode === 'code' && activeScreen ? (
              <div className="flex h-full flex-col bg-card">
                <div className="flex min-h-12 items-center justify-between border-b border-border px-5 text-xs">
                  <span className="font-mono text-muted-foreground">
                    {slug(activeScreen.name)}.html
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(activeScreen.body ?? '');
                        toast.success('HTML copied');
                      } catch {
                        toast.error('Could not copy HTML');
                      }
                    }}
                    className="rounded-md border border-border px-3 py-1.5"
                  >
                    Copy HTML
                  </button>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto p-5 text-xs leading-6">
                  <code>{activeScreen.body}</code>
                </pre>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Choose a completed screen to preview.
              </div>
            )}
          </div>
        </div>
        {showTools && project && (
          <ProjectTools
            project={project}
            screens={screens}
            screen={activeScreen}
            selection={selection}
            busy={busy || savingTheme}
            onClose={() => setShowTools(false)}
            onSelect={selectLayer}
            onTask={task}
            onCommentEdit={applyComment}
            onExplore={() => {
              if (activeScreen)
                runGenerate(
                  `Create an alternative design direction for ${activeScreen.name}. Preserve its purpose and content, use a distinct composition. Current content: ${activeScreen.body?.replace(/<[^>]+>/g, ' ').slice(0, 2500)}`,
                  undefined,
                  true
                );
            }}
            onFork={(id) => router.push(`/design/${id}`)}
          />
        )}
        {panel && project && !showTools && (
          <SidePanel
            tab={panel}
            onTab={setPanel}
            onClose={() => setPanel(null)}
            theme={project.theme}
            onTheme={changeTheme}
            screen={activeScreen}
            historyKey={historyKey}
            onRestore={restore}
            selection={selection}
            onText={updateText}
            onCanvas={canvasAction}
            onStylePreview={stylePreview}
            busy={busy || !canEdit}
            savingTheme={savingTheme}
          />
        )}
      </div>
      {guides && mode === 'canvas' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            backgroundImage:
              'linear-gradient(to right, transparent 49.9%, #b9945644 50%, transparent 50.1%), linear-gradient(to bottom, transparent 49.9%, #b9945644 50%, transparent 50.1%)',
          }}
        />
      )}
      {presenting && activeScreen?.html && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Presentation"
          className="fixed inset-0 z-[100] flex flex-col bg-background"
        >
          <div className="flex min-h-14 items-center gap-3 border-b border-border px-4">
            <span className="flex-1 text-sm">
              {activeScreen.name} · {screens.findIndex((s) => s.id === activeId) + 1} /{' '}
              {screens.length}
            </span>
            <button
              onClick={() =>
                setActiveId(
                  screens[Math.max(0, screens.findIndex((s) => s.id === activeId) - 1)].id
                )
              }
              className="design-icon-button"
              aria-label="Previous artboard"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              onClick={() =>
                setActiveId(
                  screens[
                    Math.min(screens.length - 1, screens.findIndex((s) => s.id === activeId) + 1)
                  ].id
                )
              }
              className="design-icon-button"
              aria-label="Next artboard"
            >
              <ChevronRight size={18} />
            </button>
            <button
              autoFocus
              onClick={() => setPresenting(false)}
              className="design-icon-button"
              aria-label="Close presentation"
            >
              <X size={18} />
            </button>
          </div>
          <iframe
            ref={presentationFrame}
            title={activeScreen.name + ' presentation'}
            srcDoc={activeScreen.html}
            onLoad={(event) =>
              event.currentTarget.contentWindow?.postMessage({ type: 'mode', mode: 'preview' }, '*')
            }
            sandbox="allow-scripts allow-forms"
            className="min-h-0 w-full flex-1 border-0"
          />
        </div>
      )}
    </div>
  );
}

function zoomAround(view: View, x: number, y: number, nextScale: number): View {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE),
    factor = scale / view.scale;
  return { scale, x: x - (x - view.x) * factor, y: y - (y - view.y) * factor };
}
