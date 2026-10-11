'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sun, Moon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE, requestRegistrationOtp, verifyRegistrationOtp, forgotPassword } from '@/lib/api';
import AppLogo from '@/components/ui/AppLogo';
import '@/styles/auth.css';

const THEME_KEY = 'claudechat_theme';
const REMEMBER_KEY = 'pragna_remember_email';
const VALID_EMAIL = /^\S+@\S+\.\S+$/;
const STRENGTH_COLORS = ['var(--auth-rule)', '#d8443d', '#d9b54a', '#b5c75a', '#6fcf8f'];
const passwordScore = (pw: string) =>
  !pw ? 0 : [pw.length >= 8, /[A-Z]/.test(pw) && /[a-z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;

type Mode = 'login' | 'register' | 'forgot';
type BadField = '' | 'email' | 'pw' | 'otp';

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

function readRemembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const isEmailAuthEnabled = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED === 'true';

  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [bad, setBad] = useState<BadField>('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const oauthError = sessionStorage.getItem('pragna-oauth-error');
    if (oauthError) {
      toast.error(oauthError);
      sessionStorage.removeItem('pragna-oauth-error');
    }
    const remembered = readRemembered();
    if (remembered) {
      setEmail(remembered);
      setRemember(true);
    }
  }, []);

  useEffect(() => {
    const initial = loadTheme();
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem(THEME_KEY, next);
  };

  const signUp = mode === 'register';
  const score = passwordScore(password);
  const fail = (message: string, field: BadField = '') => {
    setError(message);
    setBad(field);
  };
  const clear = () => {
    setError('');
    setBad('');
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setStep('credentials');
    setOtpCode('');
    setForgotSubmitted(false);
    setNotice('');
    clear();
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim();
    if (signUp && isEmailAuthEnabled && !fullName.trim()) return fail('Enter your name.');
    if (!VALID_EMAIL.test(cleanEmail)) return fail('Enter a valid email.', 'email');
    if (signUp && (password.length < 8 || score < 2)) return fail('Use at least 8 characters with a mix of letters and numbers.', 'pw');
    if (!signUp && !password) return fail('Enter your password.', 'pw');
    setBusy(true);
    clear();
    setNotice('');
    try {
      if (!signUp) {
        await login(cleanEmail, password);
        try {
          if (remember) localStorage.setItem(REMEMBER_KEY, cleanEmail);
          else localStorage.removeItem(REMEMBER_KEY);
        } catch {
          // storage unavailable: nothing to remember
        }
      } else if (isEmailAuthEnabled) {
        const res = await requestRegistrationOtp(cleanEmail, fullName.trim());
        toast.success('Verification code sent to your email.');
        setResendCooldown(res.resend_after || 60);
        setStep('otp');
      } else {
        await register(cleanEmail, password);
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : signUp ? 'Could not create your account. Try again.' : 'Invalid email or password.');
    } finally {
      setBusy(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (otpCode.length < 6) return fail('Enter the 6-digit code.', 'otp');
    setBusy(true);
    clear();
    try {
      await verifyRegistrationOtp(email.trim(), otpCode, password, fullName.trim() || undefined);
      toast.success('Account created! Please sign in with your email and password.');
      switchMode('login');
      setPassword('');
      setShowPassword(false);
      setNotice('Account created. Sign in to continue.');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Verification failed', 'otp');
    } finally {
      setBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || busy) return;
    setBusy(true);
    clear();
    try {
      const res = await requestRegistrationOtp(email.trim(), fullName.trim());
      toast.success('A new verification code has been sent.');
      setResendCooldown(res.resend_after || 60);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim();
    if (!VALID_EMAIL.test(cleanEmail)) return fail('Enter a valid email.', 'email');
    setBusy(true);
    clear();
    try {
      await forgotPassword(cleanEmail);
      setForgotSubmitted(true);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === 'forgot'
      ? { title: 'Reset your password', sub: <>We&apos;ll email you a link to choose a new one.</> }
      : step === 'otp'
        ? { title: 'Verify your email', sub: <>Enter the 6-digit code sent to <strong>{email.trim()}</strong></> }
        : signUp
          ? { title: 'Create your account', sub: <>Start thinking with PRAGNA 1-A in seconds.</> }
          : { title: 'Welcome back', sub: <>Sign in to continue to PRAGNA 1-A.</> };

  const emailInput = (
    <input
      className="px-auth-input" type="email" value={email} placeholder="Email" autoComplete="email" aria-label="Email"
      data-bad={bad === 'email'} aria-invalid={bad === 'email'}
      onChange={(e) => { setEmail(e.target.value); clear(); }}
    />
  );

  return (
    <div className="px-auth">
      <header className="px-auth-header">
        <AppLogo size={36} variant="full" />
        <button type="button" className="px-auth-theme" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <main className="px-auth-main">
        <div className="px-auth-panel">
          <div className="px-auth-heading">
            <h1>{heading.title}</h1>
            <p>{heading.sub}</p>
          </div>

          {mode !== 'forgot' && step === 'credentials' && (
            <>
              <div className="px-auth-oauth">
                <a className="px-auth-google" href={`${API_BASE}/api/auth/google/login`}>
                  <GoogleMark />
                  <span>{signUp ? 'Sign up with Google' : 'Continue with Google'}</span>
                </a>
                <a className="px-auth-secondary" href={`${API_BASE}/api/auth/github/login`}>
                  <GitHubMark />
                  <span>{signUp ? 'Sign up with GitHub' : 'Continue with GitHub'}</span>
                </a>
              </div>
              <div className="px-auth-or"><span />OR<span /></div>
            </>
          )}

          {mode === 'forgot' ? (
            forgotSubmitted ? (
              <div className="px-auth-form">
                <p className="px-auth-info">
                  If an account exists for <strong>{email.trim()}</strong>, a password reset link has been sent. Check your inbox and spam folder.
                </p>
                <button type="button" className="px-auth-submit" onClick={() => switchMode('login')}>Back to sign in</button>
              </div>
            ) : (
              <form className="px-auth-form" onSubmit={handleForgotSubmit} noValidate>
                {emailInput}
                {error && <p className="px-auth-error" role="alert">{error}</p>}
                <SubmitButton busy={busy} label="Send reset link" busyLabel="Sending…" />
              </form>
            )
          ) : step === 'otp' ? (
            <form className="px-auth-form" onSubmit={handleOtpSubmit} noValidate>
              <input
                className="px-auth-input px-auth-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={otpCode} placeholder="000000" aria-label="6-digit verification code"
                data-bad={bad === 'otp'} aria-invalid={bad === 'otp'}
                onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '')); clear(); }}
              />
              {error && <p className="px-auth-error" role="alert">{error}</p>}
              <SubmitButton busy={busy} label="Verify & create account" busyLabel="Verifying…" />
              <div className="px-auth-row">
                <button type="button" className="px-auth-link-muted" onClick={handleResendOtp} disabled={resendCooldown > 0 || busy}>
                  {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                </button>
                <button type="button" className="px-auth-link-muted" onClick={() => { setStep('credentials'); setOtpCode(''); clear(); }}>
                  Change email
                </button>
              </div>
            </form>
          ) : (
            <form className="px-auth-form" onSubmit={handleCredentialsSubmit} noValidate>
              {signUp && isEmailAuthEnabled && (
                <input
                  className="px-auth-input" value={fullName} placeholder="Full name" autoComplete="name" aria-label="Full name"
                  onChange={(e) => { setFullName(e.target.value); clear(); }}
                />
              )}
              {emailInput}
              <div className="px-auth-password">
                <input
                  className="px-auth-input" type={showPassword ? 'text' : 'password'} value={password} placeholder="Password" aria-label="Password"
                  autoComplete={signUp ? 'new-password' : 'current-password'} data-bad={bad === 'pw'} aria-invalid={bad === 'pw'}
                  onChange={(e) => { setPassword(e.target.value); clear(); }}
                />
                <button
                  type="button" onClick={() => setShowPassword((on) => !on)}
                  title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="M3 3l18 18" />}
                  </svg>
                </button>
              </div>

              {signUp && (
                <div className="px-auth-strength" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => <span key={i} style={{ background: i <= score ? STRENGTH_COLORS[score] : STRENGTH_COLORS[0] }} />)}
                </div>
              )}

              {notice && <p className="px-auth-notice" role="status">{notice}</p>}
              {error && <p className="px-auth-error" role="alert">{error}</p>}

              {!signUp && (
                <div className="px-auth-row">
                  <button type="button" className="px-auth-check" onClick={() => setRemember((on) => !on)} aria-pressed={remember}>
                    <Tick on={remember} />Remember me
                  </button>
                  {isEmailAuthEnabled && (
                    <button type="button" className="px-auth-link-muted" onClick={() => switchMode('forgot')}>Forgot password?</button>
                  )}
                </div>
              )}

              <SubmitButton
                busy={busy}
                label={signUp ? 'Create account' : 'Sign in'}
                busyLabel={signUp ? (isEmailAuthEnabled ? 'Sending code…' : 'Creating account…') : 'Signing in…'}
              />
            </form>
          )}

          <p className="px-auth-switch">
            {mode === 'forgot' ? (
              <>Remember your password? <button type="button" onClick={() => switchMode('login')}>Sign in</button></>
            ) : signUp ? (
              <>Already have an account? <button type="button" onClick={() => switchMode('login')}>Sign in</button></>
            ) : (
              <>New to PRAGNA? <button type="button" onClick={() => switchMode('register')}>Create an account</button></>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}

function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className="px-auth-submit" disabled={busy}>
      {busy && <span className="px-auth-spinner" aria-hidden="true" />}
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className="px-auth-box" data-on={on}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
    </span>
  );
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.46H12v4.66h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.88c2.27-2.09 3.57-5.17 3.57-8.83z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.92H1.3v3.09C3.26 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.31 14.32c-.24-.72-.38-1.49-.38-2.32s.14-1.6.38-2.32V6.59H1.3A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.3 5.41l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.3 0 3.26 2.7 1.3 6.59l4.01 3.09c.94-2.82 3.58-4.93 6.69-4.93z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 21.79 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
