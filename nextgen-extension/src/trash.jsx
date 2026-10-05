/**
 * @fileoverview Trash Entry Point — redirects to the routed SPA entry
 * @version 2.0.0
 */

const hash = window.location.hash && window.location.hash !== '#'
  ? window.location.hash
  : '#/trash';
window.location.replace(`index.html${window.location.search || ''}${hash}`);

