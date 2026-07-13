import { useState, useEffect } from 'react';
import { getThumbUrl } from '../utils/thumbCache';

export function useThumbUrl(key, remoteUrl) {
  const [url, setUrl] = useState(remoteUrl);

  useEffect(() => {
    if (!key || !remoteUrl) return;
    let cancelled = false;
    getThumbUrl(key, remoteUrl).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [key, remoteUrl]);

  return url;
}
