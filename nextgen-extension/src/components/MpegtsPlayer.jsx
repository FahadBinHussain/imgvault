import React, { useEffect, useRef } from 'react';
import mpegts from 'mpegts.js';

/**
 * MPEG-TS player built on mpegts.js. Chrome's native <video> can't decode
 * MPEG-TS containers (H.264/AAC in .ts / mkv-ish streams), so any modal video
 * whose source URL probes as TS renders this instead. Feeds the stream into a
 * <video> element through MSE, so seek/controls still work.
 */
export default function MpegtsPlayer({ src, className = '', autoPlay = true }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (!mpegts.isSupported()) return;

    const player = mpegts.createPlayer(
      {
        type: 'mpegts',
        isLive: false,
        url: src,
      },
      {
        enableWorker: true,
        liveBufferLatencyChasing: false,
        autoCleanupSourceBuffer: true,
      }
    );
    playerRef.current = player;
    player.attachMediaElement(video);
    player.load();

    let cancelled = false;
    const tryPlay = () => {
      if (!cancelled && autoPlay) {
        player.play().catch(() => {});
      }
    };
    video.addEventListener('loadeddata', tryPlay);

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', tryPlay);
      try { player.destroy(); } catch (_) {}
      playerRef.current = null;
    };
  }, [src, autoPlay]);

  return (
    <video
      ref={videoRef}
      className={className}
      controls
      playsInline
      autoPlay={autoPlay}
      preload="auto"
    />
  );
}
