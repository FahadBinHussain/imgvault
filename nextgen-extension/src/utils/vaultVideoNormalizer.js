const NORMALIZE_RE = /\.(avi|mov)$/i;
let conversionQueue = Promise.resolve();

const extensionOf = (name = '') => String(name).match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';

const sendNative = (data) => new Promise((resolve, reject) => chrome.runtime.sendMessage({ action: 'nativeVideoNormalize', data }, (response) => {
  if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
  if (!response?.success) return reject(new Error(response?.error || 'Native video normalizer failed.'));
  resolve(response.data);
}));

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = (encoded) => {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

async function convertVideo(file, report) {
  const sessionId = `vault-video-${crypto.randomUUID()}`;
  const source = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 700 * 1024;
  report?.('Using the native FFmpeg normalizer (all CPU threads; hardware decode when available)...');
  await sendNative({ operation: 'start', sessionId });
  try {
    for (let offset = 0; offset < source.length; offset += chunkSize) {
      await sendNative({ operation: 'chunk', sessionId, data: toBase64(source.subarray(offset, Math.min(offset + chunkSize, source.length))) });
      report?.(`Sending video to native normalizer... ${Math.min(100, Math.round(((offset + chunkSize) / source.length) * 100))}%`);
    }
    report?.(`Converting ${file.name} with native FFmpeg...`);
    const finished = await sendNative({ operation: 'finish', sessionId, fileName: file.name });
    const totalSize = Number(finished.message);
    if (!Number.isFinite(totalSize) || totalSize <= 0) throw new Error('Native FFmpeg returned an invalid output size.');
    const parts = [];
    for (let offset = 0; offset < totalSize; offset += chunkSize) {
      const part = await sendNative({ operation: 'read', sessionId, offset, maxBytes: chunkSize });
      if (!part.stdout) throw new Error('Native FFmpeg returned an empty output chunk.');
      parts.push(fromBase64(part.stdout));
    }
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let cursor = 0;
    for (const part of parts) { output.set(part, cursor); cursor += part.length; }
    report?.(`Converted ${file.name} to MP4 (${(output.length / 1024 / 1024).toFixed(1)} MB).`);
    return new Blob([output], { type: 'video/mp4' });
  } finally {
    await sendNative({ operation: 'cleanup', sessionId }).catch(() => {});
  }
}

export function needsVaultVideoNormalization(file) {
  return Boolean(file?.name && NORMALIZE_RE.test(file.name));
}

export function normalizeVaultVideo(file, report) {
  if (!needsVaultVideoNormalization(file)) return Promise.resolve({ blob: file, fileName: file?.name || 'video.mp4', fileType: file?.type || 'video/mp4', normalizedFrom: '' });
  const job = conversionQueue.then(async () => ({
    blob: await convertVideo(file, report),
    fileName: `${String(file.name).replace(/\.[^.]+$/, '')}.mp4`,
    fileType: 'video/mp4',
    normalizedFrom: file.name,
  }));
  conversionQueue = job.catch(() => {});
  return job.catch((error) => {
    throw new Error(`Could not normalize ${file.name} for the Secret Vault: ${error.message || String(error)}`);
  });
}
