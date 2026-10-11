/**
 * Shim (parity phase 3b): the canonical MediaDetailModal lives in packages/ui
 * (pnpm package `imgvault-ui`) and is shared with the web app.
 * Pages keep importing this path — do not add logic here (drift-guarded).
 */
export { MediaDetailModal as default } from 'imgvault-ui';
