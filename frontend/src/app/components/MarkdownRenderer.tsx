'use client';

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, PanelRight, Maximize2, ExternalLink, Download, X, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import MermaidDiagram from './MermaidDiagram';

interface MarkdownRendererProps {
  content: string;
  onOpenArtifact?: (title: string, content: string, language?: string) => void;
}

export default function MarkdownRenderer({ content, onOpenArtifact }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Paragraphs
        p: ({ children }) => (
          <div className="mb-3 last:mb-0 text-[0.9375rem] leading-[1.75]">{children}</div>
        ),

        // Headings
        h1: ({ children }) => (
          <h1 className="text-2xl font-bold mt-6 mb-3 text-foreground">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xl font-semibold mt-5 mb-2 text-foreground">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h3>
        ),

        // Lists
        ul: ({ children }) => (
          <ul className="list-disc pl-6 mb-3 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-6 mb-3 space-y-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-[0.9375rem] leading-[1.75]">{children}</li>
        ),

        // Strong / em
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-foreground/90">{children}</em>
        ),

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-[3px] border-border pl-4 my-3 text-muted-foreground italic">
            {children}
          </blockquote>
        ),

        // Horizontal rule
        hr: () => <hr className="border-border my-4" />,

        // Links & Document Downloads
        a: ({ href, children }) => {
          const text = extractText(children);
          const raw = href || text || '';
          const isDoc = /\.(docx|pdf|xlsx|csv|pptx)$/i.test(raw.trim());
          let targetUrl = href || '#';
          if (isDoc) {
            const cleanName = raw.trim().split('/').pop() || raw.trim();
            targetUrl = `/api/documents/download/${encodeURIComponent(cleanName)}`;
          }
          return (
            <a
              href={targetUrl}
              download={isDoc ? true : undefined}
              target={isDoc ? '_self' : '_blank'}
              rel="noopener noreferrer"
              className={
                isDoc
                  ? "inline-flex items-center gap-1.5 px-3 py-1 my-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-xs border border-primary/30 transition-all active:scale-95 no-underline font-mono"
                  : "text-primary underline underline-offset-[3px] hover:text-primary/80 transition-colors duration-150"
              }
            >
              {children}
            </a>
          );
        },

        // Images & Media with Open, Copy, Download & Lightbox
        img: ({ src, alt }) => <ImageBlock src={src} alt={alt} />,

        // Inline code
        code: ({ children, className }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return <code className={`${className} bg-transparent`}>{children}</code>;
          }
          return (
            <code className="bg-transparent text-primary px-0.5 py-0 text-[0.875em] font-mono font-medium">
              {children}
            </code>
          );
        },

        // Code blocks (pre)
        pre: ({ children }) => {
          return <CodeBlock onOpenArtifact={onOpenArtifact}>{children}</CodeBlock>;
        },

        // Tables
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-border/40 bg-transparent">
            <table className="w-full text-sm bg-transparent">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-transparent border-b border-border/40">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3.5 py-2 text-left font-semibold text-foreground border-b border-border/40 text-sm bg-transparent">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3.5 py-2 text-foreground/90 border-b border-border/20 text-sm bg-transparent">
            {children}
          </td>
        ),
        tr: ({ children }) => (
          <tr className="bg-transparent hover:bg-white/[0.02] transition-colors duration-100">{children}</tr>
        ),
      }}
    >
      {stripEmojis(content)}
    </ReactMarkdown>
  );
}

function stripEmojis(text: string): string {
  if (!text) return '';
  return text.replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '');
}

function CodeBlock({
  children,
  onOpenArtifact,
}: {
  children: React.ReactNode;
  onOpenArtifact?: (title: string, content: string, language?: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Extract language and code text from children
  let language = '';
  let codeText = '';

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = child.props as { className?: string; children?: React.ReactNode };
      const className = props.className ?? '';
      const match = className.match(/language-(\w+)/);
      if (match) language = match[1];
      codeText = extractText(props.children);
    }
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border/40 bg-transparent">
      {/* Code block header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-transparent border-b border-border/20">
        <span className="text-xs font-medium text-muted-foreground/70 font-mono uppercase tracking-wider">
          {language || 'text'}
        </span>
        <div className="flex items-center gap-1.5">
          {onOpenArtifact && (
            <button
              onClick={() => onOpenArtifact(language ? `${language.toUpperCase()} Artifact` : 'Code Artifact', codeText, language)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-primary transition-colors duration-150 px-2 py-1 rounded hover:bg-white/5"
              aria-label="Open in Artifact panel"
            >
              <PanelRight size={12} />
              <span>Artifact</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150 px-2 py-1 rounded hover:bg-white/5"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check size={12} className="text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code content */}
      {language?.toLowerCase() === 'mermaid' || /^\s*(sequenceDiagram|flowchart|graph|classDiagram|stateDiagram|erDiagram|mindmap|gantt|gitGraph)/.test(codeText) ? (
        <MermaidDiagram code={codeText} className="border-0 rounded-none bg-transparent" />
      ) : (
        <div className="overflow-x-auto bg-transparent">
          <pre className="p-3.5 text-sm leading-relaxed bg-transparent">
            <code className="font-mono text-[0.8125rem] text-foreground/90 whitespace-pre bg-transparent">
              {codeText}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractText(props.children);
  }
  return '';
}

function ImageBlock({ src, alt }: { src?: string; alt?: string }) {
  const [copied, setCopied] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const rawSrc = src || '';
  const proxiedSrc = rawSrc.startsWith('http://') || rawSrc.startsWith('https://')
    ? `/api/image-proxy?url=${encodeURIComponent(rawSrc)}`
    : rawSrc;

  const currentSrc = imgError && rawSrc ? rawSrc : proxiedSrc;

  // Handle ESC key to close lightbox and lock body scroll when open
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isLightboxOpen]);

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const success = await copyImageToClipboard(currentSrc);
    if (success) {
      setCopied(true);
      toast.success('Image copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Could not copy image');
    }
  };

  const handleDownload = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    downloadImageFile(currentSrc, alt);
    toast.success('Downloading image...');
  };

  const handleOpenLightbox = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsLightboxOpen(true);
  };

  const handleOpenNewTab = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const fullUrl = typeof window !== 'undefined' && currentSrc.startsWith('/')
      ? `${window.location.origin}${currentSrc}`
      : currentSrc;
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className="my-3.5 rounded-xl overflow-hidden border border-border/50 bg-card/60 shadow-md group/img transition-all hover:border-border">
        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-muted/30 border-b border-border/30 text-xs select-none">
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            <ImageIcon size={13} className="text-primary/70 shrink-0" />
            <span className="font-medium text-muted-foreground/80 truncate font-mono text-[11px]">
              {alt ? alt.slice(0, 36) + (alt.length > 36 ? '…' : '') : 'Generated Image'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Open / Lightbox */}
            <button
              onClick={handleOpenLightbox}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground/70 hover:text-foreground hover:bg-white/5 active:scale-95 transition-all"
              title="Open full view"
              type="button"
            >
              <Maximize2 size={12} />
              <span>Open</span>
            </button>

            {/* Copy Image */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground/70 hover:text-foreground hover:bg-white/5 active:scale-95 transition-all"
              title="Copy image to clipboard"
              type="button"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-white/5 active:scale-95 transition-all"
              title="Download image"
              type="button"
            >
              <Download size={12} />
            </button>

            {/* Open in new tab */}
            <button
              onClick={handleOpenNewTab}
              className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-white/5 active:scale-95 transition-all"
              title="Open in new tab"
              type="button"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        </div>

        {/* Image Container with click to open lightbox */}
        <div
          onClick={handleOpenLightbox}
          className="relative cursor-zoom-in bg-black/20 overflow-hidden flex items-center justify-center group/preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt={alt || 'Generated image'}
            className="w-full max-h-[520px] object-contain rounded-b-none transition-transform duration-200 group-hover/preview:scale-[1.008]"
            loading="eager"
            onError={() => {
              if (!imgError && rawSrc && currentSrc.includes('/api/image-proxy')) {
                setImgError(true);
              }
            }}
          />

          {/* Click to expand hover badge */}
          <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover/preview:opacity-100 transition-opacity bg-black/75 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow pointer-events-none">
            <Maximize2 size={11} />
            <span>Click to enlarge</span>
          </div>
        </div>

        {/* Prompt Caption footer */}
        {alt && (
          <div className="px-3.5 py-2 border-t border-border/30 bg-muted/20 text-xs text-muted-foreground leading-relaxed font-mono">
            {alt}
          </div>
        )}
      </div>

      {/* Fullscreen Lightbox Modal */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-150"
          onClick={() => setIsLightboxOpen(false)}
        >
          {/* Lightbox Header Bar */}
          <div
            className="w-full max-w-5xl mx-auto flex items-center justify-between gap-4 bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon size={16} className="text-primary shrink-0" />
              <span className="text-sm font-medium text-zinc-200 truncate font-mono">
                {alt || 'Generated Image Preview'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all active:scale-95"
                title="Copy image to clipboard"
                type="button"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy Image</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all active:scale-95"
                title="Download image file"
                type="button"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download</span>
              </button>

              <button
                onClick={handleOpenNewTab}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all active:scale-95"
                title="Open in new tab"
                type="button"
              >
                <ExternalLink size={15} />
              </button>

              <button
                onClick={() => setIsLightboxOpen(false)}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 text-zinc-400 transition-all active:scale-95 ml-1"
                title="Close (Esc)"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Lightbox Center Image */}
          <div
            className="flex-1 flex items-center justify-center p-2 sm:p-6 overflow-hidden max-w-6xl mx-auto w-full my-auto"
            onClick={() => setIsLightboxOpen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentSrc}
              alt={alt || 'Full preview'}
              className="max-h-[75vh] max-w-[90vw] object-contain rounded-xl shadow-2xl border border-zinc-800/80 cursor-default"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Lightbox Footer with prompt */}
          {alt ? (
            <div
              className="w-full max-w-3xl mx-auto bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur-lg text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs text-zinc-300 line-clamp-2 select-text font-mono">{alt}</p>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>
      )}
    </>
  );
}

async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  const fullUrl = typeof window !== 'undefined' && imageUrl.startsWith('/')
    ? `${window.location.origin}${imageUrl}`
    : imageUrl;

  try {
    const res = await fetch(fullUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    if (blob.type === 'image/png' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(false);
            return;
          }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (pngBlob) => {
            if (pngBlob && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                resolve(true);
                return;
              } catch (e) {
                console.warn('Clipboard write error:', e);
              }
            }
            try {
              await navigator.clipboard.writeText(fullUrl);
              resolve(true);
            } catch {
              resolve(false);
            }
          }, 'image/png');
        } catch (e) {
          console.warn('Canvas conversion error:', e);
          try {
            await navigator.clipboard.writeText(fullUrl);
            resolve(true);
          } catch {
            resolve(false);
          }
        }
      };
      img.onerror = async () => {
        try {
          await navigator.clipboard.writeText(fullUrl);
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      img.src = fullUrl;
    });
  } catch (err) {
    console.warn('Failed to copy image blob, fallback to URL:', err);
    try {
      await navigator.clipboard.writeText(fullUrl);
      return true;
    } catch {
      return false;
    }
  }
}

async function downloadImageFile(imageUrl: string, filename?: string) {
  const fullUrl = typeof window !== 'undefined' && imageUrl.startsWith('/')
    ? `${window.location.origin}${imageUrl}`
    : imageUrl;

  const defaultName = filename
    ? `${filename.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_')}.webp`
    : `image-${Date.now()}.webp`;

  try {
    const res = await fetch(fullUrl, { mode: 'cors' });
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = defaultName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}