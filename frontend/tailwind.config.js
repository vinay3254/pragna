/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: { DEFAULT: 'var(--background)' },
        foreground: { DEFAULT: 'var(--foreground)' },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
          50: '#f7efd7',
          100: '#eedca0',
          400: '#e5c76b',
          500: '#d4af37',
          600: '#c39a20',
          700: '#b8860b',
        },
        gold: {
          50: '#fbf8ed',
          100: '#f7efd7',
          200: '#eedca0',
          300: '#e5c76b',
          400: '#ddb945',
          500: '#d4af37',
          600: '#c39a20',
          700: '#b8860b',
          800: '#926a0b',
          900: '#75540e',
        },
        surface: {
          DEFAULT: '#141414',
          subtle: '#1a1a1a',
          muted: '#222222',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: { DEFAULT: 'var(--border)' },
        input: { DEFAULT: 'var(--input)' },
        ring: { DEFAULT: 'var(--ring)' },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
          bg: 'var(--sidebar-bg)',
          hover: 'var(--sidebar-hover)',
          active: 'var(--sidebar-active)',
        },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
        },
        'user-bubble': { DEFAULT: 'var(--user-bubble)' },
        'code-block': { DEFAULT: 'var(--code-bg)' },
      },
      boxShadow: {
        'premium-sm': '0 2px 8px rgba(0,0,0,0.28)',
        'premium-md': '0 6px 18px rgba(0,0,0,0.34)',
        'premium-lg': '0 12px 28px rgba(0,0,0,0.42)',
        'premium-hover': '0 20px 32px rgba(0,0,0,0.5)',
        'gold-glow': '0 0 20px rgba(212, 175, 55, 0.25)',
        'gold-sm': '0 2px 10px rgba(212, 175, 55, 0.15)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Courier New', 'monospace'],
      },
      maxWidth: {
        'chat': '48rem',
      },
      animation: {
        'blink': 'blink 0.8s ease-in-out infinite',
        'thinking': 'thinking-pulse 1.4s ease-in-out infinite',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'spring-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};