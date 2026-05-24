import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import {
  normalizeMediaItem,
  normalizeImageHosts,
  normalizeVideoHosts,
} from '../../shared/mediaItemNormalizer.js';
import {
  MEDIA_KIND_IMAGE,
  MEDIA_KIND_SYSTEM,
  getAllBaseFieldKeys,
  getSystemFieldKeys,
  getTechnicalFieldKeys,
  stripKnownTopLevelMediaFields,
} from '../../shared/mediaFieldRegistry.js';

const SCRIPT_VERSION = 1;
const MIGRATION_KEY = 'mediaFormatV2';
const DEFAULT_BATCH_SIZE = 25;

const args = parseArgs(process.argv.slice(2));
let sql;

function parseArgs(argv) {
  const parsed = {
    apply: false,
    dryRun: true,
    help: false,
    selfTest: false,
    batchSize: DEFAULT_BATCH_SIZE,
    cursor: '',
    ids: [],
    backupDir: path.resolve(process.cwd(), 'migration-backups'),
    force: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      parsed.apply = true;
      parsed.dryRun = false;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
      parsed.apply = false;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--self-test') {
      parsed.selfTest = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg.startsWith('--batch-size=')) {
      parsed.batchSize = Math.max(1, Number(arg.slice('--batch-size='.length)) || DEFAULT_BATCH_SIZE);
    } else if (arg.startsWith('--cursor=')) {
      parsed.cursor = arg.slice('--cursor='.length).trim();
    } else if (arg.startsWith('--ids=')) {
      parsed.ids = arg.slice('--ids='.length).split(',').map((id) => id.trim()).filter(Boolean);
    } else if (arg.startsWith('--backup-dir=')) {
      parsed.backupDir = path.resolve(process.cwd(), arg.slice('--backup-dir='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`ImgVault media format v2 migrator

Dry-run one batch:
  node ./scripts/migrate-media-format-v2.mjs --batch-size=25

Apply one batch:
  node ./scripts/migrate-media-format-v2.mjs --apply --batch-size=25

Continue after a cursor:
  node ./scripts/migrate-media-format-v2.mjs --cursor=<last_scanned_id> --batch-size=25

Migrate exact IDs:
  node ./scripts/migrate-media-format-v2.mjs --ids=id1,id2 --apply

Safety:
  - Dry-run is the default.
  - Apply mode writes a JSONL backup before updating rows.
  - The full previous DB row is preserved in extra_metadata._migrations.mediaFormatV2.originalRow.
  - Stable duplicate fields removed from extra_metadata are preserved in the migration snapshot.
  - Conflicts are captured under extra_metadata._migrations.mediaFormatV2.conflicts.
`);
}

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

function parseObject(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function hasValue(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function asText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asNullableText(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function asInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asFloat(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIsoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asTags(value) {
  return Array.isArray(value) ? value.map((tag) => String(tag)) : [];
}

function canonicalizeLinkUrl(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const params = new URLSearchParams(url.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      params.delete(key);
    }
    const query = params.toString();
    return `${url.protocol}//${host}${url.pathname}${query ? `?${query}` : ''}`;
  } catch (_) {
    return raw;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(normalizeComparable(a)) === JSON.stringify(normalizeComparable(b));
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-postgres-url]')
    .replace(/\b(password|secret|token|key)=([^&\s]+)/gi, '$1=[redacted]');
}

function normalizeComparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalizeComparable(nested)])
    );
  }
  return value;
}

function normalizeNumberForCompare(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function valuesEquivalentForConflict(key, a, b) {
  if (key === 'fileSize' || key === 'duration') {
    return deepEqual(normalizeNumberForCompare(a), normalizeNumberForCompare(b));
  }
  return deepEqual(a, b);
}

function rowToMediaItem(row = {}) {
  return {
    id: row.id,
    kind: row.kind,
    isVideo: row.is_video,
    isLink: row.is_link,
    pageTitle: row.page_title,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    collectionId: row.collection_id,
    internalAddedTimestamp: asIsoOrNull(row.internal_added_timestamp),
    sourceImageUrl: row.source_image_url,
    sourcePageUrl: row.source_page_url,
    fileName: row.file_name,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    duration: row.duration,
    fileType: row.file_type,
    fileTypeSource: row.file_type_source,
    creationDate: asIsoOrNull(row.creation_date),
    creationDateSource: row.creation_date_source,
    sha256: row.sha256,
    pHash: row.p_hash,
    aHash: row.a_hash,
    dHash: row.d_hash,
    exifMetadata: row.exif_metadata,
    extraMetadata: row.extra_metadata,
    pixvidUrl: row.pixvid_url,
    pixvidDeleteUrl: row.pixvid_delete_url,
    imgbbUrl: row.imgbb_url,
    imgbbDeleteUrl: row.imgbb_delete_url,
    imgbbThumbUrl: row.imgbb_thumb_url,
    filemoonWatchUrl: row.filemoon_watch_url,
    filemoonDirectUrl: row.filemoon_direct_url,
    udropWatchUrl: row.udrop_watch_url,
    udropDirectUrl: row.udrop_direct_url,
    linkUrl: row.link_url,
    linkUrlCanonical: row.link_url_canonical,
    linkPreviewImageUrl: row.link_preview_image_url,
    faviconUrl: row.favicon_url,
    lastVisitedAt: asIsoOrNull(row.last_visited_at),
    deletedAt: asIsoOrNull(row.deleted_at),
    createdAt: asIsoOrNull(row.created_at),
    updatedAt: asIsoOrNull(row.updated_at),
  };
}

function payloadFromNormalized(rowItem, normalized, extraMetadata) {
  const linkUrl = asText(normalized.linkUrl);
  const dbKind = normalized.kind === MEDIA_KIND_SYSTEM ? MEDIA_KIND_IMAGE : normalized.kind;
  return {
    kind: dbKind,
    isVideo: normalized.kind === MEDIA_KIND_SYSTEM ? false : asBool(normalized.isVideo),
    isLink: normalized.kind === MEDIA_KIND_SYSTEM ? false : asBool(normalized.isLink),
    pageTitle: asText(normalized.pageTitle),
    description: asText(normalized.description),
    tags: asTags(normalized.tags),
    collectionId: asNullableText(normalized.collectionId),
    internalAddedTimestamp: asIsoOrNull(normalized.internalAddedTimestamp) || new Date().toISOString(),
    sourceImageUrl: asText(normalized.sourceImageUrl),
    sourcePageUrl: asText(normalized.sourcePageUrl),
    fileName: asText(normalized.fileName),
    fileSize: asInt(normalized.fileSize),
    width: asInt(normalized.width),
    height: asInt(normalized.height),
    duration: asFloat(normalized.duration),
    fileType: asText(normalized.fileType),
    fileTypeSource: asText(normalized.fileTypeSource),
    creationDate: asIsoOrNull(normalized.creationDate),
    creationDateSource: asText(normalized.creationDateSource),
    sha256: asText(normalized.sha256),
    pHash: asText(normalized.pHash),
    aHash: asText(normalized.aHash),
    dHash: asText(normalized.dHash),
    exifMetadata: isPlainObject(normalized.exifMetadata) ? normalized.exifMetadata : (isPlainObject(rowItem.exifMetadata) ? rowItem.exifMetadata : null),
    extraMetadata,
    pixvidUrl: asText(normalized.pixvidUrl),
    pixvidDeleteUrl: asText(normalized.pixvidDeleteUrl),
    imgbbUrl: asText(normalized.imgbbUrl),
    imgbbDeleteUrl: asText(normalized.imgbbDeleteUrl),
    imgbbThumbUrl: asText(normalized.imgbbThumbUrl),
    filemoonWatchUrl: asText(normalized.filemoonWatchUrl),
    filemoonDirectUrl: asText(normalized.filemoonDirectUrl),
    udropWatchUrl: asText(normalized.udropWatchUrl),
    udropDirectUrl: asText(normalized.udropDirectUrl),
    linkUrl,
    linkUrlCanonical: asText(normalized.linkUrlCanonical) || canonicalizeLinkUrl(linkUrl || normalized.sourcePageUrl || ''),
    linkPreviewImageUrl: asText(normalized.linkPreviewImageUrl),
    faviconUrl: asText(normalized.faviconUrl),
    lastVisitedAt: asIsoOrNull(normalized.lastVisitedAt),
    deletedAt: asIsoOrNull(normalized.deletedAt),
  };
}

function detectRootExtraKeysToMove(originalExtra) {
  const movedKeySet = new Set([
    ...getAllBaseFieldKeys(),
    ...getTechnicalFieldKeys(),
    ...getSystemFieldKeys(),
    'ai',
  ]);
  const keptInExtra = new Set([
    'imageHosts',
    'videoHosts',
    'ai',
    'isVaulted',
    'vaultMode',
    'vaultedAt',
    'systemType',
    'secretVaultConfig',
  ]);
  return Object.keys(originalExtra || {})
    .filter((key) => movedKeySet.has(key) && !keptInExtra.has(key))
    .sort();
}

function collectConflicts(rowItem, originalExtra) {
  const conflicts = {};
  const imageHosts = parseObject(originalExtra.imageHosts);
  const videoHosts = parseObject(originalExtra.videoHosts);
  const pixvid = parseObject(imageHosts.pixvid);
  const imgbb = parseObject(imageHosts.imgbb);
  const filemoon = parseObject(videoHosts.filemoon);
  const udrop = parseObject(videoHosts.udrop);
  const stableKeys = [
    ...getAllBaseFieldKeys(),
    ...getTechnicalFieldKeys(),
    'deletedAt',
  ];

  for (const key of stableKeys) {
    if (!hasValue(rowItem[key]) || !hasValue(originalExtra[key])) continue;
    if (!valuesEquivalentForConflict(key, rowItem[key], originalExtra[key])) {
      conflicts[key] = {
        column: rowItem[key],
        extraMetadata: originalExtra[key],
      };
    }
  }

  addProviderConflict(conflicts, 'imageHosts.pixvid.url', rowItem.pixvidUrl, pixvid.url);
  addProviderConflict(conflicts, 'imageHosts.imgbb.url', rowItem.imgbbUrl, imgbb.url);
  addProviderConflict(conflicts, 'videoHosts.filemoon.watchUrl', rowItem.filemoonWatchUrl || rowItem.filemoonUrl, filemoon.watchUrl);
  addProviderConflict(conflicts, 'videoHosts.udrop.watchUrl', rowItem.udropWatchUrl || rowItem.udropUrl, udrop.watchUrl);

  return conflicts;
}

function addProviderConflict(conflicts, key, columnValue, hostValue) {
  if (!hasValue(columnValue) || !hasValue(hostValue)) return;
  if (deepEqual(columnValue, hostValue)) return;
  conflicts[key] = {
    column: columnValue,
    extraMetadata: hostValue,
  };
}

function buildCanonicalExtra(rowItem, normalized) {
  const originalExtra = parseObject(rowItem.extraMetadata);
  const strippedExtra = stripKnownTopLevelMediaFields(originalExtra);
  const nextExtra = {
    ...strippedExtra,
  };

  const imageHosts = normalizeImageHosts(normalized, originalExtra);
  if (Object.keys(imageHosts).length > 0) nextExtra.imageHosts = imageHosts;

  const videoHosts = normalizeVideoHosts(normalized, originalExtra);
  if (Object.keys(videoHosts).length > 0) nextExtra.videoHosts = videoHosts;

  const originalAi = parseObject(originalExtra.ai);
  const normalizedAi = parseObject(normalized.extraMetadata?.ai);
  if (Object.keys(originalAi).length > 0 || Object.keys(normalizedAi).length > 0) {
    nextExtra.ai = {
      ...originalAi,
      ...normalizedAi,
    };
  }

  return nextExtra;
}

function buildMigratedExtra(rowItem, normalized, migrationInfo) {
  const originalExtra = parseObject(rowItem.extraMetadata);
  const nextExtra = buildCanonicalExtra(rowItem, normalized);
  const currentMigrations = parseObject(nextExtra._migrations);
  const existingMigration = parseObject(currentMigrations[MIGRATION_KEY]);

  nextExtra._migrations = {
    ...currentMigrations,
    [MIGRATION_KEY]: {
      ...existingMigration,
      version: 1,
      script: 'migrate-media-format-v2.mjs',
      scriptVersion: SCRIPT_VERSION,
      migratedAt: existingMigration.migratedAt || migrationInfo.migratedAt,
      lastCheckedAt: migrationInfo.migratedAt,
      originalRow: existingMigration.originalRow || migrationInfo.originalRow || {},
      originalExtraMetadata: existingMigration.originalExtraMetadata || originalExtra,
      movedRootExtraKeys: migrationInfo.movedRootExtraKeys,
      filledColumnKeys: migrationInfo.filledColumnKeys,
      changedColumnKeys: migrationInfo.changedColumnKeys,
      conflictKeys: Object.keys(migrationInfo.conflicts),
      conflicts: migrationInfo.conflicts,
      backupFile: migrationInfo.backupFile || existingMigration.backupFile || '',
    },
  };

  return nextExtra;
}

function comparePayloadToRow(row, payload) {
  const checks = [
    ['kind', row.kind, payload.kind],
    ['isVideo', row.is_video, payload.isVideo],
    ['isLink', row.is_link, payload.isLink],
    ['pageTitle', row.page_title, payload.pageTitle],
    ['description', row.description, payload.description],
    ['tags', row.tags, payload.tags],
    ['collectionId', row.collection_id, payload.collectionId],
    ['internalAddedTimestamp', asIsoOrNull(row.internal_added_timestamp), payload.internalAddedTimestamp],
    ['sourceImageUrl', row.source_image_url, payload.sourceImageUrl],
    ['sourcePageUrl', row.source_page_url, payload.sourcePageUrl],
    ['fileName', row.file_name, payload.fileName],
    ['fileSize', normalizeNumberForCompare(row.file_size), normalizeNumberForCompare(payload.fileSize)],
    ['width', normalizeNumberForCompare(row.width), normalizeNumberForCompare(payload.width)],
    ['height', normalizeNumberForCompare(row.height), normalizeNumberForCompare(payload.height)],
    ['duration', normalizeNumberForCompare(row.duration), normalizeNumberForCompare(payload.duration)],
    ['fileType', row.file_type, payload.fileType],
    ['fileTypeSource', row.file_type_source, payload.fileTypeSource],
    ['creationDate', asIsoOrNull(row.creation_date), payload.creationDate],
    ['creationDateSource', row.creation_date_source, payload.creationDateSource],
    ['sha256', row.sha256, payload.sha256],
    ['pHash', row.p_hash, payload.pHash],
    ['aHash', row.a_hash, payload.aHash],
    ['dHash', row.d_hash, payload.dHash],
    ['exifMetadata', row.exif_metadata, payload.exifMetadata],
    ['extraMetadata', row.extra_metadata, payload.extraMetadata],
    ['pixvidUrl', row.pixvid_url, payload.pixvidUrl],
    ['pixvidDeleteUrl', row.pixvid_delete_url, payload.pixvidDeleteUrl],
    ['imgbbUrl', row.imgbb_url, payload.imgbbUrl],
    ['imgbbDeleteUrl', row.imgbb_delete_url, payload.imgbbDeleteUrl],
    ['imgbbThumbUrl', row.imgbb_thumb_url, payload.imgbbThumbUrl],
    ['filemoonWatchUrl', row.filemoon_watch_url, payload.filemoonWatchUrl],
    ['filemoonDirectUrl', row.filemoon_direct_url, payload.filemoonDirectUrl],
    ['udropWatchUrl', row.udrop_watch_url, payload.udropWatchUrl],
    ['udropDirectUrl', row.udrop_direct_url, payload.udropDirectUrl],
    ['linkUrl', row.link_url, payload.linkUrl],
    ['linkUrlCanonical', row.link_url_canonical, payload.linkUrlCanonical],
    ['linkPreviewImageUrl', row.link_preview_image_url, payload.linkPreviewImageUrl],
    ['faviconUrl', row.favicon_url, payload.faviconUrl],
    ['lastVisitedAt', asIsoOrNull(row.last_visited_at), payload.lastVisitedAt],
    ['deletedAt', asIsoOrNull(row.deleted_at), payload.deletedAt],
  ];

  return checks
    .filter(([, before, after]) => !deepEqual(before, after))
    .map(([key]) => key);
}

function buildPlanForRow(row, options = {}) {
  const rowItem = rowToMediaItem(row);
  const originalExtra = parseObject(rowItem.extraMetadata);
  const normalized = normalizeMediaItem(rowItem);
  const movedRootExtraKeys = detectRootExtraKeysToMove(originalExtra);
  const conflicts = collectConflicts(rowItem, originalExtra);
  const migratedAt = new Date().toISOString();
  const candidateSignals = [];

  if (movedRootExtraKeys.length > 0) candidateSignals.push('root-extra-duplicates');
  if (Object.keys(normalizeImageHosts(rowItem, originalExtra)).length > 0 && !hasValue(originalExtra.imageHosts)) {
    candidateSignals.push('missing-imageHosts');
  }
  if (Object.keys(normalizeVideoHosts(rowItem, originalExtra)).length > 0 && !hasValue(originalExtra.videoHosts)) {
    candidateSignals.push('missing-videoHosts');
  }
  if (hasValue(rowItem.ai)) candidateSignals.push('top-level-ai');

  const canonicalExtra = buildCanonicalExtra(rowItem, normalized);
  let payload = payloadFromNormalized(rowItem, normalized, canonicalExtra);
  let changedColumnKeys = comparePayloadToRow(row, payload).filter((key) => key !== 'extraMetadata');
  const filledColumnKeys = changedColumnKeys.filter((key) => !hasValue(rowItem[key]) && hasValue(payload[key]));
  const extraMetadataChanged = !deepEqual(row.extra_metadata || {}, canonicalExtra);

  const shouldMigrate = options.force || candidateSignals.length > 0 || changedColumnKeys.length > 0 || extraMetadataChanged;

  if (!shouldMigrate) {
    return {
      id: row.id,
      shouldMigrate: false,
      payload,
      candidateSignals,
      changedColumnKeys: [],
      filledColumnKeys: [],
      movedRootExtraKeys,
      conflicts,
    };
  }

  const finalExtra = buildMigratedExtra(rowItem, normalized, {
    migratedAt,
    movedRootExtraKeys,
    filledColumnKeys,
    changedColumnKeys,
    conflicts,
    originalRow: row,
    backupFile: options.backupFile || '',
  });
  payload = payloadFromNormalized(rowItem, normalized, finalExtra);
  changedColumnKeys = comparePayloadToRow(row, payload).filter((key) => key !== 'extraMetadata');

  return {
    id: row.id,
    shouldMigrate: true,
    payload,
    candidateSignals,
    changedColumnKeys,
    filledColumnKeys,
    movedRootExtraKeys,
    conflicts,
  };
}

async function fetchRows() {
  if (args.ids.length > 0) {
    return sql`
      select *
      from public.media_items
      where id = any(${args.ids}::text[])
      order by id asc
    `;
  }

  if (args.cursor) {
    return sql`
      select *
      from public.media_items
      where id > ${args.cursor}
      order by id asc
      limit ${args.batchSize}
    `;
  }

  return sql`
    select *
    from public.media_items
    order by id asc
    limit ${args.batchSize}
  `;
}

async function backupRows(rows, backupFile) {
  await fs.mkdir(path.dirname(backupFile), { recursive: true });
  const lines = rows.map((row) => JSON.stringify({
    backedUpAt: new Date().toISOString(),
    migrationKey: MIGRATION_KEY,
    row,
  }));
  await fs.appendFile(backupFile, `${lines.join('\n')}\n`, 'utf8');
}

async function applyPlan(id, payload) {
  await sql`
    update public.media_items
    set
      kind = ${payload.kind},
      is_video = ${payload.isVideo},
      is_link = ${payload.isLink},
      page_title = ${payload.pageTitle},
      description = ${payload.description},
      tags = ${JSON.stringify(payload.tags)}::jsonb,
      collection_id = ${payload.collectionId},
      internal_added_timestamp = ${payload.internalAddedTimestamp},
      source_image_url = ${payload.sourceImageUrl},
      source_page_url = ${payload.sourcePageUrl},
      file_name = ${payload.fileName},
      file_size = ${payload.fileSize},
      width = ${payload.width},
      height = ${payload.height},
      duration = ${payload.duration},
      file_type = ${payload.fileType},
      file_type_source = ${payload.fileTypeSource},
      creation_date = ${payload.creationDate},
      creation_date_source = ${payload.creationDateSource},
      sha256 = ${payload.sha256},
      p_hash = ${payload.pHash},
      a_hash = ${payload.aHash},
      d_hash = ${payload.dHash},
      exif_metadata = ${payload.exifMetadata ? JSON.stringify(payload.exifMetadata) : null}::jsonb,
      extra_metadata = ${JSON.stringify(payload.extraMetadata || {})}::jsonb,
      pixvid_url = ${payload.pixvidUrl},
      pixvid_delete_url = ${payload.pixvidDeleteUrl},
      imgbb_url = ${payload.imgbbUrl},
      imgbb_delete_url = ${payload.imgbbDeleteUrl},
      imgbb_thumb_url = ${payload.imgbbThumbUrl},
      filemoon_watch_url = ${payload.filemoonWatchUrl},
      filemoon_direct_url = ${payload.filemoonDirectUrl},
      udrop_watch_url = ${payload.udropWatchUrl},
      udrop_direct_url = ${payload.udropDirectUrl},
      link_url = ${payload.linkUrl},
      link_url_canonical = ${payload.linkUrlCanonical},
      link_preview_image_url = ${payload.linkPreviewImageUrl},
      favicon_url = ${payload.faviconUrl},
      last_visited_at = ${payload.lastVisitedAt},
      deleted_at = ${payload.deletedAt},
      updated_at = now()
    where id = ${id}
  `;
}

function summarizePlans(rows, plans) {
  const migrated = plans.filter((plan) => plan.shouldMigrate);
  const reasonCounts = {};
  const changedFieldCounts = {};
  const conflictCount = migrated.reduce((count, plan) => count + Object.keys(plan.conflicts).length, 0);

  for (const plan of migrated) {
    for (const reason of plan.candidateSignals) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    for (const key of plan.changedColumnKeys) {
      changedFieldCounts[key] = (changedFieldCounts[key] || 0) + 1;
    }
  }

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    migrateCandidates: migrated.length,
    clean: rows.length - migrated.length,
    nextCursor: rows.at(-1)?.id || args.cursor || '',
    reasonCounts,
    changedFieldCounts,
    conflictCount,
    sampleCandidateIds: migrated.slice(0, 10).map((plan) => plan.id),
  };
}

function runSelfTest() {
  const row = {
    id: 'test-image',
    kind: 'image',
    is_video: false,
    is_link: false,
    page_title: '',
    description: '',
    tags: [],
    collection_id: null,
    internal_added_timestamp: new Date('2026-01-01T00:00:00Z'),
    source_image_url: '',
    source_page_url: '',
    file_name: '',
    file_size: null,
    width: null,
    height: null,
    duration: null,
    file_type: '',
    file_type_source: '',
    creation_date: null,
    creation_date_source: '',
    sha256: '',
    p_hash: '',
    a_hash: '',
    d_hash: '',
    exif_metadata: null,
    extra_metadata: {
      pageTitle: 'legacy title',
      BlueMatrixColumn: 'raw value',
      imgbbUrl: 'https://legacy.example/image.jpg',
    },
    pixvid_url: '',
    pixvid_delete_url: '',
    imgbb_url: '',
    imgbb_delete_url: '',
    imgbb_thumb_url: '',
    filemoon_watch_url: '',
    filemoon_direct_url: '',
    udrop_watch_url: '',
    udrop_direct_url: '',
    link_url: '',
    link_url_canonical: '',
    link_preview_image_url: '',
    favicon_url: '',
    last_visited_at: null,
    deleted_at: null,
  };
  const plan = buildPlanForRow(row, { backupFile: 'self-test.jsonl' });
  if (!plan.shouldMigrate) throw new Error('Expected self-test row to migrate.');
  if (plan.payload.pageTitle !== 'legacy title') throw new Error('Legacy title did not fill blank column.');
  if (plan.payload.extraMetadata.pageTitle) throw new Error('Stable duplicate was not moved out of extra root.');
  if (plan.payload.extraMetadata.BlueMatrixColumn !== 'raw value') throw new Error('Raw metadata was not preserved.');
  if (!plan.payload.extraMetadata._migrations?.[MIGRATION_KEY]?.originalExtraMetadata?.pageTitle) {
    throw new Error('Original extra metadata snapshot missing.');
  }
  if (!plan.payload.extraMetadata._migrations?.[MIGRATION_KEY]?.originalRow?.id) {
    throw new Error('Original row snapshot missing.');
  }

  const appliedRow = {
    ...row,
    kind: plan.payload.kind,
    is_video: plan.payload.isVideo,
    is_link: plan.payload.isLink,
    page_title: plan.payload.pageTitle,
    description: plan.payload.description,
    tags: plan.payload.tags,
    collection_id: plan.payload.collectionId,
    internal_added_timestamp: plan.payload.internalAddedTimestamp,
    source_image_url: plan.payload.sourceImageUrl,
    source_page_url: plan.payload.sourcePageUrl,
    file_name: plan.payload.fileName,
    file_size: String(plan.payload.fileSize || ''),
    width: plan.payload.width,
    height: plan.payload.height,
    duration: plan.payload.duration,
    file_type: plan.payload.fileType,
    file_type_source: plan.payload.fileTypeSource,
    creation_date: plan.payload.creationDate,
    creation_date_source: plan.payload.creationDateSource,
    sha256: plan.payload.sha256,
    p_hash: plan.payload.pHash,
    a_hash: plan.payload.aHash,
    d_hash: plan.payload.dHash,
    exif_metadata: plan.payload.exifMetadata,
    extra_metadata: plan.payload.extraMetadata,
    pixvid_url: plan.payload.pixvidUrl,
    pixvid_delete_url: plan.payload.pixvidDeleteUrl,
    imgbb_url: plan.payload.imgbbUrl,
    imgbb_delete_url: plan.payload.imgbbDeleteUrl,
    imgbb_thumb_url: plan.payload.imgbbThumbUrl,
    filemoon_watch_url: plan.payload.filemoonWatchUrl,
    filemoon_direct_url: plan.payload.filemoonDirectUrl,
    udrop_watch_url: plan.payload.udropWatchUrl,
    udrop_direct_url: plan.payload.udropDirectUrl,
    link_url: plan.payload.linkUrl,
    link_url_canonical: plan.payload.linkUrlCanonical,
    link_preview_image_url: plan.payload.linkPreviewImageUrl,
    favicon_url: plan.payload.faviconUrl,
    last_visited_at: plan.payload.lastVisitedAt,
    deleted_at: plan.payload.deletedAt,
  };
  const appliedPlan = buildPlanForRow(appliedRow);
  if (appliedPlan.shouldMigrate) {
    throw new Error(`Applied row should be idempotent: ${JSON.stringify({
      candidateSignals: appliedPlan.candidateSignals,
      changedColumnKeys: appliedPlan.changedColumnKeys,
      movedRootExtraKeys: appliedPlan.movedRootExtraKeys,
    })}`);
  }

  const cleanRow = {
    ...row,
    id: 'clean-image',
    page_title: 'already clean',
    extra_metadata: {
      BlueMatrixColumn: 'raw value',
    },
  };
  const cleanPlan = buildPlanForRow(cleanRow);
  if (cleanPlan.shouldMigrate) {
    throw new Error(`Clean row should not migrate by default: ${JSON.stringify({
      candidateSignals: cleanPlan.candidateSignals,
      changedColumnKeys: cleanPlan.changedColumnKeys,
      movedRootExtraKeys: cleanPlan.movedRootExtraKeys,
    })}`);
  }

  const systemRow = {
    ...cleanRow,
    id: '__imgvault_vault_config__',
    kind: 'image',
    extra_metadata: {
      systemType: 'secretVaultConfig',
      secretVaultConfig: { enabled: true },
    },
  };
  const systemPlan = buildPlanForRow(systemRow);
  if (systemPlan.payload.kind !== 'image') {
    throw new Error('System rows must keep a DB-safe image kind.');
  }

  console.log(JSON.stringify({
    ok: true,
    shouldMigrate: plan.shouldMigrate,
    appliedShouldMigrate: appliedPlan.shouldMigrate,
    cleanShouldMigrate: cleanPlan.shouldMigrate,
    systemDbKind: systemPlan.payload.kind,
    originalRowSnapshot: Boolean(plan.payload.extraMetadata._migrations?.[MIGRATION_KEY]?.originalRow?.id),
    changedColumnKeys: plan.changedColumnKeys,
    movedRootExtraKeys: plan.movedRootExtraKeys,
    preservedRawKeys: Object.keys(plan.payload.extraMetadata).filter((key) => !key.startsWith('_')),
  }));
}

async function main() {
  const rows = await fetchRows();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(args.backupDir, `media-format-v2-${timestamp}.jsonl`);
  const plans = rows.map((row) => buildPlanForRow(row, {
    force: args.force,
    backupFile: args.apply ? backupFile : '',
  }));
  const candidates = plans.filter((plan) => plan.shouldMigrate);

  if (args.apply && candidates.length > 0) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    await backupRows(candidates.map((plan) => rowsById.get(plan.id)), backupFile);

    for (const plan of candidates) {
      await applyPlan(plan.id, plan.payload);
    }
  }

  const summary = summarizePlans(rows, plans);
  if (args.apply && candidates.length > 0) {
    summary.backupFile = backupFile;
    summary.updated = candidates.length;
  } else {
    summary.backupFile = '';
    summary.updated = 0;
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function cli() {
  if (args.help) {
    printHelp();
    return;
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const neonUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!neonUrl) {
    console.error('Missing NEON_DATABASE_URL or DATABASE_URL env var.');
    process.exit(1);
  }

  sql = neon(neonUrl);
  await main();
}

cli().catch((error) => {
  console.error(redactSecrets(error?.message || String(error)));
  process.exit(1);
});
