'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  MessageSquare,
  CalendarClock,
  Clock,
  LayoutGrid,
  Palette,
  Sun,
  Moon,
  Trash2,
  Pencil,
  Check,
  X,
  PanelLeftClose,
  Search,
  Settings,
  LogOut,
  Sparkles,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { Conversation, ConversationGroup } from '../types/chat';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/context/AuthContext';
import UserProfileMenu from '@/components/UserProfileMenu';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  conversations: Conversation[];
  groupedConversations: ConversationGroup[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenArtifacts?: () => void;
  onOpenTools?: () => void;
  onOpenSearch?: () => void;
  onOpenImageStudio?: () => void;
}

export default function Sidebar({
  open,
  onToggle,
  groupedConversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  theme,
  onToggleTheme,
  onOpenArtifacts,
  onOpenTools,
  onOpenSearch,
  onOpenImageStudio,
}: SidebarProps) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | 'scheduled'>('all');
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setMoreOpen(localStorage.getItem('sidebar_more_open') === '1');
    } catch {}
  }, []);
  useEffect(() => {
    if (!filterMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) setFilterMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterMenuOpen]);
  const toggleMore = () => {
    setMoreOpen((prev) => {
      try { localStorage.setItem('sidebar_more_open', prev ? '0' : '1'); } catch {}
      return !prev;
    });
  };
  const { user, logout } = useAuth();
  const [hoverConvId, setHoverConvId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameConversation(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteConversation(id);
    setDeleteConfirmId(null);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(null);
  };

  const visibleConversations = groupedConversations
    .flatMap((group) => group.conversations)
    .filter((conv) => listFilter === 'all' || String(conv.id).startsWith('sched-'));

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          flex flex-col h-full z-30 flex-shrink-0
          bg-sidebar-bg border-r border-sidebar-border
          sidebar-transition overflow-hidden
          fixed lg:relative
          ${open ? 'w-[260px] translate-x-0' : 'w-0 lg:w-0 -translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex flex-col h-full w-[260px]">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-3 flex-shrink-0">
            <button
              type="button"
              className="flex min-h-8 items-center rounded-md select-none py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              onClick={onNewConversation}
              title="PRAGNA 1-A - Start new chat"
            >
              <AppLogo size={30} variant="full" />
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150"
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="px-3 pb-2 flex-shrink-0">
            <button
              onClick={onNewConversation}
              className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-semibold
                gold-gradient-btn hover:opacity-95 active:scale-[0.98]
                transition-all duration-150 shadow-sm"
            >
              <Plus size={15} className="text-[#1a1405] flex-shrink-0" strokeWidth={2.5} />
              <span>New chat</span>
            </button>
          </div>

          {/* More (collapsible shortcuts) */}
          <div className="px-3 pb-1 flex-shrink-0">
            <button
              onClick={toggleMore}
              className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150"
              aria-expanded={moreOpen}
            >
              <ChevronDown size={16} strokeWidth={1.8} className={`flex-shrink-0 transition-transform duration-200 ${moreOpen ? '' : '-rotate-90'}`} />
              <span className="flex-1 text-left">More</span>
            </button>
            {moreOpen && (
              <div className="mt-0.5 space-y-0.5">
                <button
                  onClick={() => router.push('/tasks')}
                  className="flex items-center gap-2.5 w-full pl-3 pr-2 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150 group"
                >
                  <Clock size={16} strokeWidth={1.8} className="flex-shrink-0" />
                  <span className="flex-1 text-left">Scheduled</span>
                </button>
                <button
                  onClick={() => router.push('/design')}
                  className="flex items-center gap-2.5 w-full pl-3 pr-2 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150 group"
                >
                  <Palette size={16} strokeWidth={1.8} className="flex-shrink-0" />
                  <span className="flex-1 text-left">Design</span>
                </button>
                <button
                  onClick={onOpenArtifacts}
                  className="flex items-center gap-2.5 w-full pl-3 pr-2 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150 group"
                >
                  <LayoutGrid size={16} strokeWidth={1.8} className="flex-shrink-0" />
                  <span className="flex-1 text-left">Artifacts</span>
                </button>
              </div>
            )}
          </div>

          {/* Chats and tasks header */}
          <div className="relative flex items-center justify-between pl-5 pr-3 mt-3 mb-1 flex-shrink-0" ref={filterMenuRef}>
            <span className="text-xs font-medium text-muted-foreground">Chats and tasks</span>
            <button
              onClick={() => setFilterMenuOpen((prev) => !prev)}
              className={`p-1 rounded-md transition-colors duration-150 hover:text-foreground hover:bg-sidebar-hover ${listFilter !== 'all' ? 'text-primary' : 'text-muted-foreground'}`}
              title="Filter"
              aria-label="Filter chats"
            >
              <SlidersHorizontal size={14} />
            </button>
            {filterMenuOpen && (
              <div className="absolute right-3 top-full mt-1 z-40 w-44 rounded-xl border border-border bg-popover shadow-lg p-1">
                {([['all', 'All chats'], ['scheduled', 'Scheduled tasks']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setListFilter(value); setFilterMenuOpen(false); }}
                    className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs text-foreground hover:bg-sidebar-hover"
                  >
                    <span>{label}</span>
                    {listFilter === value && <Check size={12} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Conversation list: one flat, newest-first list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
            {visibleConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-10 h-10 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <MessageSquare size={18} className="text-muted-foreground/40" />
                </div>
                <p className="text-xs font-medium text-muted-foreground/70">
                  {listFilter === 'scheduled' ? 'No scheduled task results yet' : 'No conversations yet'}
                </p>
                <p className="text-xs text-muted-foreground/40 mt-1">
                  {listFilter === 'scheduled' ? 'Results appear here after a task runs' : 'Start a new chat to begin'}
                </p>
              </div>
            ) : (
              visibleConversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === activeConversationId}
                  isHovered={hoverConvId === conv.id}
                  isRenaming={renamingId === conv.id}
                  isDeleteConfirm={deleteConfirmId === conv.id}
                  renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  onSelect={onSelectConversation}
                  onHover={setHoverConvId}
                  onStartRename={startRename}
                  onRenameChange={setRenameValue}
                  onCommitRename={commitRename}
                  onCancelRename={cancelRename}
                  onDeleteClick={handleDeleteClick}
                  onConfirmDelete={confirmDelete}
                  onCancelDelete={cancelDelete}
                />
              ))
            )}
          </div>

          {/* Footer Profile & Settings Menu */}
          <div className="flex-shrink-0 border-t border-sidebar-border relative">
            <UserProfileMenu onOpenSearch={onOpenSearch} />
          </div>
        </div>
      </aside>
    </>
  );
}

interface ConversationItemProps {
  conv: Conversation;
  isActive: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  isDeleteConfirm: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onStartRename: (conv: Conversation, e: React.MouseEvent) => void;
  onRenameChange: (val: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDeleteClick: (id: string, e: React.MouseEvent) => void;
  onConfirmDelete: (id: string, e: React.MouseEvent) => void;
  onCancelDelete: (e: React.MouseEvent) => void;
}

function ConversationItem({
  conv, isActive, isHovered, isRenaming, isDeleteConfirm,
  renameValue, renameInputRef,
  onSelect, onHover, onStartRename, onRenameChange,
  onCommitRename, onCancelRename, onDeleteClick, onConfirmDelete, onCancelDelete,
}: ConversationItemProps) {
  const hasMessages = conv.messages.length > 0;

  return (
    <div
      className={`
        group relative flex items-center gap-3 pl-3 pr-2 py-1.5 rounded-lg
        text-left transition-colors duration-150 cursor-pointer
        ${isActive
          ? 'bg-sidebar-hover text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
        }
      `}
      onClick={() => !isRenaming && onSelect(conv.id)}
      onMouseEnter={() => onHover(conv.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Bullet: ring for chats, clock for scheduled results, gold dot when open */}
      {String(conv.id).startsWith('sched-') ? (
        <Clock size={13} strokeWidth={1.8} className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/70'}`} aria-label="Scheduled task" />
      ) : (
        <span
          className={`w-[7px] h-[7px] rounded-full flex-shrink-0 border ${
            isActive ? 'bg-primary border-primary shadow-[0_0_6px_rgba(212,175,55,0.7)]' : 'border-muted-foreground/50'
          }`}
        />
      )}

      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCancelRename();
          }}
          onBlur={onCommitRename}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-transparent text-sm text-foreground outline-none border-b border-primary/50 pb-0.5"
        />
      ) : isDeleteConfirm ? (
        <div className="flex-1 flex items-center gap-1">
          <span className="text-xs text-muted-foreground flex-1">Delete?</span>
          <button
            onClick={(e) => onConfirmDelete(conv.id, e)}
            className="p-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors duration-100"
          >
            <Check size={11} />
          </button>
          <button
            onClick={onCancelDelete}
            className="p-1 rounded-lg text-muted-foreground hover:bg-sidebar-hover transition-colors duration-100"
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 truncate text-sm leading-snug">{conv.title.replace(/^\u23f0\uFE0F?\s*/, '')}</span>

          {(isHovered || isActive) && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => onStartRename(conv, e)}
                className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-sidebar-active transition-colors duration-100"
                title="Rename"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={(e) => onDeleteClick(conv.id, e)}
                className="p-1 rounded-md text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors duration-100"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
