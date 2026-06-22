import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';

// Read .env
const envPath = path.resolve(process.cwd(), '.env');
const raw = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
  env[key] = value;
}

const sql = neon(env.NEON_DATABASE_URL);

const statements = [
  `ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "spz_url" text DEFAULT '' NOT NULL`,
  `ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "spz_file_size" bigint`,
  `ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "texture_url" text DEFAULT '' NOT NULL`,
  `ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "texture_file_size" bigint`,
];

for (const stmt of statements) {
  console.log(`Running: ${stmt}`);
  try {
    await sql`${stmt}`;
    console.log('✓ OK');
  } catch (e) {
    if (e.message?.includes('already exists')) {
      console.log('✓ Column already exists, skipping');
    } else {
      console.error('✗ Error:', e.message);
    }
  }
}

console.log('\nDone! Schema updated.');
