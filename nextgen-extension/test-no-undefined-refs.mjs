// static check: no source file may reference an identifier that does not exist.
//
// run:  node test-no-undefined-refs.mjs
//
// WHY THIS EXISTS: a `let` declared INSIDE a try block is invisible to the
// matching catch/finally blocks. The gallery's upload paths declared
// `runOutcome` and `pendingItemId` inside the try and read them in the
// catch/finally - which threw "runOutcome is not defined" inside the
// finally, BEFORE the upload run could be closed. The upload finished, the
// item was saved, the run stayed "running" forever, and the worker later
// reported the finished upload as interrupted with "Nothing was saved for
// this upload".
//
// There is no eslint config in this package, so nothing caught it. This test
// runs eslint's `no-undef` over every source file and fails on any
// undefined reference - the exact check that finds this class of bug.
import { Linter } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const SRC_ROOT = 'src';

const collect = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

// The globals the extension runs with. Anything not listed here and not
// declared in the file is a genuine undefined reference.
const GLOBALS = {
  chrome: 'readonly', React: 'readonly', JSX: 'readonly',
  globalThis: 'readonly', window: 'readonly', document: 'readonly',
  fetch: 'readonly', console: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', Blob: 'readonly', FormData: 'readonly', FileReader: 'readonly',
  AbortController: 'readonly', crypto: 'readonly', btoa: 'readonly', atob: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly', structuredClone: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  IntersectionObserver: 'readonly', ResizeObserver: 'readonly', Image: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', location: 'readonly',
  history: 'readonly', navigator: 'readonly', performance: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly', MutationObserver: 'readonly',
  DOMParser: 'readonly', XMLHttpRequest: 'readonly', Response: 'readonly',
  Request: 'readonly', Headers: 'readonly', URLSearchParams: 'readonly',
  process: 'readonly', Buffer: 'readonly', __dirname: 'readonly',
  module: 'writable', require: 'readonly', exports: 'writable',
};

const linter = new Linter();
const config = {
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, es2022: true, node: true, webextensions: true },
  globals: GLOBALS,
  rules: { 'no-undef': 'error' },
};

const files = collect(SRC_ROOT);
const findings = [];
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  const messages = linter.verify(code, config, file);
  for (const message of messages) {
    findings.push(`${file}:${message.line}:${message.column}  ${message.message}`);
  }
}

check(
  'every source file has no undefined reference',
  findings.length === 0,
  findings.length ? findings.join(' | ') : `${files.length} files checked`
);

// The two bugs that shipped in 2.19.x: a `let` inside a try block, read by
// the catch/finally next to it.
const gallery = fs.readFileSync(path.join(SRC_ROOT, 'pages', 'GalleryPage.jsx'), 'utf8');
const tryBlocks = [...gallery.matchAll(/\n\s*try \{/g)].map((m) => m.index);
check('the gallery still has try blocks to guard', tryBlocks.length > 0, `${tryBlocks.length} found`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exitCode = 1;
}
