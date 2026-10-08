import type { Conversation } from '@/app/types/chat';
import { getAuthToken } from '@/lib/api';
import { persistChatValue, readChatValue, readDeletedChatIds, subscribeChatHistory } from '@/lib/chat-storage';

const SYNC_STATE_PREFIX = 'pragna_chat_sync:';
const BATCH_SIZE = 25;
const DEBOUNCE_MS = 3000;

interface SyncState {
  cursor: string | null; // newest server change already applied
  pushedAt: string | null; // chats updated after this have not been uploaded yet
}

interface SyncResponse {
  chats: Conversation[];
  deleted_ids: string[];
  cursor: string | null;
}

async function readState(stateKey: string): Promise<SyncState> {
  try {
    const raw = await readChatValue(stateKey);
    if (raw) return JSON.parse(raw);
  } catch {
    // A missing state only means a full sync.
  }
  return { cursor: null, pushedAt: null };
}

async function pushAndPull(historyKey: string, token: string): Promise<void> {
  const stateKey = SYNC_STATE_PREFIX + historyKey;
  const state = await readState(stateKey);
  const startedAt = new Date().toISOString();

  const stored = await readChatValue(historyKey);
  const local: Conversation[] = stored ? JSON.parse(stored) : [];
  const changed = local.filter(chat =>
    (!state.pushedAt || chat.updatedAt > state.pushedAt) && !chat.messages.some(message => message.isStreaming));
  const deletedIds = (await readDeletedChatIds(historyKey)).slice(-5000);

  let cursor = state.cursor;
  const remote: Conversation[] = [];
  const remoteDeleted: string[] = [];
  for (let start = 0; start === 0 || start < changed.length; start += BATCH_SIZE) {
    const response = await fetch('/api/chat/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        chats: changed.slice(start, start + BATCH_SIZE),
        deleted_ids: start === 0 ? deletedIds : [],
        since: state.cursor,
      }),
    });
    if (!response.ok) throw new Error(`Chat sync failed: ${response.status}`);
    const result: SyncResponse = await response.json();
    remote.push(...result.chats);
    remoteDeleted.push(...result.deleted_ids);
    cursor = result.cursor;
  }

  // Merge through the history store so deletions and edit branches keep their usual rules.
  for (const id of remoteDeleted) await persistChatValue(historyKey, '[]', id);
  if (remote.length) await persistChatValue(historyKey, JSON.stringify(remote));
  await persistChatValue(stateKey, JSON.stringify({ cursor, pushedAt: startedAt }));
}

/** Keep this account's chat history in step with the server. Returns a cleanup function. */
export function startChatSync(historyKey: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  const run = async () => {
    const token = getAuthToken();
    if (!token || stopped) return;
    if (running) { again = true; return; }
    running = true;
    try {
      await pushAndPull(historyKey, token);
    } catch (error) {
      console.warn('Chat sync will retry on the next change.', error);
    } finally {
      running = false;
      if (again && !stopped) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void run(); };

  const unsubscribe = subscribeChatHistory(historyKey, schedule);
  document.addEventListener('visibilitychange', onVisible);
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
