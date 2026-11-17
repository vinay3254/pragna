'use client';

import Link from 'next/link';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { useDesignAppearance } from './DesignAppearance';

export function DesignMark({ size = 24 }: { size?: number }) {
  return <AppLogo size={size} variant="shield" />;
}

export function DesignBrand({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <AppLogo size={size} variant="full" />
      <span className="text-sm font-normal text-muted-foreground">Design</span>
    </span>
  );
}

export function AppearanceButton() {
  const { dark, toggle } = useDesignAppearance();
  return (
    <button
      className="design-icon-button"
      onClick={toggle}
      aria-label={dark ? 'Use light appearance' : 'Use dark appearance'}
      title={dark ? 'Light appearance' : 'Dark appearance'}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function BackToPragna() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft size={15} /> Back to Pragna
    </Link>
  );
}
