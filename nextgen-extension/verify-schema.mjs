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

const result = await sql`SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'media_items'
ORDER BY ordinal_position`;

console.log('All columns in media_items:');
for (const row of result) {
  console.log(`  ${row.column_name}: ${row.data_type}`);
}
