/**
 * @fileoverview 3D Scene Viewer using THREE.js + @sparkjsdev/spark
 * @version 2.1.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Maximize2, Minimize2, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from './UI';

export default function SceneViewer({ spzUrl, textureUrl, title, isOpen, onClose }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const animFrameRef = useRef(null);
  const sparkRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
    if (controlsRef.current) {
      controlsRef.current.dispose();
      controlsRef.current = null;
    }
    sparkRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen || !spzUrl) return;

    let cancelled = false;

    const init = async () => {
      try {
        setLoading(true);
        setError(null);

        // Dynamic imports
        const THREE = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');

        if (cancelled) return;

        // Setup scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);
        sceneRef.current = scene;

        // Setup camera
        const camera = new THREE.PerspectiveCamera(
          60,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.01,
          1000
        );
        camera.position.set(0, 0, 3);
        cameraRef.current = camera;

        // Setup renderer
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Setup SparkRenderer (required for Spark v2.x)
        const spark = new SparkRenderer({ renderer });
        scene.add(spark);
        sparkRef.current = spark;

        // Setup controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 0.5;
        controls.maxDistance = 50;
        controlsRef.current = controls;

        // Load splat — SPZ files contain their own texture data
        console.log('[SceneViewer] Loading splat from:', spzUrl);
        const splat = new SplatMesh({ url: spzUrl });
        console.log('[SceneViewer] SplatMesh created, waiting for data...');

        if (cancelled) {
          splat.dispose?.();
          return;
        }

        scene.add(splat);
        console.log('[SceneViewer] Splat added to scene, numSplats:', splat.numSplats);

        // Start render loop immediately — Spark needs it running to initialize
        let frameCount = 0;
        const animate = () => {
          if (cancelled) return;
          animFrameRef.current = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
          frameCount++;
          if (frameCount === 1) {
            console.log('[SceneViewer] First frame rendered, numSplats:', splat.numSplats);
          }
        };

        setLoading(false);
        animate();
        console.log('[SceneViewer] Render loop started');
      } catch (err) {
        if (!cancelled) {
          console.error('Scene viewer error:', err);
          setError(err.message || 'Failed to load 3D scene');
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      cleanup();
      // Remove renderer DOM element
      if (containerRef.current) {
        const canvas = containerRef.current.querySelector('canvas');
        if (canvas) {
          try { containerRef.current.removeChild(canvas); } catch {}
        }
      }
    };
  }, [isOpen, spzUrl, textureUrl, cleanup]);

  // Handle resize
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      rendererRef.current.setSize(width, height);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  const resetCamera = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.set(0, 0, 3);
      cameraRef.current.lookAt(0, 0, 0);
    }
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
        <h3 className="text-white font-medium truncate max-w-[70%]">{title || '3D Scene'}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={resetCamera}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Reset camera"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 3D Viewport */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading State */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
            <span>Loading 3D scene...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="flex flex-col items-center gap-3 text-white max-w-md text-center px-4">
            <div className="text-red-400 text-lg font-medium">Failed to load scene</div>
            <div className="text-sm text-white/70">{error}</div>
            <Button variant="ghost" onClick={onClose} className="text-white border-white/30 hover:bg-white/10">
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {!loading && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-lg bg-black/60 text-white/70 text-xs">
          Drag to rotate • Scroll to zoom • Right-click to pan
        </div>
      )}
    </div>
  );
}
