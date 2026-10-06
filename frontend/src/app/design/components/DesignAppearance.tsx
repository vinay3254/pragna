'use client';
import React from 'react';
import { useChat } from '@/context/ChatContext';

export function useDesignAppearance() {
  const { isDarkMode, toggleDarkMode } = useChat();
  return { dark: isDarkMode, toggle: toggleDarkMode };
}

export function DesignAppearance({ children }: { children: React.ReactNode }) {
  const { dark } = useDesignAppearance();
  return (
    <div className="design-studio" data-appearance={dark ? 'dark' : 'light'}>
      {children}
    </div>
  );
}
