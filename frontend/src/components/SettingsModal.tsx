'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Settings as SettingsIcon,
  User,
  Brain,
  Sparkles,
  Plug,
  X,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Check,
  Pencil,
  LogOut,
  CheckCircle2,
  Calendar,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  AuthUser,
  getBillingStatus,
  createBillingOrder,
  confirmDemoPayment,
  BillingStatusResponse,
} from '@/lib/api';
import SkillsSettings from '@/app/settings/components/SkillsSettings';
import McpSettings from '@/app/settings/components/McpSettings';
import MemorySettings from '@/app/settings/components/MemorySettings';

export interface SettingsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  initialTab?: string;
  embedded?: boolean;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

// Only tabs that have real endpoints or meaningful persistent state
const NAV_GROUPS: NavGroup[] = [
  {
    group: 'General',
    items: [
      { id: 'preferences', label: 'Preferences', icon: SettingsIcon },
      { id: 'account', label: 'Account', icon: User },
    ],
  },
  {
    group: 'AI',
    items: [
      { id: 'memory', label: 'Memory', icon: Brain },
    ],
  },
  {
    group: 'Extend',
    items: [
      { id: 'skills', label: 'Skills', icon: Sparkles },
      { id: 'connectors', label: 'Connectors', icon: Plug },
    ],
  },
];

export default function SettingsModal({
  isOpen = true,
  onClose = () => {},
  initialTab = 'preferences',
  embedded = false,
}: SettingsModalProps) {
  const { user, logout, updateUser } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  // Appearance states — persisted in localStorage
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('dark');
  const [chatFont, setChatFont] = useState('Geist Sans');
  const [fontOpen, setFontOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const savedPref = (localStorage.getItem('claudechat_theme_preference') ||
        localStorage.getItem('claudechat_theme') ||
        'dark') as 'system' | 'light' | 'dark';
      setTheme(savedPref);
      const savedFont = localStorage.getItem('pragna_chat_font');
      if (savedFont) setChatFont(savedFont);
    }
  }, []);

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme);
    let effective: 'dark' | 'light' = 'dark';
    if (newTheme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effective = newTheme;
    }
    if (effective === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('claudechat_theme', effective);
    localStorage.setItem('claudechat_theme_preference', newTheme);
  };

  const handleFontChange = (font: string) => {
    setChatFont(font);
    setFontOpen(false);
    localStorage.setItem('pragna_chat_font', font);
  };

  useEffect(() => {
    if (initialTab) {
      if (initialTab === 'mcp') setActiveTab('connectors');
      else setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !embedded) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, embedded]);

  const filteredNavGroups = useMemo(() => {
    if (!searchQuery.trim()) return NAV_GROUPS;
    const q = searchQuery.toLowerCase();
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [searchQuery]);

  if (!isOpen && !embedded) return null;

  const modalBody = (
    <div
      className={
        embedded
          ? 'w-full h-full flex bg-background text-foreground overflow-hidden select-none'
          : 'relative w-[880px] max-w-[94vw] h-[620px] max-h-[90vh] rounded-2xl bg-background border border-border text-foreground shadow-2xl flex overflow-hidden select-none'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* LEFT SIDEBAR */}
      <aside className="w-[200px] flex-shrink-0 bg-sidebar border-r border-border flex flex-col p-3">
        {/* Search */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-muted border border-transparent focus-within:border-primary/40 text-xs transition-colors mb-3">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-xs"
          />
        </div>

        {/* Nav Groups */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
          {filteredNavGroups.map((group) => (
            <div key={group.group}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 py-0.5 mb-1">
                {group.group}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = activeTab === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[13px] transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-primary/10 text-primary font-medium border border-primary/20'
                          : 'text-foreground/70 hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      <Icon
                        size={14}
                        className={`shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom: Pragna branding */}
        <div className="mt-3 pt-3 border-t border-border px-2">
          <p className="text-[10px] text-muted-foreground font-medium">Pragna</p>
          <p className="text-[10px] text-muted-foreground/60">by EtherX Innovations</p>
        </div>
      </aside>

      {/* RIGHT CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            {NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Settings'}
          </h2>
          {!embedded && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 pb-8">
          {activeTab === 'preferences' && (
            <PreferencesPanel
              theme={theme}
              setTheme={handleThemeChange}
              chatFont={chatFont}
              setChatFont={handleFontChange}
              fontOpen={fontOpen}
              setFontOpen={setFontOpen}
            />
          )}

          {activeTab === 'account' && (
            <AccountPanel
              user={user}
              logout={logout}
              updateUser={updateUser}
            />
          )}

          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'skills' && <SkillsSettings />}
          {activeTab === 'connectors' && <McpSettings />}
        </div>
      </main>
    </div>
  );

  if (embedded) return modalBody;
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      {modalBody}
    </div>,
    document.body
  );
}

/* ==========================================================================
   ACCOUNT PANEL — Claude/Notion-style Profile card, Plan card, and Logout
   ========================================================================== */
function AccountPanel({
  user,
  logout,
  updateUser,
}: {
  user: AuthUser | null;
  logout: () => void;
  updateUser: (updated: Partial<AuthUser>) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  useEffect(() => {
    let active = true;
    getBillingStatus()
      .then((status) => {
        if (active) {
          setBillingStatus(status);
          if (status.plan && status.plan !== user?.plan) {
            updateUser({ plan: status.plan });
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch billing status:', err);
      });
    return () => {
      active = false;
    };
  }, [user?.plan, updateUser]);

  const effectivePlan = (billingStatus?.plan || user?.plan || 'free').toLowerCase();
  const isPro = effectivePlan === 'pro';
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();

  const renewalDate = billingStatus?.current_period_end
    ? new Date(billingStatus.current_period_end).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const handleStartEditing = () => {
    setEditName(user?.name || '');
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    const trimmed = editName.trim();
    updateUser({ name: trimmed || null });
    setIsEditingName(false);
    toast.info('Display name updated (local session only)');
  };

  const handleCancelEditing = () => {
    setIsEditingName(false);
  };

  const handleDemoPayment = async () => {
    setIsProcessingPayment(true);
    try {
      const order = await createBillingOrder();
      const confirm = await confirmDemoPayment(order.order_id);
      setBillingStatus({
        plan: confirm.plan,
        current_period_end: confirm.current_period_end,
      });
      updateUser({ plan: confirm.plan });
      toast.success('Successfully upgraded to Pro (Demo Mode)!');
      setIsCheckoutOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Payment simulation failed');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <div className="space-y-8 max-w-lg">
      {/* PROFILE SECTION */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Profile
        </h3>
        <div className="rounded-xl bg-card border border-border p-5 shadow-sm">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt={user.name || user.email}
                className="w-14 h-14 rounded-full object-cover border border-border/80 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 border border-primary/30 text-primary font-bold text-xl flex items-center justify-center shrink-0 select-none shadow-sm">
                <span>{initial}</span>
              </div>
            )}

            {/* Profile Info */}
            <div className="flex-1 min-w-0">
              {/* Name & Plan pill & Edit affordance */}
              {!isEditingName ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-semibold text-foreground truncate">
                    {user?.name || 'Unnamed User'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium tracking-wide shrink-0 ${
                      isPro
                        ? 'bg-primary/15 text-primary border border-primary/25'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {isPro ? 'Pro (Demo)' : 'Free'}
                  </span>
                  <button
                    onClick={handleStartEditing}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs inline-flex items-center gap-1 ml-0.5"
                    title="Edit display name"
                    type="button"
                  >
                    <Pencil size={12} />
                    <span className="text-xs">Edit</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') handleCancelEditing();
                    }}
                    placeholder="Enter display name"
                    className="px-2.5 py-1 text-sm rounded-lg bg-muted border border-border focus:border-primary/50 text-foreground outline-none w-full max-w-[200px]"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleSaveName}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all"
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEditing}
                      className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Email */}
              <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                {user?.email || '—'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PLAN SECTION */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Plan
        </h3>
        <div className="rounded-xl bg-card border border-border p-5 shadow-sm space-y-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">
                  {isPro ? 'Pro Plan' : 'Free Plan'}
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                  {isPro ? 'Active (Demo)' : 'Active'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isPro
                  ? 'Advanced intelligence with priority access, high-res generation, and full model suite.'
                  : 'Core chat intelligence with standard agent tools and document analysis.'}
              </p>
              {isPro && renewalDate && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground font-mono">
                  <Calendar size={12} className="text-primary" />
                  <span>Renews on {renewalDate}</span>
                </div>
              )}
            </div>

            {/* Upgrade / Active Button */}
            {!isPro ? (
              <button
                onClick={() => setIsCheckoutOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 active:scale-95 text-xs font-medium transition-all shadow-sm shrink-0"
                type="button"
              >
                <Sparkles size={13} />
                <span>Upgrade</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium border border-primary/20 select-none shrink-0">
                <CheckCircle2 size={13} />
                <span>Pro Active</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border/60 pt-3">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Plan Features
            </p>
            <ul className="space-y-1.5 text-xs text-foreground/80">
              {isPro ? (
                <>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>All reasoning models (Praxis, Rhapsody, Elenchos, Theoria)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>High-resolution image generation & direct clipboard export</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Uncapped tool executions, web browsing & live artifacts</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Priority response generation & expanded context</span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Core AI reasoning & conversational assistant</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Document ingestion & intelligent search</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Standard rate limits & essential agent tools</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span>Interactive code blocks & mermaid diagrams</span>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* LOG OUT SECTION */}
      <section className="pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-foreground">Sign out</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sign out of your account on this browser session
            </p>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 text-xs font-medium transition-colors border border-destructive/20 active:scale-95"
            type="button"
          >
            <LogOut size={13} />
            <span>Log out</span>
          </button>
        </div>
      </section>

      {/* DEMO CHECKOUT DIALOG */}
      {isCheckoutOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !isProcessingPayment && setIsCheckoutOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl text-foreground space-y-5 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Upgrade to Pro</h3>
                  <p className="text-xs text-muted-foreground">Demo Checkout Simulation</p>
                </div>
              </div>
              <button
                onClick={() => !isProcessingPayment && setIsCheckoutOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                disabled={isProcessingPayment}
                type="button"
                aria-label="Close checkout"
              >
                <X size={16} />
              </button>
            </div>

            {/* Pricing summary */}
            <div className="rounded-xl bg-muted/50 border border-border/80 p-4 flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-bold text-foreground">₹299</span>
                <span className="text-xs text-muted-foreground ml-1">/ month</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                Pro Plan (Demo)
              </span>
            </div>

            {/* Demo notice banner */}
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5 flex items-start gap-2.5 text-xs text-amber-600 dark:text-amber-400">
              <ShieldCheck size={16} className="shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Demo mode:</strong> No real payment gateway will be contacted and no real money will be charged. This simulates the transaction to test Pro features.
              </p>
            </div>

            {/* Features included */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Included with Pro
              </p>
              <ul className="space-y-2 text-xs text-foreground/85">
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-primary shrink-0" />
                  <span>All 4 reasoning models (Praxis, Rhapsody, Elenchos, Theoria)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-primary shrink-0" />
                  <span>High-resolution image generation & clipboard export</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-primary shrink-0" />
                  <span>Uncapped tool executions, web browsing & live artifacts</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-primary shrink-0" />
                  <span>Priority response generation & expanded context</span>
                </li>
              </ul>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-border">
              <button
                onClick={() => setIsCheckoutOpen(false)}
                disabled={isProcessingPayment}
                className="px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors disabled:opacity-50"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDemoPayment}
                disabled={isProcessingPayment}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                type="button"
              >
                {isProcessingPayment ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Pay ₹299 (Demo)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   PREFERENCES PANEL — Appearance & Chat sections, persisted locally
   ========================================================================== */
function PreferencesPanel({
  theme,
  setTheme,
  chatFont,
  setChatFont,
  fontOpen,
  setFontOpen,
}: {
  theme: 'system' | 'light' | 'dark';
  setTheme: (t: 'system' | 'light' | 'dark') => void;
  chatFont: string;
  setChatFont: (f: string) => void;
  fontOpen: boolean;
  setFontOpen: (v: boolean | ((p: boolean) => boolean)) => void;
}) {
  const fontOptions = ['Geist Sans', 'System Default', 'Geist Mono'];
  const [sendOnEnter, setSendOnEnter] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pragna_send_on_enter');
      if (saved !== null) {
        setSendOnEnter(saved !== 'false');
      }
    }
  }, []);

  const handleToggleSendOnEnter = (val: boolean) => {
    setSendOnEnter(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pragna_send_on_enter', String(val));
    }
  };

  return (
    <div className="space-y-8 max-w-lg">
      {/* APPEARANCE */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Appearance
        </h3>
        <div className="rounded-xl bg-card border border-border p-5 space-y-5 shadow-sm">
          {/* Theme */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-foreground font-medium">Theme</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose your preferred color scheme</p>
            </div>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-muted border border-border">
              {(
                [
                  { value: 'system', Icon: Monitor, title: 'System' },
                  { value: 'light', Icon: Sun, title: 'Light' },
                  { value: 'dark', Icon: Moon, title: 'Dark' },
                ] as const
              ).map(({ value, Icon, title }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  title={title}
                  className={`p-1.5 rounded-md transition-all ${
                    theme === value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          <hr className="border-border/50" />

          {/* Chat Font */}
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-[13px] text-foreground font-medium">Chat font</p>
              <p className="text-xs text-muted-foreground mt-0.5">Font used in conversation messages</p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFontOpen((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border text-[13px] text-foreground hover:border-primary/40 transition-colors"
              >
                <span>{chatFont}</span>
                <ChevronDown size={13} className="text-muted-foreground" />
              </button>
              {fontOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-20 w-44 rounded-xl bg-card border border-border shadow-2xl p-1 text-xs">
                  {fontOptions.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setChatFont(f)}
                      className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        chatFont === f
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>{f}</span>
                      {chatFont === f && <Check size={12} className="text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CHAT PREFERENCES */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Chat
        </h3>
        <div className="rounded-xl bg-card border border-border p-5 space-y-5 shadow-sm">
          {/* Send on Enter */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-foreground font-medium">Send with Enter</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Press Enter to send, Shift+Enter for a new line. When disabled, press ⌘+Enter / Ctrl+Enter to send.
              </p>
            </div>
            <Toggle
              checked={sendOnEnter}
              onChange={handleToggleSendOnEnter}
              title="Toggle Send with Enter"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      title={title}
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1 ${
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
