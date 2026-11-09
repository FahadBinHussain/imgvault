// unit tests for Suno download resolution & host detection
//
// run: node test-suno-download-target.mjs
//
import {
  isSunoHost,
  isSunoUrl,
  extractSunoSongId,
  resolveSunoDownloadTarget,
} from './src/utils/sunoApi.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// --- host detection ---
check('suno.com is suno host', isSunoHost('suno.com'));
check('www.suno.com is suno host', isSunoHost('www.suno.com'));
check('app.suno.com is suno host', isSunoHost('app.suno.com'));
check('suno.ai is suno host', isSunoHost('suno.ai'));
check('cdn1.suno.ai is suno host', isSunoHost('cdn1.suno.ai'));
check('youtube.com is not suno', !isSunoHost('youtube.com'));
check('empty host is not suno', !isSunoHost(''));

// --- song id extraction ---
const sampleUuid = '41f6d542-1a2b-496f-9bce-f2b6c9907683';
check('extracts from /song/<uuid>', extractSunoSongId(`https://suno.com/song/${sampleUuid}`) === sampleUuid);
check('extracts from /song/<uuid>/ with trailing slash', extractSunoSongId(`https://suno.com/song/${sampleUuid}/`) === sampleUuid);
check('extracts from /s/<uuid>', extractSunoSongId(`https://suno.com/s/${sampleUuid}`) === sampleUuid);
check('extracts from /embed/<uuid>', extractSunoSongId(`https://suno.com/embed/${sampleUuid}`) === sampleUuid);
check('extracts from app.suno.ai', extractSunoSongId(`https://app.suno.ai/song/${sampleUuid}`) === sampleUuid);
check('extracts from cdn1.suno.ai .mp4 file link', extractSunoSongId(`https://cdn1.suno.ai/${sampleUuid}.mp4`) === sampleUuid);
check('extracts from query parameter ?clipId=', extractSunoSongId(`https://suno.com/me?clipId=${sampleUuid}`) === sampleUuid);
check('non-suno url returns null', extractSunoSongId(`https://example.com/song/${sampleUuid}`) === null);
check('invalid url returns null', extractSunoSongId('not-a-url') === null);

// --- url detection ---
check('isSunoUrl is true for song page', isSunoUrl(`https://suno.com/song/${sampleUuid}`));
check('isSunoUrl is false for homepage', !isSunoUrl('https://suno.com/'));
check('isSunoUrl is false for youtube', !isSunoUrl('https://youtube.com/watch?v=123'));

// --- live API resolution test ---
try {
  const target = await resolveSunoDownloadTarget(`https://suno.com/song/${sampleUuid}`);
  check('resolves mediaUrl', Boolean(target?.mediaUrl && target.mediaUrl.includes(sampleUuid)));
  check('resolves real song title', Boolean(target?.pageTitle && /Synth wars/i.test(target.pageTitle)), target?.pageTitle);
  check('resolves fsId', target?.fsId === sampleUuid);
  check('resolves fileName with mp4 extension', target?.fileName === `${sampleUuid}.mp4`);
} catch (err) {
  check('live API resolution failed', false, err.message);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  process.exit(1);
}
