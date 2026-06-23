import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const envContent = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const dbUrl = envContent.match(/NEON_DATABASE_URL=(.+)/)?.[1]?.trim();
const sql = neon(dbUrl);

await sql`ALTER TABLE media_items ADD COLUMN IF NOT EXISTS config_json text`;
console.log('config_json column added');
