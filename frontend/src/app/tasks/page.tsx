'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { getAuthToken } from '@/lib/api';
import { toast } from 'sonner';
import {
  Clock,
  Search,
  ChevronDown,
  Plus,
  Sunrise,
  Inbox,
  Calendar,
  CheckSquare,
  Lightbulb,
  Binoculars,
  Play,
  Pause,
  Trash2,
  X,
  Check,
  RotateCcw,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  SlidersHorizontal,
  Bell,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink
} from 'lucide-react';

interface ScheduledJob {
  id: number;
  title?: string;
  prompt: string;
  schedule: string;
  status: string;
  created_at: string;
  last_run?: string | null;
  schedule_label?: string;
  next_run?: string | null;
  conversation_id?: string | null;
  running?: boolean;
  last_result?: string | null;
  last_ok?: boolean | null;
}

interface SchedulePreview {
  found: boolean;
  label?: string;
  expression?: string;
  next_run?: string;
  recurring?: boolean;
}

const SCHEDULED_STARTERS = [
  {
    id: 'daily-briefing',
    title: 'Daily briefing',
    icon: Sunrise,
    desc: 'What needs your attention today across calendar, email, and messages.',
    schedule: 'Weekdays at 8:00 AM',
    defaultPrompt: 'Generate a concise daily executive briefing covering my key priorities, upcoming calendar commitments, urgent pending communications, and high-impact action items for today.',
  },
  {
    id: 'inbox-triage',
    title: 'Inbox triage',
    icon: Inbox,
    desc: 'Categorize your inbox and draft replies to anything urgent.',
    schedule: 'Weekdays at 8:00 AM',
    defaultPrompt: 'Triage my unread messages and notifications. Group by urgency (Immediate, Follow-up, Informational), summarize key discussions, and draft suggested replies for urgent items.',
  },
  {
    id: 'meeting-prep',
    title: 'Meeting prep',
    icon: Calendar,
    desc: 'A short brief before each meeting on your calendar, covering attendees, context, and agenda.',
    schedule: 'Weekdays at 8:00 AM',
    defaultPrompt: 'Review my calendar for today. For each scheduled meeting, provide attendee background, context from previous notes, the stated agenda, and 3 high-leverage talking points or questions.',
  },
  {
    id: 'weekly-review',
    title: 'Weekly review',
    icon: CheckSquare,
    desc: 'A Friday summary of what happened this week.',
    schedule: 'Every Friday at 4:00 PM',
    defaultPrompt: 'Compile a Friday executive weekly summary highlighting key milestones completed, blockers identified, metrics trajectory, and the top 3 focus areas for next week.',
  },
  {
    id: 'content-ideas',
    title: 'Content ideas',
    icon: Lightbulb,
    desc: 'Draft a few post ideas each week from the latest news in your industry.',
    schedule: 'Every Monday at 9:00 AM',
    defaultPrompt: 'Analyze recent developments in tech, AI, and industry news from the past week. Generate 5 compelling content ideas and outline talking points for thought leadership posts.',
  },
  {
    id: 'monitor-topic',
    title: 'Monitor a topic',
    icon: Binoculars,
    desc: 'Watch for news or mentions of a topic, competitor, or keyword.',
    schedule: 'Daily at 9:00 AM',
    defaultPrompt: 'Scan and synthesize the latest news, product launches, research benchmarks, and discussions regarding AI agent architectures and reasoning systems from the last 24 hours.',
  },
];

function StopwatchIllustration() {
  return (
    <div className="flex items-center justify-center w-20 h-20 text-[#d4af37]/60 mb-3 drop-shadow-[0_0_16px_rgba(212,175,55,0.15)]">
      <svg viewBox="0 0 64 64" fill="none" className="w-full h-full" stroke="currentColor">
        {/* Top button stem */}
        <line x1="32" y1="5" x2="32" y2="12" strokeWidth="2.5" strokeLinecap="round" />
        {/* Top crown stopper */}
        <line x1="26" y1="5" x2="38" y2="5" strokeWidth="2.5" strokeLinecap="round" />
        {/* Side button */}
        <line x1="48" y1="13" x2="43" y2="18" strokeWidth="2.5" strokeLinecap="round" />
        {/* Main circular body */}
        <circle cx="32" cy="37" r="22" strokeWidth="2" />
        {/* Watch dial hands pointing at ~1:50 */}
        <line x1="32" y1="37" x2="32" y2="24" strokeWidth="2" strokeLinecap="round" />
        <line x1="32" y1="37" x2="43" y2="30" strokeWidth="2" strokeLinecap="round" />
        <circle cx="32" cy="37" r="1.5" fill="currentColor" />
      </svg>
    </div>
  );
}

function WavyDivider() {
  return (
    <div className="w-full flex items-center justify-center my-10 overflow-hidden opacity-30 text-[#d4af37]">
      <svg width="100%" height="10" viewBox="0 0 1000 10" fill="none" preserveAspectRatio="none">
        <path
          d="M0 5 Q 12.5 0, 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 T 225 5 T 250 5 T 275 5 T 300 5 T 325 5 T 350 5 T 375 5 T 400 5 T 425 5 T 450 5 T 475 5 T 500 5 T 525 5 T 550 5 T 575 5 T 600 5 T 625 5 T 650 5 T 675 5 T 700 5 T 725 5 T 750 5 T 775 5 T 800 5 T 825 5 T 850 5 T 875 5 T 900 5 T 925 5 T 950 5 T 975 5 T 1000 5"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
    </div>
  );
}

const WHEN_CHIPS = [
  'Every morning at 9am',
  'Weekdays at 8am',
  'Every hour',
  'In 30 minutes',
  'Tomorrow at 9am',
  'Every Monday at 9am',
];

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function formatAgo(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function ScheduledTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'next_run' | 'created' | 'name'>('next_run');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalPrompt, setModalPrompt] = useState('');
  const [modalWhen, setModalWhen] = useState('');
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [detected, setDetected] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load scheduled tasks
  const wasRunning = React.useRef<Set<number>>(new Set());
  const fetchTasks = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const jobs: ScheduledJob[] = data.jobs || [];
        setTasks(jobs);
        // Tell the user when a run they were waiting on has finished.
        for (const job of jobs) {
          if (wasRunning.current.has(job.id) && !job.running) {
            wasRunning.current.delete(job.id);
            const name = job.title || job.prompt.slice(0, 30);
            if (job.last_ok === false) {
              toast.error(`"${name}" could not finish`, { action: { label: 'See why', onClick: () => openResult(job) } });
            } else {
              toast.success(`"${name}" is done`, { action: { label: 'View result', onClick: () => openResult(job) } });
            }
          } else if (job.running) {
            wasRunning.current.add(job.id);
          }
        }
      }
    } catch {
      if (!silent) toast.error('Failed to load scheduled tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => fetchTasks(true), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNewTaskModal = (starter?: typeof SCHEDULED_STARTERS[0]) => {
    setModalTitle(starter ? starter.title : '');
    setModalPrompt(starter ? starter.defaultPrompt : '');
    setModalWhen(starter ? starter.schedule : '');
    setPreview(null);
    setDetected(null);
    setModalOpen(true);
  };

  const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  const requestPreview = async (text: string): Promise<SchedulePreview | null> => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text, timezone: timeZone() }),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  // Live "next run" preview for what was typed in the When box.
  useEffect(() => {
    if (!modalOpen) return;
    if (!modalWhen.trim()) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const handle = setTimeout(async () => {
      setPreview(await requestPreview(modalWhen));
      setPreviewing(false);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalWhen, modalOpen]);

  // Pick up a time written inside the instructions ("...every weekday at 8am") when When is empty.
  useEffect(() => {
    if (!modalOpen || modalWhen.trim()) {
      setDetected(null);
      return;
    }
    const handle = setTimeout(async () => {
      const found = await requestPreview(modalPrompt);
      setDetected(found?.found ? found : null);
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalPrompt, modalWhen, modalOpen]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalPrompt.trim()) return;

    const chosen = preview?.found ? preview : detected;
    if (!chosen?.found || !chosen.expression) {
      toast.error('Tell me when to run it, for example "every weekday at 8am"');
      return;
    }

    setSubmitting(true);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action: 'create',
          title: modalTitle.trim() || modalPrompt.trim().split('\n')[0].slice(0, 40),
          prompt: modalPrompt.trim(),
          schedule: chosen.expression,
        }),
      });
      const created = res.ok ? await res.json().catch(() => null) : null;
      if (created && created.success === false) {
        toast.error(created.error || 'Failed to create scheduled task');
      } else if (res.ok) {
        toast.success(`Scheduled: ${chosen.label}`);
        setModalOpen(false);
        fetchTasks();
      } else {
        toast.error('Failed to create scheduled task');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error creating scheduled task');
    } finally {
      setSubmitting(false);
    }
  };

  const openResult = (job: ScheduledJob) => {
    if (job.conversation_id) router.push(`/?open=sched-${job.conversation_id}`);
  };

  const handleToggleTask = async (jobId: number) => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'toggle', job_id: jobId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.summary || 'Task status updated');
        fetchTasks();
      }
    } catch {
      toast.error('Failed to toggle task');
    }
  };

  const handleRunNow = async (job: ScheduledJob) => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'run', job_id: job.id }),
      });
      if (res.ok) {
        setTasks((prev) => prev.map((t) => (t.id === job.id ? { ...t, running: true } : t)));
        fetchTasks();
      }
    } catch {
      toast.error('Failed to trigger task');
    }
  };

  const handleDeleteTask = async (jobId: number, title?: string) => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'cancel', job_id: jobId }),
      });
      if (res.ok) {
        toast.success(`Deleted task "${title || 'Task'}"`);
        fetchTasks();
      }
    } catch {
      toast.error('Failed to delete task');
    }
  };

  // Filter & Sort tasks
  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => {
      const q = searchQuery.toLowerCase();
      return (
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.prompt && t.prompt.toLowerCase().includes(q)) ||
        (t.schedule && t.schedule.toLowerCase().includes(q))
      );
    });

    if (sortBy === 'name') {
      result.sort((a, b) => (a.title || a.prompt).localeCompare(b.title || b.prompt));
    } else if (sortBy === 'created') {
      result.sort((a, b) => b.id - a.id);
    }
    return result;
  }, [tasks, searchQuery, sortBy]);

  const visibleJobs = filteredTasks.filter((t) => t.status !== 'cancelled');
  const scheduledJobs = visibleJobs.filter((t) => t.status === 'active' || t.status === 'paused');
  const finishedJobs = visibleJobs.filter((t) => t.status === 'completed');
  const activeJobs = visibleJobs;

  const renderJob = (job: ScheduledJob) => {
    const name = job.title || job.prompt.slice(0, 36);
    const finished = job.status === 'completed';
    const failed = job.last_ok === false;
    return (
      <div
        key={job.id}
        className="p-4 rounded-2xl bg-card border border-border hover:border-[#d4af37]/40 shadow-sm transition-all flex flex-col gap-3 group"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">{name}</span>
              {job.running ? (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-500 border-sky-500/25 flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Running
                </span>
              ) : finished ? (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1 ${failed ? 'bg-red-500/15 text-red-500 border-red-500/25' : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/25'}`}>
                  {failed ? <AlertCircle size={10} /> : <CheckCircle2 size={10} />} {failed ? 'Failed' : 'Done'}
                </span>
              ) : (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${job.status === 'active' ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/25' : 'bg-[#d4af37]/15 text-[#b8860b] dark:text-[#d4af37] border-[#d4af37]/30'}`}>
                  {job.status === 'active' ? 'Active' : 'Paused'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">{job.prompt}</p>
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground/90 pt-0.5">
              <span className="flex items-center gap-1 text-foreground/80">
                <Clock size={11} className="text-[#d4af37]" />
                {job.schedule_label || job.schedule}
              </span>
              {job.status === 'active' && job.next_run && <span>Next: {formatWhen(job.next_run)}</span>}
              {job.last_run && <span>Last run {formatAgo(job.last_run)}</span>}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-start">
            {job.conversation_id && job.last_run && (
              <button
                onClick={() => openResult(job)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs gold-gradient-btn hover:opacity-95 transition-opacity"
                title="Open the chat with this task's results"
              >
                <ExternalLink size={11} />
                <span>View result</span>
              </button>
            )}
            <button
              onClick={() => handleRunNow(job)}
              disabled={job.running}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-muted hover:bg-[#d4af37]/20 text-foreground hover:text-[#d4af37] border border-border transition-colors disabled:opacity-50"
              title="Run task now"
            >
              {job.running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} fill="currentColor" />}
              <span>{job.running ? 'Running' : 'Run now'}</span>
            </button>
            {!finished && (
              <button
                onClick={() => handleToggleTask(job.id)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={job.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
              >
                {job.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
              </button>
            )}
            <button
              onClick={() => handleDeleteTask(job.id, job.title)}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete scheduled task"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {(job.running || job.last_result) && (
          <button
            type="button"
            onClick={() => openResult(job)}
            disabled={!job.conversation_id}
            className={`text-left rounded-xl px-3 py-2 text-xs border transition-colors ${failed ? 'bg-red-500/5 border-red-500/20' : 'bg-muted/40 border-border/60 hover:border-[#d4af37]/40'}`}
          >
            {job.running ? (
              <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Pragna is working on this now…</span>
            ) : (
              <span className="line-clamp-3 text-foreground/80 whitespace-pre-line">{job.last_result}</span>
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="flex-1 flex flex-col h-full overflow-y-auto bg-background text-foreground selection:bg-[#d4af37]/25">
        {/* Main Container */}
        <div className="max-w-4xl w-full mx-auto px-6 py-10 sm:py-14 flex flex-col flex-1">
          {/* Back to chats button */}
          <div className="mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-card/70 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium border border-border/80 hover:border-border transition-all shadow-xs group"
            >
              <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform text-[#d4af37]" />
              <span>Back to chats</span>
            </Link>
          </div>

          {/* Header section matching Pragna Theme */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-10">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Scheduled <span className="gold-gradient-text">Tasks</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 font-normal">
                Run tasks on a schedule or whenever you need them.
              </p>
            </div>

            {/* Right action controls */}
            <div className="flex items-center gap-2.5 shrink-0 self-start">
              {/* Search Toggle */}
              {searchOpen ? (
                <div className="flex items-center bg-card border border-border/80 rounded-full px-3 py-1 text-xs shadow-sm">
                  <Search size={13} className="text-[#d4af37] mr-1.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks..."
                    autoFocus
                    className="bg-transparent border-0 outline-none text-xs text-foreground placeholder:text-muted-foreground w-28 sm:w-40"
                  />
                  <button onClick={() => { setSearchQuery(''); setSearchOpen(false); }} className="text-muted-foreground hover:text-foreground">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  className="p-2 rounded-full hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border"
                  title="Search scheduled tasks"
                  aria-label="Search scheduled tasks"
                >
                  <Search size={16} />
                </button>
              )}

              {/* Sort dropdown */}
              <div className="relative">
                <button
                  onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-card hover:bg-muted text-foreground border border-border shadow-sm transition-colors"
                >
                  <span>Sort by {sortBy === 'next_run' ? 'Next run' : sortBy === 'name' ? 'Name' : 'Created'}</span>
                  <ChevronDown size={13} className="text-muted-foreground" />
                </button>

                {sortDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-40 rounded-xl bg-card border border-border shadow-premium-lg z-50 p-1">
                    <button
                      onClick={() => { setSortBy('next_run'); setSortDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${sortBy === 'next_run' ? 'bg-[#d4af37]/15 text-[#d4af37] font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                      Next run
                    </button>
                    <button
                      onClick={() => { setSortBy('created'); setSortDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${sortBy === 'created' ? 'bg-[#d4af37]/15 text-[#d4af37] font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                      Recently created
                    </button>
                    <button
                      onClick={() => { setSortBy('name'); setSortDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${sortBy === 'name' ? 'bg-[#d4af37]/15 text-[#d4af37] font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                      Name (A-Z)
                    </button>
                  </div>
                )}
              </div>

              {/* New task button with Pragna gold styling */}
              <button
                onClick={() => openNewTaskModal()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold gold-gradient-btn hover:opacity-95 active:scale-95 transition-all shadow-sm"
              >
                <span>New task</span>
                <ChevronDown size={13} />
              </button>
            </div>
          </div>

          {/* Task lists */}
          {activeJobs.length > 0 && (
            <div className="mb-8 space-y-6">
              {scheduledJobs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Scheduled ({scheduledJobs.length})
                    </h2>
                    <button onClick={() => fetchTasks()} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <RotateCcw size={11} className={loading ? 'animate-spin text-[#d4af37]' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">{scheduledJobs.map(renderJob)}</div>
                </div>
              )}
              {finishedJobs.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1">
                    Finished ({finishedJobs.length})
                  </h2>
                  <div className="grid grid-cols-1 gap-2.5">{finishedJobs.map(renderJob)}</div>
                </div>
              )}
            </div>
          )}

          {/* Empty State when no tasks exist */}
          {activeJobs.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-8 pb-4 text-center">
              <StopwatchIllustration />
              <p className="text-sm font-medium text-muted-foreground">
                No scheduled tasks yet.
              </p>
            </div>
          )}

          {/* Subtle Wavy Divider */}
          <WavyDivider />

          {/* 6 Starter Template Cards with Pragna styling */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 w-full">
            {SCHEDULED_STARTERS.map((starter) => {
              const Icon = starter.icon;
              return (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => openNewTaskModal(starter)}
                  className="group relative flex items-start gap-3.5 p-4 rounded-2xl bg-card hover:bg-muted/40 border border-border hover:border-[#d4af37]/45 shadow-sm hover:shadow-[0_4px_20px_rgba(212,175,55,0.12)] transition-all duration-200 text-left cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-muted/70 group-hover:bg-[#d4af37]/15 flex items-center justify-center shrink-0 text-muted-foreground group-hover:text-[#d4af37] border border-border/50 group-hover:border-[#d4af37]/30 transition-colors mt-0.5">
                    <Icon size={16} strokeWidth={1.8} />
                  </div>

                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className="text-sm font-semibold text-foreground tracking-tight group-hover:text-[#d4af37] transition-colors">
                      {starter.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {starter.desc}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 group-hover:text-foreground mt-2.5 transition-colors">
                      <Clock size={11} className="text-[#d4af37]" />
                      <span>{starter.schedule}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* New Scheduled Task Modal Dialog */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
              className="relative w-full max-w-lg bg-card border border-border rounded-3xl shadow-premium-lg overflow-hidden flex flex-col p-6 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#d4af37]/15 border border-[#d4af37]/30 flex items-center justify-center text-[#d4af37]">
                    <Clock size={16} />
                  </div>
                  <h3 className="text-base font-bold text-foreground">Create scheduled task</h3>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="flex flex-col gap-4 mt-5">
                {/* What */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    What should Pragna do?
                  </label>
                  <textarea
                    autoFocus
                    value={modalPrompt}
                    onChange={(e) => setModalPrompt(e.target.value)}
                    rows={4}
                    placeholder="e.g. Every weekday at 8am, give me a short briefing of the latest AI news"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/40 resize-none"
                  />
                </div>

                {/* When */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    When
                  </label>
                  <input
                    type="text"
                    value={modalWhen}
                    onChange={(e) => setModalWhen(e.target.value)}
                    placeholder='Type it naturally: "tomorrow at 6:30pm", "every Friday 5pm", "in 2 hours"'
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/40"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {WHEN_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setModalWhen(chip)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                          modalWhen === chip
                            ? 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37] font-medium'
                            : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-[#d4af37]/40'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-[20px] text-xs" aria-live="polite">
                    {modalWhen.trim() ? (
                      previewing ? (
                        <span className="text-muted-foreground flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Working out the time…</span>
                      ) : preview?.found ? (
                        <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 size={13} />
                          {preview.recurring ? 'Repeats. ' : 'Runs once. '}Next run: <strong>{formatWhen(preview.next_run)}</strong>
                        </span>
                      ) : (
                        <span className="text-amber-500 flex items-center gap-1.5"><AlertCircle size={13} /> I could not read that time. Try "every day at 9am".</span>
                      )
                    ) : detected?.found ? (
                      <button
                        type="button"
                        onClick={() => setModalWhen(detected.label || '')}
                        className="text-[#d4af37] hover:underline flex items-center gap-1.5"
                      >
                        <Sparkles size={13} /> Found in your instructions: {detected.label}. Use this
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Times use your timezone ({timeZone()}).</span>
                    )}
                  </div>
                </div>

                {/* Optional name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Name <span className="normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    placeholder="Taken from your instructions if left empty"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/40"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border mt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-full text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !(preview?.found || detected?.found)}
                    className="px-5 py-2 rounded-full text-xs font-semibold gold-gradient-btn hover:opacity-95 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                  >
                    {submitting ? 'Scheduling...' : 'Create task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
