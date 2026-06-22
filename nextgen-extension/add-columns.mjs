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

try {
  console.log('Adding spz_url column...');
  await sql`ALTER TABLE media_items ADD COLUMN spz_url text DEFAULT '' NOT NULL`;
  console.log('✓ spz_url added');
} catch (e) {
  console.log('spz_url:', e.message);
}

try {
  console.log('Adding spz_file_size column...');
  await sql`ALTER TABLE media_items ADD COLUMN spz_file_size bigint`;
  console.log('✓ spz_file_size added');
} catch (e) {
  console.log('spz_file_size:', e.message);
}

try {
  console.log('Adding texture_url column...');
  await sql`ALTER TABLE media_items ADD COLUMN texture_url text DEFAULT '' NOT NULL`;
  console.log('✓ texture_url added');
} catch (e) {
  console.log('texture_url:', e.message);
}

try {
  console.log('Adding texture_file_size column...');
  await sql`ALTER TABLE media_items ADD COLUMN texture_file_size bigint`;
  console.log('✓ texture_file_size added');
} catch (e) {
  console.log('texture_file_size:', e.message);
}

console.log('\nDone!');
