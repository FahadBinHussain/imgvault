import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, Check, Download, Key, Image, Film, HardDrive,
  Cloud, Database, FolderOpen, Settings2, Sparkles,
  ExternalLink, Loader2, Shield, Zap, CheckCircle2, AlertCircle
} from 'lucide-react';
import { useChromeStorage } from '../hooks/useChromeExtension';
import GalleryNavbar from '../components/GalleryNavbar';

const NAV = [
  { id: 'keys', label: 'API Keys', icon: Key },
  { id: 'cloud', label: 'Cloud & Database', icon: Cloud },
  { id: 'prefs', label: 'Preferences', icon: Sparkles },
  { id: 'links', label: 'Resources', icon: ExternalLink },
];

const CSS = `
.s-page { font-family: 'Outfit', system-ui, sans-serif; }

.s-orb{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none;will-change:transform}
.s-orb-a{width:520px;height:520px;background:oklch(from var(--color-primary) l c h / 0.07);top:-12%;right:-8%;animation:s-drift-a 26s ease-in-out infinite}
.s-orb-b{width:420px;height:420px;background:oklch(from var(--color-secondary) l c h / 0.06);bottom:-14%;left:-6%;animation:s-drift-b 32s ease-in-out infinite}
.s-orb-c{width:320px;height:320px;background:oklch(from var(--color-primary) l c h / 0.04);top:38%;left:28%;animation:s-drift-c 22s ease-in-out infinite}
@keyframes s-drift-a{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(-50px,40px) scale(1.06)}50%{transform:translate(25px,-55px) scale(.94)}75%{transform:translate(35px,25px) scale(1.03)}}
@keyframes s-drift-b{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(40px,-30px) scale(1.04)}50%{transform:translate(-30px,50px) scale(.96)}75%{transform:translate(-40px,-15px) scale(1.02)}}
@keyframes s-drift-c{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(60px,-40px) scale(1.1)}66%{transform:translate(-40px,60px) scale(.9)}}

.s-grid{position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(circle,oklch(from var(--color-base-content) l c h / 0.03) 1px,transparent 1px);background-size:28px 28px;z-index:0}

.s-glass{background:oklch(from var(--color-base-100) l c h / 0.45);backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);border:1px solid oklch(from var(--color-base-content) l c h / 0.06);border-radius:16px;position:relative;overflow:hidden;transition:border-color .3s,box-shadow .3s}
.s-glass:hover{border-color:oklch(from var(--color-base-content) l c h / 0.1)}
.s-glass::before{content:'';position:absolute;top:0;left:12%;right:12%;height:1px;background:linear-gradient(90deg,transparent,oklch(from var(--color-primary) l c h / 0.2),oklch(from var(--color-secondary) l c h / 0.15),transparent);z-index:2}
.s-glass::after{content:'';position:absolute;inset:0;border-radius:inherit;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");opacity:.018;pointer-events:none;mix-blend-mode:overlay;z-index:1}

.s-inp{width:100%;height:40px;padding:0 14px;font-size:13px;font-family:'Outfit',system-ui,sans-serif;color:var(--color-base-content);background:oklch(from var(--color-base-100) l c h / 0.35);border:1px solid oklch(from var(--color-base-content) l c h / 0.07);border-radius:10px;outline:none;transition:all .2s ease}
.s-inp:focus{border-color:oklch(from var(--color-primary) l c h / 0.4);background:oklch(from var(--color-base-100) l c h / 0.65);box-shadow:0 0 0 3px oklch(from var(--color-primary) l c h / 0.07),0 0 24px oklch(from var(--color-primary) l c h / 0.04)}
.s-inp::placeholder{color:oklch(from var(--color-base-content) l c h / 0.2)}
.s-inp::-ms-reveal{filter:brightness(0)}

.s-ta{width:100%;padding:12px 14px;font-size:13px;font-family:'Outfit',system-ui,sans-serif;color:var(--color-base-content);background:oklch(from var(--color-base-100) l c h / 0.35);border:1px solid oklch(from var(--color-base-content) l c h / 0.07);border-radius:10px;outline:none;resize:none;transition:all .2s ease;line-height:1.6}
.s-ta:focus{border-color:oklch(from var(--color-primary) l c h / 0.4);background:oklch(from var(--color-base-100) l c h / 0.65);box-shadow:0 0 0 3px oklch(from var(--color-primary) l c h / 0.07),0 0 24px oklch(from var(--color-primary) l c h / 0.04)}
.s-ta::placeholder{color:oklch(from var(--color-base-content) l c h / 0.2)}

.s-sel{width:100%;height:40px;padding:0 36px 0 14px;font-size:13px;font-family:'Outfit',system-ui,sans-serif;color:var(--color-base-content);background:oklch(from var(--color-base-100) l c h / 0.35);border:1px solid oklch(from var(--color-base-content) l c h / 0.07);border-radius:10px;outline:none;appearance:none;cursor:pointer;transition:all .2s ease;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.s-sel:focus{border-color:oklch(from var(--color-primary) l c h / 0.4);background-color:oklch(from var(--color-base-100) l c h / 0.65);box-shadow:0 0 0 3px oklch(from var(--color-primary) l c h / 0.07),0 0 24px oklch(from var(--color-primary) l c h / 0.04)}

.s-save{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 28px;font-size:13px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;letter-spacing:-.01em;color:var(--color-primary-content);background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));border:none;border-radius:10px;cursor:pointer;position:relative;overflow:hidden;transition:all .2s ease;box-shadow:0 2px 20px oklch(from var(--color-primary) l c h / 0.3);min-width:150px}
.s-save:hover{transform:translateY(-1px);box-shadow:0 6px 28px oklch(from var(--color-primary) l c h / 0.4);filter:brightness(1.1)}
.s-save:active{transform:translateY(0) scale(.98)}
.s-save::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,hsl(0 0% 100%/.12),transparent);transform:translateX(-100%);animation:s-shimmer 3s infinite}
.s-save-ok{background:var(--color-success);box-shadow:0 2px 20px oklch(from var(--color-success) l c h / 0.3)}
.s-save-ok::after{display:none}
@keyframes s-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

.s-nav-btn{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 16px;border-radius:10px;font-size:13px;font-weight:500;color:oklch(from var(--color-base-content) l c h / 0.4);cursor:pointer;transition:all .15s ease;position:relative;border:none;background:none;width:100%;text-align:left;font-family:'Outfit',system-ui,sans-serif}
.s-nav-btn:hover{color:oklch(from var(--color-base-content) l c h / 0.75);background:oklch(from var(--color-base-content) l c h / 0.03)}
.s-nav-on{color:var(--color-base-content)!important;background:oklch(from var(--color-base-content) l c h / 0.04)!important}

.s-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:500;font-family:'Outfit',system-ui,sans-serif}
.s-pill-ok{color:var(--color-success);background:oklch(from var(--color-success) l c h / 0.07)}
.s-pill-err{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.07)}
.s-pill-load{color:var(--color-info);background:oklch(from var(--color-info) l c h / 0.07)}
.s-pill-muted{color:oklch(from var(--color-base-content) l c h / 0.45);background:oklch(from var(--color-base-content) l c h / 0.04)}

.s-scroll{scrollbar-width:thin;scrollbar-color:oklch(from var(--color-base-content) l c h / 0.06) transparent}
.s-scroll::-webkit-scrollbar{width:5px}
.s-scroll::-webkit-scrollbar-track{background:transparent}
.s-scroll::-webkit-scrollbar-thumb{background:oklch(from var(--color-base-content) l c h / 0.06);border-radius:3px}
.s-scroll::-webkit-scrollbar-thumb:hover{background:oklch(from var(--color-base-content) l c h / 0.12)}

.s-divider{height:1px;background:linear-gradient(90deg,transparent,oklch(from var(--color-base-content) l c h / 0.06),transparent);margin:20px 0}

.s-link{display:flex;align-items:center;justify-content:between;padding:10px 12px;border-radius:10px;transition:all .15s;text-decoration:none;color:inherit}
.s-link:hover{background:oklch(from var(--color-base-content) l c h / 0.03)}

.s-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;font-size:10px;font-family:'Outfit',system-ui,sans-serif;font-weight:600;color:oklch(from var(--color-base-content) l c h / 0.3);background:oklch(from var(--color-base-content) l c h / 0.04);border:1px solid oklch(from var(--color-base-content) l c h / 0.07);border-radius:5px;line-height:1}

.s-label{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.s-label-text{font-size:13px;font-weight:500;color:oklch(from var(--color-base-content) l c h / 0.65)}
.s-label-icon{color:oklch(from var(--color-base-content) l c h / 0.25)}
.s-label-req{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:oklch(from var(--color-primary) l c h / 0.6);background:oklch(from var(--color-primary) l c h / 0.07);padding:2px 6px;border-radius:4px}

.s-hint{font-size:11px;color:oklch(from var(--color-base-content) l c h / 0.3);line-height:1.6;margin-top:6px}

.s-backdrop{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
`;

const ease = [0.25, 0.46, 0.45, 0.94];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease } },
};

function Sidebar({ active, onChange }) {
  return (
    <nav className="w-52 flex-shrink-0 hidden lg:block">
      <div className="sticky top-28 space-y-0.5">
        {NAV.map(item => {
          const on = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`s-nav-btn ${on ? 's-nav-on' : ''}`}
            >
              {on && (
                <motion.div
                  layoutId="s-glow"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full"
                  style={{
                    background: 'var(--color-primary)',
                    boxShadow: '0 0 10px oklch(from var(--color-primary) l c h / 0.45), 0 0 3px oklch(from var(--color-primary) l c h / 0.6)',
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                />
              )}
              <item.icon className="w-4 h-4 flex-shrink-0" style={on ? { color: 'var(--color-primary)' } : undefined} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <div className="mt-8 px-3 flex items-center gap-1.5">
          <span className="s-kbd">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}</span>
          <span className="s-kbd">S</span>
          <span className="text-[10px] ml-1" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.2)' }}>save</span>
        </div>
      </div>
    </nav>
  );
}

function MobileTabs({ active, onChange }) {
  return (
    <div className="flex lg:hidden gap-1 overflow-x-auto pb-3 mb-5 -mx-0.5 px-0.5" style={{ borderBottom: '1px solid oklch(from var(--color-base-content) l c h / 0.05)' }}>
      {NAV.map(item => {
        const on = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150"
            style={{
              color: on ? 'var(--color-primary)' : 'oklch(from var(--color-base-content) l c h / 0.4)',
              background: on ? 'oklch(from var(--color-primary) l c h / 0.08)' : 'transparent',
            }}
          >
            <item.icon className="w-3.5 h-3.5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, required, icon: Icon, children }) {
  return (
    <motion.div variants={fadeUp} className="space-y-1.5">
      <div className="s-label">
        {Icon && <Icon className="w-3.5 h-3.5 s-label-icon" />}
        <span className="s-label-text">{label}</span>
        {required && <span className="s-label-req">Required</span>}
      </div>
      {children}
      {hint && <p className="s-hint">{hint}</p>}
    </motion.div>
  );
}

function StatusPill({ status }) {
  if (!status) return null;
  const ok = status.includes('✅') || status.includes('✓');
  const err = status.includes('❌') || status.includes('⚠');
  const load = status.includes('...') || status.includes('Connecting') || status.includes('Syncing');
  const cls = ok ? 's-pill-ok' : err ? 's-pill-err' : load ? 's-pill-load' : 's-pill-muted';
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`s-pill ${cls}`}>
      {load && <Loader2 className="w-3 h-3 animate-spin" />}
      {ok && <CheckCircle2 className="w-3 h-3" />}
      {err && <AlertCircle className="w-3 h-3" />}
      <span>{status}</span>
    </motion.div>
  );
}

function ResourceLink({ icon: Icon, label, href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="s-link group">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <Icon className="w-4 h-4 flex-shrink-0 transition-colors" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.25)' }} />
        <span className="text-[13px] truncate transition-colors" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.55)' }}>{label}</span>
      </div>
      <ExternalLink className="w-3 h-3 flex-shrink-0 transition-colors" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.15)' }} />
    </a>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState('keys');

  const [pixvidApiKey, setPixvidApiKey] = useChromeStorage('pixvidApiKey', '', 'sync');
  const [imgbbApiKey, setImgbbApiKey] = useChromeStorage('imgbbApiKey', '', 'sync');
  const [filemoonApiKey, setFilemoonApiKey] = useChromeStorage('filemoonApiKey', '', 'sync');
  const [udropKey1, setUdropKey1] = useChromeStorage('udropKey1', '', 'sync');
  const [udropKey2, setUdropKey2] = useChromeStorage('udropKey2', '', 'sync');
  const [firebaseConfigRaw, setFirebaseConfigRaw] = useChromeStorage('firebaseConfigRaw', '', 'sync');
  const [neonDatabaseUrl, setNeonDatabaseUrl] = useChromeStorage('neonDatabaseUrl', '', 'sync');
  const [defaultGallerySource, setDefaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [defaultVideoSource, setDefaultVideoSource] = useChromeStorage('defaultVideoSource', 'filemoon', 'sync');
  const [downloadFolder, setDownloadFolder] = useChromeStorage('downloadFolder', '', 'sync');

  const [f, setF] = useState({
    pixvid: '', imgbb: '', filemoon: '', udrop1: '', udrop2: '',
    firebase: '', neon: '', gallerySrc: 'imgbb', videoSrc: 'filemoon', dlFolder: '',
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [navH, setNavH] = useState(0);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    setF({
      pixvid: pixvidApiKey || '', imgbb: imgbbApiKey || '', filemoon: filemoonApiKey || '',
      udrop1: udropKey1 || '', udrop2: udropKey2 || '', firebase: firebaseConfigRaw || '',
      neon: neonDatabaseUrl || '', gallerySrc: defaultGallerySource || 'imgbb',
      videoSrc: defaultVideoSource || 'filemoon', dlFolder: downloadFolder || '',
    });
  }, [pixvidApiKey, imgbbApiKey, filemoonApiKey, udropKey1, udropKey2, firebaseConfigRaw, neonDatabaseUrl, defaultGallerySource, defaultVideoSource, downloadFolder]);

  useEffect(() => {
    if ((downloadFolder || '').trim()) return;
    let stop = false;
    (async () => {
      try {
        const r = await chrome.runtime.sendMessage({ action: 'nativeHostCommand', command: 'get_default_video_directory', data: {} });
        if (!r?.success) return;
        const dir = (r.data?.filePath || r.data?.message || '').trim();
        if (!dir || stop) return;
        set('dlFolder', dir);
        setDownloadFolder(dir);
      } catch {}
    })();
    return () => { stop = true; };
  }, [downloadFolder, setDownloadFolder]);

  useEffect(() => {
    (async () => {
      try {
        const fc = await new Promise(r => chrome.storage.sync.get(['firebaseConfig'], r)).then(r => r.firebaseConfig);
        const hasNeon = Boolean((neonDatabaseUrl || '').trim());
        if (!fc && !hasNeon) return;
        setCloudStatus('Connecting...');
        const { StorageManager } = await import('../utils/storage.js');
        const sm = new StorageManager(); await sm.init();
        const cloud = await sm.getUserSettings();
        if (cloud) {
          let up = false;
          if (!f.pixvid && cloud.pixvidApiKey?.trim()) { set('pixvid', cloud.pixvidApiKey); setPixvidApiKey(cloud.pixvidApiKey); up = true; }
          if (!f.imgbb && cloud.imgbbApiKey?.trim()) { set('imgbb', cloud.imgbbApiKey); setImgbbApiKey(cloud.imgbbApiKey); up = true; }
          if (!f.filemoon && cloud.filemoonApiKey?.trim()) { set('filemoon', cloud.filemoonApiKey); setFilemoonApiKey(cloud.filemoonApiKey); up = true; }
          if (!f.udrop1 && cloud.udropKey1?.trim()) { set('udrop1', cloud.udropKey1); setUdropKey1(cloud.udropKey1); up = true; }
          if (!f.udrop2 && cloud.udropKey2?.trim()) { set('udrop2', cloud.udropKey2); setUdropKey2(cloud.udropKey2); up = true; }
          if (cloud.defaultGallerySource?.trim()) { set('gallerySrc', cloud.defaultGallerySource); setDefaultGallerySource(cloud.defaultGallerySource); up = true; }
          if (cloud.defaultVideoSource?.trim()) { set('videoSrc', cloud.defaultVideoSource); setDefaultVideoSource(cloud.defaultVideoSource); up = true; }
          setCloudStatus(up ? '✅ Synced from cloud' : '✓ Up to date');
        } else {
          setCloudStatus('No cloud settings found');
        }
      } catch { setCloudStatus('❌ Sync failed'); }
    })();
  }, [firebaseConfigRaw, neonDatabaseUrl]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (f.firebase) {
        let cfg;
        try { cfg = JSON.parse(f.firebase); } catch {
          const ex = k => { const m = f.firebase.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`, 'i')); return m?.[1]; };
          cfg = { apiKey: ex('apiKey'), authDomain: ex('authDomain'), projectId: ex('projectId'), storageBucket: ex('storageBucket'), messagingSenderId: ex('messagingSenderId'), appId: ex('appId'), measurementId: ex('measurementId') };
          Object.keys(cfg).forEach(k => { if (!cfg[k]) delete cfg[k]; });
        }
        if (!cfg.apiKey || !cfg.projectId) { alert('Firebase config missing critical fields'); setSaving(false); return; }
        await chrome.storage.sync.set({ firebaseConfig: cfg, firebaseConfigRaw: f.firebase });
      }
      const nUrl = f.neon.trim();
      await chrome.storage.sync.set({ neonDatabaseUrl: nUrl });
      setPixvidApiKey(f.pixvid); setImgbbApiKey(f.imgbb); setFilemoonApiKey(f.filemoon);
      setUdropKey1(f.udrop1); setUdropKey2(f.udrop2);
      setDefaultGallerySource(f.gallerySrc); setDefaultVideoSource(f.videoSrc);
      setDownloadFolder(f.dlFolder); setNeonDatabaseUrl(nUrl);
      try {
        const fc = await new Promise(r => chrome.storage.sync.get(['firebaseConfig'], r)).then(r => r.firebaseConfig);
        if ((nUrl || fc) && (f.pixvid || f.imgbb || f.filemoon || f.udrop1 || f.udrop2)) {
          setCloudStatus('Syncing...');
          const { StorageManager } = await import('../utils/storage.js');
          const sm = new StorageManager(); await sm.init();
          const s = {};
          if (f.pixvid) s.pixvidApiKey = f.pixvid;
          if (f.imgbb) s.imgbbApiKey = f.imgbb;
          if (f.filemoon) s.filemoonApiKey = f.filemoon;
          if (f.udrop1) s.udropKey1 = f.udrop1;
          if (f.udrop2) s.udropKey2 = f.udrop2;
          if (f.gallerySrc) s.defaultGallerySource = f.gallerySrc;
          if (f.videoSrc) s.defaultVideoSource = f.videoSrc;
          if (Object.keys(s).length) { await sm.saveUserSettings(s); setCloudStatus('✅ Synced to cloud'); }
          else setCloudStatus('Nothing to sync');
        }
      } catch { setCloudStatus('⚠️ Local saved, cloud sync failed'); }
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }, [f]);

  useEffect(() => {
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!saving && section !== 'links') handleSave(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, saving, section]);

  const handleExport = async () => {
    setExporting(true); setExportStatus('Preparing...');
    try {
      const r = await chrome.runtime.sendMessage({ action: 'exportFirestoreBackup' });
      if (!r?.success || !r?.data) throw new Error(r?.error || 'Export failed');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `imgvault-backup-${ts}.json`;
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setExportStatus(`Exported ${name}`);
    } catch (e) { setExportStatus(`Failed: ${e.message}`); }
    finally { setExporting(false); }
  };

  const sectionContent = (
    <AnimatePresence mode="wait">
      <motion.div
        key={section}
        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.3, ease } }}
        exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.15 } }}
      >
        {section === 'keys' && (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            <motion.div variants={fadeUp}>
              <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--color-base-content)' }}>API Keys</h2>
              <p className="text-[13px] mt-1" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>Authentication credentials for upload services</p>
            </motion.div>
            <div className="s-divider" />
            <Field label="Pixvid API Key" icon={Zap} required>
              <input className="s-inp" type="password" value={f.pixvid} onChange={e => set('pixvid', e.target.value)} placeholder="Enter your Pixvid API key" />
            </Field>
            <Field label="ImgBB API Key" icon={Image} hint="Optional fallback image host for original quality uploads">
              <input className="s-inp" type="password" value={f.imgbb} onChange={e => set('imgbb', e.target.value)} placeholder="Enter your ImgBB API key" />
            </Field>
            <div className="s-divider" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Filemoon API Key" icon={Film}>
                <input className="s-inp" type="password" value={f.filemoon} onChange={e => set('filemoon', e.target.value)} placeholder="For video uploads" />
              </Field>
              <Field label="UDrop Key 1" icon={HardDrive}>
                <input className="s-inp" type="password" value={f.udrop1} onChange={e => set('udrop1', e.target.value)} placeholder="64 characters" />
              </Field>
            </div>
            <Field label="UDrop Key 2" icon={HardDrive}>
              <input className="s-inp" type="password" value={f.udrop2} onChange={e => set('udrop2', e.target.value)} placeholder="64 characters" />
            </Field>
            <div className="s-divider" />
            <Field label="Video Download Folder" icon={FolderOpen} hint="Leave blank to auto-detect your Windows Videos folder. Use double backslashes if setting manually.">
              <input className="s-inp" style={{ fontFamily: "'Outfit', monospace", fontSize: 12 }} type="text" value={f.dlFolder} onChange={e => set('dlFolder', e.target.value)} placeholder="C:\Users\You\Videos" />
            </Field>
          </motion.div>
        )}

        {section === 'cloud' && (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            <motion.div variants={fadeUp} className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--color-base-content)' }}>Cloud & Database</h2>
                <p className="text-[13px] mt-1" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>Sync settings across devices</p>
              </div>
              <AnimatePresence><StatusPill status={cloudStatus} /></AnimatePresence>
            </motion.div>
            <div className="s-divider" />
            <Field label="Firebase Config" icon={Shield} hint="Paste JSON from Firebase Console → Project Settings → General → Your apps">
              <textarea className="s-ta" rows={6} value={f.firebase} onChange={e => set('firebase', e.target.value)} placeholder={'{ "apiKey": "...", "projectId": "...", ... }'} style={{ fontFamily: "'Outfit', monospace", fontSize: 12 }} />
            </Field>
            <Field label="Neon Database URL" icon={Database} hint="If set, ImgVault uses Neon DB. Otherwise falls back to Firebase.">
              <input className="s-inp" type="password" value={f.neon} onChange={e => set('neon', e.target.value)} placeholder="postgresql://user:pass@ep-xxx.neon.tech/db" style={{ fontFamily: "'Outfit', monospace", fontSize: 12 }} />
            </Field>
            <div className="s-divider" />
            <motion.div variants={fadeUp} className="flex items-center justify-between gap-4 p-4 rounded-xl" style={{ background: 'oklch(from var(--color-base-content) l c h / 0.02)', border: '1px solid oklch(from var(--color-base-content) l c h / 0.05)' }}>
              <div>
                <p className="text-[13px] font-medium" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.65)' }}>Full Firestore Backup</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.3)' }}>Export all collections to a local JSON file</p>
              </div>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{
                  background: 'oklch(from var(--color-base-content) l c h / 0.04)',
                  border: '1px solid oklch(from var(--color-base-content) l c h / 0.07)',
                  color: 'oklch(from var(--color-base-content) l c h / 0.55)',
                  opacity: exporting ? 0.5 : 1,
                }}
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exporting ? 'Exporting...' : 'Export'}</span>
              </button>
            </motion.div>
            {exportStatus && <motion.p variants={fadeUp} className="text-[11px] font-medium" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>{exportStatus}</motion.p>}
          </motion.div>
        )}

        {section === 'prefs' && (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            <motion.div variants={fadeUp}>
              <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--color-base-content)' }}>Preferences</h2>
              <p className="text-[13px] mt-1" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>Default sources for gallery display</p>
            </motion.div>
            <div className="s-divider" />
            <Field label="Default Image Source" icon={Image}>
              <select className="s-sel" value={f.gallerySrc} onChange={e => set('gallerySrc', e.target.value)}>
                <option value="imgbb">ImgBB — Original Quality</option>
                <option value="pixvid">Pixvid — Compressed Quality</option>
              </select>
            </Field>
            <Field label="Default Video Source" icon={Film}>
              <select className="s-sel" value={f.videoSrc} onChange={e => set('videoSrc', e.target.value)}>
                <option value="filemoon">Filemoon</option>
                <option value="udrop">UDrop</option>
              </select>
            </Field>
          </motion.div>
        )}

        {section === 'links' && (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
            <motion.div variants={fadeUp}>
              <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--color-base-content)' }}>Resources</h2>
              <p className="text-[13px] mt-1" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>Where to get API keys and credentials</p>
            </motion.div>
            <div className="s-divider" />
            <motion.div variants={fadeUp} className="space-y-0.5">
              <ResourceLink icon={Zap} label="Get Pixvid API Key" href="https://pixvid.org" />
              <ResourceLink icon={Image} label="Get ImgBB API Key" href="https://api.imgbb.com" />
              <ResourceLink icon={Film} label="Get Filemoon API Key" href="https://byse.sx/settings" />
              <ResourceLink icon={HardDrive} label="Get UDrop API Keys" href="https://www.udrop.com/account/edit" />
              <ResourceLink icon={Cloud} label="Firebase Console" href="https://console.firebase.google.com" />
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="min-h-screen s-page" style={{ background: 'var(--color-base-200)', color: 'var(--color-base-content)' }}>
      <style>{CSS}</style>

      {/* ── Background ── */}
      <div className="s-backdrop">
        <div className="s-grid" />
        <div className="s-orb s-orb-a" />
        <div className="s-orb s-orb-b" />
        <div className="s-orb s-orb-c" />
      </div>

      {/* ── Navbar ── */}
      <GalleryNavbar
        navigate={navigate} images={[]} reload={() => {}} toggleSelectionMode={() => {}}
        selectionMode={false} collectionsLoading={false} collections={[]} trashLoading={false}
        trashedImages={[]} openUploadModal={() => {}} searchQuery="" setSearchQuery={() => {}}
        selectedImages={new Set()} selectAll={() => {}} filteredImages={[]} deselectAll={() => {}}
        setShowBulkDeleteConfirm={() => {}} isDeleting={false} onHeightChange={setNavH} isSettingsPage={true}
      />
      <div style={{ height: navH ? `${navH + 8}px` : '90px' }} />

      {/* ── Page ── */}
      <div className="relative z-10 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease } }}
          className="pt-2 pb-7"
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, oklch(from var(--color-primary) l c h / 0.15), oklch(from var(--color-secondary) l c h / 0.12))',
                border: '1px solid oklch(from var(--color-primary) l c h / 0.1)',
              }}
            >
              <Settings2 className="w-[18px] h-[18px]" style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1
              className="text-[18px] font-bold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Settings
            </h1>
          </div>
        </motion.div>

        {/* Body */}
        <div className="flex gap-8">
          <Sidebar active={section} onChange={setSection} />

          <motion.div
            className="flex-1 min-w-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1, ease } }}
          >
            <MobileTabs active={section} onChange={setSection} />

            <div className="s-glass p-6 sm:p-8 s-scroll">
              {sectionContent}

              {section !== 'links' && (
                <div className="mt-8 pt-5" style={{ borderTop: '1px solid oklch(from var(--color-base-content) l c h / 0.05)' }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`s-save ${saved ? 's-save-ok' : ''}`}
                  >
                    <AnimatePresence mode="wait">
                      {saving ? (
                        <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                          <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                        </motion.span>
                      ) : saved ? (
                        <motion.span key="saved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                          <Check className="w-4 h-4" /> Saved
                        </motion.span>
                      ) : (
                        <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                          <Save className="w-4 h-4" /> Save Changes
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
