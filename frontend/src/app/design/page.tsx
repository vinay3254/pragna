'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowRight,
  Check,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  DEVICE_FRAME,
  DesignDevice,
  DesignProject,
  designApi,
  setPendingStart,
} from '@/lib/design';
import BriefComposer from './components/BriefComposer';
import { AppearanceButton, BackToPragna, DesignBrand, DesignMark } from './components/DesignChrome';

const STARTERS = [
  {
    name: 'A place for your product',
    type: 'Landing page',
    device: 'web' as const,
    kind: 'landing',
    prompt:
      'Design a refined landing page for a creative project management tool called Forma. Warm neutral colors, editorial typography, product showcase, features, customer stories and pricing.',
  },
  {
    name: 'Make the numbers clear',
    type: 'Dashboard',
    device: 'web' as const,
    kind: 'dashboard',
    prompt:
      'Design one interactive SaaS analytics dashboard with local navigation between overview, revenue analytics and customer details. Include readable charts, date filters, meaningful metrics and a calm, minimal visual style.',
  },
  {
    name: 'A little everyday better',
    type: 'Mobile app',
    device: 'mobile' as const,
    kind: 'mobile',
    prompt:
      'Design one interactive mindful habit-tracking mobile app called Daylight. Use local tabs and detail panels for daily overview, habit details and weekly progress. Use soft sage, warm ivory, friendly typography and thoughtful empty states.',
  },
];

function StarterPreview({ kind }: { kind: string }) {
  if (kind === 'landing')
    return (
      <div className="h-36 overflow-hidden bg-secondary p-5 text-foreground" aria-hidden>
        <div className="flex justify-between text-[8px]">
          <b>forma.</b>
          <span>Product &nbsp; Stories &nbsp; About</span>
        </div>
        <div className="mt-4 flex gap-5">
          <div className="w-3/5">
            <div className="font-medium text-[25px] leading-[1.08] tracking-tight">
              Good work.
              <br />A little more human.
            </div>
            <div className="mt-3 h-1 w-24 bg-border" />
            <div className="mt-1 h-1 w-20 bg-border" />
            <div className="mt-3 h-4 w-14 rounded bg-primary" />
          </div>
          <div className="mt-1 flex w-2/5 items-end gap-1 rounded-t-[45px] bg-muted px-3 pt-6">
            <div className="h-16 flex-1 rounded-t bg-[var(--pragna-gold-soft)]" />
            <div className="h-10 flex-1 rounded-t bg-card" />
            <div className="h-20 flex-1 rounded-t bg-[var(--pragna-gold-deep)]" />
          </div>
        </div>
      </div>
    );
  if (kind === 'dashboard')
    return (
      <div className="flex h-36 overflow-hidden bg-secondary p-4" aria-hidden>
        <div className="w-12 rounded-l-md border-r border-border bg-card p-2">
          <div className="mb-3 size-3 rounded bg-primary" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-2 h-1 w-7 bg-muted" />
          ))}
        </div>
        <div className="flex-1 rounded-r-md bg-card p-3">
          <div className="mb-3 text-[9px] font-semibold text-foreground">
            Your business, at a glance
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['$24,830', '1,428', '8.4%'].map((v) => (
              <div
                key={v}
                className="rounded border border-border p-2 text-[10px] font-semibold text-foreground"
              >
                {v}
                <div className="mt-1 h-1 w-6 bg-muted" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex h-10 items-end gap-1">
            {[20, 35, 26, 44, 32, 55, 48, 70, 55, 80, 68, 95].map((h, i) => (
              <div
                key={i}
                style={{ height: `${h}%` }}
                className="flex-1 rounded-t-sm bg-primary"
              />
            ))}
          </div>
        </div>
      </div>
    );
  return (
    <div
      className="flex h-36 items-start justify-center gap-3 overflow-hidden bg-secondary pt-4"
      aria-hidden
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          className={`w-24 rounded-[15px] border-[3px] border-border bg-card p-2 text-foreground ${i ? 'mt-5 rotate-[5deg]' : '-rotate-[5deg]'}`}
        >
          <div className="mx-auto mb-3 h-1 w-6 rounded bg-border" />
          <div className="font-medium text-sm">{i ? 'Small steps.' : 'Hello, Maya.'}</div>
          <div className="mt-2 text-[6px]">
            {i ? 'A week of showing up' : 'Make room for what matters'}
          </div>
          <div className="mx-auto my-3 flex size-12 items-center justify-center rounded-full border-[5px] border-primary text-[11px]">
            {i ? '5 / 7' : '68%'}
          </div>
          <div className="mb-2 h-5 rounded bg-muted" />
          <div className="h-5 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/** Mount only visible previews. Offscreen projects never execute Tailwind or load their images. */
function Thumbnail({ project }: { project: DesignProject }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [html, setHtml] = useState<string | null>(project.preview_html ?? null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '0px',
    });
    const resize = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    resize.observe(el);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!visible || html || !project.has_preview) return;
    let cancelled = false;
    designApi
      .getPreview(project.id)
      .then((preview) => {
        if (!cancelled) setHtml(preview.html);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, html, project.id, project.has_preview]);
  const frame = DEVICE_FRAME[project.device];
  const scale = project.device === 'mobile' ? 184 / frame.height : width / frame.width;
  return (
    <div ref={box} className="relative h-[184px] overflow-hidden bg-muted">
      {visible && width > 0 && html ? (
        <iframe
          title={`${project.name} preview`}
          sandbox="allow-scripts"
          srcDoc={html}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute border-0"
          style={{
            width: frame.width,
            height: frame.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            left: project.device === 'mobile' ? (width - frame.width * scale) / 2 : 0,
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <DesignMark size={30} />
        </div>
      )}
      <div className="absolute inset-0" />
    </div>
  );
}

export default function DesignHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const briefSection = useRef<HTMLDivElement>(null);
  const projectsSection = useRef<HTMLElement>(null);
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<DesignDevice>('web');
  const [image, setImage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<DesignProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | DesignDevice>('all');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    designApi
      .listProjects()
      .then(setProjects)
      .catch((error) =>
        setLoadError(error instanceof Error ? error.message : 'Could not load projects')
      );
  }, []);
  useEffect(load, [load]);
  const create = async () => {
    if (creating || (!prompt.trim() && !image)) return;
    setCreating(true);
    try {
      const { project } = await designApi.createProject(device);
      setPendingStart({ projectId: project.id, prompt: prompt.trim(), image: image ?? undefined });
      router.push(`/design/${project.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create design');
      setCreating(false);
    }
  };
  const remove = async (project: DesignProject) => {
    setDeleting(project.id);
    try {
      await designApi.deleteProject(project.id);
      setProjects((prev) => prev?.filter((p) => p.id !== project.id) ?? null);
      setConfirmDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete design');
    } finally {
      setDeleting(null);
    }
  };
  const visible = projects?.filter(
    (p) =>
      p.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || p.device === filter)
  );
  const newDesign = () => {
    setPrompt('');
    setImage(null);
    briefSection.current?.scrollIntoView({ behavior: 'smooth' });
    briefSection.current?.querySelector('textarea')?.focus();
  };

  return (
    <div className="flex h-full">
      <aside
        className="design-home-sidebar hidden w-[252px] shrink-0 flex-col border-r border-sidebar-border bg-[var(--design-sidebar)] lg:flex"
        aria-label="Design navigation"
      >
        <div className="shrink-0 px-4 pb-5 pt-5">
          <Link href="/design" className="mb-6 flex min-h-9 items-center rounded-md px-1">
            <DesignBrand size={34} />
          </Link>
          <button
            onClick={newDesign}
            className="design-sidebar-create flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[var(--pragna-gold-soft)]"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            New design
          </button>
          <button
            onClick={() => projectsSection.current?.scrollIntoView({ behavior: 'smooth' })}
            className="mt-3 flex min-h-10 w-full items-center gap-2.5 rounded-[10px] bg-[var(--design-selected)] px-3 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            <FolderOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            Your projects
            <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
              {projects?.length ?? '—'}
            </span>
          </button>
        </div>
        <nav aria-label="Recent projects" className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <p className="mb-2 px-3 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
            Recent projects
          </p>
          <div className="space-y-0.5">
            {projects?.slice(0, 8).map((p) => (
              <Link
                key={p.id}
                href={`/design/${p.id}`}
                title={p.name}
                className="design-sidebar-project group flex min-h-10 items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-[18px] text-foreground transition-colors hover:bg-sidebar-hover"
              >
                {p.device === 'web' ? (
                  <Monitor size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                ) : (
                  <Smartphone size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                )}
                <span className="min-w-0 break-words line-clamp-2">{p.name}</span>
              </Link>
            ))}
            {projects && projects.length > 8 && (
              <button
                onClick={() => projectsSection.current?.scrollIntoView({ behavior: 'smooth' })}
                className="mt-2 flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground"
              >
                View all projects <ArrowRight size={13} aria-hidden="true" className="ml-auto" />
              </button>
            )}
            {!projects && !loadError && (
              <div className="space-y-3 px-3 py-2" role="status" aria-label="Loading projects">
                {[144, 112, 128].map((width) => (
                  <div key={width} className="h-3 rounded bg-muted" style={{ width }} />
                ))}
              </div>
            )}
            {projects?.length === 0 && (
              <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                Your designs will appear here.
              </p>
            )}
            {loadError && (
              <button onClick={load} className="min-h-9 rounded-lg px-3 text-xs text-muted-foreground hover:bg-sidebar-hover hover:text-foreground">
                Could not load projects. Retry
              </button>
            )}
          </div>
        </nav>
        <div className="shrink-0 px-4 pb-4">
          <div className="border-t border-sidebar-border pt-3">
            <BackToPragna />
            <div className="mt-3 flex min-h-11 items-center gap-2.5 px-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-foreground">
                {(user?.name || user?.email || 'P')[0].toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium" title={user?.name || user?.email}>
                  {user?.name || user?.email}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={user?.email}>
                  {user?.email}
                </p>
              </div>
              <AppearanceButton />
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="flex h-16 items-center gap-2 px-6 sm:px-10">
          <div className="flex items-center lg:hidden">
            <DesignBrand size={22} />
          </div>
          <span className="hidden text-sm text-muted-foreground lg:inline">
            Your creative workspace
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/"
              className="rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted lg:hidden"
            >
              Back to Pragna
            </Link>
            <AppearanceButton />
          </div>
        </header>
        <div className="mx-auto max-w-[1120px] px-5 pb-12 sm:px-10">
          <div ref={briefSection} className="mx-auto max-w-[720px] pb-8 pt-9 text-center sm:pt-14">
            <div className="mb-5 flex justify-center text-primary">
              <DesignMark size={42} />
            </div>
            <h1 className="design-heading text-[38px] leading-[1.12] sm:text-[48px]">
              What do you want to design?
            </h1>
            <p className="mt-4 mb-7 text-sm leading-6 text-muted-foreground">
              Start with an idea. Shape it together. Make it yours.
            </p>
            <div className="text-left">
              <BriefComposer
                prompt={prompt}
                onPrompt={setPrompt}
                device={device}
                onDevice={setDevice}
                image={image}
                onImage={setImage}
                busy={creating}
                onSubmit={create}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Describe your audience, features, and visual direction. Or start with a reference
              image.
            </p>
          </div>
          <section aria-labelledby="starters-title" className="mt-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="starters-title" className="text-sm font-medium">
                A little inspiration
              </h2>
              <span className="text-xs text-muted-foreground">Make it your own</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {STARTERS.map((starter) => (
                <button
                  key={starter.kind}
                  onClick={() => {
                    setPrompt(starter.prompt);
                    setDevice(starter.device);
                    briefSection.current?.querySelector('textarea')?.focus();
                  }}
                  disabled={creating}
                  className="design-project-card group overflow-hidden rounded-xl border border-border bg-card text-left"
                >
                  <StarterPreview kind={starter.kind} />
                  <div className="flex items-center gap-2 px-4 py-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{starter.type}</p>
                      <p className="mt-1 text-sm font-medium">{starter.name}</p>
                    </div>
                    <ArrowRight
                      size={16}
                      className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-1"
                    />
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section ref={projectsSection} aria-labelledby="projects-title" className="mt-10">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="projects-title" className="text-base font-medium">
                Your projects
              </h2>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {projects?.length ?? '—'}
              </span>
              <label className="relative ml-auto w-44 sm:w-52">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search designs"
                  placeholder="Search projects"
                  className="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-3 text-xs"
                />
              </label>
            </div>
            <div className="mt-4 mb-5 flex gap-1" aria-label="Filter projects">
              {(
                [
                  { value: 'all', label: 'All projects' },
                  { value: 'web', label: 'Websites' },
                  { value: 'mobile', label: 'Mobile apps' },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`rounded-lg px-3 py-1.5 text-xs ${filter === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {loadError ? (
              <div role="alert" className="rounded-xl border border-border p-6 text-center">
                <p>{loadError}</p>
                <button onClick={load} className="mt-3 text-primary underline">
                  Try again
                </button>
              </div>
            ) : !projects ? (
              <div className="grid gap-4 sm:grid-cols-3" aria-label="Loading projects">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            ) : !visible?.length ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
                <LayoutGrid size={23} className="mb-3 text-muted-foreground" />
                <p className="font-medium">
                  {projects.length ? 'No projects match your search' : 'Room for your first idea'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {projects.length
                    ? 'Try another name or format.'
                    : 'Your designs will live here, ready to pick up where you left off.'}
                </p>
                {projects.length > 0 && (
                  <button
                    className="mt-3 text-xs text-primary"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((project) => (
                  <li
                    key={project.id}
                    className="design-project-card group relative overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <Link href={`/design/${project.id}`} className="block">
                      <Thumbnail project={project} />
                      <div className="px-4 py-3">
                        <p className="truncate text-sm font-medium">{project.name}</p>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {project.device === 'web' ? (
                            <Monitor size={12} />
                          ) : (
                            <Smartphone size={12} />
                          )}
                          <span>{project.device === 'web' ? 'Website' : 'Mobile app'}</span>
                          <span className="ml-auto">
                            {new Date(project.updated_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>
                    </Link>
                    <div className="absolute right-2 top-2 flex rounded-lg border border-border bg-card p-0.5 shadow-sm">
                      {confirmDelete === project.id ? (
                        <>
                          <span className="self-center pl-2 text-xs">Delete project?</span>
                          <button
                            disabled={deleting === project.id}
                            onClick={() => remove(project)}
                            aria-label={`Confirm delete ${project.name}`}
                            className="design-icon-button text-red-600"
                          >
                            {deleting === project.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            aria-label="Cancel delete"
                            className="design-icon-button"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(project.id)}
                          aria-label={`Delete ${project.name}`}
                          className="design-icon-button opacity-70 hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
