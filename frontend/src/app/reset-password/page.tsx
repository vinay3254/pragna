'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Sun, Moon, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { resetPassword } from '@/lib/api';
import AppLogo from '@/components/ui/AppLogo';

const InteractiveNeuralVortex = dynamic(
  () => import('@/components/ui/interactive-neural-vortex-background'),
  { ssr: false }
);

const THEME_KEY = 'claudechat_theme';

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

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [token, setToken] = useState<string | null>(null);
  const [hasCheckedToken, setHasCheckedToken] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const queryToken = searchParams.get('token');
    if (queryToken) {
      setToken(queryToken);
      window.history.replaceState({}, '', '/reset-password');
    }
    setHasCheckedToken(true);
  }, [searchParams]);

  useEffect(() => {
    const initial = loadTheme();
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem(THEME_KEY, next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Missing or invalid reset token. Please request a new reset link.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, password);
      toast.success('Password has been reset successfully! Please log in.');
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 overflow-hidden bg-background">
      <InteractiveNeuralVortex />

      <button
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title="Toggle theme"
        className="fixed top-5 left-5 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-white text-black dark:bg-black dark:text-white border border-black/10 dark:border-white/10 shadow-sm hover:opacity-80 transition-opacity"
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-premium-lg">
        <div className="flex items-center justify-center mb-5">
          <AppLogo size={36} variant="full" />
        </div>

        <h1 className="text-lg font-bold text-foreground mb-1 text-center">Set new password</h1>
        <p className="text-sm text-muted-foreground mb-5 text-center">
          Choose a secure password for your Pragna account.
        </p>

        {hasCheckedToken && !token ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center flex flex-col items-center gap-2">
              <ShieldAlert size={20} />
              <span>The password reset link is invalid, incomplete, or has already expired.</span>
            </div>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 transition-opacity shadow-sm"
            >
              Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">New Password</label>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 p-1 text-gold-500 hover:text-gold-400 dark:text-gold-400 dark:hover:text-gold-300 transition-colors focus:outline-none rounded"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Confirm New Password</label>
              <div className="relative flex items-center">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-2.5 p-1 text-gold-500 hover:text-gold-400 dark:text-gold-400 dark:hover:text-gold-300 transition-colors focus:outline-none rounded"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity shadow-sm"
            >
              {submitting ? 'Updating…' : 'Reset password'}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to log in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
