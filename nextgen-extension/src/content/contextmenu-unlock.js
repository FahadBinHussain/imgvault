(() => {
  const RIGHT_CLICK_UNLOCK_HOSTS = [
    'open.spotify.com',
    'www.instagram.com',
    'instagram.com',
  ];

  const host = window.location.hostname.toLowerCase();
  if (!RIGHT_CLICK_UNLOCK_HOSTS.includes(host)) {
    return;
  }

  const getImageUrl = (img) =>
    img?.currentSrc || img?.src || img?.getAttribute?.('src') || '';

  const resolveImageFromElement = (element) => {
    if (!element) return '';

    if (element.tagName === 'IMG') {
      return getImageUrl(element);
    }

    if (typeof element.closest === 'function') {
      const closestImg = element.closest('img');
      if (closestImg) {
        return getImageUrl(closestImg);
      }

      const instagramMediaContainer = element.closest('._aagv, ._aagu, li[tabindex="-1"]');
      if (instagramMediaContainer?.querySelector) {
        const nestedInstagramImg = instagramMediaContainer.querySelector('img');
        if (nestedInstagramImg) {
          return getImageUrl(nestedInstagramImg);
        }
      }
    }

    if (typeof element.querySelector === 'function') {
      const nestedImg = element.querySelector('img');
      if (nestedImg) {
        return getImageUrl(nestedImg);
      }
    }

    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      if (parent.tagName === 'IMG') {
        return getImageUrl(parent);
      }

      if (typeof parent.querySelector === 'function') {
        const nestedImg = parent.querySelector('img');
        if (nestedImg) {
          return getImageUrl(nestedImg);
        }
      }

      parent = parent.parentElement;
      depth++;
    }

    return '';
  };

  const unblockContextMenu = (event) => {
    const imageUrl = resolveImageFromElement(event.target);
    if (imageUrl) {
      chrome.storage.local.set({
        lastRightClickImageUrl: imageUrl,
        lastRightClickTimestamp: Date.now(),
      });
      console.log('[ImgVault][Unlock] Stored right-click media URL', imageUrl.substring(0, 200));
    } else {
      console.log('[ImgVault][Unlock] No wrapped media URL resolved for right-click target');
    }

    // Stop page-level right-click blockers, but do not prevent default.
    event.stopImmediatePropagation();
  };

  window.addEventListener('contextmenu', unblockContextMenu, true);
  document.addEventListener('contextmenu', unblockContextMenu, true);
})();
