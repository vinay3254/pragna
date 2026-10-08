'use client';

import React, { useEffect } from 'react';
import { setAuthToken } from '@/lib/api';

export default function OAuthCallbackPage() {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get('token');
    const error = hash.get('error');

    if (token) {
      setAuthToken(token);
    } else if (error) {
      // A hard navigation to "/" is about to discard this component and any
      // toast it fired -- stash the message so AuthScreen can show it after
      // the reload, once it's actually mounted long enough to be seen.
      sessionStorage.setItem('pragna-oauth-error', error);
    }

    window.location.href = '/';
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white text-sm text-black/50">
      Signing you in…
    </div>
  );
}
