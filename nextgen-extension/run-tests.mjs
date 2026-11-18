#!/usr/bin/env node
// ImgVault extension test runner — one command runs the whole suite, loud on
// any failure. No test runner dependency: legacy scripts run as plain `node`
// subprocesses, new tests use node:test (stdlib).
//
//   pnpm test            (from nextgen-extension/)
//   pnpm test            (from the repo root — also runs web + rust)
//
// parts:
//   1. legacy test-*.mjs scripts in this dir (hand-rolled, exit 1 on failure)
//   2. node --test test/ (new node:test suites, node:test + node:assert only)
//   3. tools/check-shared-twins.mjs (shared-logic drift guard)
//
// rules: every part must pass; a part that cannot run FAILS LOUDLY naming the
// reason — nothing is silently skipped. two legacy scripts are
// credential-gated live probes (test-udrop-api, test-udrop-shorturl): they
// need real UDrop API keys as UDROp_KEY1 / UDROp_KEY2 env vars, and without
// them they are reported as SKIPPED — loudly, by name, in the summary —
// instead of hanging on a keyless authorize call. that is a named skip, not
// a silent one: the summary always shows which tests did not run and why.
// the other live-network legacy scripts (test-suno-download-target,
// test-terabox-download-target) need no credentials and fail loudly on
// network errors; that is pre-existing behaviour, not a runner bug — see
// the AGENTS.md test entry.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const results = [];
const started = Date.now();

// legacy scripts that need real credentials to run at all (live API probes).
// keys come from env; the scripts themselves take them as argv.
const CREDENTIAL_GATED = {
  'test-udrop-api.mjs': ['UDROP_KEY1', 'UDROP_KEY2'],
  'test-udrop-shorturl.mjs': ['UDROP_KEY1', 'UDROP_KEY2'],
};

const run = (label, cmd, args, { cwd = dir, timeoutMs = 180_000 } = {}) => {
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', timeout: timeoutMs, encoding: 'utf8' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.error) {
    console.log(`FAIL ${label} — could not run: ${res.error.message}`);
    results.push({ label, ok: false, detail: `could not run: ${res.error.message}` });
    return;
  }
  if (res.status === null) {
    console.log(`FAIL ${label} — timed out after ${timeoutMs / 1000}s`);
    results.push({ label, ok: false, detail: `timed out after ${timeoutMs / 1000}s` });
    return;
  }
  if (res.status !== 0) {
    console.log(`FAIL ${label} — exit ${res.status} (${secs}s)`);
    results.push({ label, ok: false, detail: `exit ${res.status}` });
    return;
  }
  console.log(`PASS ${label} (${secs}s)`);
  results.push({ label, ok: true, detail: `${secs}s` });
};

// 1. legacy scripts (sorted, sequential — readable output, no shared-state races)
const legacy = readdirSync(dir).filter((f) => f.startsWith('test-') && f.endsWith('.mjs')).sort();
if (legacy.length === 0) {
  console.log('FAIL legacy scripts — no test-*.mjs files found in nextgen-extension/');
  results.push({ label: 'legacy test-*.mjs', ok: false, detail: 'no test files found' });
}
for (const file of legacy) {
  const envVars = CREDENTIAL_GATED[file];
  if (envVars) {
    const keys = envVars.map((v) => process.env[v]);
    if (keys.some((k) => !k)) {
      console.log(`\n=== legacy ${file} ===`);
      console.log(`SKIP legacy ${file} — credential-gated live probe, needs ${envVars.join(' + ')} env vars (real UDrop API keys). Set them to run it; without them it would hang on a keyless authorize call.`);
      results.push({ label: `legacy ${file}`, ok: true, skipped: true, detail: `needs ${envVars.join(' + ')}` });
      continue;
    }
    run(`legacy ${file}`, process.execPath, [join(dir, file), ...keys]);
    continue;
  }
  run(`legacy ${file}`, process.execPath, [join(dir, file)]);
}

// 2. new node:test suites — pass explicit file paths: `node --test test/`
// does NOT scan the directory, it tries to execute it as a module (verified
// on node 24: "Cannot find module '.../test'"). glob here instead.
const testDir = join(dir, 'test');
if (!existsSync(testDir)) {
  console.log('FAIL node:test — test/ directory is missing in nextgen-extension/');
  results.push({ label: 'node:test test/', ok: false, detail: 'test/ directory missing' });
} else {
  const suites = readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort();
  if (suites.length === 0) {
    console.log('FAIL node:test — no *.test.mjs files found in nextgen-extension/test/');
    results.push({ label: 'node:test test/', ok: false, detail: 'no *.test.mjs files found' });
  } else {
    run('node:test test/', process.execPath, ['--test', '--test-reporter=spec', ...suites.map((f) => join(testDir, f))], { timeoutMs: 300_000 });
  }
}

// 3. shared twin drift guard (cwd-independent: resolves the repo root itself)
run('check-shared-twins', process.execPath, [join(dir, '..', 'tools', 'check-shared-twins.mjs')]);

// summary
const totalSecs = ((Date.now() - started) / 1000).toFixed(1);
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
console.log(`\n===== test summary (${totalSecs}s) =====`);
for (const r of results) {
  const state = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
  console.log(`${state}  ${r.label}  (${r.detail})`);
}
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${results.length} parts FAILED — see above.`);
  process.exit(1);
}
if (skipped.length > 0) {
  console.log(`\nall runnable parts passed. ${skipped.length} credential-gated probe(s) skipped (see above) — set the env vars to run them.`);
} else {
  console.log(`\nall ${results.length} parts passed.`);
}
