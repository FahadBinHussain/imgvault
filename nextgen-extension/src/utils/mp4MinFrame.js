/**
 * Minimal ISO-BMFF (MP4) locator + rebuilder (2.12.88).
 *
 * A preview is a spec of a moment: it needs ONE frame, not the movie. This
 * module parses just enough of `moov` (mvhd/mdhd/hdlr/stts/stsc/stco/stsz/
 * stss) to compute the absolute byte range of the frame nearest a target
 * time, so the caller range-fetches ~100KB instead of the whole blob. It then
 * rebuilds a tiny valid MP4 around that single sample (original stsd copied
 * verbatim — it carries the SPS/PPS the decoder needs) and hands it to a
 * <video> element for decode.
 *
 * Scope is deliberately narrow and LOUD on anything it doesn't understand:
 * fragmented MP4 (moof/traf), missing sample tables, or an absent moov all
 * reject explicitly. No fallback to "download everything" — a preview that
 * can't be located cheaply fails visibly rather than silently pulling 143MiB.
 */

function u16(bytes, off) {
  return ((bytes[off] << 8) | bytes[off + 1]) >>> 0;
}

function u32(bytes, off) {
  return ((bytes[off] * 0x1000000) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3]) >>> 0;
}

function u64(bytes, off) {
  const hi = u32(bytes, off);
  const lo = u32(bytes, off + 4);
  return hi * 0x100000000 + lo;
}

function typeAt(bytes, off) {
  return String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
}

/**
 * Iterate boxes within [start, end). Handles 64-bit sizes (size===1, header
 * grows to 16) and the "extends to end of file" size (size===0).
 */
export function* iterBoxes(bytes, start, end) {
  let off = start;
  while (off + 8 <= end) {
    let size = u32(bytes, off);
    const type = typeAt(bytes, off);
    let hdr = 8;
    if (size === 1) {
      size = u64(bytes, off + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < hdr) break;
    yield { type, off, size, hdr, dataOff: off + hdr, dataEnd: Math.min(off + size, end) };
    off += size;
  }
}

export function findBox(bytes, type, start, end) {
  for (const b of iterBoxes(bytes, start, end)) {
    if (b.type === type) return b;
  }
  return null;
}

/**
 * Locate the movie metadata box in a window known to contain it.
 *
 * The window is NOT guaranteed to start on a box boundary: the head read starts
 * at byte 0 (ftyp first, so it is aligned), but a TAIL read starts at an
 * arbitrary offset — mid-box — and a strict box walk from offset 0 of that
 * slice parses garbage and silently misses moov entirely. So instead of
 * walking boxes, scan for a plausible moov header (4-byte size + 'moov') and
 * VALIDATE it by checking it actually holds mvhd + trak. The mvhd/trak
 * requirement makes a false positive on random compressed video data
 * effectively impossible.
 */
export function findMoov(bytes, start = 0, end = bytes.length) {
  // A moov whose declared size runs past the end of the window is TRUNCATED:
  // its sample tables (stsz/stsc/stco) were cut off and a box walk past the
  // real data reads unrelated bytes, yielding plausible-looking but garbage
  // sample sizes (observed: a "sample" of 67MiB on a 143MiB file, which blew
  // the 64MiB message cap). Prefer a COMPLETE moov; accept a truncated one
  // only when nothing better exists, and say so.
  // The scan compares the 4 type bytes directly (not String.fromCharCode) —
  // windows can be 32MiB and this is the hot loop.
  let truncated = null;
  for (let off = start; off + 8 <= end; off += 1) {
    if (bytes[off + 4] !== 0x6d || bytes[off + 5] !== 0x6f
      || bytes[off + 6] !== 0x6f || bytes[off + 7] !== 0x76) continue; // 'moov'
    let size = u32(bytes, off);
    let hdr = 8;
    if (size === 1) {
      size = u64(bytes, off + 8);
      hdr = 16;
    } else if (size === 0) {
      // size 0 = "extends to end of file" — the buffer is all we have
      size = end - off;
    }
    if (size < hdr) continue;
    const dataOff = off + hdr;
    const dataEnd = Math.min(off + size, end);
    if (dataEnd - dataOff < 16) continue;
    let hasMvhd = false;
    let hasTrak = false;
    for (const b of iterBoxes(bytes, dataOff, dataEnd)) {
      if (b.type === 'mvhd') hasMvhd = true;
      else if (b.type === 'trak') hasTrak = true;
    }
    if (!hasMvhd || !hasTrak) continue;
    if (off + size > end) {
      // truncated — remember it but keep looking for a complete one
      if (!truncated) truncated = { type: 'moov', off, size, hdr, dataOff, dataEnd };
      continue;
    }
    return { type: 'moov', off, size, hdr, dataOff, dataEnd };
  }
  if (truncated) {
    console.warn(
      `[mp4MinFrame] moov at ${truncated.off} declares ${truncated.size}B but only ` +
      `${truncated.dataEnd - truncated.dataOff}B fit in the read window — the sample tables ` +
      'are cut off; parse results from it are unreliable'
    );
  }
  return truncated;
}

function parseStts(bytes, box) {
  const count = u32(bytes, box.dataOff + 4);
  const out = [];
  let p = box.dataOff + 8;
  for (let i = 0; i < count && p + 8 <= box.dataEnd; i++) {
    out.push({ count: u32(bytes, p), delta: u32(bytes, p + 4) });
    p += 8;
  }
  return out;
}

function parseStsz(bytes, box) {
  const fixed = u32(bytes, box.dataOff + 4);
  const count = u32(bytes, box.dataOff + 8);
  if (fixed !== 0) return { fixed, count, sizes: null };
  const sizes = new Array(count).fill(0);
  let p = box.dataOff + 12;
  for (let i = 0; i < count && p + 4 <= box.dataEnd; i++) {
    sizes[i] = u32(bytes, p);
    p += 4;
  }
  return { fixed: 0, count, sizes };
}

function parseStsc(bytes, box) {
  const count = u32(bytes, box.dataOff + 4);
  const out = [];
  let p = box.dataOff + 8;
  for (let i = 0; i < count && p + 12 <= box.dataEnd; i++) {
    out.push({
      firstChunk: u32(bytes, p),
      samplesPerChunk: u32(bytes, p + 4),
      descIdx: u32(bytes, p + 8),
    });
    p += 12;
  }
  return out;
}

function parseStco(bytes, box) {
  const is64 = box.type === 'co64';
  const count = u32(bytes, box.dataOff + 4);
  const out = new Array(count).fill(0);
  let p = box.dataOff + 8;
  const step = is64 ? 8 : 4;
  for (let i = 0; i < count && p + step <= box.dataEnd; i++) {
    out[i] = is64 ? u64(bytes, p) : u32(bytes, p);
    p += step;
  }
  return out;
}

function parseStss(bytes, box) {
  if (!box) return null;
  const count = u32(bytes, box.dataOff + 4);
  const out = [];
  let p = box.dataOff + 8;
  for (let i = 0; i < count && p + 4 <= box.dataEnd; i++) {
    out.push(u32(bytes, p));
    p += 4;
  }
  return out;
}

function sampleSize(stsz, sampleNo) {
  if (stsz.fixed) return stsz.fixed;
  if (stsz.sizes && sampleNo >= 1 && sampleNo <= stsz.sizes.length) return stsz.sizes[sampleNo - 1];
  return 0;
}

// A single compressed video sample is never anywhere near this big (a 4K
// I-frame tops out around 1-2MiB). If the locator computes a "sample" bigger
// than this, the moov it parsed is garbage — a false positive in random video
// data, or a real moov TRUNCATED by the head/tail window whose sample tables
// ran off into unrelated bytes. Returning that range would make the caller
// fetch tens of MiB for a "frame" and blow the 64MiB message cap. Reject it
// loudly instead of guessing.
const MAX_SAMPLE_BYTES = 4 * 1024 * 1024;

/** Map a tick (track timescale) to a 1-based sample index via stts. */
function sampleIndexAtTick(stts, tick) {
  let idx = 1;
  let t = 0;
  for (const e of stts) {
    const span = e.count * e.delta;
    if (t + span >= tick && e.delta > 0) {
      return idx + Math.max(0, Math.floor((tick - t) / e.delta));
    }
    t += span;
    idx += e.count;
  }
  return Math.max(1, idx - 1);
}

/** Map a 1-based sample index to its absolute byte range via stsc + stco. */
function sampleByteRange(stsc, stco, stsz, sampleIdx) {
  if (!stsc.length || !stco.length) return null;
  let sampleNo = 1;
  for (let g = 0; g < stsc.length; g++) {
    const firstChunk = stsc[g].firstChunk;
    const lastChunk = (g + 1 < stsc.length) ? stsc[g + 1].firstChunk - 1 : stco.length;
    const perChunk = Math.max(1, stsc[g].samplesPerChunk);
    for (let c = firstChunk; c <= lastChunk; c++) {
      const chunkIdx = c - 1;
      if (chunkIdx >= stco.length) return null;
      let offset = stco[chunkIdx];
      for (let k = 0; k < perChunk; k++) {
        const size = sampleSize(stsz, sampleNo);
        if (sampleNo === sampleIdx) return { offset, size };
        offset += size;
        sampleNo += 1;
      }
    }
  }
  return null;
}

/**
 * Parse the first video track out of moov and locate the sync frame nearest
 * `ratio` of the track duration. Rejects fragmented MP4 loudly.
 * @returns {{offset:number,size:number,timescale:number,sampleDuration:number,
 *            stsdBytes:Uint8Array,width:number,height:number}|null}
 */
export function locateVideoFrame(moovBytes, ratio = 0.5) {
  const moov = findMoov(moovBytes);
  if (!moov) { console.warn('[mp4MinFrame] no moov in window'); return null; }

  // Fragmented MP4 keeps its sample tables in moof, not moov — the moov tables
  // are empty and this locator cannot work. Say so, don't guess.
  if (findBox(moovBytes, 'mvex', moov.dataOff, moov.dataEnd)) {
    console.warn('[mp4MinFrame] fragmented MP4 (mvex) — sample tables are in moof, not moov; single-frame rebuild unavailable');
    return null;
  }

  let mvhd = null;
  const traks = [];
  for (const b of iterBoxes(moovBytes, moov.dataOff, moov.dataEnd)) {
    if (b.type === 'mvhd') mvhd = b;
    else if (b.type === 'trak') traks.push(b);
  }
  if (!mvhd) { console.warn('[mp4MinFrame] no mvhd in moov'); return null; }

  const mvhdVer = moovBytes[mvhd.dataOff];
  const timescale = u32(moovBytes, mvhd.dataOff + (mvhdVer === 0 ? 12 : 20));
  const duration = mvhdVer === 0
    ? u32(moovBytes, mvhd.dataOff + 16)
    : u64(moovBytes, mvhd.dataOff + 24);

  let videoTrakSeen = false;
  for (const trak of traks) {
    const mdia = findBox(moovBytes, 'mdia', trak.dataOff, trak.dataEnd);
    if (!mdia) { console.warn('[mp4MinFrame] trak: no mdia'); continue; }
    const hdlr = findBox(moovBytes, 'hdlr', mdia.dataOff, mdia.dataEnd);
    if (!hdlr) { console.warn('[mp4MinFrame] trak: no hdlr'); continue; }
    const handler = String.fromCharCode(
      moovBytes[hdlr.dataOff + 8], moovBytes[hdlr.dataOff + 9],
      moovBytes[hdlr.dataOff + 10], moovBytes[hdlr.dataOff + 11],
    );
    if (handler !== 'vide') { console.log(`[mp4MinFrame] trak handler=${handler} — skipping non-video`); continue; }
    videoTrakSeen = true;

    const mdhd = findBox(moovBytes, 'mdhd', mdia.dataOff, mdia.dataEnd);
    const minf = findBox(moovBytes, 'minf', mdia.dataOff, mdia.dataEnd);
    if (!mdhd || !minf) { console.warn(`[mp4MinFrame] vide trak: missing ${!mdhd ? 'mdhd' : ''} ${!minf ? 'minf' : ''}`); continue; }
    const stbl = findBox(moovBytes, 'stbl', minf.dataOff, minf.dataEnd);
    if (!stbl) { console.warn('[mp4MinFrame] vide trak: no stbl'); continue; }

    const stsd = findBox(moovBytes, 'stsd', stbl.dataOff, stbl.dataEnd);
    const stts = findBox(moovBytes, 'stts', stbl.dataOff, stbl.dataEnd);
    const stsc = findBox(moovBytes, 'stsc', stbl.dataOff, stbl.dataEnd);
    const stsz = findBox(moovBytes, 'stsz', stbl.dataOff, stbl.dataEnd);
    const stco = findBox(moovBytes, 'stco', stbl.dataOff, stbl.dataEnd)
      || findBox(moovBytes, 'co64', stbl.dataOff, stbl.dataEnd);
    if (!stsd || !stts || !stsc || !stsz || !stco) {
      console.warn(`[mp4MinFrame] vide trak missing tables: ${[!stsd && 'stsd', !stts && 'stts', !stsc && 'stsc', !stsz && 'stsz', !stco && 'stco/co64'].filter(Boolean).join(',')}`);
      continue;
    }

    const mdhdVer = moovBytes[mdhd.dataOff];
    const ts = u32(moovBytes, mdhd.dataOff + (mdhdVer === 0 ? 12 : 20)) || timescale;
    const dur = mdhdVer === 0
      ? u32(moovBytes, mdhd.dataOff + 16)
      : u64(moovBytes, mdhd.dataOff + 24);
    const trackDur = dur || duration;

    const targetTick = Math.min(trackDur, Math.max(0, Math.round(trackDur * ratio)));
    const sttsArr = parseStts(moovBytes, stts);
    let idx = sampleIndexAtTick(sttsArr, targetTick);
    if (idx < 1) idx = 1;

    // Prefer a sync sample (keyframe) at or before the target so the frame
    // decodes standalone — a P-frame without its references renders nothing.
    const stss = parseStss(moovBytes, findBox(moovBytes, 'stss', stbl.dataOff, stbl.dataEnd));
    if (stss && stss.length) {
      let sync = 0;
      for (const s of stss) {
        if (s <= idx) sync = s;
        else break;
      }
      if (sync > 0) idx = sync;
    }

    const stszParsed = parseStsz(moovBytes, stsz);
    if (!stszParsed.count) { console.warn(`[mp4MinFrame] stsz count 0`); continue; }
    const range = sampleByteRange(
      parseStsc(moovBytes, stsc),
      parseStco(moovBytes, stco),
      stszParsed,
      idx,
    );
    if (!range || range.size <= 0) { console.warn(`[mp4MinFrame] sampleByteRange null/size0 for idx=${idx} (trackDur=${trackDur} targetTick=${targetTick} stszCount=${stszParsed.count})`); continue; }
    if (range.size > MAX_SAMPLE_BYTES) {
      // A "sample" this big means the moov parse is garbage (false positive in
      // video data, or a moov truncated by the read window whose tables ran
      // into unrelated bytes). Say it — never hand back a range that would
      // make the caller fetch tens of MiB and blow the message cap.
      console.warn(
        `[mp4MinFrame] located "sample" of ${range.size}B at ${range.offset} — implausible, ` +
        'the moov being parsed is corrupt or a false positive; rejecting this track'
      );
      continue;
    }

    // stsd payload: [version/flags 4][entry_count 4][entries...] — copy the
    // first sample entry verbatim; it carries avcC (SPS/PPS). The visual sample
    // entry puts width/height at +32/+34 within the entry.
    const stsdCount = u32(moovBytes, stsd.dataOff + 4);
    if (stsdCount < 1) { console.warn('[mp4MinFrame] stsd count 0'); continue; }
    const entryOff = stsd.dataOff + 8;
    const entrySize = u32(moovBytes, entryOff);
    if (entrySize < 16 || entryOff + entrySize > stsd.dataEnd) { console.warn(`[mp4MinFrame] stsd entry bad size=${entrySize} off=${entryOff} dataEnd=${stsd.dataEnd}`); continue; }
    const stsdBytes = moovBytes.subarray(entryOff, entryOff + entrySize);
    const width = u16(moovBytes, entryOff + 32);
    const height = u16(moovBytes, entryOff + 34);

    // Per-sample delta for the rebuilt single-frame timeline.
    const sampleDuration = Math.max(1, Math.round((trackDur || ts) / Math.max(1, stszParsed.count)) || 1);

    return { offset: range.offset, size: range.size, timescale: ts, sampleDuration, stsdBytes, width, height };
  }
  if (!videoTrakSeen) console.warn('[mp4MinFrame] no video trak found at all');
  else console.warn(`[mp4MinFrame] video trak seen but no usable sample for ratio=${ratio} (trackDur=${trackDur} traks=${traks.length})`);
  return null;
}

function w32(arr, off, v) {
  arr[off] = (v >>> 24) & 0xff;
  arr[off + 1] = (v >>> 16) & 0xff;
  arr[off + 2] = (v >>> 8) & 0xff;
  arr[off + 3] = v & 0xff;
}

function ascii(str) {
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

function box(type, payload) {
  const buf = new Uint8Array(8 + payload.length);
  w32(buf, 0, 8 + payload.length);
  buf.set(ascii(type), 4);
  buf.set(payload, 8);
  return buf;
}

function u32Box(v) {
  const p = new Uint8Array(4);
  w32(p, 0, v);
  return p;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const MATRIX = new Uint8Array([
  0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0,
]);

/**
 * Rebuild a minimal but valid MP4 holding exactly one video sample. The
 * original stsd entry is embedded unchanged; the sample tables describe a
 * 1-frame, 1-chunk movie, and stco is patched (by box scan, not hand math) to
 * point into our own mdat.
 * @param {object} info from locateVideoFrame
 * @param {Uint8Array} sampleBytes the frame's payload
 * @returns {Uint8Array} playable MP4
 */
export function buildSingleFrameMp4(info, sampleBytes) {
  const { timescale, sampleDuration, stsdBytes, width, height } = info;
  const w = width || 640;
  const h = height || 360;

  const ftyp = box('ftyp', concat([
    ascii('isom'), u32Box(0x200), ascii('isomiso2avc1mp41'),
  ]));

  // mvhd v0: version/flags(4) creation(4) modification(4) timescale(4)
  // duration(4) rate(4) volume(2) reserved(10) matrix(36) predefined(24)
  // next_track_ID(4) = 96-byte payload. Field offsets are spec-fixed — a
  // decoder tolerates a misplaced one, but let's not rely on leniency.
  const mvhd = box('mvhd', (() => {
    const p = new Uint8Array(96);
    w32(p, 12, timescale || 1000);
    w32(p, 16, sampleDuration || 1);
    w32(p, 20, 0x00010000); // rate 1.0
    p[24] = 0x01; p[25] = 0x00; // volume 1.0
    p.set(MATRIX, 32);
    w32(p, 92, 2); // next_track_id
    return p;
  })());

  // tkhd v0: version/flags(4) creation(4) modification(4) track_ID(4)
  // reserved(4) duration(4) reserved(8) volume(2) reserved(2) matrix(36)
  // width(4) height(4) = 80-byte payload. duration is at +20 (a 4-byte
  // reserved field sits between track_ID and duration).
  const tkhd = box('tkhd', (() => {
    const p = new Uint8Array(80);
    w32(p, 0, 0x0003); // enabled + in_movie
    w32(p, 12, 1); // track_id
    w32(p, 20, sampleDuration || 1); // duration
    p[32] = 0x01; p[33] = 0x00; // volume 1.0
    p.set(MATRIX, 36);
    w32(p, 72, (w << 16)); // width 16.16
    w32(p, 76, (h << 16)); // height 16.16
    return p;
  })());

  // mdhd v0: version/flags(4) creation(4) modification(4) timescale(4)
  // duration(4) language(2) pre_defined(2) = 24-byte payload. language is at
  // +20, immediately after duration.
  const mdhd = box('mdhd', (() => {
    const p = new Uint8Array(24);
    w32(p, 12, timescale || 1000);
    w32(p, 16, sampleDuration || 1);
    p[20] = 0x55; p[21] = 0xc4; // und
    return p;
  })());

  // hdlr layout is [version/flags 4][pre_defined 4][handler_type 4][reserved 12]
  // — handler_type sits at payload offset 8, NOT 4 (pre_defined comes first).
  // Writing 'vide' at offset 4 still plays in lenient decoders but is invalid
  // ISO-BMFF, and a strict parser then sees a non-video track and skips it.
  const hdlr = box('hdlr', concat([
    new Uint8Array(8), ascii('vide'), new Uint8Array(12),
    ascii('VideoHandler\0'),
  ]));

  const vmhd = box('vmhd', new Uint8Array(12));

  const stsd = box('stsd', concat([new Uint8Array(4), u32Box(1), stsdBytes]));
  const stts = box('stts', (() => {
    const p = new Uint8Array(16);
    w32(p, 4, 1); // entry count
    w32(p, 8, 1); // sample count
    w32(p, 12, sampleDuration || 1); // delta
    return p;
  })());
  const stsc = box('stsc', (() => {
    const p = new Uint8Array(20);
    w32(p, 4, 1); // entry count
    w32(p, 8, 1); // first chunk
    w32(p, 12, 1); // samples per chunk
    w32(p, 16, 1); // sample description index
    return p;
  })());
  const stsz = box('stsz', (() => {
    const p = new Uint8Array(12);
    w32(p, 4, sampleBytes.length);
    w32(p, 8, 1);
    return p;
  })());
  const stco = box('stco', concat([new Uint8Array(4), u32Box(1), u32Box(0)]));

  const stbl = box('stbl', concat([stsd, stts, stsc, stsz, stco]));
  const minf = box('minf', concat([vmhd, stbl]));
  const mdia = box('mdia', concat([mdhd, hdlr, minf]));
  const trak = box('trak', concat([tkhd, mdia]));
  const moov = box('moov', concat([mvhd, trak]));

  const file = concat([ftyp, moov, box('mdat', sampleBytes)]);

  // Patch stco to point just past the mdat header. Located by walking the box
  // tree rather than summing header sizes by hand (that arithmetic is exactly
  // the kind of thing that silently drifts).
  const stblBox = (() => {
    const m = findBox(file, 'moov', 0, file.length);
    const t = m && findBox(file, 'trak', m.dataOff, m.dataEnd);
    const md = t && findBox(file, 'mdia', t.dataOff, t.dataEnd);
    const mf = md && findBox(file, 'minf', md.dataOff, md.dataEnd);
    return mf && findBox(file, 'stbl', mf.dataOff, mf.dataEnd);
  })();
  if (stblBox) {
    const co = findBox(file, 'stco', stblBox.dataOff, stblBox.dataEnd);
    if (co) w32(file, co.dataOff + 8, ftyp.length + moov.length + 8);
  }

  return file;
}
