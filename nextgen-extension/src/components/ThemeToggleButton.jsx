import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';

const STORAGE_KEY = 'imgvault-theme';

const THEMES = [
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
];

function formatThemeName(themeName) {
  return themeName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, { persist = true } = {}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (persist) {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

export default function ThemeToggleButton({ className = '' }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');

  const selectTheme = (nextTheme) => {
    if (!nextTheme) return;

    setTheme(nextTheme);
    applyTheme(nextTheme, { persist: true });
    setOpen(false);
  };

  useEffect(() => {
    const storedTheme = localStorage.getItem(STORAGE_KEY);
    const currentTheme =
      storedTheme ||
      document.documentElement.getAttribute('data-theme') ||
      getSystemTheme();
    const initialTheme = THEMES.includes(currentTheme) ? currentTheme : getSystemTheme();

    setTheme(initialTheme);
    applyTheme(initialTheme, { persist: Boolean(storedTheme) });
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = () => {
      if (localStorage.getItem(STORAGE_KEY)) {
        return;
      }

      const nextTheme = mediaQuery.matches ? 'dark' : 'light';
      setTheme(nextTheme);
      applyTheme(nextTheme, { persist: false });
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-transparent text-base-content/70 hover:text-base-content hover:bg-base-100/70 hover:border-base-content/20 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open theme selector"
        title="Theme settings"
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && (
  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-base-content/20 bg-base-100 shadow-xl p-2 z-[9999] overflow-hidden">
          <div className="px-2 py-2 mb-1 border-b border-base-content/15">
            <p className="text-xs text-base-content/60">Current theme</p>
            <p className="text-sm font-medium text-base-content">{formatThemeName(theme)}</p>
          </div>

          <div className="max-h-64 overflow-y-auto pr-1 space-y-0.5">
            {THEMES.map((themeName) => {
              const isActive = themeName === theme;
              return (
                <button
                  key={themeName}
                  type="button"
                  onClick={() => selectTheme(themeName)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/20 text-primary'
                      : 'text-base-content/80 hover:text-base-content hover:bg-base-200/70'
                  }`}
                >
                  <span>{formatThemeName(themeName)}</span>
                  {isActive && <Check className="w-4 h-4" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
