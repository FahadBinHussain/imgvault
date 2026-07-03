import { neon } from '@neondatabase/serverless';
const sql = neon(process.argv[2]);

async function main() {
  try {
    // Get scene items with spzUrl
    const scenes = await sql`SELECT id, spz_url, spz_file_size, file_name, extra_metadata FROM media_items WHERE kind = 'scene' AND spz_url != '' LIMIT 20`;
    
    console.log(`Found ${scenes.length} scene records`);
    for (const scene of scenes) {
      console.log(`\nID: ${scene.id}`);
      console.log(`  File: ${scene.file_name}`);
      console.log(`  spzUrl: ${scene.spz_url}`);
      console.log(`  Size: ${scene.spz_file_size}`);
      
      // Extract code from udrop.com/file/{code}/...
      const match = scene.spz_url?.match(/udrop\.com\/file\/([^\/]+)/i);
      if (match) {
        console.log(`  UDrop Code: ${match[1]}`);
      }
      
      // Check extra_metadata for stored fileId
      if (scene.extra_metadata) {
        try {
          const extra = typeof scene.extra_metadata === 'string' ? JSON.parse(scene.extra_metadata) : scene.extra_metadata;
          if (extra.sceneSpzFileId) console.log(`  Stored fileId: ${extra.sceneSpzFileId}`);
          if (extra.sceneSpzWatchUrl) console.log(`  Watch URL: ${extra.sceneSpzWatchUrl}`);
          if (extra.sceneSpzShortUrl) console.log(`  Short URL: ${extra.sceneSpzShortUrl}`);
        } catch(e) {}
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();