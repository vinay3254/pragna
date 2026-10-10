'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { DesignScreen } from '@/lib/design';
import { AppearanceButton } from '../../components/DesignChrome';

export default function SharedDesign() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ project: { name: string }; screens: DesignScreen[] } | null>(
    null
  );
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${API_BASE}/api/design/shared/${encodeURIComponent(token)}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'This preview link has been revoked or does not exist.'
              : 'Preview unavailable. Try again.'
          );
        return response.json();
      })
      .then(setData)
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => abort.abort();
  }, [token]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select')) return;
      if (event.key === 'ArrowRight')
        setIndex((value) => Math.min((data?.screens.length || 1) - 1, value + 1));
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [data]);
  const screen = data?.screens[index];
  return (
    <main className="design-shell flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-4">
        <Link href="/design" className="design-icon-button" aria-label="Open Pragna Design">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {data?.project.name || 'Shared design'}
        </h1>
        <AppearanceButton />
      </header>
      {error ? (
        <p role="alert" className="m-auto max-w-md p-6 text-center text-sm">
          {error}
        </p>
      ) : !data ? (
        <div role="status" className="m-auto flex items-center gap-2 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Opening preview…
        </div>
      ) : !screen ? (
        <p className="m-auto text-sm">No completed artboards have been shared yet.</p>
      ) : (
        <>
          <nav
            aria-label="Artboards"
            className="flex min-h-14 items-center justify-center gap-3 border-b border-border px-4"
          >
            <button
              className="design-icon-button"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              aria-label="Previous artboard"
            >
              <ChevronLeft size={18} />
            </button>
            <label className="flex items-center gap-2 text-xs">
              <select
                aria-label="Selected artboard"
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
                className="min-h-10 rounded-lg border border-border bg-card px-3"
              >
                {data.screens.map((item, i) => (
                  <option key={item.id} value={i}>
                    {i + 1}. {item.name}
                  </option>
                ))}
              </select>
              <span>
                {index + 1}/{data.screens.length}
              </span>
            </label>
            <button
              className="design-icon-button"
              disabled={index === data.screens.length - 1}
              onClick={() => setIndex(index + 1)}
              aria-label="Next artboard"
            >
              <ChevronRight size={18} />
            </button>
          </nav>
          <iframe
            title={screen.name + ' shared preview'}
            srcDoc={screen.html || ''}
            sandbox="allow-scripts allow-forms"
            className="min-h-0 w-full flex-1 border-0"
          />
        </>
      )}
    </main>
  );
}
