// node:test suite for src/utils/duplicate-detector.js +
// src/utils/url-normalizer.js. The hash COMPARISON and metadata logic runs
// in node (WebCrypto + Blob); the hash GENERATION methods need
// createImageBitmap / OffscreenCanvas and are untestable here — see the
// report, not this file.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DuplicateDetector } from '../src/utils/duplicate-detector.js';
import { URLNormalizer } from '../src/utils/url-normalizer.js';

// checkDuplicates logs a wall of console output per scan; keep the suite
// readable by silencing console.log inside those tests only.
async function quietly(fn) {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

describe('URLNormalizer.normalize', () => {
  test('a Facebook CDN URL is stripped to origin + path', () => {
    assert.equal(
      URLNormalizer.normalize('https://scontent.fbfb-1.fna.fbcdn.net/v/t1.0-9/123.jpg?oh=abc&_nc_sid=def&oe=123'),
      'https://scontent.fbfb-1.fna.fbcdn.net/v/t1.0-9/123.jpg',
    );
  });
  test('a Facebook CDN URL keeps only its essential params — session params are stripped', () => {
    assert.equal(
      URLNormalizer.normalize('https://scontent.xx.fbcdn.net/a.jpg?fbid=123&oh=abc'),
      'https://scontent.xx.fbcdn.net/a.jpg?fbid=123',
    );
    assert.equal(
      URLNormalizer.normalize('https://scontent.xx.fbcdn.net/a.jpg?set=pcb.1&id=456&oe=789'),
      'https://scontent.xx.fbcdn.net/a.jpg?set=pcb.1&id=456',
    );
    // two different photos must not compare equal after normalizing
    assert.equal(
      URLNormalizer.areEqual(
        'https://scontent.xx.fbcdn.net/a.jpg?fbid=111&oh=abc',
        'https://scontent.xx.fbcdn.net/a.jpg?fbid=222&oh=abc',
      ),
      false,
    );
    // same photo, different session params still compares equal
    assert.equal(
      URLNormalizer.areEqual(
        'https://scontent.xx.fbcdn.net/a.jpg?fbid=111&oh=aaa',
        'https://scontent.xx.fbcdn.net/a.jpg?fbid=111&oh=bbb',
      ),
      true,
    );
  });
  test('other known CDNs lose all query params', () => {
    assert.equal(
      URLNormalizer.normalize('https://i.imgur.com/abc.png?x=1&y=2'),
      'https://i.imgur.com/abc.png',
    );
    assert.equal(
      URLNormalizer.normalize('https://d123.cloudfront.net/a.jpg?Expires=1&Signature=2'),
      'https://d123.cloudfront.net/a.jpg',
    );
    assert.equal(
      URLNormalizer.normalize('https://images.unsplash.com/photo?w=100&h=100'),
      'https://images.unsplash.com/photo?w=100&h=100',
    );
  });
  test('regular URLs pass through untouched', () => {
    const url = 'https://example.com/img.jpg?size=large&v=2';
    assert.equal(URLNormalizer.normalize(url), url);
  });
  test('non-strings, missing scheme, and control characters pass through', () => {
    assert.equal(URLNormalizer.normalize(null), null);
    assert.equal(URLNormalizer.normalize(undefined), undefined);
    assert.equal(URLNormalizer.normalize(42), 42);
    assert.equal(URLNormalizer.normalize(''), '');
    assert.equal(URLNormalizer.normalize('example.com/a.jpg'), 'example.com/a.jpg');
    assert.equal(URLNormalizer.normalize('https://example.com/a\tb.jpg'), 'https://example.com/a\tb.jpg');
  });
  test('an unparseable URL passes through', () => {
    assert.equal(URLNormalizer.normalize('https://exa mple.com/'), 'https://exa mple.com/');
  });
});

describe('URLNormalizer.isCDN / areEqual', () => {
  test('known CDN hostnames match by substring', () => {
    assert.equal(URLNormalizer.isCDN('i.imgur.com'), true);
    assert.equal(URLNormalizer.isCDN('scontent.xx.fbcdn.net'), true);
    assert.equal(URLNormalizer.isCDN('cdn.cloudflare.com'), false);
    assert.equal(URLNormalizer.isCDN('example.com'), false);
  });
  test('areEqual compares after normalization', () => {
    assert.equal(
      URLNormalizer.areEqual(
        'https://i.imgur.com/abc.png?x=1',
        'https://i.imgur.com/abc.png?y=2',
      ),
      true,
    );
    assert.equal(
      URLNormalizer.areEqual('https://example.com/a.jpg?v=1', 'https://example.com/a.jpg?v=2'),
      false,
    );
  });
});

describe('DuplicateDetector thresholds', () => {
  test('constructor defaults: pHash 100/1024, aHash 15/64, dHash 20/64, aspect 0.25', () => {
    const d = new DuplicateDetector();
    assert.equal(d.pHashThreshold, 100);
    assert.equal(d.aHashThreshold, 15);
    assert.equal(d.dHashThreshold, 20);
    assert.equal(d.aspectRatioTolerance, 0.25);
  });
});

describe('DuplicateDetector.generateSHA256', () => {
  test('hashes a blob to the known SHA-256 hex', async () => {
    const d = new DuplicateDetector();
    const hash = await d.generateSHA256(new Blob(['abc']));
    assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('an empty blob hashes to the empty-input digest', async () => {
    const d = new DuplicateDetector();
    assert.equal(
      await d.generateSHA256(new Blob([])),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('DuplicateDetector SVG helpers', () => {
  const d = new DuplicateDetector();
  test('isSvgSource detects svg by mime, data URL, or extension', () => {
    assert.equal(d.isSvgSource({ type: 'image/svg+xml' }, ''), true);
    assert.equal(d.isSvgSource({ type: 'image/png' }, 'https://example.com/a.svg'), true);
    assert.equal(d.isSvgSource({ type: 'image/png' }, 'https://example.com/a.svg?x=1'), true);
    assert.equal(d.isSvgSource({ type: '' }, 'data:image/svg+xml;base64,PHN2Zz4='), true);
    assert.equal(d.isSvgSource({ type: 'image/png' }, 'https://example.com/a.png'), false);
    assert.equal(d.isSvgSource(null, ''), false);
  });
  test('parseSvgLength reads the leading number, units ignored', () => {
    assert.equal(d.parseSvgLength('120px'), 120);
    assert.equal(d.parseSvgLength('12.5em'), 12.5);
    assert.equal(d.parseSvgLength('100%'), 100);
    assert.equal(d.parseSvgLength('abc'), 0);
    assert.equal(d.parseSvgLength(''), 0);
    assert.equal(d.parseSvgLength(null), 0);
  });
  test('extractSvgDimensions prefers width/height attrs, falls back to viewBox', () => {
    assert.deepEqual(
      d.extractSvgDimensions('<svg width="120" height="80" viewBox="0 0 640 480"></svg>'),
      { width: 120, height: 80 },
    );
    assert.deepEqual(
      d.extractSvgDimensions('<svg viewBox="0 0 640 480"></svg>'),
      { width: 640, height: 480 },
    );
    assert.deepEqual(
      d.extractSvgDimensions('<svg width="120"></svg>'),
      { width: 120, height: 0 },
    );
    assert.deepEqual(d.extractSvgDimensions('not an svg'), { width: 0, height: 0 });
    assert.deepEqual(d.extractSvgDimensions(''), { width: 0, height: 0 });
  });
  test('extractSvgMetadata hashes, sizes, and tags the file as SVG', async () => {
    const svg = '<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg"></svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const meta = await d.extractSvgMetadata(blob, 'https://example.com/a.svg', 'https://example.com/p');
    assert.equal(meta.width, 120);
    assert.equal(meta.height, 80);
    assert.equal(meta.fileSize, blob.size);
    assert.equal(meta.pHash, '');
    assert.equal(meta.aHash, '');
    assert.equal(meta.dHash, '');
    assert.equal(meta.sourceUrl, 'https://example.com/a.svg');
    assert.equal(meta.exifMetadata.FileType, 'SVG');
    assert.equal(meta.exifMetadata.SVGWidth, 120);
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);
  });
});

describe('DuplicateDetector.toGrayscale / hammingDistance', () => {
  const d = new DuplicateDetector();
  test('toGrayscale applies the luma weights', () => {
    // pure red, pure green, pure blue, white
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    assert.deepEqual(d.toGrayscale({ data }), [76, 150, 29, 255]);
  });
  test('hammingDistance counts differing bits', () => {
    assert.equal(d.hammingDistance('0000', '0000'), 0);
    assert.equal(d.hammingDistance('0000', '1111'), 4);
    assert.equal(d.hammingDistance('0101', '0111'), 1);
  });
  test('hammingDistance is Infinity for unequal lengths', () => {
    assert.equal(d.hammingDistance('000', '0000'), Infinity);
  });
});

describe('DuplicateDetector.isRealHttpUrl', () => {
  const d = new DuplicateDetector();
  test('http/https URLs are real; data/blob/relative are not', () => {
    assert.equal(d.isRealHttpUrl('https://example.com/a.png'), true);
    assert.equal(d.isRealHttpUrl('http://example.com/a.png'), true);
    assert.equal(d.isRealHttpUrl('data:image/png;base64,abc'), false);
    assert.equal(d.isRealHttpUrl('blob:https://example.com/uuid'), false);
    assert.equal(d.isRealHttpUrl('/relative/path.png'), false);
    assert.equal(d.isRealHttpUrl(''), false);
    assert.equal(d.isRealHttpUrl(null), false);
    assert.equal(d.isRealHttpUrl('not a url'), false);
  });
});

describe('DuplicateDetector.getMatchKey / getPrimaryMatchType', () => {
  const d = new DuplicateDetector();
  test('id wins, then firestore id, then sha256, then the composite key', () => {
    assert.equal(d.getMatchKey({ id: '1', sha256: 'abc' }), '1');
    assert.equal(d.getMatchKey({ firestoreDocumentId: 'fs1', sha256: 'abc' }), 'fs1');
    assert.equal(d.getMatchKey({ sha256: 'abc' }), 'abc');
    const composite = d.getMatchKey({
      sourceImageUrl: 'https://example.com/a.png',
      sourcePageUrl: 'https://example.com/p',
      imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } },
    });
    assert.match(composite, /example\.com\/a\.png/);
    assert.match(composite, /i\.ibb\.co\/a\.png/);
  });
  test('exact beats context beats visual', () => {
    assert.equal(d.getPrimaryMatchType(['visual', 'context', 'exact']), 'exact');
    assert.equal(d.getPrimaryMatchType(['visual', 'context']), 'context');
    assert.equal(d.getPrimaryMatchType(['visual']), 'visual');
    assert.equal(d.getPrimaryMatchType([]), 'unknown');
    assert.equal(d.getPrimaryMatchType(['other']), 'other');
  });
});

describe('DuplicateDetector aspect ratio helpers', () => {
  const d = new DuplicateDetector();
  test('getAspectRatio is width/height, null without both', () => {
    assert.equal(d.getAspectRatio({ width: 800, height: 400 }), 2);
    assert.equal(d.getAspectRatio({ width: 800 }), null);
    assert.equal(d.getAspectRatio({}), null);
    assert.equal(d.getAspectRatio({ width: 0, height: 100 }), null);
  });
  test('hasCompatibleAspectRatio tolerates 25% relative difference', () => {
    assert.equal(d.hasCompatibleAspectRatio({ width: 100, height: 100 }, { width: 120, height: 100 }), true);
    assert.equal(d.hasCompatibleAspectRatio({ width: 100, height: 100 }, { width: 200, height: 100 }), false);
    // missing dimensions on either side are compatible (no signal)
    assert.equal(d.hasCompatibleAspectRatio({}, { width: 200, height: 100 }), true);
  });
});

describe('DuplicateDetector.compareHashes', () => {
  const d = new DuplicateDetector();
  const zeros64 = '0'.repeat(64);
  const zeros1024 = '0'.repeat(1024);
  const flip = (hash, n) => {
    const arr = hash.split('');
    for (let i = 0; i < n; i += 1) arr[i] = arr[i] === '0' ? '1' : '0';
    return arr.join('');
  };
  test('identical hashes match on all three with 100% similarity', () => {
    const out = d.compareHashes(
      { pHash: zeros1024, aHash: zeros64, dHash: zeros64 },
      { pHash: zeros1024, aHash: zeros64, dHash: zeros64 },
    );
    assert.equal(out.matchCount, 3);
    assert.equal(out.avgSimilarity, 100);
    assert.equal(out.details.pHash.match, true);
    assert.equal(out.details.aHash.match, true);
    assert.equal(out.details.dHash.match, true);
  });
  test('thresholds: pHash 100/1024, aHash 15/64, dHash 20/64', () => {
    const out = d.compareHashes(
      { pHash: zeros1024, aHash: zeros64, dHash: zeros64 },
      { pHash: flip(zeros1024, 100), aHash: flip(zeros64, 15), dHash: flip(zeros64, 20) },
    );
    assert.equal(out.details.pHash.match, true);
    assert.equal(out.details.aHash.match, true);
    assert.equal(out.details.dHash.match, true);
    const over = d.compareHashes(
      { pHash: zeros1024, aHash: zeros64, dHash: zeros64 },
      { pHash: flip(zeros1024, 101), aHash: flip(zeros64, 16), dHash: flip(zeros64, 21) },
    );
    assert.equal(over.details.pHash.match, false);
    assert.equal(over.details.aHash.match, false);
    assert.equal(over.details.dHash.match, false);
    assert.equal(over.matchCount, 0);
  });
  test('missing hashes on either side are skipped', () => {
    const out = d.compareHashes({ aHash: zeros64 }, { aHash: zeros64 });
    assert.equal(out.matchCount, 1);
    assert.deepEqual(Object.keys(out.details), ['aHash']);
    assert.equal(out.avgSimilarity, 100);
  });
  test('no comparable hashes yields 0 similarity', () => {
    const out = d.compareHashes({}, {});
    assert.equal(out.matchCount, 0);
    assert.equal(out.avgSimilarity, 0);
  });
  test('similarity is the average of the compared hashes', () => {
    const out = d.compareHashes(
      { aHash: zeros64, dHash: zeros64 },
      { aHash: zeros64, dHash: flip(zeros64, 32) },
    );
    // aHash 100%, dHash 50% -> 75%
    assert.equal(out.avgSimilarity, 75);
  });
});

describe('DuplicateDetector.classifyVisualMatch', () => {
  const d = new DuplicateDetector();
  const meta = { width: 100, height: 100 };
  const img = { width: 100, height: 100 };
  test('3/3 hashes block as strong', () => {
    assert.deepEqual(
      d.classifyVisualMatch(meta, img, { matchCount: 3, details: { pHash: { match: true } } }),
      { blocks: true, strength: 'strong', reason: 'Strong visual match (3/3 hashes)' },
    );
  });
  test('2/3 with pHash blocks as likely, without pHash as review', () => {
    assert.equal(d.classifyVisualMatch(meta, img, { matchCount: 2, details: { pHash: { match: true } } }).strength, 'likely');
    assert.equal(d.classifyVisualMatch(meta, img, { matchCount: 2, details: { pHash: { match: true } } }).blocks, true);
    const review = d.classifyVisualMatch(meta, img, { matchCount: 2, details: { aHash: { match: true } } });
    assert.equal(review.strength, 'review');
    assert.equal(review.blocks, true);
  });
  test('1/3 is possible and does not block', () => {
    const out = d.classifyVisualMatch(meta, img, { matchCount: 1, details: {} });
    assert.equal(out.blocks, false);
    assert.equal(out.strength, 'possible');
  });
  test('0 matches is none', () => {
    assert.deepEqual(
      d.classifyVisualMatch(meta, img, { matchCount: 0, details: {} }),
      { blocks: false, strength: 'none', reason: '' },
    );
  });
  test('an aspect mismatch downgrades a partial match to possible/non-blocking', () => {
    const wide = { width: 400, height: 100 };
    const out = d.classifyVisualMatch(meta, wide, { matchCount: 2, details: { pHash: { match: true } } });
    assert.equal(out.blocks, false);
    assert.equal(out.strength, 'possible');
    assert.match(out.reason, /aspect ratios differ/);
  });
  test('an aspect mismatch does NOT downgrade a 3/3 match', () => {
    const wide = { width: 400, height: 100 };
    const out = d.classifyVisualMatch(meta, wide, { matchCount: 3, details: { pHash: { match: true } } });
    assert.equal(out.blocks, true);
    assert.equal(out.strength, 'strong');
  });
});

describe('DuplicateDetector.checkDuplicates', () => {
  const d = new DuplicateDetector();
  const zeros64 = '0'.repeat(64);
  const zeros1024 = '0'.repeat(1024);
  const baseMeta = {
    sha256: 'aaaabbbb',
    pHash: zeros1024,
    aHash: zeros64,
    dHash: zeros64,
    width: 100,
    height: 100,
    fileSize: 1234,
    sourceUrl: 'https://example.com/a.png',
    pageUrl: 'https://example.com/p',
  };

  test('no matches at all reports clean', async () => {
    const out = await quietly(() => d.checkDuplicates(baseMeta, []));
    assert.equal(out.isDuplicate, false);
    assert.deepEqual(out.allMatches, []);
    assert.equal(out.exactMatch, null);
    assert.equal(out.visualMatch, null);
    assert.equal(out.contextMatch, null);
  });

  test('the same source + page URL is a blocking context match', async () => {
    const out = await quietly(() => d.checkDuplicates(baseMeta, [{
      id: '1',
      sourceImageUrl: 'https://example.com/a.png',
      sourcePageUrl: 'https://example.com/p',
      sha256: 'different',
    }]));
    assert.equal(out.isDuplicate, true);
    assert.equal(out.contextMatch.id, '1');
    assert.deepEqual(out.contextMatch.matchTypes, ['context']);
    assert.equal(out.allMatches.length, 1);
  });

  test('CDN query params do not hide a context match', async () => {
    const meta = {
      ...baseMeta,
      sourceUrl: 'https://i.imgur.com/abc.png?x=1',
      pageUrl: 'https://example.com/p',
    };
    const out = await quietly(() => d.checkDuplicates(meta, [{
      id: '1',
      sourceImageUrl: 'https://i.imgur.com/abc.png?y=2',
      sourcePageUrl: 'https://example.com/p',
      sha256: 'different',
    }]));
    assert.equal(out.isDuplicate, true);
    assert.equal(out.contextMatch.id, '1');
  });

  test('a data: source URL skips the context check entirely', async () => {
    const meta = { ...baseMeta, sourceUrl: 'data:image/png;base64,abc', pageUrl: 'https://example.com/p' };
    const out = await quietly(() => d.checkDuplicates(meta, [{
      id: '1',
      sourceImageUrl: 'data:image/png;base64,abc',
      sourcePageUrl: 'https://example.com/p',
      sha256: 'different',
    }]));
    assert.equal(out.isDuplicate, false);
    assert.equal(out.contextMatch, null);
  });

  test('the same SHA-256 is a blocking exact match', async () => {
    const out = await quietly(() => d.checkDuplicates(baseMeta, [{
      id: '1',
      sourceImageUrl: 'https://other.example/b.png',
      sourcePageUrl: 'https://other.example/q',
      sha256: 'aaaabbbb',
    }]));
    assert.equal(out.isDuplicate, true);
    assert.equal(out.exactMatch.id, '1');
    assert.deepEqual(out.exactMatch.matchTypes, ['exact']);
  });

  test('context + exact on the same item merge into one match', async () => {
    const out = await quietly(() => d.checkDuplicates(baseMeta, [{
      id: '1',
      sourceImageUrl: 'https://example.com/a.png',
      sourcePageUrl: 'https://example.com/p',
      sha256: 'aaaabbbb',
    }]));
    assert.equal(out.allMatches.length, 1);
    assert.deepEqual(out.allMatches[0].matchTypes.sort(), ['context', 'exact']);
    assert.equal(out.allMatches[0].matchType, 'exact');
  });

  test('a 3/3 visual match blocks; a 1/3 match is possible-only', async () => {
    const flip = (hash, n) => {
      const arr = hash.split('');
      for (let i = 0; i < n; i += 1) arr[i] = arr[i] === '0' ? '1' : '0';
      return arr.join('');
    };
    const out = await quietly(() => d.checkDuplicates(baseMeta, [
      {
        id: 'strong',
        sourceImageUrl: 'https://other.example/s.png',
        sourcePageUrl: 'https://other.example/s',
        sha256: 'other1',
        pHash: zeros1024, aHash: zeros64, dHash: zeros64,
        width: 100, height: 100,
      },
      {
        id: 'weak',
        sourceImageUrl: 'https://other.example/w.png',
        sourcePageUrl: 'https://other.example/w',
        sha256: 'other2',
        pHash: zeros1024, aHash: flip(zeros64, 40), dHash: flip(zeros64, 40),
        width: 100, height: 100,
      },
    ]));
    assert.equal(out.isDuplicate, true);
    assert.equal(out.visualMatch.id, 'strong');
    assert.equal(out.visualMatch.visualStrength, 'strong');
    assert.equal(out.possibleMatches.length, 1);
    assert.equal(out.possibleMatches[0].id, 'weak');
    assert.equal(out.possibleMatches[0].visualStrength, 'possible');
  });

  test('progress callbacks fire', async () => {
    const seen = [];
    await quietly(() => d.checkDuplicates(baseMeta, [], (msg) => seen.push(msg)));
    assert.ok(seen.some((m) => m.includes('Phase 1')));
    assert.ok(seen.some((m) => m.includes('No duplicates found')));
  });
});
