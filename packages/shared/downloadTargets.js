import { getStrictImageProviderLink, getImageProviderLabel } from './imageProviderLinks.js';
import { getStrictVideoProviderLink, getVideoProviderLabel } from './videoProviderLinks.js';
import { getMediaItemKind } from './mediaFieldRegistry.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const pickText = (...values) => {
  const found = values.find(hasText);
  return found ? found.trim() : '';
};

const parseObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

export function getDownloadItemTitle(item = {}) {
  const title = pickText(item.pageTitle, item.fileName);
  return title || 'untitled';
}

/**
 * Resolve the file URL a download should fetch — STRICT per the settings
 * source (same rule as playback/posters: defaultGallerySource /
 * defaultVideoSource, never a cross-host fallback chain). Scenes use their
 * stored spzUrl (single-host truth); links have no file at all.
 *
 * Throws a loud, item-naming Error when nothing is downloadable — callers
 * surface it per item, never skip silently.
 *
 * @param {Object} item
 * @param {{imageSource?: string, videoSource?: string}} prefs settings sources
 * @returns {{url: string, sourceKey: string, sourceLabel: string, kind: string, title: string}}
 */
export function getDownloadTarget(item = {}, { imageSource = '', videoSource = '' } = {}) {
  const kind = getMediaItemKind(item);
  const title = getDownloadItemTitle(item);

  if (kind === 'image') {
    const label = getImageProviderLabel(imageSource);
    const url = getStrictImageProviderLink(item, imageSource, 'url');
    if (!hasText(url)) {
      throw new Error(`"${title}": no ${label} URL stored (default image source: ${label}) - nothing to download.`);
    }
    return { url, sourceKey: imageSource, sourceLabel: label, kind, title };
  }

  if (kind === 'video') {
    const label = getVideoProviderLabel(videoSource);
    const url = getStrictVideoProviderLink(item, videoSource, 'watchUrl');
    if (!hasText(url)) {
      throw new Error(`"${title}": no ${label} URL stored (default video source: ${label}) - nothing to download.`);
    }
    return { url, sourceKey: videoSource, sourceLabel: label, kind, title };
  }

  if (kind === 'scene') {
    const extra = parseObject(item.extraMetadata);
    const url = pickText(item.spzUrl, extra.spzUrl);
    if (!hasText(url)) {
      throw new Error(`"${title}": no 3D scene file URL stored - nothing to download.`);
    }
    return { url, sourceKey: '', sourceLabel: '3D scene', kind, title };
  }

  throw new Error(`"${title}": link items have no file - open the link instead of downloading it.`);
}

/** HTML means we hit a provider download/watch PAGE, not file bytes. */
export function isHtmlContentType(contentType = '') {
  return String(contentType || '').toLowerCase().includes('text/html');
}

// URL-path extensions worth trusting for a saved filename; anything else
// (php, html, no extension - signed CDN paths) falls through to the
// response content-type, then the kind default.
const KNOWN_URL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg',
  'mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ts',
  'json', 'spz', 'bin', 'zip', 'pdf', 'glb', 'gltf',
]);

const CONTENT_TYPE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'application/json': 'json',
  'application/zip': 'zip',
};

const KIND_DEFAULT_EXTENSIONS = {
  image: 'jpg',
  video: 'mp4',
  scene: 'spz',
  link: 'url',
};

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = match ? match[1].toLowerCase() : '';
    return KNOWN_URL_EXTENSIONS.has(ext) ? ext : '';
  } catch (_) {
    return '';
  }
}

function sanitizeFileNameBase(value) {
  // char-by-char: no regex char classes, so no raw control chars can ever
  // end up in this source (they silently truncated this file once).
  let cleaned = '';
  for (const ch of String(value || '')) {
    const code = ch.codePointAt(0);
    if (code < 32 || FORBIDDEN_FILENAME_CHARS.has(ch)) {
      cleaned += '-';
    } else {
      cleaned += ch;
    }
  }
  cleaned = cleaned
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'download';
}

/**
 * Filename for a download: sanitized item title + an extension resolved
 * URL path -> response content-type -> kind default (first that yields one).
 * Keeps an extension the title already carries instead of doubling it.
 */
export function getDownloadFileName(item = {}, url = '', contentType = '') {
  const base = sanitizeFileNameBase(getDownloadItemTitle(item));
  const kind = getMediaItemKind(item);
  const typeKey = String(contentType || '').split(';')[0].trim().toLowerCase();
  // title already carries a known extension (e.g. "clip.mp4") -> keep it.
  const baseExtMatch = base.match(/\.([A-Za-z0-9]{2,5})$/);
  if (baseExtMatch && KNOWN_URL_EXTENSIONS.has(baseExtMatch[1].toLowerCase())) return base;
  const ext =
    extensionFromUrl(url) ||
    CONTENT_TYPE_EXTENSIONS[typeKey] ||
    KIND_DEFAULT_EXTENSIONS[kind] ||
    'bin';
  return base + '.' + ext;
}
