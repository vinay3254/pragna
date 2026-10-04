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

function loadConversations(user: { id?: number | string | null; email?: string | null } | null): Conversation[] {
  if (typeof window === 'undefined') return [];
  const key = getConversationsStorageKey(user);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(user: { id?: number | string | null; email?: string | null } | null, convs: Conversation[]) {
  if (typeof window === 'undefined') return;
  const key = getConversationsStorageKey(user);
  if (!key) return; // Never write while user is null
  try {
    localStorage.setItem(key, JSON.stringify(convs));
  } catch {
    // Ignore quota or serialization errors
  }
}

function loadActiveConversationId(user: { id?: number | string | null; email?: string | null } | null): string | null {
  if (typeof window === 'undefined') return null;
  const key = getActiveStorageKey(user);
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveActiveConversationId(user: { id?: number | string | null; email?: string | null } | null, id: string | null) {
  if (typeof window === 'undefined') return;
  const key = getActiveStorageKey(user);
  if (!key) return; // Never write while user is null
  try {
    if (id) {
      localStorage.setItem(key, id);
    } else {
      localStorage.removeItem(key);
    }
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
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(MODELS[0]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isStreaming, setIsStreaming] = useState(false);
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
    // When user changes or logs out, first reset states to avoid flashing previous account's chats
    setConversations([]);
    setActiveConversationId(null);
    setArtifactOpen(false);
    setActiveArtifact(null);

    if (!user) return;

    const savedConvs = loadConversations(user);
    // One-time backfill: earlier versions left conversations titled "New conversation"
    // even after real messages were sent into them. Derive a real title wherever we can.
    let backfilled = false;
    const fixedConvs = savedConvs.map(c => {
      if (c.title !== 'New conversation') return c;
      const firstUserMsg = c.messages.find(m => m.role === 'user');
      if (!firstUserMsg) return c;
      backfilled = true;
      return { ...c, title: getConversationTitle(firstUserMsg.content) };
    });
    if (backfilled) saveConversations(user, fixedConvs);

    const savedActive = loadActiveConversationId(user);
    setConversations(fixedConvs);
    if (savedActive && fixedConvs.some(c => c.id === savedActive)) {
      setActiveConversationId(savedActive);
    } else if (savedActive && fixedConvs.length > 0) {
      setActiveConversationId(savedActive);
    } else {
      setActiveConversationId(null);
    }
  }, [user?.id, user?.email]);

  // Scheduled tasks run on the backend and post their answers into a backend chat.
  // Chats are kept in localStorage, so poll the tasks and copy those answers into a
  // local scheduled chat, with a toast when a new answer arrives.
  const activeConversationIdRef = React.useRef(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!user) return;
    const syncedRunKeys = new Map<number, string>();
    const pendingOpen = new URLSearchParams(window.location.search).get('open');
    const seenMessageIds = new Set<string>();
    let firstPoll = true;

    const poll = async () => {
      try {
        const token = getAuthToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch('/api/tools/scheduled', { headers });
        if (!res.ok) return;
        const data = await res.json();
        const jobs: any[] = data?.jobs || [];

        for (const job of jobs) {
          if (!job.conversation_id) continue;
          const runKey = `${job.last_run || ''}:${job.status}:${job.running ? 1 : 0}:${(job.last_result || '').length}`;
          if (syncedRunKeys.get(job.id) === runKey) continue;
          syncedRunKeys.set(job.id, runKey);

          const convRes = await fetch(`/api/conversations/${job.conversation_id}`, { headers });
          if (!convRes.ok) continue;
          const remote = await convRes.json();
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
    return () => clearInterval(interval);
  }, [user?.id]);

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

  const attachSource = useCallback((source: Source) => {
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeConversationIdRef.current) return c;
        if (c.sources?.some(s => s.id === source.id)) return c;
        return { ...c, sources: [...(c.sources || []), source] };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });
  }, []);

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

  const createNewConversation = useCallback(() => {
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
  }, [selectedModel.id]);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    saveActiveConversationId(userRef.current, id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConversations(userRef.current, updated);
      return updated;
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
      saveActiveConversationId(userRef.current, null);
    }
  }, [activeConversationId]);

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
  const sendMessage = useCallback(async (content: string, images?: string[], newSources?: Source[], language?: string, modelOverride?: string) => {
    if ((!content.trim() && !images?.length && !newSources?.length) || isStreaming) return;
    const titleSource = content.trim() || (images?.length ? 'Shared a photo' : 'Shared a file');

    let convId = activeConversationId;
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
      id: generateId('msg'),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      images,
    };

    // Add user message
    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages, userMessage];
        return {
          ...c,
          messages: msgs,
          title: isNewConv ? getConversationTitle(titleSource) : c.title,
          updatedAt: new Date().toISOString(),
        };
      });
      saveConversations(userRef.current, updated);
      return updated;
    });

    setIsStreaming(true);

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
      const history = (currentConv?.messages || []).map(m => ({ role: m.role, content: m.content, images: m.images }));
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
        signal: AbortSignal.timeout(180000),
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
          statusShown = true;
          setConversations(prev =>
            prev.map(c => c.id !== convId ? c : {
              ...c,
              messages: c.messages.map(m => m.id !== assistantMessageId ? m : { ...m, content: `_${status}_`, isStreaming: true }),
            })
          );
        };

        const flushStream = () => {
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') break;
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
      console.error('Streaming error from /api/chat:', err);
    }

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

    setIsStreaming(false);
  }, [activeConversationId, isStreaming, selectedModel.id, conversations, selectedLanguage, user]);

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
    // Mark any streaming messages as complete
    setConversations(prev => {
      const updated = prev.map(c => ({
        ...c,
        messages: c.messages.map(m => ({ ...m, isStreaming: false })),
      }));
      saveConversations(userRef.current, updated);
      return updated;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const groupedConversations = groupConversationsByDate(conversations);

  if (!mounted) {
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
          onAttachSource={attachSource}
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