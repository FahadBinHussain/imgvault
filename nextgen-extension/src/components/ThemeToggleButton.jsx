import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';

const STORAGE_KEY = 'imgvault-theme';

const THEMES = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
  'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
  'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
  'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
  'night', 'coffee', 'winter', 'dim', 'nord', 'sunset', 'caramellatte',
  'abyss', 'silk',
];

function formatThemeName(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, { persist = true } = {}) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) localStorage.setItem(STORAGE_KEY, theme);
}

const CSS = `
.iv-theme-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--color-base-300);background:var(--color-base-100);color:var(--color-base-content);opacity:.6;cursor:pointer;transition:all .15s ease;font-family:inherit}
.iv-theme-btn:hover{opacity:1;background:var(--color-base-200)}
.iv-theme-dropdown{position:absolute;right:0;margin-top:8px;width:220px;border:1px solid var(--color-base-300);background:var(--color-base-100);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.25);padding:6px;z-index:99999;overflow:hidden;font-family:'Outfit',system-ui,sans-serif}
.iv-theme-header{padding:8px 10px;margin-bottom:4px;border-bottom:1px solid var(--color-base-300)}
.iv-theme-header-label{font-size:10px;color:var(--color-base-content);opacity:.5;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.iv-theme-header-name{font-size:13px;font-weight:500;color:var(--color-base-content);margin-top:2px}
.iv-theme-list{max-height:256px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--color-base-300) transparent}
.iv-theme-list::-webkit-scrollbar{width:4px}
.iv-theme-list::-webkit-scrollbar-track{background:transparent}
.iv-theme-list::-webkit-scrollbar-thumb{background:var(--color-base-300);border-radius:2px}
.iv-theme-item{display:flex;align-items:center;justify-content:space-between;width:100%;padding:7px 10px;border-radius:8px;font-size:12px;font-weight:500;color:var(--color-base-content);opacity:.6;cursor:pointer;transition:all .12s ease;border:none;background:none;text-align:left;font-family:inherit}
.iv-theme-item:hover{opacity:1;background:var(--color-base-200)}
.iv-theme-item-on{opacity:1!important;color:var(--color-primary)!important;background:oklch(from var(--color-primary) l c h / 0.08)!important}
`;

export default function ThemeToggleButton({ className = '' }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');

  const selectTheme = (next) => {
    if (!next) return;
    setTheme(next);
    applyTheme(next, { persist: true });
    setOpen(false);
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const current = stored || document.documentElement.getAttribute('data-theme') || getSystemTheme();
    const initial = THEMES.includes(current) ? current : getSystemTheme();
    setTheme(initial);
    applyTheme(initial, { persist: Boolean(stored) });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (localStorage.getItem(STORAGE_KEY)) return;
      const next = mq.matches ? 'dark' : 'light';
      setTheme(next);
      applyTheme(next, { persist: false });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <style>{CSS}</style>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="iv-theme-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open theme selector"
        title="Theme"
      >
        <Palette style={{ width: 14, height: 14 }} />
      </button>

      {open && (
        <div className="iv-theme-dropdown">
          <div className="iv-theme-header">
            <div className="iv-theme-header-label">Theme</div>
            <div className="iv-theme-header-name">{formatThemeName(theme)}</div>
          </div>
          <div className="iv-theme-list">
            {THEMES.map(t => {
              const active = t === theme;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => selectTheme(t)}
                  className={`iv-theme-item ${active ? 'iv-theme-item-on' : ''}`}
                >
                  <span>{formatThemeName(t)}</span>
                  {active && <Check style={{ width: 14, height: 14 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
