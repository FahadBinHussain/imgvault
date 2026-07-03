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

async function listFiles(accessToken, accountId) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  
  const resp = await fetch('https://www.udrop.com/api/v2/file/list', {
    method: 'POST',
    body: formData,
  });
  
  if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
  const result = await resp.json();
  if (result._status !== 'success') throw new Error(`List error: ${result.response}`);
  return result.data || [];
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
    
    console.log('Listing files...');
    const files = await listFiles(auth.access_token, auth.account_id);
    console.log(`Found ${files.length} files`);
    
    const spzFiles = files.filter(f => f.name?.endsWith('.spz') || f.name?.includes('scene'));
    console.log(`\nScene/SPZ files: ${spzFiles.length}`);
    
    for (const file of spzFiles.slice(0, 10)) {
      console.log(`\nFile: ${file.name}`);
      console.log(`  ID: ${file.file_id}`);
      console.log(`  URL: ${file.url}`);
      console.log(`  Short URL: ${file.short_url}`);
      
      const dlUrl = await getFileDownloadUrl(auth.access_token, auth.account_id, file.file_id);
      console.log(`  Download URL: ${dlUrl || 'N/A'}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();