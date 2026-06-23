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

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setProgress(15, 'Fetching scene data...');
  const fileResponse = await chrome.runtime.sendMessage({
    action: 'fetchFile',
    mediaId: sceneId,
    url: spzUrl,
  });
  if (!fileResponse?.success) throw new Error(`Failed to fetch .spz: ${fileResponse?.error || 'unknown error'}`);

  setProgress(40, 'Processing splat file...');
  let spzBytes;
  if (fileResponse.data.spzBuffer) {
    spzBytes = new Uint8Array(fileResponse.data.spzBuffer).buffer;
  } else {
    spzBytes = new Uint8Array(fileResponse.data.buffer).buffer;
  }

  const configJson = fileResponse.data.configJson || null;
  console.log('[Viewer] configJson from background:', JSON.stringify(configJson));

  // Apply config matching worldlabs.ai rendering pipeline
  const splatGroup = new THREE.Group();

  // Support both flat worldlabs format and nested structured format
  const rawPos = configJson?.position || configJson?.scene?.position || null;
  if (rawPos) {
    splatGroup.position.set(rawPos[0] || 0, rawPos[1] || 0, rawPos[2] || 0);
  }

  const rawRot = configJson?.rotation || configJson?.scene?.rotation || [Math.PI, 0, 0];
  splatGroup.rotation.set(rawRot[0] || 0, rawRot[1] || 0, rawRot[2] || 0);

  splatGroup.scale.setScalar(4.5);

  const rawCamR = configJson?.cameraRadius || configJson?.controls?.camera_radius || configJson?.camera?.position?.[2];
  camera.position.set(0, 0, rawCamR);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();

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
      setProgress(100, `Ready — ${mesh.numSplats.toLocaleString()} splats`);
      setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('hint').classList.remove('hidden');
      }, 400);
    },
    onError: (err) => {
      clearInterval(progressTimer);
      console.error('[Viewer] SplatMesh error:', err);
      showError('Failed to load splat: ' + (err?.message || err));
    }
  });
  splatGroup.add(splat);
  scene.add(splatGroup);

  document.getElementById('resetBtn').addEventListener('click', () => {
    camera.position.set(0, 0, rawCamR);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
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
