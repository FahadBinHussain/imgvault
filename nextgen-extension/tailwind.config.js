import daisyui from 'daisyui'
import { fileURLToPath } from 'node:url'

// shared ui package (imgvault-ui) — Tailwind only scans content globs, so every
// class used ONLY in packages/ui (the detail modal shell) disappears from the
// compiled CSS without this (2026-10-11 visual-break incident). forward slashes
// only: fast-glob treats Windows backslashes as escape chars and silently matches nothing
const uiGlob = fileURLToPath(new URL('../packages/ui', import.meta.url)).split('\\').join('/') + '/**/*.{js,jsx}'

// daisyui v5 exposes semantic colors as bare CSS vars (--color-base-100, --color-primary,
// …), and tailwind v3 only emits `/opacity` variants for colors declared in
// theme.extend.colors. without these declarations ~750 utilities used across src/ and
// packages/ui (`text-base-content/70`, `bg-error/10`, `border-warning/40`, …) compile to
// nothing — which is why the trash banner/confirm tints rendered flat while the web app
// (palette alphas) looked right. `oklch(from …)` is the same relative-color form the
// GalleryPage inline CSS already relies on, so it works on every theme.
const daisyColor = (token) => `oklch(from var(--color-${token}) l c h / <alpha-value>)`
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
]
const daisyColors = Object.fromEntries(DAISY_COLOR_TOKENS.map((t) => [t, daisyColor(t)]))

const DAISYUI_THEMES = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
  'caramellatte',
  'abyss',
  'silk',
]

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./popup.html",
    "./gallery.html",
    "./settings.html",
    "./src/**/*.{js,jsx}",
    uiGlob
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      letterSpacing: {
        tighter: '-0.02em',
        tight: '-0.01em',
      },
      colors: {
        ...daisyColors,
        primary: {
          DEFAULT: daisyColor('primary'),
          50: '#f0f5ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5b8fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        secondary: {
          DEFAULT: daisyColor('secondary'),
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
        }
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-secondary': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [daisyui({ themes: DAISYUI_THEMES })],
}
