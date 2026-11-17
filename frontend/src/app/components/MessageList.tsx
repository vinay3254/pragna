'use client';

import React, { useCallback } from 'react';
import { Message } from '../types/chat';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  selectedLanguage?: string;
  onOpenArtifact?: (title: string, content: string, language?: string) => void;
  onRetryLast?: () => void;
  onEditMessage?: (messageId: string, content: string) => void;
}

function getDateLabel(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDay.getTime() === today.getTime()) return 'Today';
    if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';

    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: msgDay.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

function getDayKey(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  } catch {
    return '';
  }
}

export default function MessageList({ messages, isStreaming, selectedLanguage, onOpenArtifact, onRetryLast, onEditMessage }: MessageListProps) {
  const handleRetry = useCallback(() => {
    onRetryLast?.();
  }, [onRetryLast]);

  return (
    <div className="max-w-chat mx-auto px-4 py-5 space-y-3">
      {messages.map((message, index) => {
        const currentDayKey = getDayKey(message.timestamp);
        const prevDayKey = index > 0 ? getDayKey(messages[index - 1].timestamp) : null;
        const showDateSeparator = currentDayKey !== '' && currentDayKey !== prevDayKey;
        const dateSeparatorLabel = showDateSeparator ? getDateLabel(message.timestamp) : undefined;

        return (
          <MessageBubble
            key={message.id}
            message={message}
            isLastMessage={index === messages.length - 1}
            isStreaming={isStreaming && index === messages.length - 1}
            showDateSeparator={showDateSeparator}
            dateSeparatorLabel={dateSeparatorLabel}
            selectedLanguage={selectedLanguage}
            onOpenArtifact={onOpenArtifact}
            onEdit={message.role === 'user' && onEditMessage ? content => onEditMessage(message.id, content) : undefined}
            canEdit={!isStreaming}
            onRetry={index === messages.length - 1 && message.role === 'assistant' && (
              message.content.includes("Could not connect") ||
              message.content.includes("Error:") ||
              message.content.startsWith("*(Error:")
            ) ? handleRetry : undefined}
          />
        );
      })}
    </div>
  );
}
