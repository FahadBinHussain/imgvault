const udropKey1 = process.argv[2];
const udropKey2 = process.argv[3];
const dbUrl = process.argv[4];

import { neon } from '@neondatabase/serverless';
const sql = neon(dbUrl);

async function authorize(key1, key2) {
  const formData = new FormData();
  formData.append('key1', key1);
  formData.append('key2', key2);
  
  const resp = await fetch('https://www.udrop.com/api/v2/authorize', {
    method: 'POST',
    body: formData,
  });
  
  if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
  const result = await resp.json();
  if (result._status !== 'success') throw new Error(`Auth error: ${result.response}`);
  return result.data;
}

async function getFileDownloadUrl(accessToken, accountId, fileId) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  formData.append('file_id', fileId);
  
  const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
    method: 'POST',
    body: formData,
  });
  
  if (!resp.ok) return null;
  const result = await resp.json();
  if (result._status === 'success' && result.data?.download_url) {
    return result.data.download_url;
  }
  return null;
}

async function main() {
  try {
    console.log('Authorizing with UDrop...');
    const auth = await authorize(udropKey1, udropKey2);
    console.log('Authorized. Account:', auth.account_id);
    
    // Get all scene items with broken udrop URLs (with /file/ prefix)
    const scenes = await sql`SELECT id, spz_url, file_name FROM media_items WHERE kind = 'scene' AND spz_url LIKE '%/file/%' AND spz_url != ''`;
    
    console.log(`Found ${scenes.length} scene records with broken /file/ URLs`);
    
    for (const scene of scenes) {
      // Extract code from udrop.com/file/{code}/...
      const match = scene.spz_url.match(/udrop\.com\/file\/([^\/]+)/i);
      if (!match) {
        console.log(`  ${scene.id}: Could not extract code from URL`);
        continue;
      }
      
      const fileId = match[1];
      console.log(`\n  ${scene.id}: code=${fileId}, file=${scene.file_name}`);
      
      // Try to regenerate URL via UDrop API
      const freshUrl = await getFileDownloadUrl(auth.access_token, auth.account_id, fileId);
      if (freshUrl) {
        console.log(`    New URL: ${freshUrl.substring(0, 80)}...`);
        
        // Update DB
        await sql`UPDATE media_items SET spz_url = ${freshUrl} WHERE id = ${scene.id}`;
        console.log(`    DB updated successfully`);
      } else {
        console.log(`    ERROR: Could not regenerate URL for code ${fileId}`);
      }
    }
    
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();