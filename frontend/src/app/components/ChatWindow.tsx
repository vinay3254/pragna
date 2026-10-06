'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PanelLeftOpen, Share2, ChevronDown, ArrowDown, Code2, LayoutGrid, Wrench, Search, FileText, X, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Conversation, ModelOption, Source } from '../types/chat';
import { getAuthToken, uploadDocument } from '@/lib/api';
import { exportConversation } from '@/lib/exportConversation';
import { loadExportSettings } from '@/lib/exportSettings';
import { filesToDataUrls } from '../utils/chatUtils';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PromptInput from '@/components/ui/ai-chat-input';
import EmptyState from './EmptyState';
import AppLogo from '@/components/ui/AppLogo';

interface ChatWindowProps {
  conversation: Conversation | null;
  isStreaming: boolean;
  selectedModel: ModelOption;
  models: ModelOption[];
  onSelectModel: (model: ModelOption) => void;
  onSendMessage: (content: string, images?: string[], sources?: Source[], language?: string, modelOverride?: string) => void;
  onStopStreaming: () => void;
  onNewConversation: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onOpenArtifact?: (title: string, content: string, language?: string) => void;
  onToggleArtifact?: () => void;
  isArtifactOpen?: boolean;
  onOpenCommandPalette?: () => void;
  onOpenTools?: () => void;
  sources?: Source[];
  onRemoveSource?: (sourceId: number) => void;
  selectedLanguage?: string;
  onSelectLanguage?: (code: string) => void;
}

export default function ChatWindow({
  conversation,
  isStreaming,
  selectedModel,
  models,
  onSelectModel,
  onSendMessage,
  onStopStreaming,
  onNewConversation,
  onToggleSidebar,
  sidebarOpen,
  onOpenArtifact,
  onToggleArtifact,
  isArtifactOpen,
  onOpenCommandPalette,
  onOpenTools,
  sources = [],
  onRemoveSource,
  selectedLanguage = 'en',
  onSelectLanguage = () => {},
}: ChatWindowProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const isAtBottomRef = useRef(true);

  const handleShare = useCallback(async () => {
    if (!conversation) return;
    const shareableMessages = conversation.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    let shareUrl: string | null = null;
    try {
      const token = getAuthToken();
      const res = await fetch('/api/chat/0/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title: conversation.title, messages: shareableMessages }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.share_url) shareUrl = `${window.location.origin}${data.share_url}`;
      }
    } catch {
      // Backend unreachable — fall through to sharing raw text below.
    }

    if (shareUrl) {
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: conversation.title, url: shareUrl });
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Share link copied to clipboard');
        return;
      } catch {
        toast.error('Failed to copy share link');
        return;
      }
    }

    // Couldn't create a share link — fall back to sharing the raw text.
    const summary = [
      conversation.title,
      '',
      ...conversation.messages.map(m => `${m.role === 'user' ? 'You' : 'PRAGNA 1-A'}: ${m.content}`),
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: conversation.title, text: summary });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(summary);
      toast.success('Conversation copied to clipboard');
    } catch {
      toast.error('Failed to copy conversation');
    }
  }, [conversation]);

  const handleExport = useCallback(() => {
    if (!conversation) return;
    try {
      exportConversation(conversation, loadExportSettings());
      toast.success('Conversation exported');
    } catch {
      toast.error('Failed to export conversation');
    }
  }, [conversation]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 80;
    isAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && (conversation?.messages.length ?? 0) > 0);
  }, [conversation?.messages.length]);

  useEffect(() => {
    if (isStreaming && isAtBottomRef.current) {
      scrollToBottom(false);
    }
  }, [isStreaming, scrollToBottom, conversation?.messages]);

  useEffect(() => {
    setTimeout(() => scrollToBottom(false), 50);
    setShowJumpToBottom(false);
  }, [conversation?.id, scrollToBottom]);

  const hasMessages = (conversation?.messages.length ?? 0) > 0;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full relative bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 h-12 flex-shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 flex-shrink-0"
              aria-label="Open sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}

          {hasMessages && conversation ? (
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate max-w-[280px] lg:max-w-[400px]">
                {conversation.title}
              </span>
              <ChevronDown size={13} className="text-muted-foreground flex-shrink-0" />
            </div>
          ) : (
            !sidebarOpen && (
              <div className="flex items-center">
                <AppLogo size={22} variant="full" />
              </div>
            )
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasMessages && (
            <button
              onClick={handleExport}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
              text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60
              transition-all duration-150 active:scale-95"
              title="Export conversation"
            >
              <Download size={12} />
              Export
            </button>
          )}

          {hasMessages && (
            <button
              onClick={handleShare}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
              text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60
              transition-all duration-150 active:scale-95"
            >
              <Share2 size={12} />
              Share
            </button>
          )}
        </div>
      </header>

      {/* Chat area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {hasMessages && conversation ? (
          <MessageList
            messages={conversation.messages}
            isStreaming={isStreaming}
            selectedLanguage={selectedLanguage}
            onOpenArtifact={onOpenArtifact}
          />
        ) : (
          <EmptyState
            onSendMessage={onSendMessage}
            selectedModel={selectedModel}
            models={models}
            onSelectModel={onSelectModel}
            onStopStreaming={onStopStreaming}
            isStreaming={isStreaming}
            selectedLanguage={selectedLanguage}
            onSelectLanguage={onSelectLanguage}
          />
        )}
      </div>

      {/* Jump to bottom pill */}
      {showJumpToBottom && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10 jump-pill">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium
              bg-card border border-border shadow-md text-muted-foreground hover:text-foreground
              hover:bg-muted transition-all duration-150 active:scale-95"
          >
            <ArrowDown size={12} />
            Jump to latest
          </button>
        </div>
      )}

      {/* Input area — only shown when conversation is active */}
      {hasMessages && (
        <div className="flex-shrink-0 px-4 pb-4 pt-3 bg-background/80 backdrop-blur-md">
          <div className="max-w-chat mx-auto flex flex-col items-center">
            {/* Attached sources — added via the + inside the reply box below */}
            {sources.length > 0 && (
              <div className="w-full flex flex-wrap items-center gap-1.5 mb-2">
                {sources.map(source => (
                  <div
                    key={source.id}
                    className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-muted/60 border border-border/60 text-xs text-foreground"
                  >
                    <FileText size={12} className="text-muted-foreground shrink-0" />
                    <span className="max-w-[160px] truncate">{source.filename}</span>
                    <button
                      onClick={() => onRemoveSource?.(source.id)}
                      className="p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
                      aria-label={`Remove ${source.filename}`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <PromptInput
              onSubmit={async (msg, meta) => {
                let chosenModelId = selectedModel?.id;
                if (meta?.model && onSelectModel) {
                  const found = models.find(m => m.label === meta.model || m.id === meta.model);
                  if (found) {
                    chosenModelId = found.id;
                    onSelectModel(found);
                  }
                }

                if (meta?.language && onSelectLanguage) {
                  onSelectLanguage(meta.language);
                }

                const allFiles = meta?.attachments || [];
                const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
                const docFiles = allFiles.filter(f => !f.type.startsWith('image/'));

                // Pass uploads straight to onSendMessage: attaching via state first
                // races the send, so the reply would go out without the sources.
                const uploaded: Source[] = [];
                for (const file of docFiles) {
                  try {
                    const doc = await uploadDocument(file);
                    uploaded.push({ id: doc.id, filename: doc.filename, chunkCount: doc.chunk_count });
                    toast.success(`Added "${doc.filename}" as a source.`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : `Failed to attach "${file.name}"`);
                  }
                }

                const images = imageFiles.length > 0 ? await filesToDataUrls(imageFiles) : undefined;
                const finalMsg = msg.trim() || (docFiles.length > 0 ? `Take a look at ${docFiles.map(f => f.name).join(', ')}.` : msg);
                onSendMessage(finalMsg, images, uploaded.length > 0 ? uploaded : undefined, meta?.language, chosenModelId);
              }}
              placeholder="Reply to PRAGNA 1-A..."
              initialModel={selectedModel?.label || "Tvarā"}
              models={models.map(m => m.label)}
              onModelChange={(modelLabel) => {
                const found = models.find(m => m.label === modelLabel || m.id === modelLabel);
                if (found && onSelectModel) onSelectModel(found);
              }}
              isStreaming={isStreaming}
              onStopStreaming={onStopStreaming}
              collapsedWidth={440}
              expandedWidth={720}
              selectedLanguage={selectedLanguage}
              onLanguageChange={onSelectLanguage}
            />
            <p className="text-center text-[0.6875rem] text-muted-foreground/50 mt-2 tracking-wide">
              PRAGNA 1-A may make mistakes. Verify important information.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
