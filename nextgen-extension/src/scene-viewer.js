import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const params = new URLSearchParams(window.location.search);
const spzUrl = params.get('url');
const sceneId = params.get('id');
const title = params.get('title') || '3D Scene';

document.getElementById('title').textContent = title;
document.title = `${title} - ImgVault`;

function setProgress(pct, msg) {
  const fill = document.getElementById('progressFill');
  const step = document.getElementById('loadStep');
  if (fill) fill.style.width = pct + '%';
  if (step) step.textContent = msg;
}

if (!spzUrl && !sceneId) {
  showError('No scene URL or ID provided');
  throw new Error('No scene URL or ID');
}

try {
  setProgress(5, 'Initializing renderer...');

  const viewport = document.getElementById('viewport');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf9f9fb);

  const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewport.appendChild(renderer.domElement);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  scene.add(new THREE.AmbientLight(0xf9f9fb, 3.92));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.1);
  d1.position.set(4, 3, -4);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 1.1);
  d2.position.set(0, 3, 0);
  scene.add(d2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);

  const ORBIT_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'q', 'e', '+', '=', '-', '_']);
  const ORBIT_SPEED = 0.025;
  const ZOOM_SPEED = 0.05;
  const pressedKeys = new Set();
  const keyOffset = new THREE.Vector3();
  const keySpherical = new THREE.Spherical();

  function applyKeyboardControls() {
    if (pressedKeys.size === 0) return;

    keyOffset.copy(camera.position).sub(controls.target);
    keySpherical.setFromVector3(keyOffset);

    if (pressedKeys.has('arrowleft') || pressedKeys.has('a')) keySpherical.theta -= ORBIT_SPEED;
    if (pressedKeys.has('arrowright') || pressedKeys.has('d')) keySpherical.theta += ORBIT_SPEED;
    if (pressedKeys.has('arrowup') || pressedKeys.has('w')) keySpherical.phi -= ORBIT_SPEED;
    if (pressedKeys.has('arrowdown') || pressedKeys.has('s')) keySpherical.phi += ORBIT_SPEED;
    if (pressedKeys.has('q') || pressedKeys.has('+') || pressedKeys.has('=')) keySpherical.radius -= ZOOM_SPEED;
    if (pressedKeys.has('e') || pressedKeys.has('-') || pressedKeys.has('_')) keySpherical.radius += ZOOM_SPEED;

    keySpherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, keySpherical.phi));
    keySpherical.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, keySpherical.radius));

    camera.position.copy(controls.target).add(keyOffset.setFromSpherical(keySpherical));
    camera.lookAt(controls.target);
  }

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      controls.reset();
      return;
    }
    if (key === 'f') {
      event.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        document.documentElement.requestFullscreen?.();
      }
      return;
    }
    if (!ORBIT_KEYS.has(key)) return;
    event.preventDefault();
    pressedKeys.add(key);
  });

  window.addEventListener('keyup', (event) => {
    pressedKeys.delete(event.key.toLowerCase());
  });

  window.addEventListener('blur', () => pressedKeys.clear());

  renderer.setAnimationLoop(() => {
    applyKeyboardControls();
    controls.update();
    renderer.render(scene, camera);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setProgress(15, 'Fetching scene data...');

  // Viewer-level IndexedDB cache — avoids slow chrome.runtime.sendMessage round-trip on reload
  function openViewerCache() {
    return new Promise((resolve) => {
      const req = indexedDB.open('imgvault-scene-viewer-cache', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function getCachedBlob(id) {
    const db = await openViewerCache();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  }

  async function setCachedBlob(id, spzBuffer, configJson) {
    const db = await openViewerCache();
    if (!db) return;
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put({ spzBuffer, configJson, ts: Date.now() }, id);
    tx.oncomplete = () => db.close();
  }

  async function clearViewerCache(id) {
    const db = await openViewerCache();
    if (!db) return;
    const tx = db.transaction('blobs', 'readwrite');
    if (id) tx.objectStore('blobs').delete(id);
    else tx.objectStore('blobs').clear();
    await new Promise((res) => { tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => { db.close(); res(); }; });
  }

  // Clear-cache button — one click unsticks old scenes (2.12.62)
  document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
    if (!confirm('Clear cached scene file and reload? Fixes stuck Loading.')) return;
    try { await clearViewerCache(sceneId); } catch {}
    location.reload();
  });

  let spzBytes, configJson;

  const isHtmlBuffer = (buf) => {
    try {
      const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 200)).trimStart();
      return head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<');
    } catch { return false; }
  };
  const cached = await getCachedBlob(sceneId);
  let useCache = false;
  if (cached) {
    const tooSmall = !cached.spzBuffer || cached.spzBuffer.byteLength < 1024;
    const isHtml = cached.spzBuffer && isHtmlBuffer(cached.spzBuffer);
    if (tooSmall || isHtml) {
      console.warn('[Viewer] Cached blob invalid — clearing', cached.spzBuffer?.byteLength, isHtml ? 'HTML' : 'small');
      await clearViewerCache(sceneId);
    } else {
      console.log('[Viewer] Cache hit —', cached.spzBuffer.byteLength, 'bytes');
      setProgress(25, 'Loaded from cache');
      spzBytes = cached.spzBuffer;
      configJson = cached.configJson;
      useCache = true;
    }
  }
  if (useCache) {
    // A null config cached from an earlier open (uploaded before config saved,
    // or a failed fetch) must not stick forever — always refetch fresh config
    // and prefer it when present.
    try {
      const cfgResp = await chrome.runtime.sendMessage({ action: 'getSceneConfig', mediaId: sceneId });
      if (cfgResp?.success && cfgResp.data) {
        configJson = cfgResp.data;
        setCachedBlob(sceneId, spzBytes, configJson);
      }
    } catch {}
  } else {
    // Try direct fetch via getSceneDirectUrl to bypass 64MiB sendMessage limit for large spz
    let directUrl = spzUrl;
    try {
      const urlResp = await chrome.runtime.sendMessage({ action: 'getSceneDirectUrl', mediaId: sceneId, url: spzUrl });
      if (urlResp?.success && urlResp.data) directUrl = urlResp.data;
    } catch {}
    let fetchedViaDirect = false;
    try {
      if (directUrl) {
        const resp = await fetch(directUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (isHtmlBuffer(buf)) throw new Error('Direct fetch returned HTML (stale token)');
        spzBytes = buf;
        fetchedViaDirect = true;
        try {
          const cfgResp = await chrome.runtime.sendMessage({ action: 'getSceneConfig', mediaId: sceneId });
          if (cfgResp?.success && cfgResp.data) configJson = cfgResp.data;
        } catch {}
      }
    } catch (e) {
      console.warn('[Viewer] Direct fetch failed, falling back to background fetchFile', e.message);
    }
    if (!fetchedViaDirect) {
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
      setProgress(40, 'Processing splat file...');
      if (fileResponse.data.spzBuffer) {
        spzBytes = new Uint8Array(fileResponse.data.spzBuffer).buffer;
      } else {
        spzBytes = new Uint8Array(fileResponse.data.buffer).buffer;
      }
      if (isHtmlBuffer(spzBytes)) {
        await clearViewerCache(sceneId);
        throw new Error('Background fetch returned HTML (stale token) — cache cleared, reload to retry with fresh URL.');
      }
      configJson = fileResponse.data.configJson || null;
    } else {
      setProgress(40, 'Processing splat file...');
    }

    // Cache for instant reload
    setCachedBlob(sceneId, spzBytes, configJson);
  }
  console.log('[Viewer] configJson:', JSON.stringify(configJson));

  // Apply config matching worldlabs.ai rendering pipeline
  const splatGroup = new THREE.Group();

  // Support both flat worldlabs format and nested structured format
  const rawPos = configJson?.position || configJson?.scene?.position || null;
  if (rawPos) {
    splatGroup.position.set(rawPos[0] || 0, rawPos[1] || 0, rawPos[2] || 0);
  }

  // No flip unless the config says so — the PI default was a worldlabs.ai
  // homepage convention, wrong for Marble-app worlds (rendered untransformed).
  const rawRot = configJson?.rotation || configJson?.scene?.rotation || [0, 0, 0];
  splatGroup.rotation.set(rawRot[0] || 0, rawRot[1] || 0, rawRot[2] || 0);

  // Optional per-scene scale (absent = 4.5 legacy default, which the
  // showcase configs were framed against — they set radius but no scale).
  // Radius-less scenes auto-fit instead, so the default never matters there.
  const rawScale = Number.isFinite(+configJson?.scale) ? +configJson.scale : 4.5;
  splatGroup.scale.setScalar(rawScale);
  const rawFov = Number.isFinite(+configJson?.fov) ? +configJson.fov : 90;
  if (camera.fov !== rawFov) {
    camera.fov = rawFov;
    camera.updateProjectionMatrix();
  }

  const hasExplicitRadius = Boolean(configJson?.cameraRadius || configJson?.controls?.camera_radius || configJson?.camera?.position?.[2]);
  const rawCamR = configJson?.cameraRadius || configJson?.controls?.camera_radius || configJson?.camera?.position?.[2] || 5;
  camera.position.set(0, 0, rawCamR);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
  // Home view for the reset button — overwritten by auto-fit below when set.
  let homePos = camera.position.clone();
  let homeTarget = controls.target.clone();

  setProgress(60, 'Loading Gaussian Splat...');

  let loadPct = 60;
  const progressTimer = setInterval(() => {
    if (loadPct < 92) {
      loadPct += 1;
      setProgress(loadPct, `Loading splat ${loadPct - 60}%...`);
    }
  }, 200);

  const splat = new SplatMesh({
    fileBytes: spzBytes,
    onLoad: (mesh) => {
      clearInterval(progressTimer);
      // No explicit radius in config: frame the splat itself instead of
      // guessing a distance. Explicit radius always wins (showcase parity).
      if (!hasExplicitRadius) {
        try {
          const box = new THREE.Box3().setFromObject(splat);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
            const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
            const dir = camera.position.clone().sub(sphere.center);
            if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
            dir.normalize();
            controls.target.copy(sphere.center);
            camera.position.copy(sphere.center).addScaledVector(dir, dist);
            camera.lookAt(sphere.center);
            controls.update();
            homePos = camera.position.clone();
            homeTarget = controls.target.clone();
            console.log('[Viewer] auto-fit: radius', sphere.radius.toFixed(2), 'dist', dist.toFixed(2));
          }
        } catch (e) {
          console.warn('[Viewer] auto-fit failed:', e?.message || e);
        }
      }
      setProgress(100, `Ready — ${mesh.numSplats.toLocaleString()} splats`);
      setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('hint').classList.remove('hidden');
      }, 400);
    },
    onError: async (err) => {
      clearInterval(progressTimer);
      console.error('[Viewer] SplatMesh error:', err);
      try { await clearViewerCache(sceneId); } catch {}
      showError('Failed to load splat: ' + (err?.message || err) + ' — cache cleared, close and reopen to retry with fresh URL.');
    }
  });
  splatGroup.add(splat);
  scene.add(splatGroup);

  document.getElementById('resetBtn').addEventListener('click', () => {
    camera.position.copy(homePos);
    controls.target.copy(homeTarget);
    camera.lookAt(homeTarget);
    controls.update();
  });

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });
} catch (err) {
  console.error('[Viewer] Error:', err);
  showError(err.message || 'Failed to initialize viewer');
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('visible');
}
