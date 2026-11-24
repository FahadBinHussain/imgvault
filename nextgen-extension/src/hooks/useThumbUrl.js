import { useState, useEffect } from 'react';
import { getThumbUrl } from '../utils/thumbCache';

export function useThumbUrl(key, remoteUrl) {
  // Unresolved until the lookup lands — the <img> MUST NOT start on the
  // remote URL. The remote is often a dead signed URL (a TeraBox thumb
  // dies 8h after upload) while a good cached blob is one lookup away,
  // and an <img> that errors on the dead remote first marks the card
  // failed before the blob swap can land — 2026-11-24, every 11/17-11/22
  // video card fell to the icon tile although all 10 posters sat in the
  // cache. With no src the img renders nothing and cannot error; the
  // resolved URL (blob, or the remote when there is no cache) is the
  // first src the img ever sees, so an error on it is real.
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!key || !remoteUrl) return;
    let cancelled = false;
    getThumbUrl(key, remoteUrl).then((resolved) => {
      if (cancelled) return;
      setUrl(resolved);
      if (window.__IMGVAULT_THUMB_DEBUG) {
        console.log('[thumb]', key, 'remote=', remoteUrl, 'resolved=', resolved);
      }
    }).catch((err) => {
      if (window.__IMGVAULT_THUMB_DEBUG) {
        console.warn('[thumb-err]', key, err);
      }
    });
    return () => { cancelled = true; };
  }, [key, remoteUrl]);

  return url;
}
