const udropKey1 = process.argv[2];
const udropKey2 = process.argv[3];

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

async function getFileDownloadUrlByShortUrl(accessToken, accountId, shortUrl) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  formData.append('short_url', shortUrl);
  
  const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
    method: 'POST',
    body: formData,
  });
  
  console.log(`    API status: ${resp.status}`);
  if (!resp.ok) {
    const text = await resp.text();
    console.log(`    API error: ${text.substring(0, 200)}`);
    return null;
  }
  const result = await resp.json();
  console.log(`    API response: ${JSON.stringify(result).substring(0, 300)}`);
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
    
    // Test with short_url parameter (not file_id!)
    const testShortUrls = ['OHcN', 'OHd6', 'OHdh', 'OHdA', 'OHiG', 'OHc7', 'OHcc', 'OHcK'];
    
    for (const shortUrl of testShortUrls) {
      console.log(`\nTesting short_url: ${shortUrl}`);
      const url = await getFileDownloadUrlByShortUrl(auth.access_token, auth.account_id, shortUrl);
      if (url) {
        console.log(`    Fresh URL: ${url}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();