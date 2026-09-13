import { useContext, useEffect, useRef, useState } from "react";
import CodeBlock from "./CodeBlock";
import PragnaCanvas from "../canvas/PragnaCanvas";
import { API_BASE } from "../../api/api";
import pragnaShield from "../../assets/pragna-shield-icon.png";
import { ChatContext } from "../../context/ChatContext";
import {
  CodeIcon,
  EyeIcon,
  CopyIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  RetryIcon,
  EditIcon as PencilIcon,
  StarredIcon as StarIcon,
  SpeakIcon as VoiceIcon,
  CheckIcon,
  ErrorIcon,
  ThinkIcon,
  ChevronDownIcon,
} from "../icons/PragnaIcon";

// BCP-47 language tag map - Comprehensive support for all Indian regional languages
// Includes all 22 official languages + tribal languages, modern variants, and international languages
const LANG_TAG = {
  // International
  en: "en-US",        // English

  // Major Official Indian Languages - Google TTS supported locales
  hi: "hi-IN",        // Hindi
  ta: "ta-IN",        // Tamil
  te: "te-IN",        // Telugu
  kn: "kn-IN",        // Kannada
  ml: "ml-IN",        // Malayalam
  mr: "mr-IN",        // Marathi
  gu: "gu-IN",        // Gujarati
  pa: "pa-IN",        // Punjabi (Gurmukhi)
  bn: "bn-IN",        // Bengali
  or: "or-IN",        // Odia
  as: "as-IN",        // Assamese

  // Regional Languages - Google TTS supported
  kok: "kok-IN",      // Konkani
  mni: "mni-IN",      // Manipuri
  sat: "sat-IN",      // Santali (Tribal)
  mai: "mai-IN",      // Maithili
  mag: "mag-IN",      // Magahi
  ang: "ang-IN",      // Angika
  ks: "ks-IN",        // Kashmiri
  doi: "doi-IN",      // Dogri
  raj: "raj-IN",      // Rajasthani
  har: "har-IN",      // Haryanvi
  gom: "kok-IN",      // Goan Konkani → use Konkani

  // Tribal & Other Languages
  ho: "hi-IN",        // Ho → fallback to Hindi (has Google support)
  kru: "hi-IN",       // Kurukh → fallback to Hindi
  mun: "hi-IN",       // Mundari → fallback to Hindi
  brx: "brx-IN",      // Bodo - Google has this
  mwr: "mr-IN",       // Marwari → use Marathi voice
  urd: "ur-PK",       // Urdu - Pakistan variant (Google supports)
  lah: "pa-IN",       // Lahnda → use Punjabi voice
};

// Language-specific voice parameters for natural, accent-aware delivery
// All Indian languages use natural parameters to preserve authentic accents
const LANGUAGE_CONFIG = {
  // International
  "en-US": { rate: 0.95, pitch: 1.0, volume: 1.0 },

  // Major Official Indian Languages
  "hi-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Hindi
  "ta-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Tamil
  "te-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Telugu
  "kn-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Kannada
  "ml-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Malayalam
  "mr-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Marathi
  "gu-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Gujarati
  "pa-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Punjabi
  "bn-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Bengali
  "or-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Odia
  "as-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Assamese

  // Regional Languages
  "kok-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Konkani
  "mni-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Manipuri
  "sat-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Santali
  "mai-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Maithili
  "mag-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Magahi
  "ang-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Angika
  "ks-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Kashmiri
  "doi-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Dogri
  "raj-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Rajasthani
  "har-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Haryanvi

  // Tribal & Others
  "brx-IN": { rate: 0.95, pitch: 1.0, volume: 1.0 },   // Bodo
  "ur-PK": { rate: 0.95, pitch: 1.0, volume: 1.0 },    // Urdu
};

// Keywords for voice selection (no longer needed with Google TTS)
// Kept for potential future use
const FEMALE_KEYWORDS = [
  "female", "woman", "girl", "zira", "susan", "hazel", "samantha", "victoria",
  "karen", "moira", "fiona", "veena", "raveena", "heera", "lekha", "kalpana",
  "priya", "aditi", "neerja", "madhubala", "deepika",
  "natural", "premium", "neural", "standard", "default"
];

// Clean text for speech: remove emojis, code blocks, markdown formatting
const cleanTextForSpeech = (text) => {
  if (!text) return "";

  // Remove code blocks (```...```)
  let cleaned = text.replace(/```[\s\S]*?```/g, "[code block]");

  // Remove inline code (`...`)
  cleaned = cleaned.replace(/`[^`]+`/g, "");

  // Remove markdown links [text](url) but keep the link text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove markdown formatting but keep content
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, "$2");  // Bold: **text** → text
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, "$2");      // Italic: *text* → text
  cleaned = cleaned.replace(/~~(.*?)~~/g, "$1");          // Strikethrough: ~~text~~ → text

  // Remove common emojis (but keep punctuation for intonation)
  cleaned = cleaned.replace(
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
    ""
  );

  // Clean up extra spaces but preserve paragraph breaks
  cleaned = cleaned.replace(/\n\n+/g, ". ");  // Multiple newlines → period + space
  cleaned = cleaned.replace(/\n/g, " ");      // Single newline → space
  cleaned = cleaned.replace(/\s+/g, " ");     // Multiple spaces → single space
  cleaned = cleaned.trim();

  return cleaned;
};

// Enhanced voice selection with smart fallback for all languages
// NOTE: No longer used - Google TTS handles all languages automatically
// Kept for reference/fallback support in future
function findVoiceForLanguage(langTag, preferFemale = true) {
  // Removed - using Google TTS instead
  return null;
}


// Render inline markdown tokens: clickable links, bold, italic, code, raw URLs
const renderInlineText = (text) => {
  if (!text) return null;

  // Regex matches:
  // 1. Markdown link: [text](url)
  // 2. Inline code: `code`
  // 3. Bold: **text** or __text__
  // 4. Italic: *text* or _text_
  // 5. Strikethrough: ~~text~~
  // 6. Raw URL: (https?://...)
  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|(?:\*([^*]+)\*)|(?:_([^_]+)_)|~~([^~]+)~~|(https?:\/\/[^\s<]+[^<.,:;"')\]\s]))/g;

  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      elements.push(text.slice(lastIndex, matchIndex));
    }

    const [fullMatch, , linkText, linkUrl, codeText, boldText1, boldText2, italicText1, italicText2, strikeText, rawUrl] = match;

    if (linkText && linkUrl) {
      elements.push(
        <a
          key={`link-${matchIndex}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--pragna-gold-soft, #F3C96A)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            fontWeight: 650,
            transition: "all 0.15s ease",
            wordBreak: "break-word",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
          }}
          className="hover:text-[#FFE082] hover:opacity-95"
          onClick={(e) => e.stopPropagation()}
        >
          <span>{linkText}</span>
          <span style={{ fontSize: "11px", opacity: 0.8 }}>↗</span>
        </a>
      );
    } else if (rawUrl) {
      let displayUrl = rawUrl;
      try {
        const u = new URL(rawUrl);
        displayUrl = u.hostname + (u.pathname.length > 25 ? u.pathname.slice(0, 22) + "…" : u.pathname);
      } catch {}
      elements.push(
        <a
          key={`rawurl-${matchIndex}`}
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--pragna-gold-soft, #F3C96A)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            fontWeight: 650,
            transition: "all 0.15s ease",
            wordBreak: "break-word",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
          }}
          className="hover:text-[#FFE082] hover:opacity-95"
          onClick={(e) => e.stopPropagation()}
        >
          <span>{displayUrl}</span>
          <span style={{ fontSize: "11px", opacity: 0.8 }}>↗</span>
        </a>
      );
    } else if (codeText) {
      elements.push(
        <code
          key={matchIndex}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(212, 175, 55, 0.22)",
            borderRadius: "5px",
            padding: "2px 6px",
            fontSize: "13px",
            color: "var(--pragna-gold-soft, #F3C96A)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {codeText}
        </code>
      );
    } else if (boldText1 || boldText2) {
      elements.push(
        <strong key={matchIndex} style={{ color: "var(--pragna-text, #FFFFFF)", fontWeight: 700 }}>
          {boldText1 || boldText2}
        </strong>
      );
    } else if (italicText1 || italicText2) {
      elements.push(
        <em key={matchIndex} style={{ fontStyle: "italic", opacity: 0.9 }}>
          {italicText1 || italicText2}
        </em>
      );
    } else if (strikeText) {
      elements.push(
        <del key={matchIndex} style={{ opacity: 0.7 }}>
          {strikeText}
        </del>
      );
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements.length > 0 ? elements : text;
};

// Render structured markdown content: headings, lists, blockquotes, paragraphs
const renderMarkdownContent = (rawText, isStreaming, isLast) => {
  if (!rawText) return null;

  const lines = rawText.split("\n");
  const nodes = [];
  let inList = false;
  let listType = null; // 'ul' | 'ol'
  let listItems = [];

  const flushList = (key) => {
    if (listItems.length > 0) {
      if (listType === "ol") {
        nodes.push(
          <ol key={`ol-${key}`} style={{ margin: "8px 0 12px 0", paddingLeft: "22px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {listItems.map((item, i) => (
              <li key={i} style={{ lineHeight: "1.65", color: "var(--pragna-text)" }}>
                {renderInlineText(item)}
              </li>
            ))}
          </ol>
        );
      } else {
        nodes.push(
          <ul key={`ul-${key}`} style={{ margin: "8px 0 12px 0", paddingLeft: "20px", listStyleType: "disc", display: "flex", flexDirection: "column", gap: "6px" }}>
            {listItems.map((item, i) => (
              <li key={i} style={{ lineHeight: "1.65", color: "var(--pragna-text)" }}>
                {renderInlineText(item)}
              </li>
            ))}
          </ul>
        );
      }
      listItems = [];
      inList = false;
      listType = null;
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Empty line -> flush list and add spacer if needed
    if (!trimmed) {
      flushList(index);
      return;
    }

    // Horizontal rule
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList(index);
      nodes.push(
        <hr
          key={`hr-${index}`}
          style={{
            border: "none",
            borderTop: "1px solid rgba(212, 175, 55, 0.22)",
            margin: "16px 0",
          }}
        />
      );
      return;
    }

    // Headings
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushList(index);
      nodes.push(
        <h1 key={`h1-${index}`} style={{ fontSize: "20px", fontWeight: 700, color: "var(--pragna-gold-soft, #F3C96A)", margin: "18px 0 8px 0", letterSpacing: "-0.01em" }}>
          {renderInlineText(h1Match[1])}
        </h1>
      );
      return;
    }

    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushList(index);
      nodes.push(
        <h2 key={`h2-${index}`} style={{ fontSize: "17.5px", fontWeight: 700, color: "var(--pragna-gold-soft, #F3C96A)", margin: "16px 0 8px 0", letterSpacing: "-0.01em" }}>
          {renderInlineText(h2Match[1])}
        </h2>
      );
      return;
    }

    const h3Match = trimmed.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushList(index);
      nodes.push(
        <h3 key={`h3-${index}`} style={{ fontSize: "15.5px", fontWeight: 700, color: "var(--pragna-gold-soft, #F3C96A)", margin: "14px 0 6px 0" }}>
          {renderInlineText(h3Match[1])}
        </h3>
      );
      return;
    }

    const h4Match = trimmed.match(/^####\s+(.+)$/);
    if (h4Match) {
      flushList(index);
      nodes.push(
        <h4 key={`h4-${index}`} style={{ fontSize: "14.5px", fontWeight: 600, color: "var(--pragna-text)", margin: "12px 0 4px 0" }}>
          {renderInlineText(h4Match[1])}
        </h4>
      );
      return;
    }

    // Blockquote
    const quoteMatch = trimmed.match(/^>\s*(.+)$/);
    if (quoteMatch) {
      flushList(index);
      nodes.push(
        <blockquote
          key={`quote-${index}`}
          style={{
            borderLeft: "3px solid var(--pragna-gold-soft, #F3C96A)",
            margin: "10px 0",
            padding: "8px 14px",
            background: "rgba(212, 175, 55, 0.05)",
            borderRadius: "0 8px 8px 0",
            color: "var(--pragna-text-muted)",
            fontSize: "14px",
            lineHeight: "1.6",
          }}
        >
          {renderInlineText(quoteMatch[1])}
        </blockquote>
      );
      return;
    }

    // Unordered List (- item, * item, • item)
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        flushList(index);
        inList = true;
        listType = "ul";
      }
      listItems.push(ulMatch[1]);
      return;
    }

    // Ordered List (1. item)
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== "ol") {
        flushList(index);
        inList = true;
        listType = "ol";
      }
      listItems.push(olMatch[1]);
      return;
    }

    // Dedicated link line: "Link: https://..." or "Source: https://..."
    const linkLineMatch = trimmed.match(/^(?:Link|Source|Reference|URL):\s*(https?:\/\/\S+)$/i);
    if (linkLineMatch) {
      flushList(index);
      const url = linkLineMatch[1].replace(/[.,;:]+$/, "");
      nodes.push(
        <div key={`link-${index}`} style={{ margin: "4px 0 10px 0" }}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 11px",
              borderRadius: "7px",
              background: "rgba(212, 175, 55, 0.12)",
              border: "1px solid rgba(212, 175, 55, 0.35)",
              color: "var(--pragna-gold-soft, #F3C96A)",
              fontSize: "12.5px",
              fontWeight: 650,
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            className="hover:bg-[rgba(212,175,55,0.22)] hover:border-[var(--pragna-gold-soft)]"
            onClick={(e) => e.stopPropagation()}
          >
            <span>🔗 Read full article</span>
            <span style={{ fontSize: "10.5px", opacity: 0.75 }}>↗</span>
          </a>
        </div>
      );
      return;
    }

    // Regular paragraph line — detect if it's a standalone bold mini-header (e.g. **Title:** or **Title**)
    flushList(index);
    const boldHeaderMatch = trimmed.match(/^\*\*([^*]+)\*\*:?$/);
    if (boldHeaderMatch && trimmed.length < 80) {
      // Render as a styled bold label / mini-header
      nodes.push(
        <p key={`p-${index}`} style={{ margin: "14px 0 4px 0", lineHeight: "1.5", color: "var(--pragna-gold-soft, #F3C96A)", fontWeight: 700, fontSize: "14px" }}>
          {renderInlineText(trimmed)}
        </p>
      );
    } else {
      nodes.push(
        <p key={`p-${index}`} style={{ margin: "0 0 10px 0", lineHeight: "1.65", color: "var(--pragna-text)" }}>
          {renderInlineText(trimmed)}
        </p>
      );
    }
  });

  flushList("end");

  return (
    <div style={{ wordBreak: "break-word" }}>
      {nodes}
      {isStreaming && isLast && (
        <span
          aria-hidden="true"
          className="inline-block w-[6px] h-[16px] ml-1 rounded-xs bg-gradient-to-t from-[var(--pragna-gold)] to-[var(--pragna-gold-soft)] animate-pulse align-middle shadow-[0_0_10px_rgba(212,175,55,0.85)]"
          style={{ verticalAlign: "-2px", opacity: 0.95 }}
        />
      )}
    </div>
  );
};

// Parse artifacts (<antArtifact> or <artifact> tags), canvas, and code blocks from message text
const parseMessageContent = (text) => {
  if (!text) return [{ type: "text", content: "" }];

  const blockRegex = /<(?:antArtifact|artifact)\s+([^>]*?)>([\s\S]*?)<\/(?:antArtifact|artifact)>|```([\w:-]+)?\n([\s\S]*?)```/gi;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(text)) !== null) {
    const index = match.index;
    if (index > lastIndex) {
      parts.push({
        type: "text",
        content: text.slice(lastIndex, index),
      });
    }

    const [fullMatch, artifactAttrs, artifactContent, codeLang, codeContent] = match;

    if (artifactAttrs !== undefined && artifactContent !== undefined) {
      const titleMatch = artifactAttrs.match(/title=["']([^"']+)["']/i);
      const typeMatch = artifactAttrs.match(/type=["']([^"']+)["']/i);
      const langMatch = artifactAttrs.match(/language=["']([^"']+)["']/i) || artifactAttrs.match(/identifier=["']([^"']+)["']/i);

      const title = titleMatch ? titleMatch[1] : "Interactive Artifact";
      const language = langMatch ? langMatch[1] : (typeMatch ? typeMatch[1] : "html");
      const type = typeMatch ? typeMatch[1] : language;

      parts.push({
        type: "artifact",
        artifact: {
          title,
          type,
          language,
          content: artifactContent.trim(),
        },
      });
    } else {
      const language = codeLang;
      const code = codeContent;
      const lang = (language || "").toLowerCase().trim();
      const isCanvasLang =
        lang === "canvas" ||
        lang === "pragna-canvas" ||
        lang === "json:canvas" ||
        lang === "artifact:canvas";

      let parsedCanvas = null;
      if (isCanvasLang) {
        try {
          parsedCanvas = JSON.parse(code.trim());
        } catch {
          parsedCanvas = null;
        }
      } else if (lang === "json" || !lang) {
        try {
          const obj = JSON.parse(code.trim());
          if (
            obj &&
            obj.type &&
            [
              "table",
              "tree",
              "flowchart",
              "mindmap",
              "timeline",
              "chart",
              "graph",
              "kanban",
              "er_diagram",
              "er",
              "system_architecture",
              "architecture",
              "roadmap",
            ].includes(obj.type.toLowerCase())
          ) {
            parsedCanvas = obj;
          }
        } catch {}
      }

      if (parsedCanvas) {
        parts.push({
          type: "canvas",
          content: parsedCanvas,
        });
      } else {
        parts.push({
          type: "code",
          language: language || "plaintext",
          content: code.trim(),
        });
      }
    }

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ type: "text", content: text }];
};

// Render parsed message content as a stack of blocks: text segments become
// individual "glass card" bubbles, canvas segments render as PragnaCanvas, code segments as CodeBlocks
const renderContentBlocks = (text, isStreaming, onSendPrompt, openArtifact) => {
  const parts = parseMessageContent(text);
  return parts.map((part, idx) => {
    if (part.type === "artifact") {
      return (
        <div
          key={idx}
          onClick={() => openArtifact?.(part.artifact)}
          style={{
            margin: "12px 0",
            padding: "13px 18px",
            borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(212,175,55,0.16), rgba(18,17,22,0.95))",
            border: "1px solid rgba(212,175,55,0.35)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            cursor: "pointer",
            transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          className="hover:scale-[1.01] hover:border-[var(--pragna-gold-soft)] hover:shadow-premium-md group"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(212,175,55,0.22)",
                border: "1px solid rgba(212,175,55,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--pragna-gold-soft)",
                flexShrink: 0,
              }}
            >
              <CodeIcon />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--pragna-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {part.artifact.title || "Interactive Artifact"}
                </span>
                <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "2px 6px", borderRadius: "5px", background: "rgba(212,175,55,0.18)", color: "var(--pragna-gold-soft)", textTransform: "uppercase" }}>
                  {part.artifact.language || part.artifact.type || "HTML"}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--pragna-text-muted)", marginTop: "2px" }}>
                Click to open live preview & code in side panel
              </div>
            </div>
          </div>
          <button
            type="button"
            style={{
              padding: "7px 13px",
              borderRadius: "8px",
              border: "1px solid rgba(212,175,55,0.4)",
              background: "linear-gradient(135deg, rgba(212,175,55,0.25), rgba(212,175,55,0.1))",
              color: "var(--pragna-gold-soft)",
              fontSize: "12px",
              fontWeight: 650,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
            className="group-hover:bg-[var(--pragna-gold-soft)] group-hover:text-[var(--pragna-on-gold)]"
          >
            <EyeIcon />
            <span>View Artifact</span>
          </button>
        </div>
      );
    }
    if (part.type === "canvas") {
      return <PragnaCanvas key={idx} canvasData={part.content} onSendPrompt={onSendPrompt} />;
    }
    if (part.type === "code") {
      return <CodeBlock key={idx} code={part.content} language={part.language} />;
    }
    const isLast = idx === parts.length - 1;
    return (
      <div
        key={idx}
        className="glass-card rounded-[4px_18px_18px_18px] px-5 py-4 text-[15px] leading-[1.65]"
        style={{ color: "var(--pragna-text)" }}
      >
        {renderMarkdownContent(part.content, isStreaming, isLast)}
      </div>
    );
  });
};

// Shared ghost-icon-button styling for the message action row (copy/like/dislike/speak)
const actionBtnBase =
  "w-[28px] h-[28px] rounded-lg bg-transparent flex items-center justify-center transition-all duration-150 [&>svg]:w-[15px] [&>svg]:h-[15px] hover:bg-[rgba(212,175,55,0.12)] hover:text-[var(--pragna-gold-soft)] active:scale-90 cursor-pointer";

const renderAttachments = (attachments, openArtifact) => (
  <div className="flex flex-wrap gap-2 mb-1.5">
    {attachments.map((att, i) => {
      if (att.type === "image" && att.previewUrl) {
        return (
          <img
            key={i}
            src={att.previewUrl}
            alt={att.name}
            className="msg-attachment-img cursor-pointer"
            onClick={() => window.open(att.previewUrl, "_blank")}
          />
        );
      } else if (att.type === "video") {
        return (
          <div key={i} className="msg-attachment-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="5" width="15" height="14" rx="2"/>
              <path d="M17 9l5-3v12l-5-3V9z"/>
            </svg>
            <span>{att.name}</span>
          </div>
        );
      } else if (att.type === "document") {
        return (
          <div
            key={i}
            onClick={() => {
              openArtifact?.({
                id: `doc-${i}-${Date.now()}`,
                title: att.title || att.name,
                type: att.format === 'pdf' ? 'pdf' : 'document',
                format: att.format || 'pdf',
                downloadUrl: att.downloadUrl,
                content: att.content || `# ${att.title || att.name}\n\nDocument ready for preview and download.\n- Format: ${(att.format || 'pdf').toUpperCase()}\n- File: ${att.name}`,
              });
            }}
            className="msg-attachment-file group cursor-pointer hover:border-[var(--pragna-gold-soft)] hover:shadow-md transition-all flex items-center gap-2"
            title="Click to open preview in split-screen side panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="9" y1="13" x2="15" y2="13"/>
              <line x1="9" y1="17" x2="13" y2="17"/>
            </svg>
            <span className="group-hover:text-[var(--pragna-gold-soft)] transition-colors">{att.name}</span>
            <span style={{ fontSize: "10px", opacity: 0.7, marginLeft: "2px" }} className="px-1.5 py-0.5 rounded bg-[rgba(212,175,55,0.15)] text-[var(--pragna-gold-soft)] font-bold">
              {(att.format || "doc").toUpperCase()}
            </span>
            {att.downloadUrl && (
              <a
                href={att.downloadUrl}
                download={att.name}
                onClick={(e) => e.stopPropagation()}
                title="Download directly"
                className="ml-1 p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--pragna-text-muted)] hover:text-white transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </a>
            )}
          </div>
        );
      } else {
        return (
          <div key={i} className="msg-attachment-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="9" y1="13" x2="15" y2="13"/>
              <line x1="9" y1="17" x2="13" y2="17"/>
            </svg>
            <span>{att.name}</span>
          </div>
        );
      }
    })}
  </div>
);

// Extract thinking process from raw message or direct thinking field
const extractThinkingContent = (text, directThinking) => {
  if (directThinking) {
    const clean = (text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
    return { thinking: directThinking.trim(), cleanText: clean || text || "" };
  }
  if (!text) return { thinking: null, cleanText: "" };

  const thinkMatch = text.match(/<think>([\s\S]*?)(?:<\/think>|$)/i) || text.match(/<thought>([\s\S]*?)(?:<\/thought>|$)/i);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
    return { thinking: thinking || null, cleanText };
  }
  return { thinking: null, cleanText: text };
};

const ThinkingAccordion = ({ thinking, isStreaming }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!thinking) return null;

  return (
    <div
      style={{
        borderRadius: "12px",
        background: "rgba(212, 175, 55, 0.05)",
        border: "1px solid rgba(212, 175, 55, 0.2)",
        overflow: "hidden",
        marginBottom: "8px",
        transition: "all 0.2s ease",
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          width: "100%",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--pragna-gold-soft)",
          fontSize: "12.5px",
          fontWeight: 600,
          textAlign: "left",
          gap: "8px",
        }}
        className="hover:bg-[rgba(212,175,55,0.08)]"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <ThinkIcon size={14} />
          <span>Thinking Process {isStreaming && !isOpen ? "(Reasoning...)" : ""}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--pragna-text-muted)", fontSize: "11px" }}>
          <span>{isOpen ? "Hide" : "Show"}</span>
          <ChevronDownIcon
            size={12}
            style={{
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s ease",
            }}
          />
        </div>
      </button>

      {isOpen && (
        <div
          style={{
            padding: "10px 14px 12px 14px",
            borderTop: "1px solid rgba(212, 175, 55, 0.12)",
            background: "rgba(0, 0, 0, 0.22)",
            color: "var(--pragna-text-muted)",
            fontSize: "13px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--pragna-chat-font)",
            maxHeight: "280px",
            overflowY: "auto",
          }}
        >
          {thinking}
        </div>
      )}
    </div>
  );
};

export default function MessageBubble({ message, language = "en", onRetry, onEdit, isLoading, onToggleBookmark, onSendPrompt }) {
  const {
    openArtifact,
    setMessageFeedback,
  } = useContext(ChatContext) || {};

  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(message.text || "");
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [modalImage, setModalImage] = useState(null);

  const { thinking: extractedThinking, cleanText: effectiveText } = extractThinkingContent(message.text, message.thinking);

  const copyToClipboard = () => {
    const textToCopy = effectiveText || message.text;
    if (!textToCopy) return;
    navigator.clipboard?.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleThumbsUp = () => {
    const next = !liked;
    setLiked(next);
    if (disliked) setDisliked(false);
    if (message.id) {
      setMessageFeedback?.(message.id, next ? "up" : null);
    }
  };

  const handleThumbsDown = () => {
    const next = !disliked;
    setDisliked(next);
    if (liked) setLiked(false);
    if (message.id) {
      setMessageFeedback?.(message.id, next ? "down" : null);
    }
  };

  const speakIntervalRef = useRef(null);
  const audioRef = useRef(null);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speakIntervalRef.current) {
      clearInterval(speakIntervalRef.current);
      speakIntervalRef.current = null;
    }
    setSpeaking(false);
  };

  const speakWithBrowserSynthesis = (text, targetLang) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const bcpTag = LANG_TAG[targetLang] || `${targetLang}-IN` || "en-US";
    utterance.lang = bcpTag;
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(v =>
      (v.lang === bcpTag || v.lang.startsWith(targetLang)) &&
      (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("online"))
    ) || voices.find(v => v.lang === bcpTag || v.lang.startsWith(targetLang)) || voices.find(v => v.lang.includes("en-IN"));

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const speakText = () => {
    // First click speaks, second click stops
    if (speaking) {
      stopSpeaking();
      return;
    }

    const rawText = (effectiveText || message.text || "").trim();
    const textToSpeak = cleanTextForSpeech(rawText);
    if (!textToSpeak) {
      console.warn("No text to speak");
      return;
    }

    try {
      setSpeaking(true);
      const targetLang = language || "en";

      fetch(`${API_BASE}/api/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textToSpeak,
          language: targetLang,
        })
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.blob();
        })
        .then(audioBlob => {
          if (!audioBlob || audioBlob.size === 0) {
            throw new Error("Empty audio blob");
          }
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audioRef.current = audio;

          audio.onplay = () => setSpeaking(true);
          audio.onended = () => {
            setSpeaking(false);
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            speakWithBrowserSynthesis(textToSpeak, targetLang);
          };

          audio.play().catch(() => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            speakWithBrowserSynthesis(textToSpeak, targetLang);
          });
        })
        .catch(() => {
          speakWithBrowserSynthesis(textToSpeak, targetLang);
        });

    } catch (err) {
      console.error("Error in speakText:", err);
      speakWithBrowserSynthesis(textToSpeak, language || "en");
    }
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const isBot = message.sender === "bot";
  const isError = isBot && !!message.error;
  const isStreaming = message.isStreaming;
  const hasText = (message.text || "").trim().length > 0;
  const showTypingDots = isBot && isStreaming && !hasText && !isError;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const bookmarked = !!message.bookmarked;

  // ── User message: gold-gradient bubble ─────────────────────────────────
  if (!isBot) {
    const handleEditSave = (shouldResubmit = true) => {
      const trimmed = draftText.trim();
      if (!trimmed) return;
      setIsEditing(false);
      onEdit?.(trimmed, shouldResubmit);
    };

    const handleEditCancel = () => {
      setDraftText(message.text || "");
      setIsEditing(false);
    };

    return (
      <div className="flex flex-col items-end gap-1.5 group animate-[fadeUp_0.3s_ease]" style={{ fontFamily: "var(--pragna-chat-font)" }}>
        {isEditing ? (
          <div
            className="max-w-[94%] sm:max-w-[82%] w-full flex flex-col gap-2.5 p-3 sm:p-4 rounded-[18px] border border-[rgba(212,175,55,0.4)] shadow-[0_8px_24px_rgba(0,0,0,0.55),0_0_18px_rgba(212,175,55,0.12)] backdrop-blur-md"
            style={{
              background: "rgba(18, 16, 12, 0.95)",
            }}
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11.5px] font-bold tracking-wider uppercase text-[var(--pragna-gold-soft)] flex items-center gap-1.5">
                <PencilIcon size={13} />
                Edit Sent Message
              </span>
              <span className="text-[11px] text-[var(--pragna-text-muted)] opacity-70">
                Esc to cancel
              </span>
            </div>

            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleEditSave(true);
                } else if (e.key === "Escape") {
                  handleEditCancel();
                }
              }}
              rows={Math.min(8, Math.max(3, draftText.split("\n").length))}
              placeholder="Edit your message..."
              className="w-full rounded-[12px] px-3.5 py-2.5 text-[15px] sm:text-[14.5px] leading-[1.5] resize-none outline-none focus:border-[var(--pragna-gold-soft)] transition-colors custom-scrollbar"
              style={{
                background: "var(--pragna-surface)",
                border: "1px solid rgba(212,175,55,0.28)",
                color: "var(--pragna-text)",
                fontSize: "15px",
                fontFamily: "inherit",
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[var(--pragna-text-muted)] opacity-60 hidden sm:inline">
                Enter sends fresh response • Shift+Enter new line
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: "var(--pragna-text-muted)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleEditSave(false)}
                  title="Update message text only without regenerating"
                  className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold border border-[rgba(212,175,55,0.35)] transition-colors hover:bg-[rgba(212,175,55,0.1)] text-[var(--pragna-gold-soft)]"
                >
                  Save only
                </button>
                <button
                  type="button"
                  onClick={() => handleEditSave(true)}
                  title="Save and submit to regenerate fresh response"
                  className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg, var(--pragna-gold-soft), var(--pragna-gold))",
                    color: "var(--pragna-on-gold)",
                  }}
                >
                  Save & Submit
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              className="max-w-[90%] sm:max-w-[78%] rounded-[18px_18px_4px_18px] px-3.5 py-2.5 sm:px-[18px] sm:py-3 text-[14.5px] sm:text-[15px] leading-[1.5] shadow-premium-md whitespace-pre-wrap break-words"
              style={{
                background: "linear-gradient(135deg, var(--pragna-gold-soft), var(--pragna-gold))",
                color: "var(--pragna-on-gold)",
                fontWeight: 550,
              }}
            >
              {hasAttachments && renderAttachments(message.attachments, openArtifact)}
              {message.text}
            </div>
            <div className="flex items-center gap-1.5 opacity-90 sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
              {message.edited && (
                <span className="text-[11px] text-[var(--pragna-text-muted)] opacity-60 mr-1 select-none">
                  (edited)
                </span>
              )}
              {onToggleBookmark && (
                <button
                  type="button"
                  onClick={onToggleBookmark}
                  title={bookmarked ? "Remove bookmark" : "Bookmark message"}
                  className={`${actionBtnBase} ${bookmarked ? "opacity-100 text-accent-400" : "text-[color:var(--pragna-text-muted)]"}`}
                >
                  <StarIcon filled={bookmarked} />
                </button>
              )}
              {onEdit && !isLoading && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftText(message.text || "");
                    setIsEditing(true);
                  }}
                  title="Edit message"
                  aria-label="Edit message"
                  className={`${actionBtnBase} text-[color:var(--pragna-text-muted)] hover:text-[var(--pragna-gold-soft)] hover:bg-[rgba(212,175,55,0.12)]`}
                >
                  <PencilIcon size={14} />
                </button>
              )}
              {onRetry && !isLoading && (
                <button
                  type="button"
                  onClick={onRetry}
                  title="Retry prompt (branches conversation)"
                  aria-label="Retry prompt"
                  className={`${actionBtnBase} text-[color:var(--pragna-text-muted)] hover:text-[var(--pragna-gold-soft)] hover:bg-[rgba(212,175,55,0.12)]`}
                >
                  <RetryIcon size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={copyToClipboard}
                title={copied ? "Copied!" : "Copy request"}
                className={`${actionBtnBase} ${copied ? "opacity-100 text-accent-400" : "text-[color:var(--pragna-text-muted)] hover:text-[var(--pragna-gold-soft)] hover:bg-[rgba(212,175,55,0.12)]"}`}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Assistant / error message ───────────────────────────────────────────
  return (
    <div className="flex flex-col items-start animate-[fadeUp_0.3s_ease]" style={{ fontFamily: "var(--pragna-chat-font)" }}>
      <div className="flex gap-2.5 sm:gap-3.5 max-w-full sm:max-w-[92%] min-w-0 w-full">
        {isError ? (
          <div
            className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 mt-0.5 rounded-[9px] flex items-center justify-center"
            style={{ background: "rgba(180,60,60,0.15)", border: "1px solid rgba(220,110,100,0.35)" }}
          >
            <ErrorIcon />
          </div>
        ) : (
          <img src={pragnaShield} alt="Pragna" className="w-7 h-7 sm:w-9 sm:h-9 shrink-0 mt-0.5 object-contain" />
        )}

        <div className="flex flex-col gap-2.5 min-w-0 flex-1">
          {hasAttachments && renderAttachments(message.attachments, openArtifact)}

          {showTypingDots ? (
            <div className="glass-card w-fit flex items-center gap-[5px] rounded-[4px_18px_18px_18px] px-[18px] py-3.5">
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: "var(--pragna-gold)", animation: "dotBlink 1.2s infinite" }} />
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: "var(--pragna-gold)", animation: "dotBlink 1.2s infinite 0.2s" }} />
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: "var(--pragna-gold)", animation: "dotBlink 1.2s infinite 0.4s" }} />
            </div>
          ) : isError ? (
            <div
              className="min-w-0 rounded-[4px_18px_18px_18px] px-5 py-4 shadow-premium-sm"
              style={{ background: "#2a1a18", border: "1px solid rgba(220,110,100,0.28)" }}
            >
              <div className="text-[14px] font-bold tracking-[0.3px] mb-1.5" style={{ color: "#e8a598" }}>
                Something went wrong
              </div>
              <div className="text-[13.5px] leading-[1.6] whitespace-pre-wrap" style={{ color: "#cfa9a0" }}>
                {message.text}
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  title="Retry"
                  className="mt-3 flex items-center gap-[7px] rounded-lg px-4 py-[7px] text-[13px] font-semibold transition-colors duration-150 [&>svg]:w-[13px] [&>svg]:h-[13px]"
                  style={{
                    border: "1px solid rgba(220,110,100,0.35)",
                    background: "rgba(220,110,100,0.10)",
                    color: "#e8a598",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(220,110,100,0.18)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(220,110,100,0.10)"; }}
                >
                  <RetryIcon />
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              {extractedThinking && (
                <ThinkingAccordion thinking={extractedThinking} isStreaming={isStreaming} />
              )}
              {renderContentBlocks(effectiveText, isStreaming, onSendPrompt, openArtifact)}
              {message.canvas && (
                <PragnaCanvas canvasData={message.canvas} onSendPrompt={onSendPrompt} />
              )}
              {message.artifact && (
                <div
                  onClick={() => openArtifact?.(message.artifact)}
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    borderRadius: "12px",
                    background: "linear-gradient(135deg, rgba(212,175,55,0.18), rgba(212,175,55,0.06))",
                    border: "1px solid rgba(212,175,55,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
                    transition: "all 0.15s ease",
                  }}
                  className="hover:scale-[1.01] hover:border-[var(--pragna-gold-soft)]"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "rgba(212,175,55,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--pragna-gold-soft)",
                        flexShrink: 0,
                      }}
                    >
                      <CodeIcon />
                    </div>
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--pragna-text)" }}>
                        {message.artifact.title || "HTML Web Artifact"}
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--pragna-text-muted)" }}>
                        Click to open live preview & code
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      padding: "5px 11px",
                      borderRadius: "7px",
                      border: "none",
                      background: "var(--pragna-gold-soft)",
                      color: "var(--pragna-on-gold)",
                      fontSize: "12px",
                      fontWeight: 650,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    View Artifact
                  </button>
                </div>
              )}
            </>
          )}


          {isBot && !isStreaming && !isError && message.sources?.length > 0 && (
            <div className="text-[13px]">
              <button
                type="button"
                onClick={() => setSourcesExpanded((prev) => !prev)}
                className="text-[color:var(--pragna-text-muted)] hover:text-accent-400 transition-colors duration-150"
              >
                {sourcesExpanded ? "▾" : "▸"} Sources ({message.sources.length})
              </button>
              {sourcesExpanded && (
                <ul className="mt-1.5 flex flex-col gap-1 pl-4 list-disc">
                  {message.sources.map((src, idx) => {
                    const href = src.link && /^https?:\/\//.test(src.link) ? src.link : null;
                    const label = src.title || href || "Untitled source";
                    return (
                      <li key={idx} className="text-[color:var(--pragna-text-muted)]">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-400 hover:underline">
                            {label}
                          </a>
                        ) : (
                          <span>{label}</span>
                        )}
                        {src.source && !/^https?:\/\//.test(src.source) && (
                          <span className="ml-1.5 text-[11px] opacity-70">({src.source})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Mimir Live Tool Execution Cards & Browser Preview */}
          {message.tool_calls && message.tool_calls.length > 0 && (
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setToolsExpanded((prev) => !prev)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "var(--pragna-text-muted)",
                  cursor: "pointer",
                  width: "fit-content",
                }}
              >
                <span>{toolsExpanded ? "▾" : "▸"}</span>
                <span>Tools ({message.tool_calls.length})</span>
              </button>

              {toolsExpanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {message.tool_calls.map((tc, tcIdx) => {
                    const isPending = tc.status === "pending" || tc.type === "confirm_required";
                    const hasImg = tc.result?.image_base64 || tc.image_base64;
                    return (
                      <div
                        key={tc.id || tcIdx}
                        style={{
                          background: "var(--pragna-surface-elevated, #18181B)",
                          border: isPending ? "1px solid rgba(251,191,36,0.5)" : "1px solid var(--pragna-border)",
                          borderRadius: "10px",
                          padding: "10px 12px",
                          fontSize: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontWeight: 700, color: "var(--pragna-gold-soft)", fontFamily: "monospace" }}>
                            ⚙ {tc.tool_name || tc.tool || "tool"}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              textTransform: "uppercase",
                              background: isPending ? "rgba(251,191,36,0.2)" : "rgba(52,211,153,0.15)",
                              color: isPending ? "#fbbf24" : "#34d399",
                              fontWeight: 700,
                            }}
                          >
                            {tc.status || (isPending ? "approval required" : "completed")}
                          </span>
                        </div>

                        {/* Pending Tool Action Approval Gate */}
                        {isPending && (
                          <div style={{ marginTop: "8px", padding: "8px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
                            <p style={{ fontSize: "11.5px", color: "#fbbf24", marginBottom: "6px", fontWeight: 600 }}>
                              ⚠️ This tool requires confirmation before executing:
                            </p>
                            <pre style={{ fontSize: "11px", color: "var(--pragna-text-muted)", background: "rgba(0,0,0,0.3)", padding: "6px", borderRadius: "6px", overflowX: "auto" }}>
                              {JSON.stringify(tc.arguments || tc.args || {}, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Browser or Generated Image preview */}
                        {hasImg && (
                          <div style={{ marginTop: "8px" }}>
                            <img
                              src={`data:image/png;base64,${hasImg}`}
                              alt="Live Viewport Preview"
                              style={{ width: "100%", maxHeight: "200px", objectFit: "cover", borderRadius: "8px", cursor: "pointer", border: "1px solid var(--pragna-border)" }}
                              onClick={() => setModalImage(hasImg)}
                            />
                            <span style={{ fontSize: "10px", color: "var(--pragna-text-muted)", marginTop: "2px", display: "block" }}>
                              Click to view full viewport
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {isBot && !isStreaming && !isError && (
            <div className="flex gap-1 flex-wrap">
              <button
                type="button"
                onClick={copyToClipboard}
                title="Copy"
                className={`${actionBtnBase} text-[color:var(--pragna-text-muted)]`}
              >
                <CopyIcon />
              </button>
              {onToggleBookmark && (
                <button
                  type="button"
                  onClick={onToggleBookmark}
                  title={bookmarked ? "Remove bookmark" : "Bookmark message"}
                  className={`${actionBtnBase} ${bookmarked ? "text-accent-400" : "text-[color:var(--pragna-text-muted)]"}`}
                >
                  <StarIcon filled={bookmarked} />
                </button>
              )}
              <button
                type="button"
                onClick={handleThumbsUp}
                title="Good response"
                className={`${actionBtnBase} ${liked ? "text-accent-400" : "text-[color:var(--pragna-text-muted)]"}`}
              >
                <ThumbsUpIcon filled={liked} />
              </button>
              <button
                type="button"
                onClick={handleThumbsDown}
                title="Bad response"
                className={`${actionBtnBase} ${disliked ? "text-accent-400" : "text-[color:var(--pragna-text-muted)]"}`}
              >
                <ThumbsDownIcon filled={disliked} />
              </button>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  title="Regenerate"
                  className={`${actionBtnBase} text-[color:var(--pragna-text-muted)]`}
                >
                  <RetryIcon />
                </button>
              )}
              <button
                type="button"
                onClick={speakText}
                title={speaking ? "Stop speaking" : "Read aloud"}
                className={`${actionBtnBase} ${speaking ? "text-accent-400 bg-accent-500/15 ring-1 ring-accent-400/40 animate-pulse" : "text-[color:var(--pragna-text-muted)]"}`}
              >
                <VoiceIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
