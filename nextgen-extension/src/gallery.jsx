/**
 * @fileoverview Gallery Entry Point — redirects to the routed SPA entry
 * @version 2.0.0
 */

const hash = window.location.hash && window.location.hash !== '#'
  ? window.location.hash
  : '#/gallery';
window.location.replace(`index.html${window.location.search || ''}${hash}`);

