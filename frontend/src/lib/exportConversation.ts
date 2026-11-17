import { Conversation } from '@/app/types/chat';
import { ExportSettings } from './exportSettings';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'conversation';
}

function buildFilename(pattern: string, conversation: Conversation, ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const name = pattern
    .replace('{title}', slugify(conversation.title))
    .replace('{date}', date)
    .replace('{model}', slugify(conversation.model || 'pragna'));
  return `${name}.${ext}`;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function buildExportContent(
  conversation: Conversation,
  settings: ExportSettings
): { content: string; ext: string; mime: string } {
  const { defaultFormat, includeMetadata, includeTimestamps, includeModelInfo } = settings;

  if (defaultFormat === 'json') {
    const data = {
      ...(includeMetadata ? { title: conversation.title, createdAt: conversation.createdAt } : {}),
      ...(includeModelInfo ? { model: conversation.model } : {}),
      messages: conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(includeTimestamps ? { timestamp: m.timestamp } : {}),
      })),
    };
    return { content: JSON.stringify(data, null, 2), ext: 'json', mime: 'application/json' };
  }

  const isMarkdown = defaultFormat === 'markdown';
  const lines: string[] = [];
  if (isMarkdown) lines.push(`# ${conversation.title}`, '');
  else lines.push(conversation.title, '='.repeat(conversation.title.length), '');

  if (includeMetadata) {
    lines.push(`Created: ${formatTimestamp(conversation.createdAt)}`);
    if (includeModelInfo && conversation.model) lines.push(`Model: ${conversation.model}`);
    lines.push('');
  }

  for (const m of conversation.messages) {
    const speaker = m.role === 'user' ? 'You' : 'PRAGNA 1-A';
    const label = isMarkdown ? `**${speaker}**` : speaker;
    const time = includeTimestamps ? ` (${formatTimestamp(m.timestamp)})` : '';
    lines.push(`${label}${time}:`, m.content, '');
  }

  return { content: lines.join('\n'), ext: isMarkdown ? 'md' : 'txt', mime: 'text/plain' };
}

export function exportConversation(conversation: Conversation, settings: ExportSettings): void {
  const { content, ext, mime } = buildExportContent(conversation, settings);
  const filename = buildFilename(settings.filenamePattern, conversation, ext);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
