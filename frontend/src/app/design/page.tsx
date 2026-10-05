'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Monitor, Palette, Search, Smartphone, Sparkles, Trash2, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import {
  DEVICE_FRAME,
  DesignDevice,
  DesignProject,
  designApi,
  readImageFile,
  setPendingStart,
} from '@/lib/design';

const EXAMPLES = [
  'A food delivery app: home, restaurant menu, cart and checkout',
  'A SaaS landing page for an AI note-taking tool',
  'A fitness tracker with a dashboard and workout log',
  'A banking app with accounts, transfers and spending insights',
];

const NEW_OPTIONS: { device: DesignDevice; label: string; Icon: typeof Smartphone }[] = [
  { device: 'mobile', label: 'Mobile app', Icon: Smartphone },
  { device: 'web', label: 'Website', Icon: Monitor },
];

/** Static, scaled-down render of a project's first screen. Web frames fit by width, mobile by height. */
function Thumbnail({ project }: { project: DesignProject }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = DEVICE_FRAME[project.device];
  const scale = size ? (project.device === 'mobile' ? size.h / frame.height : size.w / frame.width) : 0;

  return (
    <div ref={boxRef} className="relative h-40 overflow-hidden bg-muted">
      {project.preview_html && size ? (
        <iframe
          title={`${project.name} preview`}
          sandbox="allow-scripts"
          srcDoc={project.preview_html}
          tabIndex={-1}
          aria-hidden
          style={{
            width: frame.width,
            height: frame.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            marginLeft: project.device === 'mobile' ? (size.w - frame.width * scale) / 2 : 0,
          }}
          className="pointer-events-none block border-0 bg-white"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground/50">
          <Palette size={28} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur">
        <Palette size={14} />
      </span>
    </div>
  );
}

export default function DesignHomePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<DesignDevice | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<DesignProject[] | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    designApi
      .listProjects()
      .then(setProjects)
      .catch((err) => {
        setProjects([]);
        toast.error(err instanceof Error ? err.message : 'Could not load your projects');
      });
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (device) promptRef.current?.focus();
  }, [device]);

  const canCreate = device && (prompt.trim().length > 0 || image) && !creating;

  const create = async () => {
    if (!device || !canCreate) return;
    setCreating(true);
    try {
      const { project } = await designApi.createProject(device);
      setPendingStart({ projectId: project.id, prompt: prompt.trim(), image: image ?? undefined });
      router.push(`/design/${project.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the project');
      setCreating(false);
    }
  };

  const attach = async (file?: File) => {
    if (!file) return;
    try {
      setImage(await readImageFile(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not attach that image');
    }
  };

  const remove = async (project: DesignProject) => {
    try {
      await designApi.deleteProject(project.id);
      setProjects((prev) => (prev ? prev.filter((p) => p.id !== project.id) : prev));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the project');
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = projects?.filter((p) => p.name.toLowerCase().includes(needle));

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-semibold text-foreground">Design</h1>
            <label className="relative ml-auto w-full max-w-60">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search designs"
                aria-label="Search designs"
                className="w-full rounded-lg border border-border bg-transparent py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
              />
            </label>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe an app or website. Get linked screens you can refine by chatting or clicking any element.
          </p>

          <h2 className="mt-8 mb-3 text-sm text-muted-foreground">Make something new</h2>
          <div className="flex flex-wrap gap-4">
            {NEW_OPTIONS.map(({ device: d, label, Icon }) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                className="group w-36 text-left"
              >
                <div
                  className={`flex h-24 items-center justify-center rounded-xl border bg-card text-muted-foreground transition-colors group-hover:text-foreground ${
                    device === d ? 'border-primary text-foreground ring-2 ring-primary/30' : 'border-border group-hover:border-primary/50'
                  }`}
                >
                  <Icon size={32} />
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">{label}</div>
              </button>
            ))}
          </div>

          {device && (
            <div className="mt-5 rounded-2xl border border-border bg-card p-3">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create();
                }}
                rows={3}
                maxLength={4000}
                placeholder={device === 'mobile' ? 'What mobile app do you want to design?' : 'What website do you want to design?'}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                aria-label="Design brief"
              />
              {image && (
                <div className="relative mt-2 ml-2 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="Reference" className="h-16 rounded-lg border border-border object-cover" />
                  <button
                    onClick={() => setImage(null)}
                    className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-card border border-border text-muted-foreground hover:text-foreground"
                    aria-label="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
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
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <ImagePlus size={14} /> Design from image
                </button>
                <button
                  onClick={create}
                  disabled={!canCreate}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40 transition-opacity"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Design it
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setPrompt(example)}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10">
            {visible === undefined ? (
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            ) : projects?.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Your first design will show up here.</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No designs match “{query.trim()}”.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((project) => (
                  <li key={project.id} className="group relative">
                    <button
                      onClick={() => router.push(`/design/${project.id}`)}
                      className="block w-full overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50"
                    >
                      <Thumbnail project={project} />
                      <div className="px-4 py-3">
                        <div className="truncate text-sm font-medium text-foreground">{project.name}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {project.device === 'mobile' ? <Smartphone size={12} /> : <Monitor size={12} />}
                          <span>Edited {new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => remove(project)}
                      className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Delete ${project.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
