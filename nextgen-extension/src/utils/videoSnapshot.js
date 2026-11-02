// Lightweight single-frame video snapshot extractor (at upload time)
// 0 background daemons, ~0 MB idle RAM footprint.
// Runs offscreen <video> + <canvas> to extract a compact ~25KB JPEG blob.

const SNAPSHOT_WIDTH = 640;
const SNAPSHOT_QUALITY = 0.8;

function waitForEvent(target, name, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      target.removeEventListener(name, onEvent);
      target.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = (e) => {
      cleanup();
      reject(new Error(`Failed waiting for ${name}: ${e?.message || 'media error'}`));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${name} after ${timeoutMs}ms`));
    }, timeoutMs);
    target.addEventListener(name, onEvent);
    target.addEventListener('error', onError);
  });
}

function releaseVideo(video) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // detached element
  }
}

/**
 * Capture a 1-frame snapshot from a video Blob or File.
 * @param {Blob|File} videoBlob - The video file to snapshot
 * @param {number} [targetSeconds=1.0] - Desired timestamp to capture
 * @returns {Promise<Blob>} JPEG Blob of the video frame
 */
export async function captureVideoSnapshotBlob(videoBlob, targetSeconds = 1.0) {
  if (!(videoBlob instanceof Blob)) {
    throw new Error('captureVideoSnapshotBlob: expected a Blob or File instance');
  }

  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    video.src = url;
    await waitForEvent(video, 'loadedmetadata', 8000);

    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1.0;
    // Seek to targetSeconds, but keep within bounds (e.g. 10% for ultra-short clips)
    const seekTime = Math.min(targetSeconds, dur > 1 ? dur * 0.1 : 0);
    if (seekTime > 0) {
      video.currentTime = seekTime;
      await waitForEvent(video, 'seeked', 5000).catch(() => {});
    }

    const vw = video.videoWidth || SNAPSHOT_WIDTH;
    const vh = video.videoHeight || Math.round((SNAPSHOT_WIDTH * 9) / 16);
    const scale = Math.min(1, SNAPSHOT_WIDTH / vw);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas snapshot encode failed'));
      }, 'image/jpeg', SNAPSHOT_QUALITY);
    });
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}
