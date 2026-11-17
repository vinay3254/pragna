'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Languages, Check, Search, ChevronDown } from 'lucide-react';
import { INDIAN_LANGUAGES, IndianLanguage } from '@/lib/indianLanguages';
import { cn } from '@/lib/utils';

export interface LanguageSelectorProps {
  selectedLanguage: string;
  onSelectLanguage: (code: string) => void;
  direction?: 'up' | 'down';
  variant?: 'pill' | 'compact' | 'header';
  align?: 'left' | 'right';
  className?: string;
  onOpen?: () => void;
}

export default function LanguageSelector({
  selectedLanguage,
  onSelectLanguage,
  direction = 'up',
  variant = 'pill',
  align = 'left',
  className,
  onOpen,
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeLang =
    INDIAN_LANGUAGES.find((l) => l.code === selectedLanguage) ||
    INDIAN_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const filteredLanguages = INDIAN_LANGUAGES.filter((lang) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      lang.name.toLowerCase().includes(q) ||
      lang.nativeName.toLowerCase().includes(q) ||
      lang.script.toLowerCase().includes(q) ||
      lang.code.toLowerCase().includes(q)
    );
  });

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !isOpen;
    if (next) onOpen?.();
    setIsOpen(next);
  };

  const popupPositionClass =
    direction === 'up'
      ? align === 'right'
        ? 'bottom-full right-0 mb-2.5'
        : 'bottom-full left-0 max-sm:-left-24 mb-2.5'
      : align === 'right'
        ? 'top-full right-0 mt-1.5'
        : 'top-full left-0 mt-1.5';

  return (
    <div className="relative" ref={containerRef}>
      {variant === 'pill' && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleToggle}
          className={cn(
            'group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground/70 transition-all duration-200 outline-none hover:bg-primary/15 hover:text-primary cursor-pointer border border-transparent hover:border-primary/30',
            isOpen ? 'bg-primary/20 text-primary border-primary/40' : '',
            className
          )}
          title={`Language: ${activeLang.name} (${activeLang.nativeName})`}
          aria-label={`Select language. Current: ${activeLang.name}`}
          aria-expanded={isOpen}
        >
          <Languages className="size-3.5 opacity-80 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          <span className="text-xs font-semibold select-none transition-colors truncate max-w-[85px]">
            {activeLang.code === 'auto' ? 'Auto' : activeLang.name}
          </span>
          <ChevronDown
            className={cn(
              'size-3 opacity-60 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      )}

      {variant === 'compact' && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleToggle}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-foreground/70 hover:text-primary hover:bg-primary/10 border border-border/60 hover:border-primary/30 transition-all bg-card/80 backdrop-blur-sm cursor-pointer shadow-2xs',
            isOpen ? 'bg-primary/20 text-primary border-primary/40' : '',
            className
          )}
          title={`Current language: ${activeLang.name}. Click to change.`}
          aria-label={`Current language: ${activeLang.name}`}
          aria-expanded={isOpen}
        >
          <Languages className="size-3 text-primary flex-shrink-0" />
          <span className="text-[11px] font-medium max-w-[70px] truncate">
            {activeLang.code === 'auto' ? 'Auto' : activeLang.name}
          </span>
          <ChevronDown
            className={cn(
              'size-2.5 opacity-60 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      )}

      {variant === 'header' && (
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 transition-all shadow-sm active:scale-95',
            isOpen && 'bg-muted text-foreground',
            className
          )}
          title="Indian Languages (Google Services)"
          aria-label="Select Indian Language"
          aria-expanded={isOpen}
        >
          <Languages size={14} className="text-primary flex-shrink-0" />
          <span className="max-w-[85px] sm:max-w-[120px] truncate">
            {activeLang.code === 'auto' ? 'Auto (Indic)' : activeLang.nativeName}
          </span>
          <ChevronDown
            size={12}
            className={cn(
              'opacity-60 flex-shrink-0 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      )}

      {isOpen && (
        <div
          style={{
            transformOrigin: direction === 'up' ? 'bottom left' : 'top right',
            backgroundColor: 'var(--card)',
          }}
          className={cn(
            'absolute z-50 w-72 sm:w-80 max-w-[calc(100vw-2rem)] max-h-80 flex flex-col rounded-2xl border border-border bg-card shadow-premium-lg overflow-hidden animate-in fade-in duration-150',
            direction === 'up' ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2',
            popupPositionClass
          )}
        >
          <div className="p-2 border-b border-border/60 bg-muted/40">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-background border border-border text-xs focus-within:border-primary/40 transition-colors">
              <Search size={13} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search languages…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-xs"
              />
            </div>
            <div className="flex items-center justify-between px-1 mt-1.5 text-[0.625rem] text-muted-foreground font-medium">
              <span>Google Services Indic Suite</span>
              <span>24 Languages</span>
            </div>
          </div>

          <div className="overflow-y-auto p-1 divide-y divide-border/20 prompt-scrollbar">
            {filteredLanguages.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No matching language found
              </div>
            ) : (
              filteredLanguages.map((lang: IndianLanguage) => {
                const isSelected = lang.code === selectedLanguage;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectLanguage(lang.code);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2 rounded-xl text-left text-xs transition-all',
                      isSelected
                        ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                        : 'text-foreground hover:bg-muted/80 border border-transparent'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium leading-none">
                          {lang.nativeName}
                        </span>
                        {lang.code !== 'auto' && (
                          <span className="text-[0.6875rem] text-muted-foreground font-normal">
                            ({lang.name})
                          </span>
                        )}
                      </div>
                      <span className="text-[0.625rem] text-muted-foreground/80 mt-0.5">
                        {lang.script} • {lang.family}
                      </span>
                    </div>
                    {isSelected && (
                      <Check size={14} className="text-primary flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
