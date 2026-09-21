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
  MessageSquare
} from 'lucide-react';

interface ScheduledJob {
  id: number;
  title?: string;
  prompt: string;
  schedule: string;
  status: string;
  created_at: string;
  last_run?: string | null;
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
  const [modalSchedule, setModalSchedule] = useState('Weekdays at 8:00 AM');
  const [modalDelivery, setModalDelivery] = useState<'notification' | 'chat'>('notification');
  const [submitting, setSubmitting] = useState(false);

  // Load scheduled tasks
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.jobs || []);
      }
    } catch {
      toast.error('Failed to load scheduled tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const openNewTaskModal = (starter?: typeof SCHEDULED_STARTERS[0]) => {
    if (starter) {
      setModalTitle(starter.title);
      setModalPrompt(starter.defaultPrompt);
      setModalSchedule(starter.schedule);
    } else {
      setModalTitle('');
      setModalPrompt('');
      setModalSchedule('Weekdays at 8:00 AM');
    }
    setModalDelivery('notification');
    setModalOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalPrompt.trim()) return;

    setSubmitting(true);
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'create',
          title: modalTitle.trim() || 'Untitled scheduled task',
          prompt: modalPrompt.trim(),
          schedule: modalSchedule,
        }),
      });

      if (res.ok) {
        toast.success(`Scheduled task "${modalTitle || 'New task'}" created`);
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
      toast.info(`Running "${job.title || job.prompt.slice(0, 24)}" now...`);
      const token = getAuthToken();
      const res = await fetch('/api/tools/scheduled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'run', job_id: job.id }),
      });
      if (res.ok) {
        toast.success(`Task triggered successfully!`);
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

  const activeJobs = tasks.filter((t) => t.status === 'active' || t.status === 'paused');

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

          {/* Active Tasks List (if tasks exist) */}
          {activeJobs.length > 0 && (
            <div className="mb-8 space-y-3">
              <div className="flex items-center justify-between pb-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your Scheduled Tasks ({filteredTasks.length})
                </h2>
                <button onClick={fetchTasks} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <RotateCcw size={11} className={loading ? 'animate-spin text-[#d4af37]' : ''} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {filteredTasks.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-2xl bg-card hover:bg-muted/40 border border-border hover:border-[#d4af37]/40 shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate group-hover:text-[#d4af37] transition-colors">
                          {job.title || job.prompt.slice(0, 36)}
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${job.status === 'active' ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/25' : 'bg-[#d4af37]/15 text-[#b8860b] dark:text-[#d4af37] border-[#d4af37]/30'}`}>
                          {job.status === 'active' ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{job.prompt}</p>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/80 pt-0.5">
                        <span className="flex items-center gap-1 text-foreground/80">
                          <Clock size={11} className="text-[#d4af37]" />
                          {job.schedule}
                        </span>
                        {job.last_run && (
                          <span>Last run: {new Date(job.last_run).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      <button
                        onClick={() => handleRunNow(job)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-muted hover:bg-[#d4af37]/20 text-foreground hover:text-[#d4af37] border border-border transition-colors"
                        title="Run task immediately"
                      >
                        <Play size={11} fill="currentColor" />
                        <span>Run</span>
                      </button>
                      <button
                        onClick={() => handleToggleTask(job.id)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={job.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                      >
                        {job.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        onClick={() => handleDeleteTask(job.id, job.title)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete scheduled task"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
                {/* Task Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Task Name
                  </label>
                  <input
                    type="text"
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    placeholder="e.g. Daily briefing, Competitor tracking"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/40"
                  />
                </div>

                {/* Task Instructions */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Instructions / Prompt
                  </label>
                  <textarea
                    value={modalPrompt}
                    onChange={(e) => setModalPrompt(e.target.value)}
                    rows={3}
                    placeholder="What should the assistant do on schedule?"
                    required
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/40 resize-none"
                  />
                </div>

                {/* Schedule Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Schedule Frequency
                  </label>
                  <select
                    value={modalSchedule}
                    onChange={(e) => setModalSchedule(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-background border border-border text-foreground outline-none focus:border-[#d4af37] cursor-pointer"
                  >
                    <option value="Weekdays at 8:00 AM">Weekdays at 8:00 AM</option>
                    <option value="Daily at 9:00 AM">Daily at 9:00 AM</option>
                    <option value="Every Monday at 9:00 AM">Every Monday at 9:00 AM</option>
                    <option value="Every Friday at 4:00 PM">Every Friday at 4:00 PM</option>
                    <option value="Every 1 hour">Every 1 hour</option>
                    <option value="In 30 minutes">In 30 minutes (One-time)</option>
                  </select>
                </div>

                {/* Delivery Mode */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Delivery Channel
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setModalDelivery('notification')}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs transition-all ${
                        modalDelivery === 'notification'
                          ? 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37] font-medium'
                          : 'bg-background border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Bell size={14} className="shrink-0 text-[#d4af37]" />
                      <div>
                        <p className="font-semibold text-foreground">In-app Notification</p>
                        <p className="text-[10px] text-muted-foreground">Popup reminder & log</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setModalDelivery('chat')}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs transition-all ${
                        modalDelivery === 'chat'
                          ? 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37] font-medium'
                          : 'bg-background border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <MessageSquare size={14} className="shrink-0 text-[#d4af37]" />
                      <div>
                        <p className="font-semibold text-foreground">New Chat Thread</p>
                        <p className="text-[10px] text-muted-foreground">Create conversation</p>
                      </div>
                    </button>
                  </div>
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
                    disabled={submitting}
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
