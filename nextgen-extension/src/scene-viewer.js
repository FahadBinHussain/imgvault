import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const params = new URLSearchParams(window.location.search);
const spzUrl = params.get('url');
const sceneId = params.get('id');
const title = params.get('title') || '3D Scene';

document.getElementById('title').textContent = title;
document.title = `${title} - ImgVault`;

if (!spzUrl && !sceneId) {
  showError('No scene URL or ID provided');
  throw new Error('No scene URL or ID');
}

try {
  console.log('[Viewer] Starting...');
  console.log('[Viewer] SPZ URL:', spzUrl);

  const viewport = document.getElementById('viewport');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewport.appendChild(renderer.domElement);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  console.log('[Viewer] SparkRenderer added');

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;

  // Fetch .spz bytes via background script (cache-first, no CORS restrictions)
  console.log('[Viewer] Requesting .spz bytes from background...', { sceneId, spzUrl });
  const fileResponse = await chrome.runtime.sendMessage({
    action: 'fetchFile',
    mediaId: sceneId,
    url: spzUrl,
  });
  if (!fileResponse?.success) throw new Error(`Failed to fetch .spz: ${fileResponse?.error || 'unknown error'}`);

  let spzBytes;
  if (fileResponse.data.spzBuffer) {
    // From IndexedDB cache (new upload path)
    spzBytes = new Uint8Array(fileResponse.data.spzBuffer).buffer;
    console.log('[Viewer] Loaded from cache:', spzBytes.byteLength, 'bytes');
  } else {
    // Fallback from URL fetch
    spzBytes = new Uint8Array(fileResponse.data.buffer).buffer;
    console.log('[Viewer] Fetched from URL:', spzBytes.byteLength, 'bytes');
  }

  const splat = new SplatMesh({
    fileBytes: spzBytes,
    onLoad: (mesh) => {
      console.log('[Viewer] onLoad fired, numSplats:', mesh.numSplats);
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('hint').classList.remove('hidden');
    },
    onError: (err) => {
      console.error('[Viewer] SplatMesh error:', err);
      showError('Failed to load splat: ' + (err?.message || err));
    }
  });
  scene.add(splat);
  console.log('[Viewer] SplatMesh created, initial numSplats:', splat.numSplats);

  let frameCount = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    frameCount++;
    if (frameCount === 1) console.log('[Viewer] First frame, numSplats:', splat.numSplats);
    if (frameCount % 60 === 0) console.log('[Viewer] frame', frameCount, 'numSplats:', splat.numSplats);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    controls.reset();
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
