'use client';

import React, { useState } from 'react';
import { MoreHorizontal, Share2, Download, Pencil, Command, Sun, Moon, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useChat } from '@/context/ChatContext';

interface ChatHeaderProps {
  onOpenCommandPalette?: () => void;
  onOpenTools?: () => void;
}

export default function ChatHeader({ onOpenCommandPalette, onOpenTools }: ChatHeaderProps) {
  const {
    conversations,
    activeConversationId,
    messages,
    renameActiveConversation,
    documents,
    isDarkMode,
    toggleDarkMode,
  } = useChat();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const title = activeConversation?.title ?? 'New conversation';

  const startEditing = () => {
    setDraftTitle(title);
    setEditing(true);
  };

  const commitEdit = async () => {
    setEditing(false);
    if (draftTitle.trim() && draftTitle !== title && activeConversationId != null) {
      await renameActiveConversation(draftTitle.trim());
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.origin + (activeConversationId ? `?chat=${activeConversationId}` : '');
    const docSummary = documents.length > 0 ? `\nAttached Knowledge Files: ${documents.map(d => d.filename).join(', ')}` : '';
    const shareText = `Pragna Conversation: ${title}${docSummary}\n${shareUrl}`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text: `Check out this Pragna AI conversation: ${title}`, url: shareUrl });
        toast.success('Shared successfully!');
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      toast.success('Share link and file summary copied to clipboard!');
    } catch {
      toast.error('Failed to copy share link');
    }
  };

  const handleExport = (format: 'md' | 'json' = 'md') => {
    if (messages.length === 0 && documents.length === 0) {
      toast.info('No content to export');
      return;
    }

    let content = '';
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeTitle || 'conversation'}.${format}`;
    let mimeType = 'text/markdown';

    if (format === 'json') {
      mimeType = 'application/json';
      content = JSON.stringify(
        {
          title,
          conversation_id: activeConversationId,
          exported_at: new Date().toISOString(),
          documents: documents.map((d) => ({ id: d.id, filename: d.filename, chunks: d.chunk_count })),
          messages: messages.map((m) => ({ role: m.role, content: m.content, model: m.model, sources: m.sources })),
        },
        null,
        2
      );
    } else {
      content = `# ${title}\n\n`;
      if (documents.length > 0) {
        content += `## Knowledge Base Files\n`;
        for (const doc of documents) {
          content += `- **${doc.filename}** (${doc.chunk_count} chunks)\n`;
        }
        content += `\n---\n\n`;
      }
      for (const m of messages) {
        const roleStr = m.role === 'user' ? '**User**' : `**Pragna (${m.model || 'Assistant'})**`;
        content += `${roleStr}:\n${m.content}\n\n---\n\n`;
      }
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported as ${format.toUpperCase()}!`);
  };

  return (
    <>
      <header className="h-14 flex items-center justify-between px-5 border-b border-border bg-card shrink-0">
        {/* Left: title */}
        <div className="flex items-center gap-2 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e?.target?.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => e?.key === 'Enter' && commitEdit()}
              className="text-sm font-medium bg-muted border border-border rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-ring w-72"
            />
          ) : (
            <button
              onClick={startEditing}
              disabled={activeConversationId == null}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-xs disabled:hover:text-foreground disabled:cursor-default"
              title={activeConversationId != null ? 'Click to rename' : undefined}
            >
              {title}
            </button>
          )}
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
              {messages.length} messages
            </span>
          )}
        </div>

        {/* Right: toolbar */}
        <div className="flex items-center gap-1.5">
          {/* Tools & Skills Trigger */}
          {onOpenTools && (
            <button
              onClick={onOpenTools}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
              title="Agent Tools & Capabilities"
            >
              <Wrench size={14} className="text-primary" />
              <span className="hidden sm:inline">Tools</span>
            </button>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Cmd+K palette trigger */}
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
              title="Command palette (⌘K)"
            >
              <Command size={14} />
              <kbd className="font-mono text-[10px] hidden sm:inline">⌘K</kbd>
            </button>
          )}

          <button
            onClick={handleShare}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Share conversation and files"
          >
            <Share2 size={16} />
          </button>

          <button
            onClick={() => handleExport('md')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Export conversation & files as Markdown"
          >
            <Download size={16} />
          </button>

          {/* More options menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="More options"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 w-48 bg-card border border-border rounded-xl shadow-lg z-50 py-1 fade-in">
                <button
                  onClick={() => { startEditing(); setMenuOpen(false); }}
                  disabled={activeConversationId == null}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-default"
                >
                  <Pencil size={14} />
                  Rename chat
                </button>
                <button
                  onClick={() => { handleExport('md'); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <Download size={14} />
                  Export as Markdown
                </button>
                <button
                  onClick={() => { handleExport('json'); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <Share2 size={14} />
                  Export as JSON
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
