import type { Conversation } from '@/app/types/chat';

const DATABASE_NAME = 'pragna-chat-history';
const STORE_NAME = 'values';
const HISTORY_PREFIX = 'claudechat_conversations:';
const HISTORY_EVENT = 'pragna-chat-history-updated';
const CHANNEL_NAME = 'pragna-chat-history';

interface StoredValue {
  key: string;
  value: string | null;
  deletedIds?: string[];
}

let databasePromise: Promise<IDBDatabase> | null = null;
const pendingWrites = new Map<string, Promise<void>>();

function mergeHistory(saved: string | null, incoming: string | null, deletedIds: string[]): string {
  const stored: Conversation[] = saved ? JSON.parse(saved) : [];
  const next: Conversation[] = incoming ? JSON.parse(incoming) : [];
  const deleted = new Set(deletedIds);
  const conversations = new Map(stored.map(conversation => [conversation.id, conversation]));
  for (const conversation of next) {
    const previous = conversations.get(conversation.id);
    if (!previous) {
      conversations.set(conversation.id, conversation);
      continue;
    }
    const newer = Date.parse(conversation.updatedAt) >= Date.parse(previous.updatedAt);
    if ((conversation.historyRevision ?? 0) !== (previous.historyRevision ?? 0)) {
      // An edit intentionally replaces later turns. Never merge the discarded
      // branch back in from IndexedDB, localStorage, or an older browser tab.
      conversations.set(conversation.id, (conversation.historyRevision ?? 0) > (previous.historyRevision ?? 0) ? conversation : previous);
      continue;
    }
    const messages = new Map(previous.messages.map(message => [message.id, message]));
    for (const message of conversation.messages) {
      const existing = messages.get(message.id);
      if (!existing || (newer && (message.content || !existing.content))) messages.set(message.id, message);
    }
    conversations.set(conversation.id, {
      ...(newer ? conversation : previous),
      messages: [...messages.values()],
    });
  }
  return JSON.stringify([...conversations.values()]
    .filter(conversation => !deleted.has(conversation.id))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
}

function announceHistory(key: string) {
  if (!key.startsWith(HISTORY_PREFIX)) return;
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: key }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(key);
    channel.close();
  }
}

export function subscribeChatHistory(key: string, onUpdate: () => void): () => void {
  const onLocal = (event: Event) => { if ((event as CustomEvent<string>).detail === key) onUpdate(); };
  const onStorage = (event: StorageEvent) => { if (event.key === key) onUpdate(); };
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  if (channel) channel.onmessage = event => { if (event.data === key) onUpdate(); };
  window.addEventListener(HISTORY_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(HISTORY_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Chat history database is blocked.'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function writeDatabase(key: string, value: string | null, deletedId?: string): Promise<StoredValue> {
  const database = await openDatabase();
  return new Promise<StoredValue>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let record: StoredValue = { key, value };
    if (key.startsWith(HISTORY_PREFIX)) {
      // Read and merge inside one transaction: different tabs cannot replace each other's history.
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const previous = request.result as StoredValue | undefined;
          const deletedIds = [...new Set([...(previous?.deletedIds ?? []), ...(deletedId ? [deletedId] : [])])];
          record = { key, value: mergeHistory(previous?.value ?? null, value, deletedIds), deletedIds };
          store.put(record);
        } catch {
          transaction.abort();
        }
      };
    } else store.put(record);
    transaction.oncomplete = () => resolve(record);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

/** Keep browser history durable even when images fill localStorage's small quota. */
export function persistChatValue(key: string, value: string | null, deletedId?: string): Promise<void> {
  let localSaved = false;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    localSaved = true;
  } catch {
    // IndexedDB stores the complete history when localStorage cannot accept it.
  }

  // Serialize writes to each account/key so older snapshots cannot land last.
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(() => writeDatabase(key, value, deletedId))
    .then(record => {
      try {
        if (record.value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, record.value);
      } catch {
        // The merged record is already committed to IndexedDB.
      }
      announceHistory(key);
    }).catch(error => {
      if (!localSaved || deletedId) throw error;
    });
  pendingWrites.set(key, write);
  void write.finally(() => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }).catch(() => {});
  return write;
}

export async function readChatValue(key: string): Promise<string | null> {
  await pendingWrites.get(key)?.catch(() => {});
  try {
    const database = await openDatabase();
    const record = await new Promise<StoredValue | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (record) {
      if (key.startsWith(HISTORY_PREFIX)) {
        // Older app tabs still write localStorage, so recover their saved messages too.
        let local: string | null;
        try { local = localStorage.getItem(key); } catch { return record.value; }
        const merged = mergeHistory(record.value, local, record.deletedIds ?? []);
        if (merged !== record.value) await persistChatValue(key, merged);
        return merged;
      }
      return record.value;
    }
  } catch {
    // Existing local history remains available when IndexedDB is unavailable.
  }

  const legacy = localStorage.getItem(key);
  if (legacy !== null) {
    // Migrate only the requested account's existing history.
    await persistChatValue(key, legacy);
  }
  return legacy;
}
