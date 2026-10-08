'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import ArtifactPanel from './ArtifactPanel';
import CommandPalette from './CommandPalette';
import ToolsPanel from './ToolsPanel';
import ImageGenerationModal from './ImageGenerationModal';
import { Conversation, Message, ModelOption, Source } from '../types/chat';
import { generateId, getConversationTitle, groupConversationsByDate } from '../utils/chatUtils';
import { SANSKRIT_MODELS } from '@/lib/modelDisplayNames';
import { getAuthToken } from '@/lib/api';
import { persistChatValue, readChatValue, subscribeChatHistory } from '@/lib/chat-storage';
import { useAuth } from '@/context/AuthContext';
import { notifyIfBackgrounded } from '@/lib/notifications';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';

export const MODELS: ModelOption[] = SANSKRIT_MODELS.map((m) => ({
  id: m.id,
  label: m.displayName,
  description: m.subtitle,
}));

const THEME_KEY = 'claudechat_theme';

function getUserIdentifier(user: { id?: number | string | null; email?: string | null } | null): string | null {
  if (!user) return null;
  if (user.id !== undefined && user.id !== null && String(user.id).trim() !== '') {
    return String(user.id).trim();
  }
  if (user.email && String(user.email).trim() !== '') {
    return String(user.email).trim();
  }
  return null;
}

function getConversationsStorageKey(user: { id?: number | string | null; email?: string | null } | null): string | null {
  const identifier = getUserIdentifier(user);
  return identifier ? `claudechat_conversations:${identifier}` : null;
}

function getActiveStorageKey(user: { id?: number | string | null; email?: string | null } | null): string | null {
  const identifier = getUserIdentifier(user);
  return identifier ? `claudechat_active:${identifier}` : null;
}

async function loadConversations(user: { id?: number | string | null; email?: string | null } | null): Promise<Conversation[]> {
  if (typeof window === 'undefined') return [];
  const key = getConversationsStorageKey(user);
  if (!key) return [];
  try {
    const raw = await readChatValue(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    toast.error('Chat history could not be loaded. Existing saved data has not been cleared.', { id: 'chat-history-load-error' });
    return [];
  }
}

async function loadRecoveredConversations(
  user: { id?: number | string | null; email?: string | null } | null,
  local: Conversation[],
  token: string | null,
): Promise<Conversation[]> {
  const key = getConversationsStorageKey(user);
  if (!key || !token) return local;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const response = await fetch('/api/conversations?q=Recovered%3A', { headers, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return local;
    const remoteList = await response.json();
    const recovered: Conversation[] = [];
    for (const entry of remoteList) {
      if (!String(entry.title).startsWith('Recovered:')) continue;
      const detail = await fetch(`/api/conversations/${entry.id}`, { headers, signal: AbortSignal.timeout(3000) });
      if (!detail.ok) continue;
      const remote = await detail.json();
      if (String(remote.user_id) !== String(user?.id)) continue;
      const id = `recovered-${remote.id}`;
      if (local.some(c => c.id === id)) continue;
      const messages: Message[] = (remote.messages || [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ id: `${id}-${m.id}`, role: m.role, content: m.content, timestamp: m.created_at }));
      const prompts = messages.filter(m => m.role === 'user').map(m => m.content);
      // A surviving copy of the same chat needs no second sidebar entry.
      if (prompts.length && local.some(c => prompts.every(prompt => c.messages.some(m => m.role === 'user' && m.content === prompt)))) continue;
      if (messages.length) recovered.push({ id, title: remote.title, messages,
        model: MODELS[0].id, createdAt: remote.created_at,
        updatedAt: messages.at(-1)?.timestamp || remote.created_at });
    }
    if (!recovered.length) return local;
    await persistChatValue(key, JSON.stringify([...local, ...recovered]));
    // The durable merge also honors deletion tombstones on later imports.
    return loadConversations(user);
  } catch {
    return local;
  }
}

function saveConversations(user: { id?: number | string | null; email?: string | null } | null, convs: Conversation[]) {
  if (typeof window === 'undefined') return;
  const key = getConversationsStorageKey(user);
  if (!key) return; // Never write while user is null
  try {
    void persistChatValue(key, JSON.stringify(convs)).catch(() => {
      toast.error('Chat history could not be saved. Keep this tab open and export important chats.', { id: 'chat-history-save-error' });
    });
  } catch {
    toast.error('Chat history could not be saved. Keep this tab open and export important chats.', { id: 'chat-history-save-error' });
  }
}

async function loadActiveConversationId(user: { id?: number | string | null; email?: string | null } | null): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const key = getActiveStorageKey(user);
  if (!key) return null;
  try {
    return await readChatValue(key);
  } catch {
    return null;
  }
}

function saveActiveConversationId(user: { id?: number | string | null; email?: string | null } | null, id: string | null) {
  if (typeof window === 'undefined') return;
  const key = getActiveStorageKey(user);
  if (!key) return; // Never write while user is null
  try {
    void persistChatValue(key, id).catch(() => {
      toast.error('Selected chat could not be saved. Chat history remains separate.', { id: 'chat-selection-save-error' });
    });
  } catch {
    // Ignore error
  }
}

function loadTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export default function ChatInterface() {
  const { user } = useAuth();
  const userRef = React.useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOwner, setHistoryOwner] = useState<string | null>(null);
  const historyReady = historyOwner !== null && historyOwner === getConversationsStorageKey(user);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(MODELS[0]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isStreaming, setIsStreaming] = useState(false);
  const streamControllerRef = React.useRef<AbortController | null>(null);
  const [mounted, setMounted] = useState(false);

  // Integrated feature states
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<{ title: string; content: string; language?: string } | null>(null);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [imageStudioOpen, setImageStudioOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    if (typeof window === 'undefined') return 'en';
    const initialized = localStorage.getItem('pragna_lang_initialized');
    if (!initialized) {
      localStorage.setItem('pragna_selected_language', 'en');
      localStorage.setItem('pragna_lang_initialized', 'true');
      return 'en';
    }
    return localStorage.getItem('pragna_selected_language') || 'en';
  });

  const handleSelectLanguage = useCallback((langCode: string) => {
    setSelectedLanguage(langCode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pragna_selected_language', langCode);
    }
  }, []);

  const handleOpenArtifact = useCallback((title: string, content: string, language?: string) => {
    setActiveArtifact({ title, content, language });
    setArtifactOpen(true);
  }, []);

  // Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Synchronize authenticated user identity with localStorage
  useEffect(() => {
    if (user?.name) {
      localStorage.setItem('claudechat_user_name', user.name);
    } else if (user?.email) {
      const emailName = user.email.split('@')[0];
      const formatted = emailName.charAt(0).toUpperCase() + emailName.slice(1);
      localStorage.setItem('claudechat_user_name', formatted);
    }
  }, [user]);

  // Load theme and mount on client
  useEffect(() => {
    const savedTheme = loadTheme();
    setTheme(savedTheme);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setSidebarOpen(false);
    }
    setMounted(true);
  }, []);

  // Load user-specific conversations and active ID whenever user changes
  useEffect(() => {
    let cancelled = false;
    // When user changes or logs out, first reset states to avoid flashing previous account's chats
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    setIsStreaming(false);
    setConversations([]);
    setHistoryOwner(null);
    setActiveConversationId(null);
    setArtifactOpen(false);
    setActiveArtifact(null);

    if (!user) return;

    const token = getAuthToken();
    void Promise.all([loadConversations(user).then(saved => loadRecoveredConversations(user, saved, token)), loadActiveConversationId(user)]).then(([savedConvs, savedActive]) => {
      if (cancelled) return;
      // Backfill titles of older conversations after loading this account's history.
      let backfilled = false;
      const fixedConvs = savedConvs.map(c => {
        if (c.title !== 'New conversation') return c;
        const firstUserMsg = c.messages.find(m => m.role === 'user');
        if (!firstUserMsg) return c;
        backfilled = true;
        return { ...c, title: getConversationTitle(firstUserMsg.content) };
      });
      if (backfilled) saveConversations(user, fixedConvs);

      setConversations(fixedConvs);
      if (savedActive && fixedConvs.some(c => c.id === savedActive)) {
        setActiveConversationId(savedActive);
      } else {
        setActiveConversationId(null);
        saveActiveConversationId(user, null);
      }
      setHistoryOwner(getConversationsStorageKey(user));
    });
    return () => { cancelled = true; };
  }, [user?.id, user?.email]);

  useEffect(() => () => {
    streamControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const key = getConversationsStorageKey(user);
    if (!key || !historyReady) return;
    let cancelled = false;
    const unsubscribe = subscribeChatHistory(key, () => {
      void loadConversations(user).then(saved => {
        if (!cancelled && !streamControllerRef.current) setConversations(saved);
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [user?.id, user?.email, historyReady]);

  // Scheduled tasks run on the backend and post their answers into a backend chat.
  // Poll the tasks and copy those answers into this account's persisted history,
  // local scheduled chat, with a toast when a new answer arrives.
  const activeConversationIdRef = React.useRef(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!user || !historyReady) return;
    const syncedRunKeys = new Map<number, string>();
    const pendingOpen = new URLSearchParams(window.location.search).get('open');
    const seenMessageIds = new Set<string>();
    let firstPoll = true;
    let cancelled = false;

    const poll = async () => {
      try {
        const token = getAuthToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch('/api/tools/scheduled', { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const jobs: any[] = data?.jobs || [];

        for (const job of jobs) {
          if (!job.conversation_id) continue;
          const runKey = `${job.last_run || ''}:${job.status}:${job.running ? 1 : 0}:${(job.last_result || '').length}`;
          if (syncedRunKeys.get(job.id) === runKey) continue;
          syncedRunKeys.set(job.id, runKey);

          const convRes = await fetch(`/api/conversations/${job.conversation_id}`, { headers });
          if (!convRes.ok) continue;
          const remote = await convRes.json();
          if (cancelled) return;
          const localId = `sched-${job.conversation_id}`;
          const remoteMessages: Message[] = (remote.messages || []).map((m: any) => ({
            id: `${localId}-${m.id}`,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
            timestamp: m.created_at || new Date().toISOString(),
          }));

          const addedCount = remoteMessages.filter(m => !seenMessageIds.has(m.id)).length;
          remoteMessages.forEach(m => seenMessageIds.add(m.id));
          setConversations(prev => {
            const existing = prev.find(c => c.id === localId);
            const knownIds = new Set((existing?.messages || []).map(m => m.id));
            const fresh = remoteMessages.filter(m => !knownIds.has(m.id));
            if (fresh.length === 0) return prev;
            const now = new Date().toISOString();
            const updated = existing
              ? prev.map(c => (c.id === localId ? { ...c, messages: [...c.messages, ...fresh], updatedAt: now } : c))
              : [
                  {
                    id: localId,
                    title: String(remote.title || job.title || 'Scheduled task').replace(/^\u23f0\uFE0F?\s*/, ''),
                    messages: fresh,
                    model: 'scheduled-task',
                    createdAt: remote.created_at || now,
                    updatedAt: now,
                  } as Conversation,
                  ...prev,
                ];
            saveConversations(userRef.current, updated);
            return updated;
          });

          if (pendingOpen === localId) {
            setActiveConversationId(localId);
            window.history.replaceState(null, '', window.location.pathname);
          }

          if (!firstPoll && addedCount > 0) {
            toast(`Result ready: ${job.title || 'Scheduled task'}`, {
              icon: <Clock size={16} />,
              duration: 15000,
              action: { label: 'Open', onClick: () => setActiveConversationId(localId) },
            });
            notifyIfBackgrounded('Pragna scheduled task', job.title || 'Result ready');
          }
        }
        firstPoll = false;
      } catch {
        // Network hiccup: try again on the next tick.
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id, historyReady]);

  // Apply theme to document
  useEffect(() => {
    if (!mounted) return;
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, mounted]);

  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? null;

  const removeSource = useCallback((sourceId: number) => {
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeConversationIdRef.current) return c;
        return { ...c, sources: (c.sources || []).filter(s => s.id !== sourceId) };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });
  }, []);

  const stopStreaming = useCallback(() => {
    if (!streamControllerRef.current) return;
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    setIsStreaming(false);
    setConversations(prev => {
      const updated = prev.map(c => ({
        ...c,
        messages: c.messages.map(m => ({ ...m, isStreaming: false })),
      }));
      saveConversations(userRef.current, updated);
      return updated;
    });
  }, []);

  const createNewConversation = useCallback(() => {
    stopStreaming();
    const newConv: Conversation = {
      id: generateId('conv'),
      title: 'New conversation',
      messages: [],
      model: selectedModel.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setConversations(prev => {
      const updated = [newConv, ...prev];
      saveConversations(userRef.current, updated);
      return updated;
    });
    setActiveConversationId(newConv.id);
    saveActiveConversationId(userRef.current, newConv.id);
  }, [selectedModel.id, stopStreaming]);

  const selectConversation = useCallback((id: string) => {
    stopStreaming();
    setActiveConversationId(id);
    saveActiveConversationId(userRef.current, id);
  }, [stopStreaming]);

  const deleteConversation = useCallback((id: string) => {
    if (activeConversationId === id) stopStreaming();
    const key = getConversationsStorageKey(userRef.current);
    if (key) {
      void persistChatValue(key, '[]', id).catch(() => {
        toast.error('Chat deletion could not be saved.', { id: 'chat-deletion-save-error' });
      });
    }
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConversations(userRef.current, updated);
      return updated;
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
      saveActiveConversationId(userRef.current, null);
    }
  }, [activeConversationId, stopStreaming]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === id ? { ...c, title: newTitle, updatedAt: new Date().toISOString() } : c
      );
      saveConversations(userRef.current, updated);
      return updated;
    });
  }, []);

  // Backend integration point: replace simulateStream with real fetch to /api/chat
  const sendMessage = useCallback(async (content: string, images?: string[], newSources?: Source[], language?: string, modelOverride?: string, editMessageId?: string) => {
    if ((!content.trim() && !images?.length && !newSources?.length && !editMessageId) || streamControllerRef.current) return;
    const titleSource = content.trim() || (images?.length ? 'Shared a photo' : 'Shared a file');

    let convId = conversations.some(c => c.id === activeConversationId) ? activeConversationId : null;
    const currentConversation = conversations.find(c => c.id === convId);
    const editIndex = editMessageId ? currentConversation?.messages.findIndex(message => message.id === editMessageId && message.role === 'user') ?? -1 : -1;
    if (editMessageId && editIndex < 0) return;
    const originalMessage = editIndex >= 0 ? currentConversation?.messages[editIndex] : undefined;
    if (!content.trim() && !images?.length && !newSources?.length && !originalMessage?.files?.length) return;
    const precedingMessages = editIndex >= 0 ? currentConversation!.messages.slice(0, editIndex) : currentConversation?.messages ?? [];
    const historyRevision = editMessageId ? Math.max(Date.now(), (currentConversation?.historyRevision ?? 0) + 1) : undefined;
    // "New conversation" is also true for a conversation pre-created empty by the
    // "+ New chat" button — not just one created in this very call — so its title
    // still gets derived from the first real message sent into it.
    let isNewConv = convId ? conversations.find(c => c.id === convId)?.messages.length === 0 : false;

    const effectiveModelId = modelOverride || selectedModel.id;

    if (!convId) {
      const newConv: Conversation = {
        id: generateId('conv'),
        title: getConversationTitle(titleSource),
        messages: [],
        model: effectiveModelId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sources: newSources?.length ? newSources : undefined,
      };
      convId = newConv.id;
      isNewConv = true;
      setConversations(prev => {
        const updated = [newConv, ...prev];
        saveConversations(userRef.current, updated);
        return updated;
      });
      setActiveConversationId(convId);
      saveActiveConversationId(userRef.current, convId);
    } else if (newSources?.length) {
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== convId) return c;
          const existing = c.sources || [];
          const merged = [...existing, ...newSources.filter(s => !existing.some(e => e.id === s.id))];
          return { ...c, sources: merged };
        });
        saveConversations(userRef.current, updated);
        return updated;
      });
    }

    const userMessage: Message = {
      id: originalMessage?.id || generateId('msg'),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      images,
      files: originalMessage?.files || (newSources?.length ? newSources.map(s => s.filename) : undefined),
    };

    // Add user message
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = [...(editMessageId ? precedingMessages : c.messages), userMessage];
        return {
          ...c,
          messages: msgs,
          title: isNewConv || editIndex === 0 ? getConversationTitle(titleSource) : c.title,
          ...(historyRevision ? { historyRevision } : {}),
          updatedAt: new Date().toISOString(),
        };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });

    setIsStreaming(true);
    const controller = new AbortController();
    streamControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);

    const assistantMessageId = generateId('msg');
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    // Add empty assistant message (thinking state)
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== convId) return c;
        return { ...c, messages: [...c.messages, assistantMessage] };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });

    let streamedAny = false;
    try {
      const currentConv = conversations.find(c => c.id === convId);
      const history = precedingMessages.map(m => ({ role: m.role, content: m.content, images: m.images }));
      history.push({ role: 'user', content, images });
      const effectiveSources = [
        ...(currentConv?.sources || []),
        ...((newSources || []).filter(s => !(currentConv?.sources || []).some(e => e.id === s.id))),
      ];

      let customPrompt = typeof window !== 'undefined' ? localStorage.getItem('claudechat_system_prompt') : null;
      if (customPrompt && (customPrompt.includes('Claude') || customPrompt.includes('Anthropic') || customPrompt.includes('helpful AI assistant.'))) {
        localStorage.removeItem('claudechat_system_prompt');
        customPrompt = null;
      }

      if (typeof window !== 'undefined') {
        const nickMatch = content.match(/\b(?:my nickname is|nickname is|my nick is|call me nickname)\s+["']?([A-Za-z0-9_-]{2,30})["']?\b/i);
        if (nickMatch) {
          const formatted = nickMatch[1].trim();
          localStorage.setItem('claudechat_user_nickname', formatted.charAt(0).toUpperCase() + formatted.slice(1));
        }

        const nameMatch = content.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z]{2,20})\b/i);
        if (nameMatch) {
          const candidate = nameMatch[1].trim();
          const invalid = ['a', 'an', 'the', 'here', 'just', 'trying', 'working', 'looking', 'sorry', 'fine', 'good', 'happy', 'busy', 'online', 'curious', 'not', 'asking', 'thinking', 'pragna', 'claude', 'assistant', 'bot'];
          if (!invalid.includes(candidate.toLowerCase())) {
            const formatted = candidate.charAt(0).toUpperCase() + candidate.slice(1);
            localStorage.setItem('claudechat_user_name', formatted);
          }
        }
      }

      const authUserName = user?.name || (user?.email ? user.email.split('@')[0] : '');
      const rawStoredName = typeof window !== 'undefined' ? localStorage.getItem('claudechat_user_name') : null;
      const validStoredName = rawStoredName && rawStoredName.toLowerCase() !== 'vinay' ? rawStoredName : null;
      const clientUserName = authUserName || validStoredName || 'Kishore';

      if (typeof window !== 'undefined' && clientUserName) {
        localStorage.setItem('claudechat_user_name', clientUserName);
      }

      const clientUserNickname = typeof window !== 'undefined' ? localStorage.getItem('claudechat_user_nickname') || undefined : undefined;

      const effectiveLang = language || selectedLanguage || (typeof window !== 'undefined' ? localStorage.getItem('pragna_selected_language') : null) || 'en';

      const authToken = getAuthToken();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: history,
          model: effectiveModelId,
          systemPrompt: customPrompt || undefined,
          userName: clientUserName,
          userEmail: user?.email || undefined,
          userNickname: clientUserNickname,
          sourceDocumentIds: effectiveSources.length ? effectiveSources.map(s => s.id) : undefined,
          preferredLanguage: effectiveLang !== 'auto' ? effectiveLang : undefined,
        }),
        signal: controller.signal,
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let pendingDelta = '';
        let pendingCitations: any[] | null = null;
        let lastFlush = Date.now();
        // Status text (e.g. "Creating image…") shown until the first real text replaces it.
        let statusShown = false;

        const showStatus = (status: string) => {
          if (controller.signal.aborted) return;
          statusShown = true;
          setConversations(prev =>
            prev.map(c => c.id !== convId ? c : {
              ...c,
              messages: c.messages.map(m => m.id !== assistantMessageId ? m : { ...m, content: `_${status}_`, isStreaming: true }),
            })
          );
        };

        const flushStream = () => {
          if (controller.signal.aborted) return;
          if (!pendingDelta && !pendingCitations) return;
          const deltaToFlush = pendingDelta;
          const citationsToFlush = pendingCitations;
          const replaceStatus = statusShown && !!deltaToFlush;
          if (replaceStatus) statusShown = false;
          pendingDelta = '';
          pendingCitations = null;

          setConversations(prev =>
            prev.map(c => {
              if (c.id !== convId) return c;
              return {
                ...c,
                messages: c.messages.map(m => {
                  if (m.id !== assistantMessageId) return m;
                  return {
                    ...m,
                    content: (replaceStatus ? '' : m.content) + deltaToFlush,
                    ...(citationsToFlush ? { citations: citationsToFlush } : {}),
                    isStreaming: true,
                  };
                }),
              };
            })
          );
        };

        streamLoop: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') {
              void reader.cancel().catch(() => {});
              break streamLoop;
            }
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta?.content || '';
                if (delta) {
                  streamedAny = true;
                  pendingDelta += delta;
                }
                if (Array.isArray(data.citations) && data.citations.length > 0) {
                  pendingCitations = data.citations;
                }
                if (typeof data.status === 'string' && !streamedAny) showStatus(data.status);
              } catch {
                // Ignore chunk parse error
              }
            }
          }

          if (Date.now() - lastFlush > 50) {
            flushStream();
            lastFlush = Date.now();
          }
        }
        flushStream();
      }
    } catch (err) {
      if (!controller.signal.aborted) console.error('Streaming error from /api/chat:', err);
    }

    clearTimeout(timeout);
    // A stopped request must not overwrite a newer request's messages or state.
    if (streamControllerRef.current !== controller) return;
    streamControllerRef.current = null;
    setIsStreaming(false);

    // If no stream tokens received (e.g. backend error or network failure)
    if (!streamedAny) {
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== convId) return c;
          return {
            ...c,
            messages: c.messages.map(m =>
              m.id === assistantMessageId
                ? { ...m, content: "Could not connect to the AI service. Please verify your connection or try again.", isStreaming: false }
                : m
            ),
          };
        });
        saveConversations(userRef.current, updated);
        return updated;
      });
    }

    // Mark streaming complete
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantMessageId ? { ...m, isStreaming: false } : m
          ),
          updatedAt: new Date().toISOString(),
        };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });

  }, [activeConversationId, selectedModel.id, conversations, selectedLanguage, user]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const groupedConversations = groupConversationsByDate(conversations);

  if (!mounted || !historyReady) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex items-center gap-2">
          <div className="thinking-dot" />
          <div className="thinking-dot" />
          <div className="thinking-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(p => !p)}
        conversations={conversations}
        groupedConversations={groupedConversations}
        activeConversationId={activeConversationId}
        onSelectConversation={selectConversation}
        onNewConversation={createNewConversation}
        onDeleteConversation={deleteConversation}
        onRenameConversation={renameConversation}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenArtifacts={() => setArtifactOpen(p => !p)}
        onOpenTools={() => setToolsPanelOpen(true)}
        onOpenSearch={() => setCmdPaletteOpen(true)}
        onOpenImageStudio={() => setImageStudioOpen(true)}
      />
      <div className="flex-1 flex overflow-hidden min-w-0">
        <ChatWindow
          conversation={activeConversation}
          isStreaming={isStreaming}
          selectedModel={selectedModel}
          models={MODELS}
          onSelectModel={setSelectedModel}
          onSendMessage={sendMessage}
          onEditMessage={(messageId, content) => {
            const message = activeConversation?.messages.find(item => item.id === messageId);
            if (!message || message.role !== 'user') return;
            void sendMessage(content, message.images, undefined, selectedLanguage, undefined, messageId);
          }}
          onStopStreaming={stopStreaming}
          onNewConversation={createNewConversation}
          onToggleSidebar={() => setSidebarOpen(p => !p)}
          sidebarOpen={sidebarOpen}
          onOpenArtifact={handleOpenArtifact}
          onToggleArtifact={() => setArtifactOpen(p => !p)}
          isArtifactOpen={artifactOpen}
          onOpenCommandPalette={() => setCmdPaletteOpen(true)}
          onOpenTools={() => setToolsPanelOpen(true)}
          sources={activeConversation?.sources}
          onRemoveSource={removeSource}
          selectedLanguage={selectedLanguage}
          onSelectLanguage={handleSelectLanguage}
        />
        {/* Live Claude-style Artifact side panel */}
        <ArtifactPanel
          open={artifactOpen}
          title={activeArtifact?.title || 'Artifact Viewer'}
          content={activeArtifact?.content || ''}
          language={activeArtifact?.language || 'typescript'}
          onClose={() => setArtifactOpen(false)}
        />
      </div>

      {/* Global Command Palette (Cmd+K) */}
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
      />

      {/* Tools & Skills Modal */}
      {toolsPanelOpen && (
        <ToolsPanel onClose={() => setToolsPanelOpen(false)} />
      )}

      {/* OmniRoute Image Studio Modal */}
      <ImageGenerationModal
        open={imageStudioOpen}
        onClose={() => setImageStudioOpen(false)}
        onInsertToChat={(imageUrl, imgPrompt) => {
          sendMessage(`![${imgPrompt}](${imageUrl})`);
        }}
      />
    </div>
  );
}
