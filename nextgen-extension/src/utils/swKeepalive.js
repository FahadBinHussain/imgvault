/**
 * Keep the MV3 service worker alive while a long-running message is in
 * flight. Chrome terminates the SW after ~30s idle / 5min runtime, which
 * closes the message channel and fails the sendMessage promise with
 * "listener ... message channel closed". The page holds a port open and
 * pings it periodically so the SW stays alive until the operation settles.
 * @param {Function} task async function that uses chrome.runtime.sendMessage
 * @returns {Promise<*>} task result
 */
export async function withServiceWorkerKeepalive(task) {
  let port = null;
  let timer = null;
  try {
    port = chrome.runtime.connect({ name: 'swKeepalive' });
    timer = setInterval(() => {
      try {
        port.postMessage({ type: 'ping' });
      } catch (_) {
        // Port already disconnected; the next check will surface the error.
      }
    }, 20000);
    return await task();
  } finally {
    if (timer) clearInterval(timer);
    if (port) {
      try {
        port.disconnect();
      } catch (_) {
        // Already disconnected.
      }
    }
  }
}
