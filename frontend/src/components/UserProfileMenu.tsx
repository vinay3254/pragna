'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Settings,
  LogOut,
  Search,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { createPortal } from 'react-dom';
import SettingsModal from './SettingsModal';

interface UserProfileMenuProps {
  onOpenSearch?: () => void;
  className?: string;
  defaultPlan?: string;
}

export default function UserProfileMenu({
  onOpenSearch,
  className = '',
  defaultPlan = 'Free',
}: UserProfileMenuProps) {
  const { user, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setSettingsModalOpen(false);
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === '<' || e.key === ',' || e.code === 'Comma')
      ) {
        e.preventDefault();
        setMenuOpen(false);
        setSettingsModalOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Derive user info
  const email = user?.email || '';
  const rawName = user?.name || (user?.email ? user.email.split('@')[0] : 'User');
  const displayName = rawName.toLowerCase() === 'vinay' ? 'pookieee' : rawName;
  const initial = (rawName.charAt(0) || 'u').toLowerCase();

  const handleOpenSettings = () => {
    setMenuOpen(false);
    setSettingsModalOpen(true);
  };

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
  };

  const activePlan = (user?.plan || defaultPlan || 'Free').toLowerCase();
  const planLabel = activePlan === 'pro' ? 'Pro' : 'Free';

  return (
    <div className={`relative ${className}`}>
      {/* Popup Menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-2 right-2 mb-2 z-50 flex flex-col bg-black text-[#f0e6d3] border border-[#d4af37]/30 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.9),0_0_20px_rgba(212,175,55,0.10)] p-1.5 animate-in fade-in zoom-in-95 duration-150 select-none text-left"
          style={{ minWidth: '220px' }}
        >
          {/* Email header */}
          <div className="px-3 py-2 text-xs text-[#a89878] truncate border-b border-[#2d2a24]">
            {email}
          </div>

          {/* Settings */}
          <div className="flex flex-col py-1 space-y-0.5">
            <button
              type="button"
              onClick={handleOpenSettings}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-primary/15 transition-all group cursor-pointer text-[13px] text-[#f0e6d3] hover:text-primary"
            >
              <Settings className="w-4 h-4 text-[#a89878] group-hover:text-primary shrink-0 transition-colors" />
              <span className="flex-1 font-normal">Settings</span>
              <span className="text-[10px] text-primary/80 font-mono tracking-wide px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                Ctrl+Shift+,
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="h-px bg-[#2d2a24] my-1 mx-1" />

          {/* Log out */}
          <div className="flex flex-col py-0.5">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-red-500/15 hover:text-red-400 transition-all group cursor-pointer text-[13px] text-[#f0e6d3]"
            >
              <LogOut className="w-4 h-4 text-[#a89878] group-hover:text-red-400 shrink-0 transition-colors" />
              <span className="flex-1 font-normal">Log out</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Profile Bar */}
      <div className="flex items-center justify-between px-2.5 py-2 w-full">
        {/* Trigger button */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className={`flex items-center gap-2 min-w-0 flex-1 px-2 py-1.5 rounded-xl hover:bg-primary/10 transition-all text-left cursor-pointer group border ${
            menuOpen ? 'bg-primary/15 border-primary/30' : 'border-transparent'
          }`}
          title="User profile & settings"
        >
          {/* Avatar */}
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary border border-primary/40 shadow-[0_0_8px_rgba(212,175,55,0.25)] flex items-center justify-center flex-shrink-0 text-xs font-bold">
            {initial}
          </div>

          {/* Name & Tier */}
          <div className="flex items-center gap-1 min-w-0 truncate text-[13px]">
            <span className="text-[#f0e6d3] font-medium truncate group-hover:text-primary transition-colors">
              {displayName}
            </span>
            <span className="text-primary font-semibold text-xs tracking-tight">· {planLabel}</span>
          </div>

          {/* Chevron */}
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#a89878] group-hover:text-primary transition-all duration-200 flex-shrink-0 ml-0.5 ${
              menuOpen ? 'rotate-180 text-primary' : ''
            }`}
          />
        </button>

        {/* Search icon */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <button
            type="button"
            onClick={onOpenSearch}
            className="p-1.5 rounded-lg text-[#a89878] hover:text-primary hover:bg-primary/10 transition-colors"
            title="Search (Cmd+K)"
            aria-label="Search"
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {/* Settings Modal portal */}
      {mounted &&
        typeof document !== 'undefined' &&
        createPortal(
          <SettingsModal
            isOpen={settingsModalOpen}
            onClose={() => setSettingsModalOpen(false)}
            initialTab="preferences"
          />,
          document.body
        )}
    </div>
  );
}
