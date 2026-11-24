/**
 * Bound a promise that might never settle.
 *
 * Some awaits in the extension have no timeout of their own — an IndexedDB
 * open with no onblocked handler, a sendMessage the worker never answers —
 * and a `try/catch` only helps on rejection, never on a hang. Wrapping the
 * await in withTimeout turns a hang into a loud, nameable rejection the
 * caller can warn about and continue from.
 *
 * The message format matches the pre-existing local copies (GalleryPage's
 * upload-run close, imageSnapshot's decode) so log lines stay identical.
 */
export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = ms;
  }
}

/**
 * Race `promise` against a timer. Resolves/rejects with the promise's own
 * outcome when it settles first; rejects with a TimeoutError naming `label`
 * when the timer wins. The timer is always cleared on settle.
 * @param {Promise|*} promise
 * @param {number} ms
 * @param {string} [label='operation']
 * @returns {Promise}
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
