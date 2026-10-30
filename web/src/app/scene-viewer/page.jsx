'use client'

import { useEffect, useRef } from 'react'

// Web host for the shared imgvault-scene-viewer core (parity phase 4 chunk 3).
// Same element ids + styles as nextgen-extension/scene-viewer.html so the core
// renders identically on both platforms; only the data layer differs:
//   .spz bytes  -> /api/media?url= (web transport; udrop share URLs 302 to the
//                  real octet-stream bytes and the proxy follows redirects)
//   config      -> /api/images?id= detail payload (config_json column)
// Any transport failure throws loudly into the core's error overlay.

const VIEWER_STYLE = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f9f9fb; overflow: hidden; font-family: system-ui, sans-serif; }
    #viewport { width: 100vw; height: 100vh; }
    #header {
      position: fixed; top: 0; left: 0; right: 0; z-index: 30;
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
      color: white;
    }
    #header h3 { font-size: 14px; font-weight: 500; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-group { display: flex; gap: 8px; }
    .btn {
      background: rgba(255,255,255,0.1); border: none; color: white;
      width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .btn:hover { background: rgba(255,255,255,0.2); }
    .btn svg { width: 20px; height: 20px; transition: transform 0.2s ease; }
    .btn:hover svg { transform: scale(1.12); }
    #loading {
      position: fixed; inset: 0; z-index: 20;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5); color: white;
    }
    #loading.hidden { display: none; }
    #loading .spinner {
      width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #22d3ee; border-radius: 50%;
      animation: spin 0.8s linear infinite; margin-right: 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading .load-info { display: flex; flex-direction: column; gap: 8px; align-items: center; }
    #loading .load-info span { font-size: 13px; opacity: 0.8; }
    .progress-bar { width: 200px; height: 3px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; width: 0%; background: #22d3ee; border-radius: 2px; transition: width 0.3s ease; }
    #error {
      position: fixed; inset: 0; z-index: 20;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.8); color: white; text-align: center;
    }
    #error.visible { display: flex; }
    #error .msg { max-width: 400px; }
    #error .close-btn {
      margin-top: 16px; padding: 8px 20px; background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 8px;
      cursor: pointer;
    }
    #hint {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 10;
      padding: 8px 16px; border-radius: 8px;
      background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.7); font-size: 12px;
    }
    #hint.hidden { display: none; }
`

// Inline fallback so the clear-cache button always works — even if the viewer
// module failed to load (same script as scene-viewer.html).
const INLINE_CLEAR_CACHE = `
    document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
      const id = new URLSearchParams(location.search).get('id');
      try {
        const req = indexedDB.open('imgvault-scene-viewer-cache', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('blobs', 'readwrite');
          if (id) tx.objectStore('blobs').delete(id); else tx.objectStore('blobs').clear();
          tx.oncomplete = () => { db.close(); location.reload(); };
          tx.onerror = () => { db.close(); location.reload(); };
        };
        req.onerror = () => location.reload();
      } catch { location.reload(); }
    });
`

function showShellError(msg) {
  const errorEl = document.getElementById('errorMsg')
  if (errorEl) errorEl.textContent = msg
  document.getElementById('loading')?.classList.add('hidden')
  document.getElementById('error')?.classList.add('visible')
}

export default function SceneViewerPage() {
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const spzUrl = params.get('url')
    const sceneId = params.get('id')
    const title = params.get('title') || '3D Scene'

    async function fetchSpz() {
      if (!spzUrl) throw new Error('No scene URL provided')
      // Telegram scenes store the platform-local route (`/telegram-media/<fileId>`);
      // /api/media only proxies absolute http(s) URLs, so local paths fetch same-origin.
      const resp = await fetch(
        spzUrl.startsWith('/') ? spzUrl : `/api/media?url=${encodeURIComponent(spzUrl)}`
      )
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200)
        throw new Error(`Scene file fetch failed: HTTP ${resp.status} — ${body}`)
      }
      return await resp.arrayBuffer()
    }

    async function getConfig() {
      if (!sceneId) return null
      const resp = await fetch(`/api/images?id=${encodeURIComponent(sceneId)}`)
      const data = await resp.json().catch(() => null)
      if (!resp.ok) {
        throw new Error(`Scene config fetch failed: HTTP ${resp.status} — ${data?.error || 'unknown error'}`)
      }
      const raw = data?.image?.configJson
      if (!raw) return null
      if (typeof raw !== 'string') return raw
      try {
        return JSON.parse(raw)
      } catch (e) {
        console.error('[SceneViewer] stored config_json is not valid JSON — rendering with defaults:', e?.message || e)
        return null
      }
    }

    import('imgvault-scene-viewer')
      .then(({ startSceneViewer }) => startSceneViewer({ spzUrl, sceneId, title, fetchSpz, getConfig }))
      .catch((err) => {
        console.error('[SceneViewer] failed to start:', err)
        showShellError('Viewer failed to load: ' + (err?.message || err))
      })
  }, [])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: VIEWER_STYLE }} />
      <div id="header">
        <h3 id="title">3D Scene</h3>
        <div className="btn-group">
          <button className="btn" id="clearCacheBtn" title="Clear cache & reload (fixes stuck 32%)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 10.5 22 2" /><path d="M14.734 13.841a2 2 0 00-.314-2.42L12.58 9.58a2 2 0 00-2.421-.314l-7.657 4.461A1 1 0 002.3 15.3l6.403 6.403a1 1 0 001.571-.204z" /><path d="m5 18 2-2" /><path d="m7.699 10.7 5.602 5.601" /></svg>
          </button>
          <button className="btn" id="resetBtn" title="Reset camera">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
          </button>
          <button className="btn" id="fullscreenBtn" title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          </button>
        </div>
      </div>

      <div id="viewport" />

      <div id="loading">
        <div className="spinner" />
        <div className="load-info">
          <span id="loadStep">Preparing...</span>
          <div className="progress-bar"><div id="progressFill" className="progress-fill" /></div>
        </div>
      </div>

      <div id="error">
        <div className="msg">
          <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '8px' }}>Failed to load scene</div>
          <div id="errorMsg" style={{ fontSize: '14px', opacity: 0.7 }} />
          <button className="close-btn" onClick={() => window.close()}>Close</button>
        </div>
      </div>

      <div id="hint" className="hidden">Drag to rotate • Scroll to zoom • Right-click to pan</div>

      <script dangerouslySetInnerHTML={{ __html: INLINE_CLEAR_CACHE }} />
    </>
  )
}
