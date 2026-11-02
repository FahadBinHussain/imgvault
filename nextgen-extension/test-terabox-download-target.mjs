// unit tests for TeraBox download resolution & host detection (2.19.5)
//
// run: node test-terabox-download-target.mjs
//
import {
  isTeraBoxHost,
  isTeraBoxUrl,
  TERABOX_DOMAINS_RE,
  teraBoxFsIdFromUrl,
} from './src/utils/teraBoxApi.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// --- host detection ---
check('dm.terabox.com is terabox host', isTeraBoxHost('dm.terabox.com'));
check('www.terabox.com is terabox host', isTeraBoxHost('www.terabox.com'));
check('terabox.com is terabox host', isTeraBoxHost('terabox.com'));
check('1024tera.com is terabox host', isTeraBoxHost('1024tera.com'));
check('teraboxapp.com is terabox host', isTeraBoxHost('teraboxapp.com'));
check('freeterabox.com is terabox host', isTeraBoxHost('freeterabox.com'));
check('tibibox.com is terabox host', isTeraBoxHost('tibibox.com'));
check('4funbox.com is terabox host', isTeraBoxHost('4funbox.com'));
check('mirrobox.com is terabox host', isTeraBoxHost('mirrobox.com'));
check('nephobox.com is terabox host', isTeraBoxHost('nephobox.com'));

check('youtube.com is not terabox', !isTeraBoxHost('youtube.com'));
check('facebook.com is not terabox', !isTeraBoxHost('facebook.com'));
check('google.com is not terabox', !isTeraBoxHost('google.com'));
check('empty host is not terabox', !isTeraBoxHost(''));

// --- url detection ---
check(
  'play/video url is terabox url',
  isTeraBoxUrl('https://dm.terabox.com/play/video?path=%2FBy_%40Desipremier_On_Telegrama_1532.mp4&t=-1')
);
check(
  'sharing/link url is terabox url',
  isTeraBoxUrl('https://www.terabox.com/sharing/link?fidlist=%5B%22545144788274046%22%5D')
);
check(
  '1024tera short link is terabox url',
  isTeraBoxUrl('https://1024tera.com/s/1abcXYZ')
);
check('invalid url string returns false without throw', !isTeraBoxUrl('not-a-url'));
check('youtube url returns false', !isTeraBoxUrl('https://www.youtube.com/watch?v=12345'));

// --- parameter extraction logic ---
const playUrl = 'https://dm.terabox.com/play/video?path=%2FBy_%40Desipremier_On_Telegrama_1532.mp4&t=-1';
const parsedPlay = new URL(playUrl);
check('path query param extracted', parsedPlay.searchParams.get('path') === '/By_@Desipremier_On_Telegrama_1532.mp4');

const shareUrl = 'https://www.terabox.com/sharing/link?fidlist=%5B%22545144788274046%22%5D';
const parsedShare = new URL(shareUrl);
const fids = JSON.parse(parsedShare.searchParams.get('fidlist') || '[]');
check('fidlist extracted', fids[0] === '545144788274046');

const dlink = 'https://dm-d.terabox.com/file/31513265b74697a7f3412af0e63b8c41?fid=4398193731262-250528-545144788274046&rt=pr';
check('fs_id extracted from fid parameter', teraBoxFsIdFromUrl(dlink) === '545144788274046');

// Summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
