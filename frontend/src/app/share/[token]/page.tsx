'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import MarkdownRenderer from '@/app/components/MarkdownRenderer';

interface SharedMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  files?: string[];
}

export default function SharedConversationPage() {
  const params = useParams();
  const token = String(params?.token || '');
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/share/${token}`);
        if (res.status === 404) {
          setStatus('not_found');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          return;
        }
        const data = await res.json();
        setTitle(data.title || 'Shared conversation');
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    })();
  }, [token]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={28} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">
            {status === 'not_found' ? "This share link doesn't exist or has been removed." : 'Something went wrong loading this conversation.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 sm:px-6 py-4 flex items-center gap-2.5 sticky top-0 bg-background/90 backdrop-blur-md z-10">
        <AppLogo size={22} variant="shield" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          <p className="text-xs text-muted-foreground">Shared read-only conversation &bull; PRAGNA 1-A</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-muted/60 border border-border/50 text-sm leading-relaxed">
                {m.images?.length ? <div className="flex flex-wrap gap-2 mb-2">
                  {m.images.map((src, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={index} src={src} alt={`Attached photo ${index + 1}`} className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-border/50" />
                  ))}
                </div> : null}
                {m.files?.map((name, index) => <p key={index} className="mb-2 text-xs text-muted-foreground">Attachment: {name}</p>)}
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 mt-1 flex items-center justify-center">
                  <AppLogo size={22} variant="shield" />
                </div>
                <div className="prose-chat flex-1 min-w-0 text-sm leading-relaxed">
                  <MarkdownRenderer content={m.content} />
                </div>
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
