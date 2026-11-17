'use client';

import React from 'react';
import { DesignAppearance } from './components/DesignAppearance';
import './design.css';

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return <DesignAppearance>{children}</DesignAppearance>;
}
