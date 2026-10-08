'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ALLOWED_MODELS,
  ApiArtifact,
  ApiConversation,
  ApiDocument,
  ApiMessage,
  ApiToolCall,
  Source,
  fetchArtifact,
  fetchConversation,
  fetchConversations,
  fetchDocuments,
  renameConversation as apiRenameConversation,
  deleteConversation as apiDeleteConversation,
  sendFeedback as apiSendFeedback,
  setActiveLeaf as apiSetActiveLeaf,
  streamChat,
  uploadDocument as apiUploadDocument,
  deleteDocument as apiDeleteDocument,
  resumeToolCall,
} from '@/lib/api';

export interface ChatMessage {
  id?: number;
  parentId?: number | null;
  role: 'user' | 'assistant';
  content: string;
  model?: string | null;
  sources?: Source[] | null;
  feedback?: 'up' | 'down' | null;
  isError?: boolean;
  siblingIds?: number[];
  artifacts?: ApiArtifact[];
  tool_calls?: ApiToolCall[];
  attachedDocs?: { id: number; filename: string; chunk_count: number }[];
}

export interface ActiveArtifact {
  id?: number;
  title: string;
  content: string;
  language?: string;
}

interface ChatContextValue {
  conversations: ApiConversation[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeConversationId: number | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  sendMessage: (text: string) => void;
  stopGeneration: () => void;
  loadConversation: (id: number) => Promise<void>;
  startNewChat: () => void;
  renameActiveConversation: (title: string) => Promise<void>;
  deleteConversation: (id: number) => Promise<void>;
  editMessage: (messageId: number, newText: string) => void;
  regenerateMessage: (messageId: number) => void;
  switchToSibling: (messageId: number) => Promise<void>;
  documents: ApiDocument[];
  refreshDocuments: () => Promise<void>;
  uploadDocument: (file: File) => Promise<void>;
  pendingUploads: { name: string; status: 'indexing' | 'error' }[];
  removePendingUpload: (name: string, index?: number) => void;
  deleteDocument: (id: number) => Promise<void>;
  setMessageFeedback: (messageId: number, rating: 'up' | 'down') => Promise<void>;
  // Attached docs for next message
  attachedDocIds: number[];
  toggleAttachDoc: (doc: ApiDocument) => void;
  clearAttachedDocs: () => void;
  // Phase 5 Voice
  isMuted: boolean;
  toggleMute: () => void;
  // Phase 5 Artifact Panel
  artifactPanelOpen: boolean;
  activeArtifact: ActiveArtifact | null;
  openArtifact: (id: number, fallbackTitle?: string, fallbackContent?: string, fallbackLang?: string) => Promise<void>;
  closeArtifactPanel: () => void;
  // Phase 5 Tool Confirm
  handleResumeTool: (toolCallId: number, approved: boolean) => Promise<void>;
  // Dark mode
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function findDeepestLeaf(allMessages: ApiMessage[], startId: number): number {
  const childrenByParent = new Map<number, ApiMessage[]>();
  for (const m of allMessages) {
    if (m.parent_id == null) continue;
    if (!childrenByParent.has(m.parent_id)) childrenByParent.set(m.parent_id, []);
    childrenByParent.get(m.parent_id)!.push(m);
  }

  let current = startId;
  while (true) {
    const children = childrenByParent.get(current);
    if (!children || children.length === 0) return current;
    current = children[children.length - 1].id;
  }
}

function buildActivePath(allMessages: ApiMessage[], activeLeafId: number | null): ChatMessage[] {
  if (allMessages.length === 0) return [];

  const byId = new Map(allMessages.map((m) => [m.id, m]));
  const childrenByParent = new Map<number | null, ApiMessage[]>();
  for (const m of allMessages) {
    const key = m.parent_id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(m);
  }

  const leafId = activeLeafId ?? allMessages[allMessages.length - 1].id;
  const pathIds: number[] = [];
  let current: ApiMessage | undefined = byId.get(leafId);
  while (current) {
    pathIds.push(current.id);
    current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  pathIds.reverse();

  return pathIds.map((id) => {
    const m = byId.get(id)!;
    const siblings = childrenByParent.get(m.parent_id) ?? [m];
    return {
      id: m.id,
      parentId: m.parent_id,
      role: m.role,
      content: m.content,
      model: m.model,
      sources: m.sources,
      feedback: m.feedback,
      siblingIds: siblings.map((s) => s.id),
      artifacts: m.artifacts,
      tool_calls: m.tool_calls,
    };
  });
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Dark mode -- defaults to the user's last choice (localStorage), falling
  // back to their OS preference the first time. Applied to <html> so it
  // covers every page, not just the ones that render a toggle button.
  const [isDarkMode, setIsDarkMode] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem('pragna-theme');
    const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('pragna-theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [allMessages, setAllMessages] = useState<ApiMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(ALLOWED_MODELS[0].id);
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [pendingUploads, setPendingUploads] = useState<
    { name: string; status: 'indexing' | 'error' }[]
  >([]);
  const [attachedDocIds, setAttachedDocIds] = useState<number[]>([]);

  // Phase 5 Voice
  const [isMuted, setIsMuted] = useState(false);
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      // Muting should silence whatever's playing right now, not just block
      // future auto-play -- otherwise a long response keeps reading itself
      // out loud until it finishes on its own, with no way to interrupt it.
      if (next && typeof window !== 'undefined') {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        window.dispatchEvent(new CustomEvent('pragna:speech-stop'));
      }
      return next;
    });
  }, []);

  // Phase 5 Artifact Panel
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);

  const closeArtifactPanel = useCallback(() => {
    setArtifactPanelOpen(false);
  }, []);

  const openArtifact = useCallback(
    async (id: number, fallbackTitle?: string, fallbackContent?: string, fallbackLang?: string) => {
      try {
        const art = await fetchArtifact(id);
        setActiveArtifact({
          id: art.id,
          title: art.title,
          content: art.content ?? '',
          language: art.language ?? undefined,
        });
        setArtifactPanelOpen(true);
      } catch {
        if (fallbackContent) {
          setActiveArtifact({
            id,
            title: fallbackTitle || 'Artifact',
            content: fallbackContent,
            language: fallbackLang,
          });
          setArtifactPanelOpen(true);
        }
      }
    },
    []
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  // Persist attachedDocs across the loadConversation reload that happens
  // after onDone -- the API response has no attachedDocs field so they'd
  // be lost without this ref. We store them keyed by message content so we
  // can patch them back in after buildActivePath runs.
  const pendingAttachedDocsRef = useRef<Map<string, { id: number; filename: string; chunk_count: number }[]>>(new Map());

  const refreshConversations = useCallback(async (query = '') => {
    setConversations(await fetchConversations(query));
  }, []);

  useEffect(() => {
    refreshConversations(searchQuery);
  }, [searchQuery, refreshConversations]);

  const refreshDocuments = useCallback(async () => {
    setDocuments(await fetchDocuments());
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const loadConversation = useCallback(async (id: number) => {
    // Switching conversations shouldn't leave the previous one still
    // talking in the background -- stop any in-flight speech first.
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      window.dispatchEvent(new CustomEvent('pragna:speech-stop'));
    }
    const data = await fetchConversation(id);
    setActiveConversationId(id);
    setAllMessages(data.messages);
    setActiveLeafId(data.active_leaf_id);
    let path = buildActivePath(data.messages, data.active_leaf_id);

    // Patch back any attachedDocs that were stored before this reload
    if (pendingAttachedDocsRef.current.size > 0) {
      path = path.map((msg) => {
        if (msg.role === 'user' && pendingAttachedDocsRef.current.has(msg.content)) {
          return { ...msg, attachedDocs: pendingAttachedDocsRef.current.get(msg.content) };
        }
        return msg;
      });
    }

    setMessages(path);

    // Auto-open artifact panel if latest message has artifacts
    const lastMsg = data.messages[data.messages.length - 1];
    if (lastMsg && lastMsg.artifacts && lastMsg.artifacts.length > 0) {
      const art = lastMsg.artifacts[lastMsg.artifacts.length - 1];
      openArtifact(art.id, art.title, art.content, art.language || undefined);
    }
  }, [openArtifact]);

  const startNewChat = useCallback(() => {
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      window.dispatchEvent(new CustomEvent('pragna:speech-stop'));
    }
    setActiveConversationId(null);
    setAllMessages([]);
    setActiveLeafId(null);
    setMessages([]);
    setArtifactPanelOpen(false);
    setActiveArtifact(null);
    setPendingUploads([]);
    setAttachedDocIds([]);
  }, []);

  const runGeneration = useCallback(
    (text: string | null, parentId: number | null | undefined, docIds?: number[], attachedDocs?: { id: number; filename: string; chunk_count: number }[]) => {
      if (text !== null) {
        setMessages((prev) => [...prev, { role: 'user', content: text, attachedDocs: attachedDocs && attachedDocs.length > 0 ? attachedDocs : undefined }]);
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: '', model: selectedModel, tool_calls: [] }]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      streamChat({
        conversationId: activeConversationId,
        message: text,
        model: selectedModel,
        parentId,
        documentIds: docIds && docIds.length > 0 ? docIds : undefined,
        signal: controller.signal,
        onToken: (token) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + token };
            return next;
          });
        },
        onToolCall: (event) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const existingTools = last.tool_calls || [];
            const newTool: ApiToolCall = {
              id: Date.now(),
              tool_name: event.tool_name,
              arguments: event.arguments,
              status: 'running',
            };
            next[next.length - 1] = { ...last, tool_calls: [...existingTools, newTool] };
            return next;
          });
        },
        onToolResult: (event) => {
          // Note: open_url tab-opening is handled in MessageBubble via a
          // useEffect + anchor .click() so it isn't blocked by popup blockers.
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const tools = [...(last.tool_calls || [])];
            if (tools.length > 0) {
              tools[tools.length - 1] = {
                ...tools[tools.length - 1],
                result: event.result,
                status: 'completed',
              };
            }
            next[next.length - 1] = { ...last, tool_calls: tools };
            return next;
          });
        },
        onConfirmRequired: (event) => {
          // A brand-new conversation's very first message can pause for
          // confirmation before ever reaching a `done` event -- without
          // this, activeConversationId stays null and clicking Approve/Deny
          // silently no-ops (handleResumeTool bails out when it's null).
          setActiveConversationId(event.conversation_id);
          refreshConversations(searchQuery);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const existingTools = last.tool_calls || [];
            const confirmTool: ApiToolCall = {
              id: event.tool_call_id,
              tool_name: event.tool_name,
              arguments: { description: event.description, steps: event.steps },
              status: 'pending',
            };
            next[next.length - 1] = { ...last, tool_calls: [...existingTools, confirmTool] };
            return next;
          });
          setIsStreaming(false);
        },
        onDone: async (event) => {
          setActiveConversationId(event.conversation_id);
          setIsStreaming(false);
          await loadConversation(event.conversation_id);
          await refreshConversations(searchQuery);
        },
        onError: (message) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: message, isError: true };
            return next;
          });
          setIsStreaming(false);
        },
      }).catch((err) => {
        if (err?.name !== 'AbortError') {
          console.error(err);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: last.content || 'Failed to connect to backend server.',
                isError: true,
              };
            }
            return next;
          });
        }
        setIsStreaming(false);
      });
    },
    [activeConversationId, selectedModel, loadConversation, refreshConversations, searchQuery]
  );

  const sendMessage = useCallback(
    (text: string) => {
      // Snapshot which docs are attached, then clear so the input is ready for next message
      const docIds = [...attachedDocIds];
      const docDetails = documents.filter((d) => docIds.includes(d.id)).map((d) => ({ id: d.id, filename: d.filename, chunk_count: d.chunk_count }));
      setAttachedDocIds([]);
      // Stash attachedDocs keyed by message text so loadConversation can restore them
      if (docDetails.length > 0) {
        pendingAttachedDocsRef.current.set(text, docDetails);
      }
      runGeneration(text, undefined, docIds, docDetails);
    },
    [runGeneration, attachedDocIds, documents]
  );

  const toggleAttachDoc = useCallback((doc: ApiDocument) => {
    setAttachedDocIds((prev) =>
      prev.includes(doc.id) ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]
    );
  }, []);

  const clearAttachedDocs = useCallback(() => {
    setAttachedDocIds([]);
  }, []);

  const editMessage = useCallback(
    (messageId: number, newText: string) => {
      const original = allMessages.find((m) => m.id === messageId);
      if (!original) return;
      runGeneration(newText, original.parent_id, [], []);
    },
    [allMessages, runGeneration]
  );

  const regenerateMessage = useCallback(
    (messageId: number) => {
      const original = allMessages.find((m) => m.id === messageId);
      if (!original) return;
      runGeneration(null, original.parent_id, [], []);
    },
    [allMessages, runGeneration]
  );

  const switchToSibling = useCallback(
    async (messageId: number) => {
      if (activeConversationId == null) return;
      const leafId = findDeepestLeaf(allMessages, messageId);
      await apiSetActiveLeaf(activeConversationId, leafId);
      await loadConversation(activeConversationId);
    },
    [activeConversationId, allMessages, loadConversation]
  );

  const handleResumeTool = useCallback(
    async (toolCallId: number, approved: boolean) => {
      if (activeConversationId == null) return;
      setIsStreaming(true);

      // The paused message (last in the thread, showing the Approve/Deny
      // card) is what continues -- resuming appends to it in place rather
      // than starting a new assistant message.
      await resumeToolCall({
        conversationId: activeConversationId,
        toolCallId,
        approved,
        onToken: (token) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + token };
            return next;
          });
        },
        onToolCall: (event) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const existingTools = last.tool_calls || [];
            const newTool: ApiToolCall = {
              id: Date.now(),
              tool_name: event.tool_name,
              arguments: event.arguments,
              status: 'running',
            };
            next[next.length - 1] = { ...last, tool_calls: [...existingTools, newTool] };
            return next;
          });
        },
        onToolResult: (event) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const tools = (last.tool_calls || []).map((tc) =>
              tc.id === toolCallId
                ? { ...tc, result: event.result, status: approved ? ('completed' as const) : ('denied' as const) }
                : tc
            );
            next[next.length - 1] = { ...last, tool_calls: tools };
            return next;
          });
        },
        onConfirmRequired: (event) => {
          setActiveConversationId(event.conversation_id);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const existingTools = last.tool_calls || [];
            const confirmTool: ApiToolCall = {
              id: event.tool_call_id,
              tool_name: event.tool_name,
              arguments: { description: event.description, steps: event.steps },
              status: 'pending',
            };
            next[next.length - 1] = { ...last, tool_calls: [...existingTools, confirmTool] };
            return next;
          });
          setIsStreaming(false);
        },
        onDone: async (event) => {
          setIsStreaming(false);
          await loadConversation(event.conversation_id);
        },
        onError: (message) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content || message, isError: true };
            return next;
          });
          setIsStreaming(false);
        },
      }).catch((err) => {
        console.error(err);
        setIsStreaming(false);
      });
    },
    [activeConversationId, loadConversation]
  );

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const renameActiveConversation = useCallback(
    async (title: string) => {
      if (activeConversationId == null) return;
      await apiRenameConversation(activeConversationId, title);
      await refreshConversations(searchQuery);
    },
    [activeConversationId, refreshConversations, searchQuery]
  );

  const deleteConversation = useCallback(
    async (id: number) => {
      await apiDeleteConversation(id);
      if (activeConversationId === id) {
        startNewChat();
      }
      await refreshConversations(searchQuery);
    },
    [activeConversationId, startNewChat, refreshConversations, searchQuery]
  );

  const uploadDocument = useCallback(
    async (file: File) => {
      setPendingUploads((prev) => [...prev, { name: file.name, status: 'indexing' }]);
      try {
        await apiUploadDocument(file);
        setPendingUploads((prev) => prev.filter((f) => f.name !== file.name));
        await refreshDocuments();
      } catch {
        setPendingUploads((prev) =>
          prev.map((f) => (f.name === file.name ? { ...f, status: 'error' } : f))
        );
      }
    },
    [refreshDocuments]
  );

  const removePendingUpload = useCallback((name: string, index?: number) => {
    setPendingUploads((prev) => {
      if (index !== undefined && index >= 0 && index < prev.length) {
        return prev.filter((_, i) => i !== index);
      }
      return prev.filter((f) => f.name !== name);
    });
  }, []);

  const deleteDocument = useCallback(
    async (id: number) => {
      try {
        await apiDeleteDocument(id);
        await refreshDocuments();
      } catch (err) {
        console.error('Failed to delete document', err);
      }
    },
    [refreshDocuments]
  );

  const setMessageFeedback = useCallback(async (messageId: number, rating: 'up' | 'down') => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
    );
    await apiSendFeedback(messageId, rating);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        searchQuery,
        setSearchQuery,
        activeConversationId,
        messages,
        isStreaming,
        selectedModel,
        setSelectedModel,
        sendMessage,
        stopGeneration,
        loadConversation,
        startNewChat,
        renameActiveConversation,
        deleteConversation,
        editMessage,
        regenerateMessage,
        switchToSibling,
        documents,
        refreshDocuments,
        uploadDocument,
        pendingUploads,
        removePendingUpload,
        deleteDocument,
        setMessageFeedback,
        attachedDocIds,
        toggleAttachDoc,
        clearAttachedDocs,
        isMuted,
        toggleMute,
        artifactPanelOpen,
        activeArtifact,
        openArtifact,
        closeArtifactPanel,
        handleResumeTool,
        isDarkMode,
        toggleDarkMode,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
