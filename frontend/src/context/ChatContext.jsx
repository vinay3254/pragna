import { createContext, useState, useEffect, useRef, useCallback } from "react";
import { normalizeLanguageCode } from "../utils/language";
import { listPersonas, sendOrchestratedMessageStream } from "../api/api";
import ChatManagementAPI from "../api/chatManagement";

export const MODEL_TIERS = [
  { id: "gemma4:cloud", label: "Tvarā", englishLabel: "Praxis", sanskrit: "त्वरा", meaning: "speed", tier: "Tier 1: Implementation", desc: "Fast routine coding & rapid reasoning" },
  { id: "gemma4:31b-cloud", label: "Manas", englishLabel: "Rhapsody", sanskrit: "मनस्", meaning: "intellect", tier: "Tier 2: Testing & QA", desc: "Deep multi-step reasoning & QA" },
  { id: "nemotron-3-super:cloud", label: "Bṛhat", englishLabel: "Elenchos", sanskrit: "बृहत्", meaning: "vast", tier: "Tier 3: Review", desc: "Security audit & 120B analytical review" },
  { id: "minimax-m3:cloud", label: "Pragya", englishLabel: "Theoria", sanskrit: "प्रज्ञा", meaning: "deep wisdom", tier: "Tier 4: Architecture", desc: "System architecture & long synthesis" },
];

export const ChatContext = createContext({});

// Chat data used to live under these global localStorage keys, shared by
// every account that ever logged in on the same browser - log out, log into
// a different account, and their chats/folders/etc. were still sitting there
// waiting for you. Namespacing each key by userId fixes that going forward;
// migrateLegacyKeys() does a one-time best-effort handoff of any data still
// sitting under the old global key to whichever account logs in next (so the
// last person who actually owned it doesn't just lose it), then deletes the
// global key so it can never leak into the account after that.
const LEGACY_KEYS = [
  "pragna_chats",
  "pragna_folders",
  "pragna_templates",
  "pragna_active_chat_id",
  "pragna_active_persona_id",
  "pragna_nickname",
  "pragna_instructions",
];

function migrateLegacyKeys(userId) {
  LEGACY_KEYS.forEach((legacyKey) => {
    const scopedKey = `${legacyKey}_${userId}`;
    if (localStorage.getItem(scopedKey) === null) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        localStorage.setItem(scopedKey, legacyValue);
      }
    }
    localStorage.removeItem(legacyKey);
  });
}

export function ChatProvider({ children }) {
  // ChatProvider only ever mounts while authenticated (see src/App.jsx), so
  // userId is set by the time this runs; "anon" is just a defensive fallback.
  const [userId] = useState(() => {
    const id = localStorage.getItem("userId") || "anon";
    migrateLegacyKeys(id);
    return id;
  });

  const scoped = useCallback((key) => `${key}_${userId}`, [userId]);

  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem(scoped("pragna_chats"));
    return saved ? JSON.parse(saved) : [];
  });

  const [folders, setFolders] = useState(() => {
    const saved = localStorage.getItem(scoped("pragna_folders"));
    return saved ? JSON.parse(saved) : [];
  });

  const [templates, setTemplates] = useState(() => {
    const saved = localStorage.getItem(scoped("pragna_templates"));
    return saved ? JSON.parse(saved) : [];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem(scoped("pragna_active_chat_id"));
    return saved || null;
  });

  const [activeArtifact, setActiveArtifact] = useState(null);
  const [isArtifactOpen, setIsArtifactOpen] = useState(false);

  const openArtifact = (artifact) => {
    if (artifact) {
      setActiveArtifact(artifact);
      setIsArtifactOpen(true);
    }
  };

  const closeArtifact = () => {
    setIsArtifactOpen(false);
  };

  const [language, setLanguage] = useState(() => {

    return normalizeLanguageCode(localStorage.getItem("pragna_language") || "en");
  });

  const setNormalizedLanguage = (nextLanguage) => {
    setLanguage(normalizeLanguageCode(nextLanguage));
  };

  // Theme/accent switching was tried and removed (didn't look good) - the app
  // is single fixed dark-gold theme now. Kept as constants rather than state
  // so nothing can drift from this, and cleared any stale values a previous
  // build may have left in localStorage.
  const theme = "dark";
  const setTheme = () => {};
  const resolvedTheme = "dark";
  const accentColor = "#d4af37";
  const setAccentColor = () => {};
  localStorage.removeItem("pragna_theme");
  localStorage.removeItem("pragna_accent");

  const CHAT_FONT_STACKS = {
    "Default (Segoe UI)": "'Segoe UI', system-ui, -apple-system, sans-serif",
    "Serif": "Georgia, 'Times New Roman', serif",
    "Monospace": "'Cascadia Code', 'Consolas', 'Courier New', monospace",
  };

  const [chatFont, setChatFontState] = useState(() => {
    return localStorage.getItem("pragna_chat_font") || "Default (Segoe UI)";
  });

  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Sidebar: open by default, persisted across reloads (desktop only — mobile uses its own drawer state)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem("pragna_sidebar_open");
    return saved === null ? true : JSON.parse(saved);
  });

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const [user, setUser] = useState(null);

  const [chatMode, setChatMode] = useState(() => {
    return localStorage.getItem("pragna_chat_mode") || "general";
  });

  const [extendedThinking, setExtendedThinkingState] = useState(() => {
    return localStorage.getItem("pragna_extended_thinking") === "true";
  });

  const setExtendedThinking = (val) => {
    setExtendedThinkingState(val);
    localStorage.setItem("pragna_extended_thinking", val ? "true" : "false");
  };

  const toggleExtendedThinking = () => {
    setExtendedThinkingState((prev) => {
      const next = !prev;
      localStorage.setItem("pragna_extended_thinking", next ? "true" : "false");
      return next;
    });
  };

  const [personas, setPersonas] = useState([]);

  const [activePersonaId, setActivePersonaId] = useState(() => {
    return localStorage.getItem(scoped("pragna_active_persona_id")) || null;
  });

  const [selectedModel, setSelectedModelState] = useState(() => {
    return localStorage.getItem("pragna_selected_model") || "gemma4:cloud";
  });

  const setSelectedModel = (modelId) => {
    setSelectedModelState(modelId);
    localStorage.setItem("pragna_selected_model", modelId);
  };

  const setMessageFeedback = async (messageId, rating) => {
    const token = localStorage.getItem("authToken");
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ""}/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rating }),
      });
    } catch (err) {
      console.warn("Feedback error:", err);
    }
  };

  const [desktopNotifications, setDesktopNotificationsState] = useState(() => {
    return localStorage.getItem("pragna_desktop_notifications") === "true";
  });

  const setDesktopNotifications = (enabled) => {
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    setDesktopNotificationsState(enabled);
    localStorage.setItem("pragna_desktop_notifications", String(enabled));
  };

  // Ref to input field for focusing when mode is selected
  const inputRef = useRef(null);

  // Ref to the sidebar's search input, focused via the Ctrl/Cmd+K shortcut
  const sidebarSearchInputRef = useRef(null);

  // Persist sidebar open/closed state
  useEffect(() => {
    localStorage.setItem("pragna_sidebar_open", JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  // Sync chats to server in the background for cross-thread search persistence
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token || !chats || chats.length === 0) return;
    const timer = setTimeout(() => {
      ChatManagementAPI.syncChats(chats).catch((err) => {
        console.warn("Background chat sync notice:", err);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [chats]);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(scoped("pragna_chats"), JSON.stringify(chats));
  }, [chats, scoped]);

  useEffect(() => {
    localStorage.setItem(scoped("pragna_folders"), JSON.stringify(folders));
  }, [folders, scoped]);

  useEffect(() => {
    localStorage.setItem(scoped("pragna_templates"), JSON.stringify(templates));
  }, [templates, scoped]);

  // Save chat mode
  useEffect(() => {
    localStorage.setItem("pragna_chat_mode", chatMode);
  }, [chatMode]);

  // Save active persona selection
  useEffect(() => {
    if (activePersonaId) {
      localStorage.setItem(scoped("pragna_active_persona_id"), activePersonaId);
    } else {
      localStorage.removeItem(scoped("pragna_active_persona_id"));
    }
  }, [activePersonaId, scoped]);

  const refreshPersonas = useCallback(async () => {
    try {
      const data = await listPersonas();
      setPersonas(data.personas || []);
    } catch (err) {
      console.warn("Failed to load personas:", err);
    }
  }, []);

  // Fetch personas once on load, only if the user is logged in (personas require auth)
  useEffect(() => {
    if (localStorage.getItem("authToken")) {
      refreshPersonas();
    }
  }, []);

  useEffect(() => {
    if (activeChatId) {
      localStorage.setItem(scoped("pragna_active_chat_id"), activeChatId);
    } else {
      localStorage.removeItem(scoped("pragna_active_chat_id"));
    }
  }, [activeChatId, scoped]);

  useEffect(() => {
    localStorage.setItem("pragna_language", language);
  }, [language]);

  const setChatFont = (label) => {
    setChatFontState(label);
    localStorage.setItem("pragna_chat_font", label);
  };

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--pragna-chat-font",
      CHAT_FONT_STACKS[chatFont] || CHAT_FONT_STACKS["Default (Segoe UI)"]
    );
  }, [chatFont]);

  // Auto-initialize first chat if none exist
  useEffect(() => {
    if (!activeChatId && chats.length > 0) {
      setActiveChatId(chats[0].id);
    }
  }, []);

  // Fire a desktop notification when a response finishes arriving while the
  // tab is in the background. wasLoadingRef distinguishes "just finished
  // loading" from "was never loading" so this doesn't fire on mount.
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (
      wasLoadingRef.current &&
      !isLoading &&
      desktopNotifications &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.hidden
    ) {
      const chat = chats.find((c) => c.id === activeChatId);
      const lastMessage = chat?.messages?.[chat.messages.length - 1];
      if (lastMessage && lastMessage.sender === "bot") {
        new Notification("Pragna-1 A", {
          body: (lastMessage.text || "New response ready").slice(0, 120),
        });
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  const newChat = () => {
    const chat = {
      id: Date.now().toString(),
      title: "New chat",
      messages: [],
    };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
  };

  const login = (name, email) => {
    setUser({ name, email });
  };

  const logout = () => {
    setUser(null);
  };

  const deleteChat = (chatId) => {
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) {
      setActiveChatId(null);
    }
  };

  const createFolder = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    setFolders((prev) => [...prev, { id: Date.now().toString(), name: trimmed }]);
  };

  const renameFolder = (folderId, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f))
    );
  };

  const deleteFolder = (folderId) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setChats((prev) =>
      prev.map((c) => (c.folderId === folderId ? { ...c, folderId: null } : c))
    );
  };

  const moveChatToFolder = (chatId, folderId) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, folderId } : c))
    );
  };

  const renameChat = (chatId, newTitle) => {
    const trimmed = (newTitle || "").trim();
    if (!trimmed) return;
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c))
    );
    ChatManagementAPI.renameChat(chatId, trimmed).catch((err) => {
      console.warn("Rename chat API sync notice:", err);
    });
  };

  const pinChat = (chatId, isPinned) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id === chatId) {
          const nextPinned = isPinned !== undefined ? isPinned : !c.pinned;
          return { ...c, pinned: nextPinned };
        }
        return c;
      })
    );
    const targetChat = chats.find((c) => c.id === chatId);
    const targetPinned = isPinned !== undefined ? isPinned : !targetChat?.pinned;
    ChatManagementAPI.pinChat(chatId, targetPinned).catch((err) => {
      console.warn("Pin chat API sync notice:", err);
    });
  };

  const duplicateChat = (chatId) => {
    const source = chats.find((c) => c.id === chatId);
    if (!source) return;
    const copy = {
      id: Date.now().toString(),
      title: `${source.title || "New chat"} (copy)`,
      messages: JSON.parse(JSON.stringify(source.messages || [])),
      folderId: source.folderId || null,
      pinned: source.pinned || false,
    };
    setChats((prev) => [copy, ...prev]);
    setActiveChatId(copy.id);
  };

  const createTemplate = (title, prompt) => {
    const trimmedTitle = (title || "").trim();
    const trimmedPrompt = (prompt || "").trim();
    if (!trimmedTitle || !trimmedPrompt) return;
    setTemplates((prev) => [...prev, { id: Date.now().toString(), title: trimmedTitle, prompt: trimmedPrompt }]);
  };

  const deleteTemplate = (templateId) => {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
  };

  // Voice Assistant state & streaming integration
  const [isVoiceAssistantOpen, setIsVoiceAssistantOpen] = useState(false);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const activeMessages = activeChat?.messages || [];
  const lastAssistantMessage = [...activeMessages].reverse().find((m) => m.sender === "bot")?.text || "";

  const sendVoiceChatMessage = useCallback(
    async (promptText) => {
      if (!promptText || !promptText.trim()) return;
      const text = promptText.trim();

      let targetChatId = activeChatId;
      let currentChat = chats.find((c) => c.id === activeChatId);

      if (!targetChatId || !currentChat) {
        const newId = Date.now().toString();
        const newChatObj = {
          id: newId,
          title: "Voice conversation",
          messages: [],
        };
        setChats((prev) => [newChatObj, ...prev]);
        setActiveChatId(newId);
        targetChatId = newId;
        currentChat = newChatObj;
      }

      const updatedMessages = [
        ...currentChat.messages,
        { sender: "user", text, attachments: [] },
      ];
      const botMsg = { sender: "bot", text: "", isStreaming: true };

      setChats((prev) =>
        prev.map((c) =>
          c.id === targetChatId ? { ...c, messages: [...updatedMessages, botMsg] } : c
        )
      );
      setIsLoading(true);

      try {
        const normalizedLanguage = normalizeLanguageCode(language);
        const activePersona = personas.find((p) => p.id === activePersonaId);
        const controller = new AbortController();
        if (abortControllerRef) {
          abortControllerRef.current = controller;
        }

        let accumulated = "";
        await sendOrchestratedMessageStream({
          text,
          language: normalizedLanguage,
          user_id: targetChatId,
          chatMode,
          personaSystemPrompt: activePersona?.system_prompt,
          extendedThinking,
          signal: controller.signal,
          onChunk: (chunk) => {
            accumulated += chunk;
            setChats((prev) =>
              prev.map((c) =>
                c.id === targetChatId
                  ? {
                      ...c,
                      messages: c.messages.map((m, idx) =>
                        idx === c.messages.length - 1
                          ? { ...m, text: accumulated, isStreaming: true }
                          : m
                      ),
                    }
                  : c
              )
            );
          },
        });

        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m, idx) =>
                    idx === c.messages.length - 1
                      ? { ...m, isStreaming: false }
                      : m
                  ),
                }
              : c
          )
        );

        return accumulated;
      } catch (err) {
        console.error("Voice chat stream error:", err);
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m, idx) =>
                    idx === c.messages.length - 1
                      ? {
                          ...m,
                          text: "Sorry, I encountered an error processing your voice request.",
                          isStreaming: false,
                        }
                      : m
                  ),
                }
              : c
          )
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [activeChatId, chats, language, chatMode, personas, activePersonaId, extendedThinking, abortControllerRef]
  );

  return (
    <ChatContext.Provider
      value={{
        userId,
        chats,
        setChats,
        activeChatId,
        setActiveChatId,
        newChat,
        language,
        setLanguage: setNormalizedLanguage,
        theme,
        setTheme,
        resolvedTheme,
        accentColor,
        setAccentColor,
        chatFont,
        setChatFont,
        isLoading,
        setIsLoading,
        abortControllerRef,
        stopGeneration,

        sidebarOpen,
        toggleSidebar,
        user,
        login,
        logout,
        deleteChat,
        renameChat,
        pinChat,
        folders,
        createFolder,
        renameFolder,
        deleteFolder,
        moveChatToFolder,
        duplicateChat,
        templates,
        createTemplate,
        deleteTemplate,
        chatMode,
        setChatMode,
        extendedThinking,
        setExtendedThinking,
        toggleExtendedThinking,
        personas,
        activePersonaId,
        setActivePersonaId,
        refreshPersonas,
        selectedModel,
        setSelectedModel,
        MODEL_TIERS,
        setMessageFeedback,
        inputRef,
        sidebarSearchInputRef,
        desktopNotifications,
        setDesktopNotifications,

        activeArtifact,
        setActiveArtifact,
        isArtifactOpen,
        setIsArtifactOpen,
        openArtifact,
        closeArtifact,
        highlightedMessageId,
        setHighlightedMessageId,

        isVoiceAssistantOpen,
        setIsVoiceAssistantOpen,
        sendVoiceChatMessage,
        lastAssistantMessage,
      }}
    >

      {children}
    </ChatContext.Provider>
  );
}
