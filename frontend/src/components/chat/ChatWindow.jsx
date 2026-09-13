import { useContext, useCallback, useState, useEffect, useRef } from "react";

import { ChatContext } from "../../context/ChatContext";
import { generateAIImage, generateDocument, sendOrchestratedMessageStream, summarizeChat } from "../../api/api";
import MessageBubble from "./MessageBubble";
import { normalizeLanguageCode } from "../../utils/language";
import { useMediaQuery } from "../../pragna/hooks/useMediaQuery";
import pragnaShield from "../../assets/pragna-shield-icon.png";
import NewChatView from "../../pragna/components/NewChatView";

const IMAGE_REQUEST_RE = /(create|generate|make|design)\s+(an?\s+)?(ai\s+)?image|image\s+of|illustration\s+of|poster\s+of|logo\s+of/i;

const extractImagePrompt = (text) => {
  const raw = (text || "").trim();
  if (!raw) return "";
  return raw
    .replace(/^(please\s+)?(create|generate|make|design)\s+(an?\s+)?(ai\s+)?(image|picture|photo|illustration)\s+(of|for)?\s*/i, "")
    .trim() || raw;
};

const DOCUMENT_VERB_RE = /\b(create|generate|make|write|draft|build|export|give\s+me)\b.*\b(word(\s*(doc(ument)?|file))?|\bdocx\b|\bdoc(ument)?\b|report|excel(\s*(sheet|spreadsheet|file))?|spreadsheet|\bxlsx\b|\bpdf(\s*file)?\b|power\s*point(\s*(presentation|deck|file|slides?))?|presentation|slides?|\bpptx\b)\b/i;

const DOCUMENT_FORMAT_PATTERNS = [
  { format: "pptx", re: /power\s*point|presentation|slides?|\bpptx\b/i },
  { format: "xlsx", re: /excel|spreadsheet|sheet|\bxlsx\b/i },
  { format: "pdf", re: /\bpdf\b/i },
  { format: "docx", re: /word(\s*(doc(ument)?|file))?|\bdoc(ument)?\b|\bdocx\b|report/i },
];

const extractDocumentRequest = (text) => {
  const raw = (text || "").trim();
  if (!raw || !DOCUMENT_VERB_RE.test(raw)) return null;
  const match = DOCUMENT_FORMAT_PATTERNS.find((p) => p.re.test(raw));
  if (!match) return null;
  const subject = raw
    .replace(/^(please\s+)?(create|generate|make|write|draft|build|export|give\s+me)\s+(me\s+)?(an?\s+)?(ms\s*)?((word(\s*(doc(ument)?|file))?|\bdocx\b|\bdoc(ument)?\b|excel(\s*(sheet|spreadsheet|file))?|spreadsheet|\bxlsx\b|pdf(\s*file)?|power\s*point(\s*(presentation|deck|file))?|presentation|slides?|\bpptx\b|report))\s*(about|on|for|regarding|with|containing|and|to|,)?\s*/i, "")
    .trim() || raw;
  return { format: match.format, subject };
};

export default function ChatWindow() {
  const {
    chats,
    setChats,
    activeChatId,
    setActiveChatId,
    language,
    isLoading,
    setIsLoading,
    chatMode,
    setChatMode,
    personas,
    activePersonaId,
    setActivePersonaId,
    sidebarOpen,
    highlightedMessageId,
    extendedThinking,
    abortControllerRef,
    openArtifact,
    selectedModel,
    setSelectedModel,
    MODEL_TIERS,
  } = useContext(ChatContext);

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // The floating "reopen sidebar" button this padding makes room for is
  // desktop-only (see MainLayout.jsx) - on mobile sidebarOpen may still be
  // false from a desktop session, so gate the extra padding on isDesktop too,
  // otherwise mobile loses ~64px of its already-scarce width for nothing.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 640px)");

  const chat = chats.find((c) => c.id === activeChatId);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesContainerRef = useRef(null);
  const messagesBottomRef = useRef(null);
  const isAutoScrollEnabledRef = useRef(true);
  const prevMessagesLengthRef = useRef(chat?.messages?.length || 0);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // If the user scrolls up by more than 100px, pause auto-scroll so they can read peacefully
    if (distanceFromBottom > 100) {
      isAutoScrollEnabledRef.current = false;
      setShowScrollBottom(true);
    } else {
      // Near bottom: resume auto-scroll
      isAutoScrollEnabledRef.current = true;
      setShowScrollBottom(false);
    }
  };

  const scrollToBottom = useCallback((smooth = false) => {
    isAutoScrollEnabledRef.current = true;
    setShowScrollBottom(false);
    if (!messagesContainerRef.current) return;
    if (smooth) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    } else {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const currentLength = chat?.messages?.length || 0;
    // When a new message is appended (user submits or bot begins), re-enable auto-scroll
    if (currentLength > prevMessagesLengthRef.current) {
      isAutoScrollEnabledRef.current = true;
      setShowScrollBottom(false);
    }
    prevMessagesLengthRef.current = currentLength;

    if (!messagesContainerRef.current) return;
    if (isAutoScrollEnabledRef.current) {
      requestAnimationFrame(() => {
        if (messagesContainerRef.current && isAutoScrollEnabledRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      });
    }
  }, [chat?.messages, isLoading]);

  useEffect(() => {
    // When switching active chats, scroll immediately to bottom
    isAutoScrollEnabledRef.current = true;
    setShowScrollBottom(false);
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [activeChatId]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${highlightedMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightedMessageId, activeChatId]);


  // Map display names for modes
  const modeMapping = {
    general: "General",
    explain_concepts: "Explain",
    generate_ideas: "Ideas",
    write_content: "Write",
    code_assistance: "Code",
    ask_questions: "Questions",
    creative_writing: "Story",
  };

  const dbModeFromLabel = (label) => {
    const rMap = {
      General: "general",
      Explain: "explain_concepts",
      Ideas: "generate_ideas",
      Write: "write_content",
      Code: "code_assistance",
      Questions: "ask_questions",
      Story: "creative_writing",
    };
    return rMap[label] || "general";
  };

  const getModeLabel = (v) => modeMapping[v] || "General";

  // Send suggestion message
  const sendSuggestionMessage = useCallback(async (suggestion, attachments = []) => {
    if (isLoading) return;

    let targetChatId = activeChatId;
    let currentChat = chat;

    if (!targetChatId || !currentChat) {
      const newId = Date.now().toString();
      const newChatObj = {
        id: newId,
        title: "New chat",
        messages: [],
      };
      setChats((prev) => [newChatObj, ...prev]);
      setActiveChatId(newId);
      targetChatId = newId;
      currentChat = newChatObj;
    }

    const botMsg = { sender: "bot", text: "", isStreaming: true };

    setChats((prev) =>
      prev.map((c) =>
        c.id === targetChatId
          ? { ...c, messages: [...c.messages, { sender: "user", text: suggestion, attachments }, botMsg] }
          : c
      )
    );
    setIsLoading(true);

    try {
      const docRequest = extractDocumentRequest(suggestion);
      if (docRequest) {
        const docResult = await generateDocument({
          format: docRequest.format,
          prompt: docRequest.subject,
          language: normalizeLanguageCode(language),
        });

        setIsLoading(false);
        openArtifact?.({
          id: `doc-${Date.now()}`,
          title: docResult.title || docResult.filename || `${docRequest.subject}.${docRequest.format}`,
          type: docRequest.format === 'pdf' ? 'pdf' : 'document',
          format: docRequest.format,
          downloadUrl: docResult.download_url,
          content: docResult.content || `# ${docResult.filename || 'Generated Document'}\n\nDocument ready for preview and download.`,
        });
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m, idx) =>
                    idx === c.messages.length - 1
                      ? {
                          ...m,
                          text: "Generated document ready.",
                          isStreaming: false,
                          attachments: [
                            {
                              name: docResult.filename,
                              type: "document",
                              downloadUrl: docResult.download_url,
                              format: docRequest.format,
                              content: docResult.content,
                              title: docResult.title,
                            },
                          ],
                        }
                      : m
                  ),
                }
              : c
          )
        );
        return;
      }

      if (IMAGE_REQUEST_RE.test(suggestion)) {
        const imageResult = await generateAIImage({
          prompt: extractImagePrompt(suggestion),
          style: "cinematic",
          quality: "hd",
          size: "1024x1024",
        });

        setIsLoading(false);
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m, idx) =>
                    idx === c.messages.length - 1
                      ? {
                          ...m,
                          text: "Generated image ready.",
                          isStreaming: false,
                          attachments: [
                            {
                              name: `generated-${Date.now()}.png`,
                              type: "image",
                              previewUrl: imageResult.image,
                            },
                          ],
                        }
                      : m
                  ),
                }
              : c
          )
        );
        return;
      }

      const activePersona = personas.find((p) => p.id === activePersonaId);

      let sawResponse = false;
      const controller = new AbortController();
      if (abortControllerRef) {
        abortControllerRef.current = controller;
      }

      await sendOrchestratedMessageStream({
        text: suggestion,
        language: normalizeLanguageCode(language),
        user_id: targetChatId,
        chatMode,
        personaSystemPrompt: activePersona?.system_prompt,
        extendedThinking,
        signal: controller.signal,
        onThinking: (thinking) => {
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.map((m, idx) =>
                      idx === c.messages.length - 1 ? { ...m, thinking } : m
                    ),
                  }
                : c
            )
          );
        },
        onChunk: (chunk) => {
          sawResponse = true;
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.map((m, idx) =>
                      idx === c.messages.length - 1 ? { ...m, text: (m.text || "") + chunk } : m
                    ),
                  }
                : c
            )
          );
        },
        onSources: (sources) => {
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.map((m, idx) =>
                      idx === c.messages.length - 1 ? { ...m, sources } : m
                    ),
                  }
                : c
            )
          );
        },
        onDone: () => {
          setIsLoading(false);
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.map((m, idx) =>
                      idx === c.messages.length - 1 ? { ...m, isStreaming: false } : m
                    ),
                  }
                : c
            )
          );
        },
      });

      if (!sawResponse) {
        throw new Error("Invalid response from server");
      }
    } catch (err) {
      console.error("API error:", err);
      setIsLoading(false);

      const errorMessage = "Server error. Please try again.";
      setChats((prev) =>
        prev.map((c) =>
          c.id === targetChatId
            ? {
                ...c,
                messages: c.messages.map((m, idx) =>
                  idx === c.messages.length - 1
                    ? {
                        ...m,
                        text: errorMessage,
                        isStreaming: false,
                        error: true,
                      }
                    : m
                ),
              }
            : c
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeChatId, chat, isLoading, language, setChats, setActiveChatId, setIsLoading, chatMode, personas, activePersonaId, extendedThinking, abortControllerRef]);

  // Retry a failed message: remove the old failed user+bot pair, then resend
  const retryMessage = useCallback((idx) => {
    if (isLoading) return;
    const userMsg = chat?.messages?.[idx - 1];
    if (!userMsg) return;
    const targetChatId = activeChatId;
    setChats((prev) =>
      prev.map((c) =>
        c.id === targetChatId ? { ...c, messages: c.messages.slice(0, idx - 1) } : c
      )
    );
    sendSuggestionMessage(userMsg.text, userMsg.attachments || []);
  }, [chat, activeChatId, isLoading, setChats, sendSuggestionMessage]);

  // Edit a previously sent user message: support both in-place editing and re-submitting with fresh response
  const editMessage = useCallback((idx, newText, resubmit = true) => {
    if (isLoading) return;
    const trimmed = (newText || "").trim();
    if (!trimmed) return;
    const targetChatId = activeChatId;

    if (!resubmit) {
      setChats((prev) =>
        prev.map((c) =>
          c.id === targetChatId
            ? {
                ...c,
                messages: c.messages.map((m, i) =>
                  i === idx ? { ...m, text: trimmed, edited: true } : m
                ),
              }
            : c
        )
      );
      return;
    }

    const currentMsg = chat?.messages?.[idx];
    const originalAttachments = currentMsg?.attachments || [];
    setChats((prev) =>
      prev.map((c) =>
        c.id === targetChatId ? { ...c, messages: c.messages.slice(0, idx) } : c
      )
    );
    sendSuggestionMessage(trimmed, originalAttachments);
  }, [activeChatId, chat, isLoading, setChats, sendSuggestionMessage]);

  // Toggle the bookmarked flag on a single message, leaving everything else untouched
  const toggleBookmark = useCallback((idx) => {
    const targetChatId = activeChatId;
    setChats((prev) =>
      prev.map((c) =>
        c.id === targetChatId
          ? {
              ...c,
              messages: c.messages.map((m, i) =>
                i === idx ? { ...m, bookmarked: !m.bookmarked } : m
              ),
            }
          : c
      )
    );
  }, [activeChatId, setChats]);

  // Summarize the active chat and append the result as a new message
  const [summarizing, setSummarizing] = useState(false);
  const handleSummarize = useCallback(async () => {
    if (!chat || summarizing) return;
    setSummarizing(true);
    try {
      const { summary } = await summarizeChat(chat.messages, language);
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId
            ? { ...c, messages: [...c.messages, { sender: "bot", text: summary }] }
            : c
        )
      );
    } catch (err) {
      console.error("Summarize error:", err);
    } finally {
      setSummarizing(false);
    }
  }, [chat, activeChatId, language, setChats, summarizing]);

  // If chat is empty, show the New Chat landing view
  if (!chat || chat.messages.length === 0) {
    return <NewChatView />;
  }

  // If chat is active and has messages, show conversation
  const chatTitle = chat.title || 'New Chat'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', position: 'relative' }}>
      {/* Chat header (matches mockup) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'nowrap',
          gap: isMobile ? '8px' : '12px',
          padding: isDesktop && !sidebarOpen ? '14px 28px 14px 64px' : (isMobile ? '10px 14px' : '14px 28px'),
          borderBottom: '1px solid var(--pragna-border)',
          background: 'var(--pragna-surface-2)',
          backdropFilter: 'blur(8px)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: isMobile ? '14px' : '15px', fontWeight: 650, color: 'var(--pragna-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatTitle}</div>
        
        {/* Mimir Model Engine Tier Selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setModelDropdownOpen((prev) => !prev)}
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: isMobile ? '4px 9px' : '5px 12px',
              borderRadius: '999px',
              border: '1px solid rgba(212,175,55,0.35)',
              background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(212,175,55,0.04))',
              color: 'var(--pragna-gold-soft, #F3C96A)',
              fontSize: isMobile ? '11px' : '12px',
              fontWeight: 650,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            className="hover:scale-[1.02] hover:border-[var(--pragna-gold-soft)]"
          >
            <span>
              {(() => {
                const t = MODEL_TIERS?.find((item) => item.id === selectedModel);
                return t ? `${t.label} (${t.sanskrit})` : 'Tvarā (त्वरा)';
              })()}
            </span>
            <span style={{ fontSize: '10px', opacity: 0.7 }}>▾</span>
          </button>

          {modelDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                width: '280px',
                background: 'var(--pragna-surface-elevated, #1A1A1E)',
                border: '1px solid var(--pragna-border)',
                borderRadius: '14px',
                padding: '6px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                zIndex: 100,
                backdropFilter: 'blur(16px)',
              }}
            >
              <div style={{ padding: '6px 10px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--pragna-text-muted)' }}>
                Pragna Model Intelligence Engine
              </div>
              {MODEL_TIERS?.map((tier) => {
                const isSelected = selectedModel === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => {
                      setSelectedModel?.(tier.id);
                      setModelDropdownOpen(false);
                    }}
                    type="button"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: isSelected ? '1px solid rgba(212,175,55,0.3)' : '1px solid transparent',
                      background: isSelected ? 'rgba(212,175,55,0.12)' : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      marginBottom: '2px',
                    }}
                    className="hover:bg-[var(--pragna-surface-hover)]"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 650, color: isSelected ? 'var(--pragna-gold-soft)' : 'var(--pragna-text)' }}>
                        {tier.label} ({tier.sanskrit}) · <span style={{ opacity: 0.8, fontWeight: 400, fontSize: '11.5px' }}>{tier.englishLabel}</span>
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--pragna-text-muted)', fontFamily: 'monospace' }}>
                        {tier.tier.split(':')[0]}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--pragna-text-muted)', marginTop: '2px' }}>
                      {tier.meaning ? `"${tier.meaning}" — ` : ''}{tier.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={handleSummarize}
          disabled={summarizing}
          title="Summarize this conversation"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: isMobile ? '5px 11px' : '6px 14px',
            borderRadius: '999px',
            border: '1px solid var(--pragna-border)',
            background: 'transparent',
            color: 'var(--pragna-text-muted)',
            fontSize: isMobile ? '11.5px' : '12.5px',
            fontWeight: 600,
            cursor: summarizing ? 'default' : 'pointer',
            opacity: summarizing ? 0.6 : 1,
            flexShrink: 0,
          }}
          className="hover:text-[var(--pragna-gold-soft)] hover:border-accent-500/40"
        >
          {summarizing ? 'Summarizing…' : 'Summarize'}
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 0 24px 0' : '32px 0', minHeight: 0 }}
        className="custom-scrollbar"
      >
        <div style={{ maxWidth: '780px', margin: '0 auto', padding: isMobile ? '0 10px' : '0 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? '16px' : '22px' }}>
          {chat.messages.map((m, idx) => {
            const isHighlighted = highlightedMessageId && (m.id === highlightedMessageId || String(idx) === String(highlightedMessageId));
            return (
              <div
                key={m.id || idx}
                id={`msg-${m.id || idx}`}
                style={{
                  borderRadius: '16px',
                  transition: 'all 0.3s ease',
                  border: isHighlighted ? '1.5px solid rgba(212,175,55,0.7)' : '1.5px solid transparent',
                  boxShadow: isHighlighted ? '0 0 20px rgba(212,175,55,0.25)' : 'none',
                  padding: isHighlighted ? '6px' : '0px',
                  background: isHighlighted ? 'rgba(212,175,55,0.06)' : 'transparent',
                }}
              >
                <MessageBubble
                  message={m}
                  language={language}
                  onRetry={idx === chat.messages.length - 1 ? () => retryMessage(idx) : undefined}
                  onEdit={m.sender !== "bot" ? (newText, resubmit) => editMessage(idx, newText, resubmit) : undefined}
                  isLoading={isLoading}
                  onToggleBookmark={() => toggleBookmark(idx)}
                  onSendPrompt={sendSuggestionMessage}
                />
              </div>
            );
          })}
          <div ref={messagesBottomRef} style={{ height: '1px' }} />
        </div>
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          title="Scroll to bottom"
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'var(--pragna-surface)',
            border: '1px solid rgba(212,175,55,0.45)',
            color: 'var(--pragna-gold-soft)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45), 0 0 12px rgba(212,175,55,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="hover:scale-110 hover:border-[var(--pragna-gold-soft)] animate-[fadeUp_0.2s_ease]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

