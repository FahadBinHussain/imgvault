/** @type {import('tailwindcss').Config} */
const path = require('path');

// shared ui package (imgvault-ui) — Tailwind only scans content globs, so every
// class used ONLY in packages/ui (the detail modal shell) disappears from the
// compiled CSS without this (2026-10-11 visual-break incident). forward slashes
// only: fast-glob treats Windows backslashes as escape chars and silently matches nothing
const uiGlob = path.resolve(__dirname, '../packages/ui').split(path.sep).join('/') + '/**/*.{js,jsx}';

// daisyui v5 exposes semantic colors as bare CSS vars (--color-base-100, --color-primary,
// …), and tailwind v3 only emits `/opacity` variants for colors declared here. without
// these, `text-base-content/70`, `bg-error/10`, `border-warning/40` (and the shared
// imgvault-ui modal's own alpha classes) compile to nothing on web while the extension
// renders them — a silent parity break. same declaration as the extension config.
const daisyColor = (token) => `oklch(from var(--color-${token}) l c h / <alpha-value>)`;
const DAISY_COLOR_TOKENS = [
  'base-100', 'base-200', 'base-300', 'base-content',
  'primary', 'primary-content',
  'secondary', 'secondary-content',
  'accent', 'accent-content',
  'neutral', 'neutral-content',
  'info', 'info-content',
  'success', 'success-content',
  'warning', 'warning-content',
  'error', 'error-content',
];
const daisyColors = Object.fromEntries(DAISY_COLOR_TOKENS.map((t) => [t, daisyColor(t)]));

module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    uiGlob,
  ],
  theme: {
    extend: {
      colors: {
        ...daisyColors,
        primary: {
          DEFAULT: daisyColor('primary'),
          50: '#f0f4ff',
          100: '#dbe4ff',
          200: '#bac8ff',
          300: '#91a7ff',
          400: '#748ffc',
          500: '#5c7cfa',
          600: '#4c6ef5',
          700: '#4263eb',
          800: '#3b5bdb',
          900: '#364fc7',
        },
        dark: {
          50: '#f8f9fa',
          100: '#f1f3f5',
          200: '#e9ecef',
          300: '#dee2e6',
          400: '#ced4da',
          500: '#adb5bd',
          600: '#868e96',
          700: '#495057',
          800: '#343a40',
          900: '#212529',
          950: '#0d1117',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 8s ease-in-out infinite',
        'float-slower': 'float 10s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'gradient': 'gradient 8s ease infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0%' },
          '100%': { backgroundPosition: '200% 0%' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(92, 124, 250, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(92, 124, 250, 0.6)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '60px 60px',
      },
    },
  },
  // invoke the plugin with options (same registration style as the extension):
  // daisyui v5 on tailwind v3 does NOT apply its theme colors to theme.extend when
  // the plugin is passed uninvoked with a `daisyui:` config key — utilities like
  // bg-base-100/text-info/from-base-300 silently never generate (2026-10-11 modal fix)
  plugins: [require('daisyui')({ themes: 'all' })],
}