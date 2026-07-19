import { useState, useEffect } from 'react';
import { getThumbUrl } from '../utils/thumbCache';

export function useThumbUrl(key, remoteUrl) {
  const [url, setUrl] = useState(remoteUrl);

  useEffect(() => {
    if (!key || !remoteUrl) return;
    let cancelled = false;
    getThumbUrl(key, remoteUrl).then((resolved) => {
      if (cancelled) return;
      if (resolved !== remoteUrl) setUrl(resolved);
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
