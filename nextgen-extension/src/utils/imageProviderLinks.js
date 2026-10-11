// phase-2 shared move — implementations live in imgvault-shared (drift guard: tools/check-shared-twins.mjs).
// runtime-bound lookups come from the extension catalog layer, not the shared metadata.
export * from 'imgvault-shared/imageProviderLinks.js';
export { getImageUploadService, getImageProviderLabel } from '../config/providerCatalog.js';
