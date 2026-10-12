// Scene viewer page entry (extension host) — rendering moved to the shared
// imgvault-scene-viewer package (parity phase 4 chunk 3). This file only owns the
// extension data layer: fresh direct URL + background fetchFile fallback for the
// .spz bytes, getSceneConfig for the render config.
import { startSceneViewer } from 'imgvault-scene-viewer';

const params = new URLSearchParams(window.location.search);
const spzUrl = params.get('url');
const sceneId = params.get('id');
const title = params.get('title') || '3D Scene';

const isHtmlBuffer = (buf) => {
  try {
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 200)).trimStart();
    return head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<');
  } catch { return false; }
};

async function fetchSpz() {
  // Try direct fetch via getSceneDirectUrl to bypass 64MiB sendMessage limit for large spz
  let directUrl = spzUrl;
  try {
    const urlResp = await chrome.runtime.sendMessage({ action: 'getSceneDirectUrl', mediaId: sceneId, url: spzUrl });
    if (urlResp?.success && urlResp.data) directUrl = urlResp.data;
  } catch {}
  try {
    if (directUrl) {
      const resp = await fetch(directUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (isHtmlBuffer(buf)) throw new Error('Direct fetch returned HTML (stale token)');
      return buf;
    }
  } catch (e) {
    console.warn('[Viewer] Direct fetch failed, falling back to background fetchFile', e.message);
  }
  const fileResponse = await chrome.runtime.sendMessage({
    action: 'fetchFile',
    mediaId: sceneId,
    url: spzUrl,
  });
  if (!fileResponse?.success) {
    const err = fileResponse?.error || 'unknown error';
    const is404 = err.includes('404');
    const isExpired = is404 || err.includes('expir') || err.includes('deleted');
    const msg = isExpired
      ? 'Scene file expired or was removed from storage. Try re-uploading from the original source, or clear the browser cache if it was recently uploaded.'
      : `Failed to fetch .spz: ${err}`;
    throw new Error(msg);
  }
  if (fileResponse.data.spzBuffer) {
    return new Uint8Array(fileResponse.data.spzBuffer).buffer;
  }
  return new Uint8Array(fileResponse.data.buffer).buffer;
}

async function getConfig() {
  // Failure policy of this host: config is optional render metadata, keep the
  // established swallow-to-null behavior (mirrors the pre-extraction viewer).
  try {
    const cfgResp = await chrome.runtime.sendMessage({ action: 'getSceneConfig', mediaId: sceneId });
    if (cfgResp?.success && cfgResp.data) return cfgResp.data;
  } catch {}
  return null;
}

startSceneViewer({ spzUrl, sceneId, title, fetchSpz, getConfig }).catch((err) => {
  console.error('[Viewer]', err);
});
