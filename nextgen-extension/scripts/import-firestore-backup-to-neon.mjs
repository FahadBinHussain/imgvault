import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const cwd = process.cwd();
const backupPath = process.argv[2]
  ? path.resolve(cwd, process.argv[2])
  : path.resolve(cwd, 'backup.json');

const neonUrl = (process.env.NEON_DATABASE_URL || '').trim();
if (!neonUrl) {
  console.error('Missing NEON_DATABASE_URL env var.');
  process.exit(1);
}

const sql = neon(neonUrl);

function fromFirestoreValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return value.doubleValue;
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'referenceValue')) return value.referenceValue;
  if (Object.prototype.hasOwnProperty.call(value, 'geoPointValue')) return value.geoPointValue;
  if (Object.prototype.hasOwnProperty.call(value, 'bytesValue')) return value.bytesValue;
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (value.mapValue) {
    const out = {};
    const fields = value.mapValue.fields || {};
    Object.keys(fields).forEach((k) => {
      out[k] = fromFirestoreValue(fields[k]);
    });
    return out;
  }
  return null;
}

function fieldsRawToJs(fieldsRaw = {}) {
  const out = {};
  Object.keys(fieldsRaw || {}).forEach((k) => {
    out[k] = fromFirestoreValue(fieldsRaw[k]);
  });
  return out;
}

function asText(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function asNullableText(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

function asBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asFloat(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asTags(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function canonicalizeLinkUrl(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = new URLSearchParams(u.search);
    params.delete('utm_source');
    params.delete('utm_medium');
    params.delete('utm_campaign');
    params.delete('utm_term');
    params.delete('utm_content');
    params.delete('fbclid');
    params.delete('gclid');
    const q = params.toString();
    return `${u.protocol}//${host}${u.pathname}${q ? `?${q}` : ''}`;
  } catch {
    return raw;
  }
}

function toKind(data) {
  const isLink = asBool(data.isLink, false);
  const isVideo = asBool(data.isVideo, false);
  if (isLink) return 'link';
  if (isVideo) return 'video';
  return 'image';
}

function toMediaPayload(data = {}, fallbackTimestamp = null, forceDeleted = false) {
  const kind = toKind(data);
  const isLink = kind === 'link';
  const isVideo = kind === 'video';
  const linkUrl = asText(data.linkUrl);

  const deletedAtFromData = asIsoOrNull(data.deletedAt);
  const deletedAt = forceDeleted ? (deletedAtFromData || fallbackTimestamp || new Date().toISOString()) : deletedAtFromData;
  const internalAddedTimestamp =
    asIsoOrNull(data.internalAddedTimestamp) ||
    asIsoOrNull(data.creationDate) ||
    fallbackTimestamp ||
    new Date().toISOString();

  return {
    kind,
    isVideo,
    isLink,
    pageTitle: asText(data.pageTitle),
    description: asText(data.description),
    tags: asTags(data.tags),
    collectionId: asNullableText(data.collectionId),
    internalAddedTimestamp,
    sourceImageUrl: asText(data.sourceImageUrl),
    sourcePageUrl: asText(data.sourcePageUrl),
    fileName: asText(data.fileName),
    fileSize: asInt(data.fileSize),
    width: asInt(data.width),
    height: asInt(data.height),
    duration: asFloat(data.duration),
    fileType: asText(data.fileType),
    fileTypeSource: asText(data.fileTypeSource),
    creationDate: asIsoOrNull(data.creationDate),
    creationDateSource: asText(data.creationDateSource),
    sha256: asText(data.sha256),
    pHash: asText(data.pHash),
    aHash: asText(data.aHash),
    dHash: asText(data.dHash),
    exifMetadata: data.exifMetadata && typeof data.exifMetadata === 'object' ? data.exifMetadata : null,
    extraMetadata: data,
    pixvidUrl: asText(data.pixvidUrl),
    pixvidDeleteUrl: asText(data.pixvidDeleteUrl),
    imgbbUrl: asText(data.imgbbUrl),
    imgbbDeleteUrl: asText(data.imgbbDeleteUrl),
    imgbbThumbUrl: asText(data.imgbbThumbUrl),
    filemoonWatchUrl: asText(data.filemoonWatchUrl),
    filemoonDirectUrl: asText(data.filemoonDirectUrl),
    udropWatchUrl: asText(data.udropWatchUrl),
    udropDirectUrl: asText(data.udropDirectUrl),
    linkUrl,
    linkUrlCanonical: asText(data.linkUrlCanonical) || canonicalizeLinkUrl(linkUrl || data.sourcePageUrl || ''),
    linkPreviewImageUrl: asText(data.linkPreviewImageUrl),
    faviconUrl: asText(data.faviconUrl),
    lastVisitedAt: asIsoOrNull(data.lastVisitedAt),
    deletedAt,
  };
}

async function upsertCollection(id, c = {}) {
  await sql`
    insert into public.collections (
      id, name, description, color, image_count, created_at, updated_at
    ) values (
      ${id},
      ${asText(c.name, 'Untitled')},
      ${asText(c.description)},
      ${asText(c.color)},
      ${asInt(c.imageCount) ?? 0},
      ${asIsoOrNull(c.createdAt) || new Date().toISOString()},
      ${asIsoOrNull(c.updatedAt) || new Date().toISOString()}
    )
    on conflict (id) do update set
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      image_count = excluded.image_count,
      updated_at = excluded.updated_at
  `;
}

async function upsertMedia(id, p) {
  await sql`
    insert into public.media_items (
      id, kind, is_video, is_link,
      page_title, description, tags, collection_id, internal_added_timestamp,
      source_image_url, source_page_url,
      file_name, file_size, width, height, duration, file_type, file_type_source, creation_date, creation_date_source,
      sha256, p_hash, a_hash, d_hash,
      exif_metadata, extra_metadata,
      pixvid_url, pixvid_delete_url, imgbb_url, imgbb_delete_url, imgbb_thumb_url,
      filemoon_watch_url, filemoon_direct_url, udrop_watch_url, udrop_direct_url,
      link_url, link_url_canonical, link_preview_image_url, favicon_url, last_visited_at,
      deleted_at, updated_at
    ) values (
      ${id}, ${p.kind}, ${p.isVideo}, ${p.isLink},
      ${p.pageTitle}, ${p.description}, ${p.tags}, ${p.collectionId}, ${p.internalAddedTimestamp},
      ${p.sourceImageUrl}, ${p.sourcePageUrl},
      ${p.fileName}, ${p.fileSize}, ${p.width}, ${p.height}, ${p.duration}, ${p.fileType}, ${p.fileTypeSource}, ${p.creationDate}, ${p.creationDateSource},
      ${p.sha256}, ${p.pHash}, ${p.aHash}, ${p.dHash},
      ${p.exifMetadata}, ${p.extraMetadata},
      ${p.pixvidUrl}, ${p.pixvidDeleteUrl}, ${p.imgbbUrl}, ${p.imgbbDeleteUrl}, ${p.imgbbThumbUrl},
      ${p.filemoonWatchUrl}, ${p.filemoonDirectUrl}, ${p.udropWatchUrl}, ${p.udropDirectUrl},
      ${p.linkUrl}, ${p.linkUrlCanonical}, ${p.linkPreviewImageUrl}, ${p.faviconUrl}, ${p.lastVisitedAt},
      ${p.deletedAt}, now()
    )
    on conflict (id) do update set
      kind = excluded.kind,
      is_video = excluded.is_video,
      is_link = excluded.is_link,
      page_title = excluded.page_title,
      description = excluded.description,
      tags = excluded.tags,
      collection_id = excluded.collection_id,
      internal_added_timestamp = excluded.internal_added_timestamp,
      source_image_url = excluded.source_image_url,
      source_page_url = excluded.source_page_url,
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      width = excluded.width,
      height = excluded.height,
      duration = excluded.duration,
      file_type = excluded.file_type,
      file_type_source = excluded.file_type_source,
      creation_date = excluded.creation_date,
      creation_date_source = excluded.creation_date_source,
      sha256 = excluded.sha256,
      p_hash = excluded.p_hash,
      a_hash = excluded.a_hash,
      d_hash = excluded.d_hash,
      exif_metadata = excluded.exif_metadata,
      extra_metadata = excluded.extra_metadata,
      pixvid_url = excluded.pixvid_url,
      pixvid_delete_url = excluded.pixvid_delete_url,
      imgbb_url = excluded.imgbb_url,
      imgbb_delete_url = excluded.imgbb_delete_url,
      imgbb_thumb_url = excluded.imgbb_thumb_url,
      filemoon_watch_url = excluded.filemoon_watch_url,
      filemoon_direct_url = excluded.filemoon_direct_url,
      udrop_watch_url = excluded.udrop_watch_url,
      udrop_direct_url = excluded.udrop_direct_url,
      link_url = excluded.link_url,
      link_url_canonical = excluded.link_url_canonical,
      link_preview_image_url = excluded.link_preview_image_url,
      favicon_url = excluded.favicon_url,
      last_visited_at = excluded.last_visited_at,
      deleted_at = excluded.deleted_at,
      updated_at = now()
  `;
}

async function upsertSettings(doc = {}) {
  await sql`
    insert into public.settings (
      id, pixvid_api_key, imgbb_api_key, filemoon_api_key, udrop_key1, udrop_key2,
      default_gallery_source, default_video_source, updated_at
    ) values (
      'config',
      ${asText(doc.pixvidApiKey)},
      ${asText(doc.imgbbApiKey)},
      ${asText(doc.filemoonApiKey)},
      ${asText(doc.udropKey1)},
      ${asText(doc.udropKey2)},
      ${asText(doc.defaultGallerySource, 'imgbb')},
      ${asText(doc.defaultVideoSource, 'filemoon')},
      now()
    )
    on conflict (id) do update set
      pixvid_api_key = excluded.pixvid_api_key,
      imgbb_api_key = excluded.imgbb_api_key,
      filemoon_api_key = excluded.filemoon_api_key,
      udrop_key1 = excluded.udrop_key1,
      udrop_key2 = excluded.udrop_key2,
      default_gallery_source = excluded.default_gallery_source,
      default_video_source = excluded.default_video_source,
      updated_at = now()
  `;
}

function docsOf(backup, collectionName) {
  return backup?.collections?.[collectionName]?.documents || [];
}

function docData(doc) {
  if (doc?.data && typeof doc.data === 'object') return doc.data;
  return fieldsRawToJs(doc?.fieldsRaw || {});
}

async function main() {
  const raw = await fs.readFile(backupPath, 'utf8');
  const backup = JSON.parse(raw);

  const imageDocs = docsOf(backup, 'images');
  const trashDocs = docsOf(backup, 'trash');
  const collectionDocs = docsOf(backup, 'collections');
  const settingsDocs = docsOf(backup, 'userSettings');

  console.log(`Importing backup: ${backupPath}`);
  console.log(`images=${imageDocs.length}, trash=${trashDocs.length}, collections=${collectionDocs.length}, settings=${settingsDocs.length}`);

  for (const d of collectionDocs) {
    const data = docData(d);
    await upsertCollection(d.id, data);
  }

  for (const d of imageDocs) {
    const data = docData(d);
    const payload = toMediaPayload(data, asIsoOrNull(d.updateTime), false);
    await upsertMedia(d.id, payload);
  }

  for (const d of trashDocs) {
    const data = docData(d);
    const payload = toMediaPayload(data, asIsoOrNull(d.updateTime), true);
    await upsertMedia(d.id, payload);
  }

  for (const d of settingsDocs) {
    const data = docData(d);
    await upsertSettings(data);
  }

  console.log('Import complete.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

