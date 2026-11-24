/**
 * Serialized client upload-log appender.
 *
 * The upload log lives in chrome.storage.local as one `uploadStatusLogs`
 * array, and appending is a read-modify-write: get the list, prepend the
 * entry, set it back. The progress handlers fire-and-forget their appends,
 * so two appends in the same tick used to read the SAME list and the
 * second set clobbered the first — a line vanished with no trace (2.19.36:
 * the 100% line of a 128 MB vault upload was lost this way, leaving the
 * log to end at "saved" with no completion in sight).
 *
 * Every append returned here runs through one promise chain: an append
 * starts only after the previous one finished its read-modify-write, so
 * concurrent callers cannot lose each other's lines. A failed append does
 * not poison the chain — the caller still sees its own rejection, but the
 * next append runs normally.
 */
export const UPLOAD_LOG_MAX_ENTRIES = 200;

/**
 * @param {{get: (keys: string[]) => Promise<Object>, set: (items: Object) => Promise<void>}} storage
 *   chrome.storage.local in the page; a fake in tests.
 * @returns {(message: string, type?: string) => Promise<void>}
 */
export function createUploadLogAppender(storage) {
  let chain = Promise.resolve();
  const write = async (message, type) => {
    const result = await storage.get(['uploadStatusLogs']);
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };
    const nextLogs = [entry, ...(result.uploadStatusLogs || [])].slice(0, UPLOAD_LOG_MAX_ENTRIES);
    await storage.set({ uploadStatusLogs: nextLogs });
  };
  return (message, type = 'info') => {
    const run = chain.then(() => write(message, type));
    // The chain itself never rejects: a failed append must not kill every
    // later append. The caller still gets its own rejection via `run`.
    chain = run.catch(() => {});
    return run;
  };
}
