// song / audio file helpers — shared by every platform (drift guard:
// tools/check-shared-twins.mjs). Song files use the SAME hosts as video, so
// the host/link plumbing is shared with the video provider links; this file
// only owns the "is this an audio file" question.
//
// .webm is deliberately NOT here: it is a video container as often as it is
// an audio one, so the mime type has to decide. Everything else below is
// audio-only in practice.

export const AUDIO_FILE_EXTENSIONS = [
  'm4a',
  'mp3',
  'wav',
  'opus',
  'ogg',
  'oga',
  'flac',
  'aac',
  'm4b',
  'weba',
  'aif',
  'aiff',
];

export const AUDIO_MIME_PREFIX = 'audio/';

/**
 * accept attribute fragment for song pickers. The OS file dialog filters on
 * this string, so `audio/*` alone is not enough: a browser reports an .m4a as
 * `audio/mp4` but many pickers only match the mime list, so the extensions
 * have to be listed too. A picker without this fragment silently refuses to
 * select a song, no matter what the drop handler accepts.
 */
export const AUDIO_ACCEPT_ATTRIBUTE = `audio/*,${AUDIO_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')}`;

/**
 * Lowercase extension of a file name, without the dot.
 * @param {string} name
 * @returns {string}
 */
export function getFileExtension(name) {
  const text = String(name || '');
  const dot = text.lastIndexOf('.');
  if (dot < 0 || dot === text.length - 1) return '';
  return text.slice(dot + 1).toLowerCase();
}

/**
 * True when a file name looks like an audio file.
 * @param {string} name
 * @returns {boolean}
 */
export function isAudioFileName(name) {
  return AUDIO_FILE_EXTENSIONS.includes(getFileExtension(name));
}

/**
 * True when a picked File is a song/audio file. The mime type wins; the
 * extension is the fallback for files the browser reports without a type.
 * @param {File|{name?: string, type?: string}} file
 * @returns {boolean}
 */
export function isAudioUploadFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type) {
    if (type.startsWith(AUDIO_MIME_PREFIX)) return true;
    // A typed file that is not audio is not audio, even if the name lies.
    if (type.startsWith('video/') || type.startsWith('image/')) return false;
  }
  return isAudioFileName(file.name);
}

/**
 * True when a stored media item is a song.
 * @param {Object} item
 * @returns {boolean}
 */
export function isAudioMediaItem(item) {
  if (!item) return false;
  if (item.kind === 'audio' || item.isAudio === true) return true;
  if (item.isVideo === true) return false;
  const type = String(item.fileType || '').toLowerCase();
  if (type.startsWith(AUDIO_MIME_PREFIX)) return true;
  return !item.isVideo && isAudioFileName(item.fileName || '');
}
