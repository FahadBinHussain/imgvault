// node:test suite for src/utils/mp4MinFrame.js — the minimal ISO-BMFF
// locator + single-frame rebuilder. Pure byte parsing, no network, no DOM.
//
// The fixture is a synthetic MP4 built by hand in this file: ftyp + moov
// (mvhd + one video trak with stsd/stts/stsc/stsz/stco/stss) + mdat holding
// 10 samples of 1000 bytes each. Track: timescale 1000, duration 10000 ticks
// (10 s), keyframes at samples 1 and 6.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSingleFrameMp4,
  findBox,
  findMoov,
  iterBoxes,
  locateVideoFrame,
} from '../src/utils/mp4MinFrame.js';

const w32 = (buf, off, v) => {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
};
const w16 = (buf, off, v) => {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
};
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const box = (type, payload) => {
  const buf = new Uint8Array(8 + payload.length);
  w32(buf, 0, 8 + payload.length);
  buf.set(ascii(type), 4);
  buf.set(payload, 8);
  return buf;
};
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};
const u32Box = (v) => {
  const p = new Uint8Array(4);
  w32(p, 0, v);
  return p;
};

// --- fixture builders ----------------------------------------------------
function buildMvhd(timescale = 1000, duration = 10000) {
  const p = new Uint8Array(96);
  w32(p, 12, timescale);
  w32(p, 16, duration);
  return box('mvhd', p);
}
function buildMdhd(timescale = 1000, duration = 10000) {
  const p = new Uint8Array(24);
  w32(p, 12, timescale);
  w32(p, 16, duration);
  return box('mdhd', p);
}
function buildHdlr(handler = 'vide') {
  return box('hdlr', concat([new Uint8Array(8), ascii(handler), new Uint8Array(12)]));
}
function buildStsd(width = 640, height = 360) {
  const entry = new Uint8Array(86);
  w32(entry, 0, 86);
  entry.set(ascii('avc1'), 4);
  w16(entry, 32, width);
  w16(entry, 34, height);
  return box('stsd', concat([new Uint8Array(4), u32Box(1), entry]));
}
function buildStts(entries = [[10, 1000]]) {
  const p = new Uint8Array(8 + entries.length * 8);
  w32(p, 4, entries.length);
  entries.forEach(([count, delta], i) => {
    w32(p, 8 + i * 8, count);
    w32(p, 12 + i * 8, delta);
  });
  return box('stts', p);
}
function buildStsc(entries = [[1, 10, 1]]) {
  const p = new Uint8Array(8 + entries.length * 12);
  w32(p, 4, entries.length);
  entries.forEach(([first, per, desc], i) => {
    w32(p, 8 + i * 12, first);
    w32(p, 12 + i * 12, per);
    w32(p, 16 + i * 12, desc);
  });
  return box('stsc', p);
}
function buildStsz(sizes) {
  const p = new Uint8Array(12 + sizes.length * 4);
  w32(p, 4, 0);
  w32(p, 8, sizes.length);
  sizes.forEach((s, i) => w32(p, 12 + i * 4, s));
  return box('stsz', p);
}
function buildStco(offsets) {
  const p = new Uint8Array(8 + offsets.length * 4);
  w32(p, 4, offsets.length);
  offsets.forEach((o, i) => w32(p, 8 + i * 4, o));
  return box('stco', p);
}
function buildStss(samples) {
  const p = new Uint8Array(8 + samples.length * 4);
  w32(p, 4, samples.length);
  samples.forEach((s, i) => w32(p, 8 + i * 4, s));
  return box('stss', p);
}
function buildTrak({ stcoOffset, sizes, keyframes = [1, 6], handler = 'vide', extraStbl = [] }) {
  const stbl = box('stbl', concat([
    buildStsd(),
    buildStts(),
    buildStsc(),
    buildStsz(sizes),
    buildStco([stcoOffset]),
    ...(keyframes ? [buildStss(keyframes)] : []),
    ...extraStbl,
  ]));
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat([buildMdhd(), buildHdlr(handler), minf]));
  return box('trak', mdia);
}

/** Full file: ftyp + moov + mdat. stco is patched to the real mdat offset. */
function buildFixture({ keyframes = [1, 6], sizes = Array(10).fill(1000), handler = 'vide', extraMoov = [] } = {}) {
  const ftyp = box('ftyp', concat([ascii('isom'), u32Box(0x200), ascii('isomiso2avc1mp41')]));
  // First pass with a dummy offset to measure moov size, then rebuild.
  const moovDummy = box('moov', concat([buildMvhd(), buildTrak({ stcoOffset: 0, sizes, keyframes, handler }), ...extraMoov]));
  const mdatDataStart = ftyp.length + moovDummy.length + 8;
  const moov = box('moov', concat([buildMvhd(), buildTrak({ stcoOffset: mdatDataStart, sizes, keyframes, handler }), ...extraMoov]));
  const samples = new Uint8Array(sizes.reduce((n, s) => n + s, 0));
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 251;
  const mdat = box('mdat', samples);
  return { file: concat([ftyp, moov, mdat]), mdatDataStart, sizes };
}

describe('iterBoxes', () => {
  test('walks sibling boxes with offsets and sizes', () => {
    const bytes = concat([box('ftyp', new Uint8Array(8)), box('moov', new Uint8Array(4)), box('free', new Uint8Array(0))]);
    const found = [...iterBoxes(bytes, 0, bytes.length)];
    assert.deepEqual(found.map((b) => b.type), ['ftyp', 'moov', 'free']);
    assert.equal(found[0].off, 0);
    assert.equal(found[0].size, 16);
    assert.equal(found[1].off, 16);
    assert.equal(found[1].dataOff, 24);
    assert.equal(found[2].size, 8);
  });
  test('handles a 64-bit size (size === 1)', () => {
    const payload = new Uint8Array(4);
    const buf = new Uint8Array(16 + 4);
    w32(buf, 0, 1);
    buf.set(ascii('wide'), 4);
    // u64 size = 20 at offset 8
    w32(buf, 8, 0);
    w32(buf, 12, 20);
    buf.set(payload, 16);
    const found = [...iterBoxes(buf, 0, buf.length)];
    assert.equal(found.length, 1);
    assert.equal(found[0].type, 'wide');
    assert.equal(found[0].size, 20);
    assert.equal(found[0].hdr, 16);
    assert.equal(found[0].dataOff, 16);
  });
  test('size 0 extends to the end of the window', () => {
    const buf = concat([box('ftyp', new Uint8Array(0)), new Uint8Array(8)]);
    w32(buf, 8, 0);
    buf.set(ascii('mdat'), 12);
    const found = [...iterBoxes(buf, 0, buf.length)];
    assert.equal(found[1].type, 'mdat');
    assert.equal(found[1].size, 8);
  });
  test('a box smaller than its header stops the walk', () => {
    const buf = new Uint8Array(16);
    w32(buf, 0, 4);
    buf.set(ascii('bad!'), 4);
    w32(buf, 8, 8);
    buf.set(ascii('free'), 12);
    assert.deepEqual([...iterBoxes(buf, 0, buf.length)], []);
  });
  test('a truncated tail (fewer than 8 bytes left) ends the walk', () => {
    const bytes = concat([box('free', new Uint8Array(0)), new Uint8Array(5)]);
    assert.equal([...iterBoxes(bytes, 0, bytes.length)].length, 1);
  });
});

describe('findBox', () => {
  test('returns the first matching box, or null', () => {
    const bytes = concat([box('ftyp', new Uint8Array(0)), box('moov', new Uint8Array(0)), box('moov', new Uint8Array(0))]);
    assert.equal(findBox(bytes, 'moov', 0, bytes.length).off, 8);
    assert.equal(findBox(bytes, 'mdat', 0, bytes.length), null);
  });
});

describe('findMoov', () => {
  test('finds moov in a full file', () => {
    const { file } = buildFixture();
    const moov = findMoov(file);
    assert.ok(moov);
    assert.equal(moov.type, 'moov');
    assert.ok(moov.off > 0);
  });
  test('finds moov in a mid-file window (tail read, unaligned start)', () => {
    const { file } = buildFixture();
    const moov = findMoov(file);
    // start 3 bytes into ftyp so the walk is NOT box-aligned
    const found = findMoov(file, 3);
    assert.ok(found);
    assert.equal(found.off, moov.off);
  });
  test('returns null when there is no moov', () => {
    const bytes = concat([box('ftyp', new Uint8Array(8)), box('mdat', new Uint8Array(100))]);
    assert.equal(findMoov(bytes), null);
  });
  test('a moov without mvhd + trak is not a moov (false-positive guard)', () => {
    const fake = box('moov', concat([box('free', new Uint8Array(8)), box('free', new Uint8Array(8))]));
    assert.equal(findMoov(fake), null);
  });
  test('a truncated moov is returned as a last resort', () => {
    const { file } = buildFixture();
    const moov = findMoov(file);
    // cut the window 10 bytes short of the moov end
    const truncated = findMoov(file, 0, moov.off + moov.size - 10);
    assert.ok(truncated);
    assert.equal(truncated.off, moov.off);
  });
});

describe('locateVideoFrame', () => {
  test('locates the keyframe nearest the middle of the track', () => {
    const { file, mdatDataStart } = buildFixture();
    const info = locateVideoFrame(file, 0.5);
    assert.ok(info);
    // target tick 5000 -> sample 6, which is itself a keyframe
    assert.equal(info.offset, mdatDataStart + 5000);
    assert.equal(info.size, 1000);
    assert.equal(info.timescale, 1000);
    assert.equal(info.sampleDuration, 1000);
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(info.stsdBytes.length, 86);
  });
  test('ratio 0 locates the first frame', () => {
    const { file, mdatDataStart } = buildFixture();
    const info = locateVideoFrame(file, 0);
    assert.equal(info.offset, mdatDataStart);
    assert.equal(info.size, 1000);
  });
  test('a non-keyframe target snaps back to the previous keyframe', () => {
    const { file, mdatDataStart } = buildFixture();
    // ratio 0.8 -> tick 8000 -> sample 9 -> previous keyframe is sample 6
    const info = locateVideoFrame(file, 0.8);
    assert.equal(info.offset, mdatDataStart + 5000);
  });
  test('without an stss table the exact target sample is used', () => {
    const { file, mdatDataStart } = buildFixture({ keyframes: null });
    const info = locateVideoFrame(file, 0.8);
    // sample 9, no keyframe snapping
    assert.equal(info.offset, mdatDataStart + 8000);
  });
  test('variable sample sizes map through stsc + stco', () => {
    const sizes = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const { file, mdatDataStart } = buildFixture({ sizes, keyframes: [1] });
    const info = locateVideoFrame(file, 0.5);
    // target sample 6 snaps back to keyframe 1
    assert.equal(info.offset, mdatDataStart);
    assert.equal(info.size, 100);
  });
  test('returns null when there is no moov', () => {
    const bytes = concat([box('ftyp', new Uint8Array(8)), box('mdat', new Uint8Array(100))]);
    assert.equal(locateVideoFrame(bytes), null);
  });
  test('returns null for fragmented MP4 (mvex present)', () => {
    const { file } = buildFixture({ extraMoov: [box('mvex', new Uint8Array(8))] });
    assert.equal(locateVideoFrame(file), null);
  });
  test('returns null when the only track is audio', () => {
    const { file } = buildFixture({ handler: 'soun' });
    assert.equal(locateVideoFrame(file), null);
  });
  test('an implausibly large sample (> 4 MiB) is rejected, not returned', () => {
    const sizes = [1000, 1000, 1000, 1000, 1000, 5 * 1024 * 1024, 1000, 1000, 1000, 1000];
    const { file } = buildFixture({ sizes });
    // target sample 6 is the 5 MiB one
    assert.equal(locateVideoFrame(file, 0.5), null);
  });
});

describe('buildSingleFrameMp4', () => {
  test('rebuilds a valid one-frame MP4 around the located frame', () => {
    const { file, mdatDataStart } = buildFixture();
    const info = locateVideoFrame(file, 0.5);
    const sampleBytes = file.slice(info.offset, info.offset + info.size);
    const rebuilt = buildSingleFrameMp4(info, sampleBytes);
    assert.equal(String.fromCharCode(...rebuilt.slice(4, 8)), 'ftyp');
    const moov = findMoov(rebuilt);
    assert.ok(moov);
    const mdat = findBox(rebuilt, 'mdat', 0, rebuilt.length);
    assert.ok(mdat);
    assert.deepEqual(rebuilt.slice(mdat.dataOff, mdat.dataEnd), sampleBytes);
  });
  test('the rebuilt stco points at the rebuilt mdat payload', () => {
    const { file } = buildFixture();
    const info = locateVideoFrame(file, 0.5);
    const sampleBytes = file.slice(info.offset, info.offset + info.size);
    const rebuilt = buildSingleFrameMp4(info, sampleBytes);
    const mdat = findBox(rebuilt, 'mdat', 0, rebuilt.length);
    const moov = findMoov(rebuilt);
    const trak = findBox(rebuilt, 'trak', moov.dataOff, moov.dataEnd);
    const mdia = findBox(rebuilt, 'mdia', trak.dataOff, trak.dataEnd);
    const minf = findBox(rebuilt, 'minf', mdia.dataOff, mdia.dataEnd);
    const stbl = findBox(rebuilt, 'stbl', minf.dataOff, minf.dataEnd);
    const stco = findBox(rebuilt, 'stco', stbl.dataOff, stbl.dataEnd);
    const chunkOffset = new DataView(rebuilt.buffer, rebuilt.byteOffset + stco.dataOff + 8, 4).getUint32(0);
    assert.equal(chunkOffset, mdat.dataOff);
  });
  test('the rebuilt file round-trips through locateVideoFrame', () => {
    const { file } = buildFixture();
    const info = locateVideoFrame(file, 0.5);
    const sampleBytes = file.slice(info.offset, info.offset + info.size);
    const rebuilt = buildSingleFrameMp4(info, sampleBytes);
    const again = locateVideoFrame(rebuilt, 0.5);
    assert.ok(again);
    assert.equal(again.size, sampleBytes.length);
    assert.equal(again.timescale, info.timescale);
    assert.equal(again.width, 640);
    assert.equal(again.height, 360);
  });
  test('missing dimensions fall back to 640x360', () => {
    const { file } = buildFixture();
    const info = locateVideoFrame(file, 0.5);
    const rebuilt = buildSingleFrameMp4({ ...info, width: 0, height: 0 }, new Uint8Array([1, 2, 3]));
    const again = locateVideoFrame(rebuilt, 0.5);
    assert.equal(again.width, 640);
    assert.equal(again.height, 360);
  });
});
