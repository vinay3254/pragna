'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Sun, Moon, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE, requestRegistrationOtp, verifyRegistrationOtp, forgotPassword } from '@/lib/api';
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

export default function AuthScreen() {
  const { login, register, registerWithOtp } = useAuth();
  const isEmailAuthEnabled = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED === 'true';

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const oauthError = sessionStorage.getItem('pragna-oauth-error');
    if (oauthError) {
      toast.error(oauthError);
      sessionStorage.removeItem('pragna-oauth-error');
    }
  }, []);

  useEffect(() => {
    const initial = loadTheme();
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem(THEME_KEY, next);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register') {
        if (isEmailAuthEnabled) {
          const res = await requestRegistrationOtp(email);
          toast.success('Verification code sent to your email.');
          setResendCooldown(res.resend_after || 60);
          setStep('otp');
        } else {
          await register(email, password);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setSubmitting(true);

    try {
      await verifyRegistrationOtp(email, otpCode, password);
      toast.success('Account created! Please log in with your email and password.');
      setMode('login');
      setStep('credentials');
      setOtpCode('');
      setError(null);
      setShowPassword(false);
      setPassword('');
      setSuccessNotice('Account created. Log in to continue.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || submitting) return;
    setError(null);
    setSuccessNotice(null);
    setSubmitting(true);

    try {
      const res = await requestRegistrationOtp(email);
      toast.success('A new verification code has been sent.');
      setResendCooldown(res.resend_after || 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setSubmitting(true);

    try {
      await forgotPassword(email);
      setForgotSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (newMode: 'login' | 'register' | 'forgot') => {
    setMode(newMode);
    setStep('credentials');
    setOtpCode('');
    setError(null);
    setSuccessNotice(null);
    setForgotSubmitted(false);
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

        {/* Heading & Mode Switcher */}
        {mode === 'forgot' ? (
          <>
            <h1 className="text-lg font-bold text-foreground mb-1 text-center">Reset your password</h1>
            <p className="text-sm text-muted-foreground mb-5 text-center">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-primary font-medium hover:underline"
              >
                Log in
              </button>
            </p>
          </>
        ) : mode === 'register' && step === 'otp' ? (
          <>
            <h1 className="text-lg font-bold text-foreground mb-1 text-center">Verify your email</h1>
            <p className="text-sm text-muted-foreground mb-5 text-center">
              Enter the 6-digit code sent to <br />
              <span className="font-medium text-foreground">{email}</span>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-foreground mb-1 text-center">
              {mode === 'login' ? 'Log in to PRAGNA 1-A' : 'Create your PRAGNA 1-A account'}
            </h1>
            <p className="text-sm text-muted-foreground mb-5 text-center">
              {mode === 'login'
                ? "Don't have an account yet?"
                : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                className="text-primary font-medium hover:underline"
              >
                {mode === 'login' ? 'Register' : 'Log in'}
              </button>
            </p>
          </>
        )}

        {/* OAuth Buttons (Only when on credentials step of login / register) */}
        {mode !== 'forgot' && step === 'credentials' && (
          <>
            <div className="space-y-2 mb-4">
              <a
                href={`${API_BASE}/api/auth/google/login`}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.46H12v4.66h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.88c2.27-2.09 3.57-5.17 3.57-8.83z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.92H1.3v3.09C3.26 21.3 7.3 24 12 24z" />
                  <path fill="#FBBC05" d="M5.31 14.32c-.24-.72-.38-1.49-.38-2.32s.14-1.6.38-2.32V6.59H1.3A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.3 5.41l4.01-3.09z" />
                  <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.3 0 3.26 2.7 1.3 6.59l4.01 3.09c.94-2.82 3.58-4.93 6.69-4.93z" />
                </svg>
                Continue with Google
              </a>
              <a
                href={`${API_BASE}/api/auth/github/login`}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 21.79 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                Continue with GitHub
              </a>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          </>
        )}

        {/* 1. Forgot Password Mode */}
        {mode === 'forgot' ? (
          forgotSubmitted ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-muted/60 border border-border text-xs text-foreground/90 leading-relaxed text-center">
                If an account exists for <span className="font-semibold text-foreground">{email}</span>, a password reset link has been sent. Please check your inbox and spam folder.
              </div>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 transition-opacity shadow-sm"
              >
                Back to log in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity shadow-sm"
              >
                {submitting ? 'Please wait…' : 'Send reset link'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to log in
                </button>
              </div>
            </form>
          )
        ) : step === 'otp' ? (
          /* 2. Registration OTP Verification Step */
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5 text-center">6-digit verification code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full text-center tracking-[0.4em] text-lg font-mono px-3 py-2.5 rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}

            <button
              type="submit"
              disabled={submitting || otpCode.length < 6}
              className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity shadow-sm"
            >
              {submitting ? 'Verifying…' : 'Verify & create account'}
            </button>

            <div className="flex items-center justify-between text-xs pt-1 px-1">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendCooldown > 0 || submitting}
                className="text-primary hover:underline disabled:opacity-50 disabled:no-underline font-medium"
              >
                {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setOtpCode('');
                  setError(null);
                  setSuccessNotice(null);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Change email
              </button>
            </div>
          </form>
        ) : (
          /* 3. Standard Login / Register Credentials Step */
          <>
            {successNotice && (
              <div className="mb-3.5 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 font-medium text-center">
                {successNotice}
              </div>
            )}
            <form onSubmit={handleCredentialsSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Password</label>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={mode === 'login' ? '••••••••' : 'At least 8 characters'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 p-1 text-gold-500 hover:text-gold-400 dark:text-gold-400 dark:hover:text-gold-300 transition-colors focus:outline-none focus:ring-1 focus:ring-gold-500/50 rounded"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Forgot password link in Login mode when email auth is enabled */}
              {mode === 'login' && isEmailAuthEnabled && (
                <div className="flex justify-end pt-1.5">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-[11px] text-primary hover:underline transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl gold-gradient-btn text-sm font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity shadow-sm"
            >
              {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </>
        )}
      </div>
    </div>
  );
}
