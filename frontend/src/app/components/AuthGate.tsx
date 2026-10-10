'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import AuthScreen from './AuthScreen';
import SplashScreen, { SPLASH_TOTAL_MS, SPLASH_FADE_MS } from '@/components/SplashScreen';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Splash plays on initial entry once per browser session (skipped on OAuth callback and reset-password).
  // null until mounted: sessionStorage is client-only, so deciding during render would cause a hydration mismatch.
  const [showSplash, setShowSplash] = useState<boolean | null>(null);

  useEffect(() => {
    if (
      pathname === '/auth/callback' ||
      pathname === '/reset-password' ||
      pathname.startsWith('/share/') ||
      pathname.startsWith('/design/shared/')
    ) {
      setShowSplash(false);
      return;
    }
    let seen = false;
    try {
      seen = !!sessionStorage.getItem('pragna_seen_splash');
    } catch {
      // storage unavailable: show splash
    }
    setShowSplash(!seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [splashVisible, setSplashVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pragna_seen_splash', '1');
    }
    setSplashVisible(false);
    setTimeout(() => setShowSplash(false), SPLASH_FADE_MS);
  }, []);

  useEffect(() => {
    if (!showSplash) return;
    const fadeTimer = setTimeout(() => {
      setSplashVisible(false);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('pragna_seen_splash', '1');
      }
    }, SPLASH_TOTAL_MS - SPLASH_FADE_MS);
    const removeTimer = setTimeout(() => setShowSplash(false), SPLASH_TOTAL_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [showSplash]);

  // Authentication callbacks, password resets, and public share links must be
  // accessible without an account.
  if (
    pathname === '/auth/callback' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/share/') ||
    pathname.startsWith('/design/shared/')
  ) {
    return <>{children}</>;
  }

  if (showSplash === null) {
    return null;
  }

  if (showSplash) {
    return <SplashScreen visible={splashVisible} onDismiss={handleDismiss} />;
  }

  if (loading) {
    return null;
  }

  if (!user) {
    return <AuthScreen />;
  }

  return <>{children}</>;
}
