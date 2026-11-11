// phase-2 shared move — implementations live in imgvault-shared (drift guard: tools/check-shared-twins.mjs).
// song files use the same hosts as video, so the runtime-bound host lookups come
// from the extension catalog layer, not the shared metadata.
export * from 'imgvault-shared/audioProviderLinks.js';
export { getConfiguredAudioUploadServices } from '../config/providerCatalog.js';
