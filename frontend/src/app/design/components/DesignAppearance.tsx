'use client';
import React, { useEffect } from 'react';
import { useChat } from '@/context/ChatContext';

export function useDesignAppearance() {
  const { isDarkMode, toggleDarkMode } = useChat();
  return { dark: isDarkMode, toggle: toggleDarkMode };
}

export function DesignAppearance({ children }: { children: React.ReactNode }) {
  const { dark } = useDesignAppearance();

  useEffect(() => {
    const lockScroll = () => {
      if (window.scrollX !== 0) {
        window.scrollTo(0, window.scrollY);
      }
    };
    window.addEventListener('scroll', lockScroll, { passive: true });
    return () => window.removeEventListener('scroll', lockScroll);
  }, []);

  return (
    <div className="design-studio" data-appearance={dark ? 'dark' : 'light'}>
      {children}
    </div>
  );
}
