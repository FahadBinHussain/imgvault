(() => {
  const RIGHT_CLICK_UNLOCK_HOSTS = [
    'open.spotify.com',
  ];

  const host = window.location.hostname.toLowerCase();
  if (!RIGHT_CLICK_UNLOCK_HOSTS.includes(host)) {
    return;
  }

  const unblockContextMenu = (event) => {
    // Stop page-level right-click blockers, but do not prevent default.
    event.stopImmediatePropagation();
  };

  window.addEventListener('contextmenu', unblockContextMenu, true);
  document.addEventListener('contextmenu', unblockContextMenu, true);
})();
