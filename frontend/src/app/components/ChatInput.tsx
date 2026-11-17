'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowUp, Square, Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModelOption, Source } from '../types/chat';
import { uploadDocument } from '@/lib/api';
import ModelSelector from './ModelSelector';

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onStopStreaming: () => void;
  isStreaming: boolean;
  selectedModel: ModelOption;
  models: ModelOption[];
  onSelectModel: (model: ModelOption) => void;
  sources?: Source[];
  onAttachSource?: (source: Source) => void;
  onRemoveSource?: (sourceId: number) => void;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export default function ChatInput({
  onSendMessage,
  onStopStreaming,
  isStreaming,
  selectedModel,
  models,
  onSelectModel,
  sources = [],
  onAttachSource,
  onRemoveSource,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'cowork'>('chat');
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming) return;
    onSendMessage(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const sendOnEnter = typeof window !== 'undefined'
      ? localStorage.getItem('pragna_send_on_enter') !== 'false'
      : true;

    if (sendOnEnter) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-selecting the same file later
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`"${file.name}" is too large (max 20MB).`);
        return;
      }
      setUploading(true);
      try {
        const doc = await uploadDocument(file);
        onAttachSource?.({ id: doc.id, filename: doc.filename, chunkCount: doc.chunk_count });
        toast.success(`Added "${doc.filename}" as a source (${doc.chunk_count} chunks indexed).`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [onAttachSource]
  );

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div
      className={`
        relative rounded-2xl border bg-card transition-all duration-200
        ${isFocused
          ? 'border-primary/40 shadow-premium-sm ring-2 ring-primary/20'
          : 'border-border/70 shadow-sm hover:border-border'
        }
      `}
    >
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
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

      {/* Textarea */}
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx,.xlsx,.pptx,.csv"
          className="hidden"
          onChange={handleFileSelected}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-shrink-0 mt-0.5 p-1.5 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 transition-colors duration-150 disabled:opacity-50"
          aria-label="Attach source file"
          title="Attach a file as a source"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Ask PRAGNA 1-A anything..."
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40
            resize-none outline-none leading-relaxed min-h-[26px] max-h-[200px] py-0.5"
          aria-label="Message input"
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 py-2.5">
        {/* Left: mode tabs */}
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-muted/40 rounded-lg p-0.5 border border-border/40">
            {(['chat', 'cowork'] as const).map((tab) => (
              <button
                key={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium capitalize transition-all duration-150
                  ${activeTab === tab
                    ? 'bg-card text-foreground shadow-sm border border-border/40 font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                  }
                `}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Right: model + voice + send */}
        <div className="flex items-center gap-1.5">
          <ModelSelector
            selectedModel={selectedModel}
            models={models}
            onSelectModel={onSelectModel}
            compact
          />

          {isStreaming ? (
            <button
              onClick={onStopStreaming}
              className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center
                hover:bg-foreground/80 transition-all duration-150 active:scale-90 flex-shrink-0 shadow-sm"
              aria-label="Stop generating"
            >
              <Square size={11} className="text-background fill-background" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`
                w-8 h-8 rounded-full flex items-center justify-center
                transition-all duration-200 active:scale-90 flex-shrink-0
                ${canSend
                  ? 'gold-gradient-btn hover:opacity-95 shadow-premium-sm cursor-pointer'
                  : 'bg-muted cursor-not-allowed opacity-50'
                }
              `}
              aria-label="Send message"
            >
              <ArrowUp size={14} strokeWidth={canSend ? 2.5 : 2} className={canSend ? 'text-[#1a1405]' : 'text-muted-foreground/40'} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}