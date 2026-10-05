'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { useChat } from '@/context/ChatContext';
import { useAuth } from '@/context/AuthContext';
import {
  MessageSquare,
  ChevronRight,
  PanelLeftClose,
  Plus,
  Search,
  Clock,
  Palette,
  Trash2,
  X,
} from 'lucide-react';
import UserProfileMenu from '@/components/UserProfileMenu';

const navItems = [
  { key: 'nav-tasks', href: '/tasks', icon: Clock, label: 'Scheduled' },
  { key: 'nav-design', href: '/design', icon: Palette, label: 'Design' },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const { conversations, searchQuery, setSearchQuery, activeConversationId, loadConversation, deleteConversation, startNewChat } =
    useChat();
  const { user } = useAuth();

  const closeSearch = () => {
    setSearchQuery('');
    setSearchOpen(false);
  };

  return (
    <aside
      className={`sidebar-transition flex flex-col h-full bg-sidebar-bg border-r border-sidebar-border shrink-0 relative z-20 ${
        collapsed ? 'w-16' : 'w-[260px]'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center px-3 py-3 shrink-0 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {collapsed ? (
          <AppLogo size={30} variant="shield" />
        ) : (
          <Link
            href="/"
            className="flex items-center select-none py-0.5"
            title="PRAGNA 1-A - Start new chat"
            onClick={() => {
              startNewChat();
              onNavigate?.();
            }}
          >
            <AppLogo size={30} variant="full" />
          </Link>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* New Chat */}
      <div className={`px-3 pb-2 shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
        <Link
          href="/"
          onClick={() => {
            startNewChat();
            onNavigate?.();
          }}
          title="New chat"
          className={`flex items-center justify-center gap-2 rounded-xl text-sm font-semibold gold-gradient-btn hover:opacity-95 active:scale-[0.98] transition-all duration-150 shadow-sm ${
            collapsed ? 'w-10 h-10 p-0' : 'w-full px-3 py-2.5'
          }`}
        >
          <Plus size={15} strokeWidth={2.5} className="shrink-0" />
          {!collapsed && <span>New chat</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav className={`px-3 pb-3 shrink-0 space-y-0.5 ${collapsed ? 'flex flex-col items-center' : ''}`}>
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => onNavigate?.()}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 rounded-lg text-sm transition-all duration-150 ${
                collapsed ? 'w-10 h-9 justify-center' : 'w-full px-3 py-2'
              } ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
              }`}
            >
              <item.icon size={17} strokeWidth={1.8} className="shrink-0" />
              {!collapsed && <span className="flex-1">{item.label}</span>}
            </Link>
          );
        })}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="w-10 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </nav>

      {!collapsed && (
        <>
          <div className="mx-3 border-t border-sidebar-border mb-3 shrink-0" />

          {/* Recents header */}
          <div className="flex items-center justify-between px-4 mb-1.5 shrink-0">
            <span className="text-[0.6875rem] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              {searchQuery ? 'Results' : 'Recents'}
            </span>
            <button
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              className="p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150"
              title={searchOpen ? 'Close search' : 'Search conversations'}
            >
              {searchOpen ? <X size={12} /> : <Search size={12} />}
            </button>
          </div>

          {searchOpen && (
            <div className="px-3 pb-2 shrink-0">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                placeholder="Search conversations…"
                className="w-full bg-muted rounded-lg px-3 py-2 text-sm outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 min-h-0">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-10 h-10 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <MessageSquare size={18} className="text-muted-foreground/40" />
                </div>
                <p className="text-xs font-medium text-muted-foreground/70">
                  {searchQuery ? 'No matching conversations' : 'No conversations yet'}
                </p>
                {!searchQuery && (
                  <p className="text-xs text-muted-foreground/40 mt-1">Start a new chat to begin</p>
                )}
              </div>
            ) : (
              conversations.map((conv) => {
                const active = conv.id === activeConversationId;
                return (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all duration-150 ${
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
                    }`}
                  >
                    <Link
                      href="/"
                      onClick={() => {
                        loadConversation(conv.id);
                        onNavigate?.();
                      }}
                      className="flex-1 min-w-0 truncate text-sm leading-snug"
                    >
                      {conv.title}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-opacity"
                      title="Delete chat"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Footer: profile menu holds Settings */}
      <div className="border-t border-sidebar-border shrink-0 relative">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="w-full py-3 flex items-center justify-center hover:bg-sidebar-hover transition-colors"
            title="Expand sidebar & open profile"
          >
            <div className="w-7 h-7 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700/60 flex items-center justify-center text-xs font-semibold">
              {(user?.name || user?.email || 'v').charAt(0).toLowerCase()}
            </div>
          </button>
        ) : (
          <UserProfileMenu onOpenSearch={() => setSearchOpen(true)} />
        )}
      </div>
    </aside>
  );
}
