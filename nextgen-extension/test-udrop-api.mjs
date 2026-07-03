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

async function getFileDownloadUrl(accessToken, accountId, fileId) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  formData.append('file_id', fileId);
  
  const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
    method: 'POST',
    body: formData,
  });
  
  console.log(`    API response status: ${resp.status}`);
  if (!resp.ok) {
    const text = await resp.text();
    console.log(`    API error body: ${text.substring(0, 200)}`);
    return null;
  }
  const result = await resp.json();
  console.log(`    API response: ${JSON.stringify(result).substring(0, 200)}`);
  if (result._status === 'success' && result.data?.download_url) {
    return result.data.download_url;
  }
  return null;
}

async function getFileInfo(accessToken, accountId, fileId) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  formData.append('file_id', fileId);
  
  const resp = await fetch('https://www.udrop.com/api/v2/file/info', {
    method: 'POST',
    body: formData,
  });
  
  console.log(`    Info API status: ${resp.status}`);
  if (!resp.ok) {
    const text = await resp.text();
    console.log(`    Info API error: ${text.substring(0, 200)}`);
    return null;
  }
  const result = await resp.json();
  console.log(`    Info API response: ${JSON.stringify(result).substring(0, 300)}`);
  return result;
}

async function main() {
  try {
    console.log('Authorizing with UDrop...');
    const auth = await authorize(udropKey1, udropKey2);
    console.log('Authorized. Account:', auth.account_id);
    
    // Test with various file IDs from the DB
    const testIds = ['OHcN', 'OHd6', 'OHdh', 'OHdA', 'OHiG', 'OHc7', 'OHcc', 'OHcK'];
    
    for (const fileId of testIds) {
      console.log(`\nTesting fileId: ${fileId}`);
      
      // Try info first
      const info = await getFileInfo(auth.access_token, auth.account_id, fileId);
      
      // Try download
      const url = await getFileDownloadUrl(auth.access_token, auth.account_id, fileId);
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