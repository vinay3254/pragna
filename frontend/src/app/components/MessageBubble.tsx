'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Copy, ThumbsUp, ThumbsDown, RotateCcw, Check, Download, FileText, Volume2, Square, Loader2, ChevronDown } from 'lucide-react';
import { Message } from '../types/chat';
import MarkdownRenderer from './MarkdownRenderer';
import AppLogo from '@/components/ui/AppLogo';
import { synthesizeSpeech } from '@/lib/api';

interface MessageBubbleProps {
  message: Message;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  showDateSeparator?: boolean;
  dateSeparatorLabel?: string;
  selectedLanguage?: string;
  onOpenArtifact?: (title: string, content: string, language?: string) => void;
  onRetry?: () => void;
}

function formatExactTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function formatInlineTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export default function MessageBubble({
  message,
  isLastMessage = false,
  isStreaming = false,
  showDateSeparator,
  dateSeparatorLabel,
  selectedLanguage,
  onOpenArtifact,
  onRetry,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [thumbState, setThumbState] = useState<'up' | 'down' | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingSpeech, setIsLoadingSpeech] = useState(false);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsLoadingSpeech(false);
  }, []);

  useEffect(() => {
    const handleSpeechStart = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom.detail !== message.id) {
        stopSpeech();
      }
    };
    const handleSpeechStop = () => {
      stopSpeech();
    };

    window.addEventListener('pragna:speech-start', handleSpeechStart);
    window.addEventListener('pragna:speech-stop', handleSpeechStop);
    return () => {
      window.removeEventListener('pragna:speech-start', handleSpeechStart);
      window.removeEventListener('pragna:speech-stop', handleSpeechStop);
      stopSpeech();
    };
  }, [message.id, stopSpeech]);
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const isThinking = message.role === 'assistant' && message.content === '' && message.isStreaming;
  const isErrorMessage = message.role === 'assistant' && (
    message.content.includes("Could not connect to the AI service") ||
    message.content.includes("Error:") ||
    message.content.startsWith("*(Error:")
  );

  const exactTimestamp = formatExactTimestamp(message.timestamp);
  const inlineTime = formatInlineTime(message.timestamp);

  // Detect any referenced or generated document files (.docx, .pdf, .xlsx, .csv, .pptx)
  const detectedDocFiles = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return [];
    const regex = /(?:Download Link:\s*\[?|File Name:\s*`?|generated_docs\/|\b)([a-zA-Z0-9_\- ]+\.(docx|pdf|xlsx|csv|pptx))\b/gi;
    const matches: { filename: string; ext: string }[] = [];
    const seen = new Set<string>();
    let m;
    while ((m = regex.exec(message.content)) !== null) {
      const clean = m[1].trim();
      const ext = m[2].toLowerCase();
      if (!seen.has(clean) && clean.length > 4) {
        seen.add(clean);
        matches.push({ filename: clean, ext });
      }
    }
    return matches;
  }, [message.content, message.role]);

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const speakWithBrowser = (cleanText: string, targetLang: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSpeaking(false);
      setIsLoadingSpeech(false);
      return;
    }

    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    let textToSpeak = cleanText;
    let actualLang = targetLang;

    // Transliterate Odia (\u0B00-\u0B7F) to Devanagari so browser speech synthesis can pronounce it
    if (/[\u0B00-\u0B7F]/.test(cleanText) || targetLang === 'or-IN' || targetLang === 'or') {
      textToSpeak = cleanText.replace(/[\u0B00-\u0B7F]/g, (ch) => {
        const code = ch.charCodeAt(0);
        if (code === 0x0b71) return '\u0935';
        return String.fromCharCode(code - 0x0200);
      });
      actualLang = 'hi-IN';
    } else if (/[\u0A00-\u0A7F]/.test(cleanText) || targetLang === 'pa-IN' || targetLang === 'pa') {
      textToSpeak = cleanText.replace(/[\u0A00-\u0A7F]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0x0100);
      });
      actualLang = 'hi-IN';
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = actualLang;
    utterance.pitch = 1.05;
    utterance.rate = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const targetLangLower = actualLang.toLowerCase();
    const langPrefix = targetLangLower.slice(0, 2);

    // Only assign a voice if it matches the target language!
    // NEVER assign an English voice to an Indian script utterance.
    const matchingVoice =
      voices.find((v) => v.lang.toLowerCase() === targetLangLower) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    } else if (langPrefix === 'en') {
      const englishVoice =
        voices.find((v) => v.lang.toLowerCase().startsWith('en') && /female|zira|neerja|samantha/i.test(v.name)) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en'));
      if (englishVoice) utterance.voice = englishVoice;
    }

    utterance.onstart = () => {
      setIsLoadingSpeech(false);
      setIsSpeaking(true);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsLoadingSpeech(false);
    };
    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      setIsSpeaking(false);
      setIsLoadingSpeech(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const toggleSpeech = async () => {
    if (isSpeaking || isLoadingSpeech) {
      stopSpeech();
      return;
    }

    stopSpeech();

    // Clean text for speech
    const cleanText = message.content
      .replace(/```[\s\S]*?```/g, '') // remove code blocks
      .replace(/`([^`]+)`/g, '$1') // remove inline code backticks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // remove markdown links
      .replace(/[#*_~>|•]/g, '') // remove markdown formatting symbols
      .replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '') // strip emojis
      .replace(/(\r\n|\n|\r)+/g, ' ') // convert linebreaks to spaces
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    // Detect language script for optimal pronunciation
    const hasTelugu = /[\u0C00-\u0C7F]/.test(cleanText);
    const hasTamil = /[\u0B80-\u0BFF]/.test(cleanText);
    const hasBengali = /[\u0980-\u09FF]/.test(cleanText);
    const hasKannada = /[\u0C80-\u0CFF]/.test(cleanText);
    const hasMalayalam = /[\u0D00-\u0D7F]/.test(cleanText);
    const hasGujarati = /[\u0A80-\u0AFF]/.test(cleanText);
    const hasPunjabi = /[\u0A00-\u0A7F]/.test(cleanText);
    const hasOdia = /[\u0B00-\u0B7F]/.test(cleanText);
    const hasUrdu = /[\u0600-\u06FF]/.test(cleanText);
    const hasDevanagari = /[\u0900-\u097F]/.test(cleanText);

    const activeLanguage =
      selectedLanguage ||
      (typeof window !== 'undefined' ? localStorage.getItem('pragna_selected_language') : null) ||
      'auto';

    let targetLang = 'en-IN';
    let targetVoice = 'en-IN-NeerjaNeural';

    if (hasTelugu || activeLanguage === 'te') {
      targetLang = 'te-IN';
      targetVoice = 'te-IN-ShrutiNeural';
    } else if (hasTamil || activeLanguage === 'ta') {
      targetLang = 'ta-IN';
      targetVoice = 'ta-IN-PallaviNeural';
    } else if (hasBengali || activeLanguage === 'bn' || activeLanguage === 'as') {
      targetLang = 'bn-IN';
      targetVoice = 'bn-IN-TanishaaNeural';
    } else if (hasKannada || activeLanguage === 'kn') {
      targetLang = 'kn-IN';
      targetVoice = 'kn-IN-SapnaNeural';
    } else if (hasMalayalam || activeLanguage === 'ml') {
      targetLang = 'ml-IN';
      targetVoice = 'ml-IN-SobhanaNeural';
    } else if (hasGujarati || activeLanguage === 'gu') {
      targetLang = 'gu-IN';
      targetVoice = 'gu-IN-DhwaniNeural';
    } else if (hasPunjabi || activeLanguage === 'pa') {
      targetLang = 'pa-IN';
      targetVoice = 'hi-IN-SwaraNeural';
    } else if (hasUrdu || activeLanguage === 'ur') {
      targetLang = 'ur-IN';
      targetVoice = 'ur-IN-GulNeural';
    } else if (hasOdia || activeLanguage === 'or') {
      targetLang = 'or-IN';
      targetVoice = 'hi-IN-SwaraNeural';
    } else if (hasDevanagari || ['hi', 'mr', 'ne', 'sa', 'bho', 'mai', 'kok'].includes(activeLanguage)) {
      if (activeLanguage === 'mr') {
        targetLang = 'mr-IN';
        targetVoice = 'mr-IN-AarohiNeural';
      } else if (activeLanguage === 'ne') {
        targetLang = 'ne-NP';
        targetVoice = 'ne-NP-HemkalaNeural';
      } else {
        targetLang = 'hi-IN';
        targetVoice = 'hi-IN-SwaraNeural';
      }
    } else if (activeLanguage === 'en' || activeLanguage === 'en-IN') {
      targetLang = 'en-IN';
      targetVoice = 'en-IN-NeerjaNeural';
    }

    setIsLoadingSpeech(true);
    window.dispatchEvent(new CustomEvent('pragna:speech-start', { detail: message.id }));

    // Strategy 1: High-definition neural audio via Next.js / FastAPI TTS endpoint
    try {
      const speechSnippet = cleanText.length > 1500 ? cleanText.slice(0, 1500) + '...' : cleanText;
      const blob = await synthesizeSpeech(speechSnippet, targetVoice, targetLang.slice(0, 2));

      if (blob && blob.size > 200) {
        const audioUrl = URL.createObjectURL(blob);
        audioUrlRef.current = audioUrl;
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onplay = () => {
          setIsLoadingSpeech(false);
          setIsSpeaking(true);
        };
        audio.onended = () => {
          stopSpeech();
        };
        audio.onerror = () => {
          stopSpeech();
          speakWithBrowser(cleanText, targetLang);
        };

        await audio.play();
        return;
      }
    } catch (err) {
      console.warn('Server TTS failed, falling back to browser SpeechSynthesis:', err);
    }

    // Strategy 2: Client-side SpeechSynthesis fallback
    speakWithBrowser(cleanText, targetLang);
  };

  return (
    <>
      {/* Date separator for multi-day conversations */}
      {showDateSeparator && dateSeparatorLabel && (
        <div className="flex items-center gap-3 my-1.5">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-[11px] text-muted-foreground/60 font-medium px-2.5 py-0.5 rounded-full bg-muted/40 border border-border/40 whitespace-nowrap">
            {dateSeparatorLabel}
          </span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
      )}

      {message.role === 'user' ? (
        <div className="flex justify-end message-enter group/msg">
          <div className="flex flex-col items-end gap-0.5 max-w-[85%]">
            <div className="relative inline-block max-w-full">
              {/* Tooltip */}
              {exactTimestamp && (
                <div className="absolute -top-7 right-0 z-10 pointer-events-none opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
                  <div className="bg-popover text-popover-foreground text-[11px] px-2 py-0.5 rounded-md shadow-md border border-border/60 whitespace-nowrap">
                    {exactTimestamp}
                  </div>
                </div>
              )}
              <div className="px-4 py-2.5 text-foreground text-sm leading-relaxed">
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {message.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`Attached photo ${i + 1}`}
                        className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-border/50"
                      />
                    ))}
                  </div>
                )}
                {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
              </div>
            </div>
            {/* Inline time */}
            {inlineTime && !message.isStreaming && (
              <span className="text-[10px] text-muted-foreground/40 pr-1 font-mono-data tracking-tight leading-none mt-0.5">{inlineTime}</span>
            )}
          </div>
        </div>
      ) : (
        /* Assistant message */
        <div className="message-enter group/msg">
          <div className="flex items-start gap-2.5">
            <div className="flex-shrink-0 w-6 h-6 mt-1 flex items-center justify-center">
              <AppLogo size={22} variant="shield" />
            </div>

            <div className="flex-1 min-w-0">
              {isThinking ? (
                <div className="inline-flex items-center gap-1.5 py-1.5 bg-transparent">
                  <div className="thinking-dot" />
                  <div className="thinking-dot" />
                  <div className="thinking-dot" />
                </div>
              ) : (
                <div className="relative">
                  {/* Tooltip */}
                  {exactTimestamp && !message.isStreaming && (
                    <div className="absolute -top-7 left-0 z-10 pointer-events-none opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
                      <div className="bg-popover text-popover-foreground text-[11px] px-2 py-0.5 rounded-md shadow-md border border-border/60 whitespace-nowrap">
                        {exactTimestamp}
                      </div>
                    </div>
                  )}

                  {/* Assistant response container bubble */}
                  <div className={`
                    relative text-sm leading-relaxed transition-all
                    ${isErrorMessage
                      ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300 dark:text-rose-200 px-4 py-3 rounded-2xl'
                      : 'bg-transparent border-0 shadow-none text-foreground py-0.5'
                    }
                  `}>
                    <div className="prose-chat">
                      <MarkdownRenderer content={message.content} onOpenArtifact={onOpenArtifact} />
                      {message.isStreaming && (
                        <span className="streaming-cursor" aria-hidden="true" />
                      )}
                    </div>

                    {/* Detected Document Download Attachments */}
                    {!message.isStreaming && detectedDocFiles.length > 0 && (
                      <div className="mt-3.5 space-y-2">
                        {detectedDocFiles.map((doc) => (
                          <div
                            key={doc.filename}
                            className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-transparent hover:border-border/70 transition-all"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-mono font-bold text-xs uppercase shrink-0">
                                {doc.ext}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-foreground truncate max-w-[280px]">
                                  {doc.filename}
                                </div>
                                <div className="text-[11px] text-muted-foreground/70">
                                  {doc.ext.toUpperCase()} Document &bull; Ready for download
                                </div>
                              </div>
                            </div>
                            <a
                              href={`/api/documents/download/${encodeURIComponent(doc.filename)}`}
                              download={doc.filename}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-all active:scale-95 shrink-0 ml-3 no-underline"
                            >
                              <Download size={13} />
                              <span>Download</span>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* RAG citations — passages this reply's [n] markers refer to */}
                    {!message.isStreaming && message.citations && message.citations.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-start gap-1.5">
                        {message.citations.map((citation) => (
                          <div key={citation.index} className="flex flex-col">
                            <button
                              onClick={() =>
                                setOpenCitation(prev => (prev === citation.index ? null : citation.index))
                              }
                              className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-muted/60 border border-border/60 text-xs text-foreground hover:border-border transition-colors"
                            >
                              <span className="font-mono-data text-[10px] text-muted-foreground/80">
                                [{citation.index}]
                              </span>
                              <FileText size={12} className="text-muted-foreground shrink-0" />
                              <span className="max-w-[160px] truncate">{citation.filename}</span>
                              <ChevronDown
                                size={11}
                                className={`transition-transform ${openCitation === citation.index ? 'rotate-180' : ''}`}
                              />
                            </button>
                            {openCitation === citation.index && (
                              <div className="mt-1 max-w-[320px] p-2.5 rounded-lg bg-muted/40 border border-border/50 text-[11px] text-muted-foreground leading-snug">
                                {citation.snippet}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action row — only show when message is complete */}
              {!message.isStreaming && !isThinking && message.content && (
                <div className="flex items-center gap-1 mt-1.5 pl-0.5">
                  <div className="flex items-center gap-0.5 opacity-40 group-hover/msg:opacity-100 transition-opacity duration-200">
                    {!isErrorMessage && (
                      <>
                        <ActionButton
                          icon={copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          label={copied ? 'Copied!' : 'Copy response'}
                          onClick={copyMessage}
                        />
                        <ActionButton
                          icon={
                            isLoadingSpeech ? (
                              <Loader2 size={12} className="text-primary animate-spin" />
                            ) : isSpeaking ? (
                              <Square size={11} className="text-primary fill-primary animate-pulse" />
                            ) : (
                              <Volume2 size={12} />
                            )
                          }
                          label={isLoadingSpeech ? 'Synthesizing...' : isSpeaking ? 'Stop reading' : 'Read aloud'}
                          onClick={toggleSpeech}
                          active={isSpeaking || isLoadingSpeech}
                        />
                        <ActionButton
                          icon={<ThumbsUp size={12} className={thumbState === 'up' ? 'text-primary fill-primary/20' : ''} />}
                          label="Good response"
                          onClick={() => setThumbState(prev => prev === 'up' ? null : 'up')}
                          active={thumbState === 'up'}
                        />
                        <ActionButton
                          icon={<ThumbsDown size={12} className={thumbState === 'down' ? 'text-rose-400 fill-rose-400/20' : ''} />}
                          label="Bad response"
                          onClick={() => setThumbState(prev => prev === 'down' ? null : 'down')}
                          active={thumbState === 'down'}
                        />
                      </>
                    )}
                    <ActionButton
                      icon={<RotateCcw size={12} className={isErrorMessage ? 'text-rose-400' : ''} />}
                      label="Retry response"
                      onClick={() => onRetry ? onRetry() : copyMessage()}
                      active={isErrorMessage}
                    />
                  </div>

                  {/* Inline time for assistant */}
                  {inlineTime && (
                    <span className="ml-1 text-[10px] text-muted-foreground/40 font-mono-data tracking-tight leading-none">{inlineTime}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionButton({
  icon, label, onClick, active = false
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`
        p-1 rounded-md transition-all duration-150 active:scale-90
        ${active
          ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/60'
        }
      `}
      aria-label={label}
    >
      {icon}
    </button>
  );
}