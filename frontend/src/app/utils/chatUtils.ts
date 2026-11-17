import { Conversation, ConversationGroup } from '../types/chat';

let counter = 0;

export function generateId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function filesToDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(files.map(fileToDataUrl));
}

export function getConversationTitle(firstMessage: string): string {
  const clean = firstMessage.trim().replace(/\s+/g, ' ');
  if (clean.length <= 40) return clean;
  // Find last word boundary before 40 chars
  const truncated = clean.slice(0, 40);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
}

function getDayLabel(dateStr: string): 'today' | 'yesterday' | 'week' | 'older' {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);

  if (date >= todayStart) return 'today';
  if (date >= yesterdayStart) return 'yesterday';
  if (date >= weekStart) return 'week';
  return 'older';
}

export function groupConversationsByDate(conversations: Conversation[]): ConversationGroup[] {
  const groups: Record<string, Conversation[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  for (const conv of conversations) {
    const bucket = getDayLabel(conv.updatedAt);
    groups[bucket].push(conv);
  }

  const result: ConversationGroup[] = [];

  if (groups.today.length > 0) {
    result.push({ label: 'Today', conversations: groups.today });
  }
  if (groups.yesterday.length > 0) {
    result.push({ label: 'Yesterday', conversations: groups.yesterday });
  }
  if (groups.week.length > 0) {
    result.push({ label: 'Previous 7 days', conversations: groups.week });
  }
  if (groups.older.length > 0) {
    result.push({ label: 'Older', conversations: groups.older });
  }

  return result;
}