'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  AuthUser,
  setAuthToken,
  getAuthToken,
  register as apiRegister,
  verifyRegistrationOtp,
  login as apiLogin,
  fetchMe,
} from '@/lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  registerWithOtp: (email: string, password: string, code: string, name?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updated: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 1500);

    fetchMe()
      .then(setUser)
      .catch((err) => {
        // Only drop the token when the server rejects it. A network error or an
        // aborted request (e.g. the OAuth callback navigating away mid-fetch) must not log the user out.
        if (err?.status === 401 || err?.status === 403) setAuthToken(null);
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => clearTimeout(timeout);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setAuthToken(res.access_token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await apiRegister(email, password);
    setAuthToken(res.access_token);
    setUser(res.user);
  }, []);

  const registerWithOtp = useCallback(
    async (email: string, password: string, code: string, name?: string) => {
      const res = await verifyRegistrationOtp(email, code, password, name);
      setAuthToken(res.access_token);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((updated: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updated } : null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, registerWithOtp, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
