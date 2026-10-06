'use client';

import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import AppLogo from './ui/AppLogo';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={`fixed md:static inset-y-0 left-0 z-40 h-full transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center h-12 px-3 border-b border-border bg-card shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-foreground"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div className="ml-2 flex items-center">
            <AppLogo size={22} variant="full" />
          </div>
        </div>
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">{children}</main>
      </div>
    </div>
  );
}
