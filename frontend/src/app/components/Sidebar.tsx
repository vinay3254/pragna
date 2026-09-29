'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  MessageSquare,
  CalendarClock,
  Clock,
  LayoutGrid,
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
            <div
              className="flex items-center cursor-pointer select-none py-0.5"
              onClick={onNewConversation}
              title="PRAGNA 1-A - Start new chat"
            >
              <AppLogo size={30} variant="full" />
            </div>
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

          {/* Nav items */}
          <div className="px-3 pb-3 flex-shrink-0 space-y-0.5">
            <button
              onClick={() => router.push('/tasks')}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-all duration-150 group"
            >
              <Clock size={17} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1 text-left">Scheduled</span>
            </button>

            <button
              onClick={onOpenArtifacts}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-hover transition-all duration-150 group"
            >
              <LayoutGrid size={17} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1 text-left">Artifacts Panel</span>
            </button>
          </div>

          <div className="mx-3 border-t border-sidebar-border mb-3 flex-shrink-0" />

          {/* Chats and tasks header */}
          <div className="flex items-center justify-between px-4 mb-1.5 flex-shrink-0">
            <span className="text-[0.6875rem] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              Recents
            </span>
            <button
              onClick={onOpenSearch}
              className="p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-hover transition-colors duration-150"
              title="Search (Cmd+K)"
            >
              <Search size={12} />
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
            {groupedConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-10 h-10 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <MessageSquare size={18} className="text-muted-foreground/40" />
                </div>
                <p className="text-xs font-medium text-muted-foreground/70">No conversations yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1">Start a new chat to begin</p>
              </div>
            ) : (
              groupedConversations.map((group) => (
                <div key={`group-${group.label}`} className="mb-4">
                  <div className="px-2 py-1 mb-0.5">
                    <span className="text-[0.625rem] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                      {group.label}
                    </span>
                  </div>
                  {group.conversations.map((conv) => (
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
                  ))}
                </div>
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
        group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg
        text-left transition-all duration-150 cursor-pointer
        ${isActive
          ? 'bg-primary/15 text-primary border border-primary/25 font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
        }
      `}
      onClick={() => !isRenaming && onSelect(conv.id)}
      onMouseEnter={() => onHover(conv.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 shadow-[0_0_8px_rgba(212,175,55,0.8)]" />
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
          <span className="flex-1 truncate text-sm leading-snug">{conv.title}</span>

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