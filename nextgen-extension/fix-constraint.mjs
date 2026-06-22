import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';

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

// Drop old constraint
try {
  await sql`ALTER TABLE media_items DROP CONSTRAINT IF EXISTS chk_media_items_kind`;
  console.log('✓ Dropped old constraint');
} catch (e) {
  console.log('Drop:', e.message);
}

// Add new constraint with 'scene' included
try {
  await sql`ALTER TABLE media_items ADD CONSTRAINT chk_media_items_kind CHECK (kind IN ('image', 'video', 'link', 'scene'))`;
  console.log('✓ Added new constraint with scene');
} catch (e) {
  console.log('Add:', e.message);
}

console.log('Done!');
