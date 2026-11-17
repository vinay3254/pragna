'use client';

import React, { memo } from 'react';

interface AppLogoProps {
  src?: string;
  variant?: 'shield' | 'full' | 'wordmark' | 'icon';
  size?: number;
  className?: string;
  onClick?: () => void;
}

const AppLogo = memo(function AppLogo({
  src,
  variant = 'shield',
  size = 40,
  className = '',
  onClick,
}: AppLogoProps) {
  const imageSources = {
    shield: '/pragna-shield-icon.png',
    full: '/pragna-logo-full.png',
    wordmark: '/pragna-wordmark.png',
    icon: '/pragna-logo-icon.png',
  };
  const width = Math.round(size * (variant === 'full' ? 3.6 : variant === 'wordmark' ? 8.27 : 1));
  const name = 'PRAGNA 1-A';
  const content = (
    <img
      src={src || imageSources[variant]}
      alt={name}
      width={width}
      height={size}
      className="shrink-0 object-contain"
      style={{ width, height: size }}
      loading="eager"
      decoding="async"
    />
  );
  const classes = `inline-flex shrink-0 items-center justify-center select-none align-middle ${className}`;

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      className={`${classes} rounded-md transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring`}
    >
      {content}
    </button>
  ) : (
    <span className={classes}>
      {content}
    </span>
  );
});

export default AppLogo;
