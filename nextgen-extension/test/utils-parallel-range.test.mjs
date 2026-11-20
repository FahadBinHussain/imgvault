// node:test suite for src/utils/parallelRangeDownload.js + the wiring in
// src/utils/videoRetryPageSide.js. The engine is tested live with a mocked
// fetch serving a synthetic byte array; the retry path itself cannot be
// imported in plain node (videoRetryPageSide.js imports uploaders.js, which
// circular-imports providerCatalog.js), so its wiring is pinned by
// source-text assertions below.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PARALLEL_RANGE_PARTS,
  PARALLEL_RANGE_MIN_BYTES,
  splitByteRanges,
  probeDownload,
  downloadParallelRanges,
} from '../src/utils/parallelRangeDownload.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('splitByteRanges', () => {
  test('splits evenly with the remainder on the last part', () => {
    const ranges = splitByteRanges(100, 8);
    assert.equal(ranges.length, 8);
    assert.deepEqual(ranges[0], { start: 0, end: 12 });
    assert.deepEqual(ranges[7], { start: 91, end: 99 });
    // contiguous, exact cover, no gaps or overlaps
    let covered = 0;
    for (let i = 0; i < ranges.length; i += 1) {
      assert.equal(ranges[i].start, covered);
      covered = ranges[i].end + 1;
    }
    assert.equal(covered, 100);
  });
  test('an exact multiple splits cleanly', () => {
    assert.deepEqual(splitByteRanges(80, 8).map((r) => r.end - r.start + 1), [10, 10, 10, 10, 10, 10, 10, 10]);
  });
  test('fewer bytes than parts still covers exactly', () => {
    const ranges = splitByteRanges(3, 8);
    assert.deepEqual(ranges, [
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });
  test('zero or negative totals give no ranges', () => {
    assert.deepEqual(splitByteRanges(0), []);
    assert.deepEqual(splitByteRanges(-5), []);
  });
  test('defaults are 8 parts and an 8 MB floor', () => {
    assert.equal(PARALLEL_RANGE_PARTS, 8);
    assert.equal(PARALLEL_RANGE_MIN_BYTES, 8 * 1024 * 1024);
  });
});

describe('probeDownload', () => {
  test('a 206 with Content-Range reports support + total + final url', async () => {
    const fetchImpl = async () => new Response(new Uint8Array([1]), {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-0/123456', 'Content-Type': 'video/mp4' },
    });
    const probe = await probeDownload('https://cdn.example/f.mp4', '', fetchImpl);
    assert.equal(probe.supportsRange, true);
    assert.equal(probe.total, 123456);
    assert.equal(probe.type, 'video/mp4');
    assert.equal(probe.status, 206);
  });
  test('a 200 answers no Range support instead of throwing', async () => {
    const fetchImpl = async () => new Response(new Uint8Array([1]), { status: 200 });
    const probe = await probeDownload('https://cdn.example/f.mp4', '', fetchImpl);
    assert.equal(probe.supportsRange, false);
    assert.equal(probe.total, 0);
    assert.equal(probe.status, 200);
  });
  test('a network failure answers status 0 instead of throwing', async () => {
    const fetchImpl = async () => { throw new Error('boom'); };
    const probe = await probeDownload('https://cdn.example/f.mp4', '', fetchImpl);
    assert.equal(probe.supportsRange, false);
    assert.equal(probe.status, 0);
    assert.equal(probe.finalUrl, 'https://cdn.example/f.mp4');
  });
});

// A fetch mock serving `bytes` over Range requests, recording every range.
function rangeServer(bytes, { failRangeOnce = null } = {}) {
  const calls = [];
  const failedOnce = new Set();
  const fetchImpl = async (url, opts) => {
    const rangeHeader = opts?.headers?.Range || '';
    calls.push(rangeHeader);
    const match = rangeHeader.match(/bytes=(\d+)-(\d+)/);
    if (!match) {
      return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.length) } });
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const slice = bytes.slice(start, end + 1);
    if (failRangeOnce === rangeHeader && !failedOnce.has(rangeHeader)) {
      failedOnce.add(rangeHeader);
      // deliver half the part, then die on the next pull — the part must
      // resume from the delivered offset, not restart from 0
      const half = Math.floor(slice.length / 2);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(slice.slice(0, half));
        },
        pull(controller) {
          controller.error(new Error('simulated stall'));
        },
      });
      return new Response(stream, {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new Response(slice, {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
    });
  };
  return { fetchImpl, calls };
}

describe('downloadParallelRanges', () => {
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;

  test('the blob is byte-identical to the source, in order', async () => {
    const { fetchImpl, calls } = rangeServer(bytes);
    const blob = await downloadParallelRanges('https://cdn.example/f.mp4', {
      total: bytes.length,
      type: 'video/mp4',
      fetchImpl,
      maxRetries: 2,
    });
    assert.equal(blob.size, bytes.length);
    assert.equal(blob.type, 'video/mp4');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    assert.equal(calls.length, 8, 'one request per part');
    assert.ok(calls.includes('bytes=0-124'));
    assert.ok(calls.includes('bytes=875-999'));
  });
  test('progress reports the aggregate loaded/total and reaches 100%', async () => {
    const { fetchImpl } = rangeServer(bytes);
    const reports = [];
    await downloadParallelRanges('https://cdn.example/f.mp4', {
      total: bytes.length,
      fetchImpl,
      maxRetries: 2,
      onProgress: (p) => reports.push({ ...p }),
    });
    const last = reports[reports.length - 1];
    assert.equal(last.loaded, bytes.length);
    assert.equal(last.total, bytes.length);
    assert.equal(last.percent, 100);
    assert.equal(last.method, 'parallel-range');
    for (const p of reports) {
      assert.ok(p.loaded <= bytes.length, 'loaded never exceeds the total');
      assert.ok(p.percent === null || (p.percent >= 0 && p.percent <= 100));
    }
  });
  test('a part that stalls mid-stream resumes from the missing offset', async () => {
    const { fetchImpl, calls } = rangeServer(bytes, { failRangeOnce: 'bytes=0-124' });
    const blob = await downloadParallelRanges('https://cdn.example/f.mp4', {
      total: bytes.length,
      fetchImpl,
      maxRetries: 2,
    });
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    // the failed part was retried with a resume range, not from 0
    assert.ok(calls.some((c) => c === 'bytes=62-124'), `calls: ${calls.join(', ')}`);
  });
  test('a part that answers 200 instead of 206 fails LOUDLY', async () => {
    const fetchImpl = async () => new Response(bytes, { status: 200 });
    await assert.rejects(
      () => downloadParallelRanges('https://cdn.example/f.mp4', {
        total: bytes.length,
        fetchImpl,
        maxRetries: 1,
      }),
      /got HTTP 200 instead of 206/,
    );
  });
  test('a truncated part fails loudly instead of handing back a short blob', async () => {
    const fetchImpl = async (url, opts) => {
      const match = (opts?.headers?.Range || '').match(/bytes=(\d+)-(\d+)/);
      const start = Number(match[1]);
      // always serve 1 byte short of the requested range
      return new Response(bytes.slice(start, Number(match[2])), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${match[2]}/${bytes.length}` },
      });
    };
    await assert.rejects(
      () => downloadParallelRanges('https://cdn.example/f.mp4', {
        total: bytes.length,
        fetchImpl,
        maxRetries: 1,
      }),
      /truncated/,
    );
  });
  test('an unknown total throws instead of downloading blind', async () => {
    await assert.rejects(
      () => downloadParallelRanges('https://cdn.example/f.mp4', { total: 0, fetchImpl: async () => new Response() }),
      /known total size/,
    );
  });
  test('an explicit parts count is honored — 2 parts means 2 range requests', async () => {
    const { fetchImpl, calls } = rangeServer(bytes);
    const blob = await downloadParallelRanges('https://cdn.example/f.mp4', {
      total: bytes.length,
      fetchImpl,
      parts: 2,
      maxRetries: 2,
    });
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    assert.equal(calls.length, 2);
    assert.ok(calls.includes('bytes=0-499'));
    assert.ok(calls.includes('bytes=500-999'));
  });
});

describe('videoRetryPageSide wiring (source assertions)', () => {
  const retry = () => src('../src/utils/videoRetryPageSide.js');
  test('the retry download runs parallel and names the fallback in the label', () => {
    const file = retry();
    assert.ok(file.includes("import { downloadParallelRanges, probeDownload, PARALLEL_RANGE_MIN_BYTES } from './parallelRangeDownload.js';"));
    assert.ok(file.includes('}, { parallel: true });'), 'the retry fetchVideoAsBlob call passes { parallel: true }');
    assert.ok(file.includes('const label = p.methodNote ? `${base} — ${p.methodNote}` : base;'));
    assert.ok(file.includes('this host does not support Range requests, so the download runs on one connection'));
  });
  test('HLS segments and playlist fetches stay single-connection (no probe overhead on small files)', () => {
    const file = retry();
    assert.ok(file.includes("const blob = await fetchVideoAsBlob(segmentUris[i], 'https://filemoon.sx/');"));
    assert.ok(file.includes('const blob = await fetchVideoAsBlob(url, referrer);'));
    assert.ok(!file.includes("fetchVideoAsBlob(segmentUris[i], 'https://filemoon.sx/', undefined, { parallel: true })"));
  });
  test('the single-connection path keeps its stall/resume/truncation guards', () => {
    const file = retry();
    assert.ok(file.includes('async function fetchVideoAsBlobSingle(url, referrer, onProgress, methodNote = \'\') {'));
    assert.ok(file.includes('Download truncated: got ${loaded} of ${total} bytes.'));
    assert.ok(file.includes('method: \'single-connection\','));
  });
  test('parallel runs ONLY when the server honors Range AND the file is STRICTLY over 8 MB (exactly 8 MB stays single)', () => {
    const file = retry();
    assert.ok(file.includes('if (probe.supportsRange && probe.total > PARALLEL_RANGE_MIN_BYTES) {'));
  });
  test('the parallel call uses the probe finalUrl (post-redirect) with the probed total + type, and the default 8 parts', () => {
    const file = retry();
    const fn = file.slice(file.indexOf('async function fetchVideoAsBlob('));
    assert.ok(fn.includes('return downloadParallelRanges(probe.finalUrl, {'));
    assert.ok(fn.includes('total: probe.total,'));
    assert.ok(fn.includes('type: probe.type,'));
    assert.ok(!fn.includes('parts:'), 'no explicit parts override — PARALLEL_RANGE_PARTS (8) owns the split');
  });
  test('a failed probe (status 0) gets NO fallback note — the single-connection path surfaces the real failure', () => {
    const file = retry();
    const fn = file.slice(file.indexOf('async function fetchVideoAsBlob('));
    assert.ok(fn.includes('const methodNote = probe.status > 0 && !probe.supportsRange'));
    assert.ok(fn.includes('? \'this host does not support Range requests, so the download runs on one connection\''));
  });
});
