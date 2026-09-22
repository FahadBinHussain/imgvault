import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js?url';
import wasmURL from '../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url';
import classWorkerURL from '@ffmpeg/ffmpeg/worker?worker&url';

const NORMALIZE_RE = /\.(avi|mov)$/i;
let ffmpegInstance = null;
let ffmpegLoadPromise = null;
let conversionQueue = Promise.resolve();

const extensionOf = (name = '') => String(name).match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';

function loadWithTimeout(ffmpeg, timeoutMs = 120000) {
  let timer;
  const loadPromise = ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`FFmpeg initialization timed out after ${timeoutMs / 1000} seconds.`)), timeoutMs);
  });
  return Promise.race([loadPromise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function getFFmpeg(report) {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      report?.('Loading the local video normalizer (first use downloads the bundled engine)...');
      const ffmpeg = new FFmpeg();
      await loadWithTimeout(ffmpeg);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((error) => {
      ffmpegLoadPromise = null;
      throw new Error(`Video normalizer failed to load: ${error.message || String(error)}`);
    });
  }
  return ffmpegLoadPromise;
}

async function convertVideo(file, report) {
  const ffmpeg = await getFFmpeg(report);
  const ext = extensionOf(file.name) || 'video';
  const inputName = `vault-input.${ext}`;
  const outputName = 'vault-output.mp4';

  report?.(`Converting ${file.name} to vault-safe MP4...`);
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '12',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-movflags', '+faststart',
      outputName,
    ]);
    const output = await ffmpeg.readFile(outputName);
    if (!output?.length) throw new Error('FFmpeg returned an empty MP4.');
    report?.(`Converted ${file.name} to MP4 (${(output.length / 1024 / 1024).toFixed(1)} MB).`);
    return new Blob([output.slice().buffer], { type: 'video/mp4' });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
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
