'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle, Code, Eye } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

export default function MermaidDiagram({ code, className = '' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');

  useEffect(() => {
    let isMounted = true;
    let timerId: NodeJS.Timeout;

    async function renderMermaid() {
      if (!code || !code.trim()) return;

      const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            primaryColor: '#3b82f6',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#60a5fa',
            lineColor: '#94a3b8',
            secondaryColor: '#6366f1',
            tertiaryColor: '#1e293b',
          },
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          securityLevel: 'loose',
        });

        const { svg } = await mermaid.render(id, code.trim());

        if (isMounted) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to render Mermaid diagram');
        }
      } finally {
        const tempEl = document.getElementById(`d${id}`);
        if (tempEl) tempEl.remove();
      }
    }

    timerId = setTimeout(renderMermaid, 200);

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [code]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.15, 2.5));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.15, 0.5));
  const handleResetZoom = () => setScale(1);

  if (error) {
    return (
      <div className={`p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-xs ${className}`}>
        <div className="flex items-center gap-2 text-destructive mb-2 font-medium">
          <AlertCircle size={15} />
          <span>Mermaid Syntax Warning</span>
        </div>
        <p className="text-muted-foreground mb-3">{error}</p>
        <pre className="p-3 bg-black/40 rounded-lg overflow-x-auto text-[11px] font-mono text-muted-foreground">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div className={`relative group rounded-xl border border-border/60 bg-muted/20 overflow-hidden ${className}`}>
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/50 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-primary/90 uppercase tracking-wider text-[11px]">Mermaid Diagram</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode(viewMode === 'preview' ? 'code' : 'preview')}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title={viewMode === 'preview' ? 'View Diagram Code' : 'View Diagram'}
          >
            {viewMode === 'preview' ? <Code size={13} /> : <Eye size={13} />}
          </button>
          {viewMode === 'preview' && (
            <>
              <button
                onClick={handleZoomOut}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="text-[10px] text-muted-foreground font-mono min-w-[32px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={13} />
              </button>
              <button
                onClick={handleResetZoom}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                title="Reset Zoom"
              >
                <RotateCcw size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content View */}
      {viewMode === 'code' ? (
        <pre className="p-4 overflow-x-auto text-xs font-mono bg-black/30 text-muted-foreground leading-relaxed">
          {code}
        </pre>
      ) : (
        <div className="p-6 overflow-auto flex items-center justify-center min-h-[220px] bg-black/10">
          <div
            ref={containerRef}
            style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
            className="transition-transform duration-150 ease-out max-w-full flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      )}
    </div>
  );
}
