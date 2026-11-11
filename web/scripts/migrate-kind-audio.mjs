// One-off migration: allow songs in the media_items.kind CHECK constraint.
//
// The constraint shipped with ('image','video','link','scene'). Songs need a
// kind of their own ('audio') because they ride the VIDEO hosts but are not
// videos - the gallery renders an <audio> player, not a <video>.
//
// Run with the web app's DATABASE_URL:
//   node web/scripts/migrate-kind-audio.mjs
//
// It is idempotent: re-running it is a no-op.
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) throw new Error('DATABASE_URL not found in web/.env.local');
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const sql = neon(url);

const ALLOWED = ['image', 'video', 'link', 'scene', 'audio'];
const ALLOWED_SQL = ALLOWED.map((k) => `'${k}'`).join(', ');

const before = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'media_items'::regclass AND contype = 'c' AND conname = 'chk_media_items_kind'
`;
console.log('before:', JSON.stringify(before));

await sql`ALTER TABLE media_items DROP CONSTRAINT IF EXISTS chk_media_items_kind`;
await sql.query(
  `ALTER TABLE media_items ADD CONSTRAINT chk_media_items_kind CHECK (kind IN (${ALLOWED_SQL}))`
);

const after = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'media_items'::regclass AND contype = 'c' AND conname = 'chk_media_items_kind'
`;
console.log('after:', JSON.stringify(after));

// Prove the new kind actually inserts, then clean the probe row up.
const probeId = '__imgvault_audio_kind_probe__';
try {
  await sql`DELETE FROM media_items WHERE id = ${probeId}`;
  await sql.query(
    `INSERT INTO media_items (id, kind, is_video, is_link, page_title, description, tags,
      internal_added_timestamp, file_name, file_size, file_type, file_type_source,
      extra_metadata)
    VALUES ('${probeId}', 'audio', false, false, 'audio kind probe', '', '[]'::jsonb,
      now(), 'probe.m4a', 1, 'audio/mp4', 'File object', '{}'::jsonb)`
  );
  const row = await sql`SELECT id, kind, is_video FROM media_items WHERE id = ${probeId}`;
  console.log('probe insert ok:', JSON.stringify(row));
} finally {
  await sql`DELETE FROM media_items WHERE id = ${probeId}`;
  const left = await sql`SELECT count(*)::int AS n FROM media_items WHERE id = ${probeId}`;
  console.log('probe cleaned:', JSON.stringify(left));
}
