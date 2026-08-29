/**
 * @fileoverview Upload service modules for Pixvid and ImgBB
 * @version 2.0.0
 */

/**
 * @typedef {Object} UploadResult
 * @property {string} url - Image URL
 * @property {string} deleteUrl - Delete URL
 * @property {string} [displayUrl] - Display URL
 * @property {string} [thumbUrl] - Thumbnail URL (ImgBB only)
 */

/**
 * Base uploader class
 */
class BaseUploader {
  /**
   * @param {string} name - Service name
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Upload image blob
   * @param {Blob} blob - Image blob
   * @param {string} apiKey - API key
   * @param {string} [filename] - Optional filename
   * @returns {Promise<UploadResult>}
   */
  async upload(blob, apiKey, filename) {
    throw new Error('Upload method must be implemented');
  }

  /**
   * Handle upload errors
   * @param {Response} response - Fetch response
   * @param {string} errorPrefix - Error message prefix
   * @throws {Error}
   */
  async handleError(response, errorPrefix) {
    const errorText = await response.text();
    throw new Error(`${errorPrefix}: ${response.status} - ${errorText}`);
  }

  xhrUpload(url, formData, onProgress, signal) {
    return new Promise((resolve, reject) => {
      if (typeof XMLHttpRequest === 'undefined') {
        reject(new Error('XMLHttpRequest is not available in this context'));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          reject(new Error('Upload aborted'));
          return;
        }

        const abortUpload = () => xhr.abort();
        signal.addEventListener('abort', abortUpload, { once: true });

        xhr.onloadend = () => {
          signal.removeEventListener('abort', abortUpload);
        };
      }

      xhr.upload.onprogress = (event) => {
        if (typeof onProgress === 'function') {
          onProgress({
            loaded: event.loaded,
            total: event.lengthComputable ? event.total : null,
            percent: event.lengthComputable && event.total > 0
              ? Math.round((event.loaded / event.total) * 100)
              : null,
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText || '{}'));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        } else {
          reject(new Error(`${xhr.status} - ${xhr.responseText || 'Upload failed'}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));
      xhr.send(formData);
    });
  }

}

/**
 * Pixvid uploader service
 */
export class PixvidUploader extends BaseUploader {
  constructor() {
    super('Pixvid');
    this.apiUrl = 'https://pixvid.org/api/1/upload';
  }

  /**
   * Upload image to Pixvid
   * @param {Blob} blob - Image blob
   * @param {string} apiKey - Pixvid API key
   * @param {string} originalFilename - Original filename or URL
   * @returns {Promise<UploadResult>}
   */
  async upload(blob, apiKey, originalFilename = 'image.jpg', signal) {
    const formData = new FormData();
    
    // Extract filename from URL or use default
    const filename = originalFilename.split('/').pop().split('?')[0] || 'image.jpg';
    formData.append('source', blob, filename);
    formData.append('key', apiKey);
    
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) {
        await this.handleError(response, 'Pixvid upload failed');
      }

      const result = await response.json();
      
      if (result.status_code !== 200) {
        throw new Error(result.error?.message || 'Upload failed');
      }

      return {
        url: result.image.url,
        deleteUrl: result.image.delete_url,
        displayUrl: result.image.display_url
      };
    } catch (error) {
      console.error('Pixvid API error:', error);
      throw new Error(`Failed to upload to Pixvid: ${error.message}`);
    }
  }
}

/**
 * ImgBB uploader service
 */
export class ImgbbUploader extends BaseUploader {
  constructor() {
    super('ImgBB');
    this.apiUrl = 'https://api.imgbb.com/1/upload';
  }

  /**
   * Convert blob to base64
   * @param {Blob} blob - Image blob
   * @returns {Promise<string>} Base64 string
   */
  async blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result.split(',')[1];
        resolve(base64data);
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Upload image to ImgBB
   * @param {Blob} blob - Image blob
   * @param {string} apiKey - ImgBB API key
   * @returns {Promise<UploadResult>}
   */
  async upload(blob, apiKey, signal) {
    const formData = new FormData();
    
    // Convert blob to base64
    const base64 = await this.blobToBase64(blob);
    formData.append('image', base64);
    
    try {
      const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) {
        await this.handleError(response, 'ImgBB upload failed');
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error?.message || 'Upload failed');
      }

      return {
        url: result.data.url,
        deleteUrl: result.data.delete_url,
        displayUrl: result.data.display_url,
        thumbUrl: result.data.thumb?.url
      };
    } catch (error) {
      console.error('ImgBB API error:', error);
      throw new Error(`Failed to upload to ImgBB: ${error.message}`);
    }
  }
}

/**
 * Filemoon uploader service for videos
 */
export class FilemoonUploader extends BaseUploader {
  constructor() {
    super('Filemoon');
    this.apiUrl = 'https://api.byse.sx/upload/server';
  }

  /**
   * Get upload server URL
   * @param {string} apiKey - Filemoon API key
   * @returns {Promise<string>} Upload server URL
   */
  async getUploadServer(apiKey, signal) {
    try {
      const response = await fetch(`${this.apiUrl}?key=${apiKey}`, { signal });
      
      if (!response.ok) {
        await this.handleError(response, 'Failed to get upload server');
      }

      const result = await response.json();
      
      if (result.status !== 200 || !result.result) {
        throw new Error(result.msg || 'Failed to get upload server');
      }

      return result.result;
    } catch (error) {
      console.error('Filemoon get server error:', error);
      throw new Error(`Failed to get Filemoon upload server: ${error.message}`);
    }
  }

  /**
   * Upload video to Filemoon
   * @param {Blob} blob - Video blob
   * @param {string} apiKey - Filemoon API key
   * @param {string} [filename] - Optional filename
   * @returns {Promise<UploadResult>}
   */
  async upload(blob, apiKey, filename = 'video.mp4', signal) {
    try {
      // Step 1: Get upload server URL
      const uploadServerUrl = await this.getUploadServer(apiKey, signal);
      console.log('📡 Filemoon upload server:', uploadServerUrl);

      // Step 2: Upload to the server
      const formData = new FormData();
      
      // Extract filename from URL or use default
      const videoFilename = filename.split('/').pop().split('?')[0] || 'video.mp4';
      formData.append('file', blob, videoFilename);
      formData.append('key', apiKey);
      
      const response = await fetch(uploadServerUrl, {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) {
        await this.handleError(response, 'Filemoon upload failed');
      }

      const result = await response.json();
      
      if (result.status !== 200 || !result.files || result.files.length === 0) {
        throw new Error(result.msg || result.error?.message || 'Upload failed');
      }

      const fileData = result.files[0];
      
      const watchUrl = `https://filemoon.sx/d/${fileData.filecode}`;
      const directUrl = `https://filemoon.sx/e/${fileData.filecode}`;
      
      console.log('🎬 [FILEMOON] File uploaded successfully, filecode:', fileData.filecode);
      console.log('🎬 [FILEMOON] Watch URL:', watchUrl);
      console.log('🎬 [FILEMOON] Direct URL:', directUrl);
      console.log('ℹ️ [FILEMOON] Thumbnail will be fetched later when gallery loads (video needs time to process)');
      
      return {
        url: watchUrl,
        deleteUrl: null,
        displayUrl: watchUrl,
        thumbUrl: null, // Will be fetched later when gallery loads
        filecode: fileData.filecode,
        filename: fileData.filename,
        watchUrl,
        directUrl
      };
    } catch (error) {
      console.error('Filemoon API error:', error);
      throw new Error(`Failed to upload to Filemoon: ${error.message}`);
    }
  }

  async uploadWithProgress(blob, apiKey, filename = 'video.mp4', onProgress, signal) {
    try {
      const uploadServerUrl = await this.getUploadServer(apiKey, signal);

      const formData = new FormData();
      const videoFilename = filename.split('/').pop().split('?')[0] || 'video.mp4';
      formData.append('file', blob, videoFilename);
      formData.append('key', apiKey);

      const result = await this.xhrUpload(uploadServerUrl, formData, onProgress, signal);

      if (result.status !== 200 || !result.files || result.files.length === 0) {
        throw new Error(result.msg || result.error?.message || 'Upload failed');
      }

      const fileData = result.files[0];
      const watchUrl = `https://filemoon.sx/d/${fileData.filecode}`;
      const directUrl = `https://filemoon.sx/e/${fileData.filecode}`;

      return {
        url: watchUrl,
        deleteUrl: null,
        displayUrl: watchUrl,
        thumbUrl: null,
        filecode: fileData.filecode,
        filename: fileData.filename,
        watchUrl,
        directUrl,
        apiStatus: result.status || '',
        apiMessage: result.msg || '',
      };
    } catch (error) {
      throw new Error(`Failed to upload to Filemoon: ${error.message}`);
    }
  }
}

/**
 * UDrop Video Uploader
 * Uploads videos to UDrop.com using their API v2
 */
export class UDropUploader extends BaseUploader {
  constructor() {
    super('UDrop');
    this.apiUrl = 'https://www.udrop.com/api/v2';
  }

  buildDirectUrl(fileIdOrCode, filename, shortUrl = '', watchUrl = '') {
    const safeFilename = (filename || 'video.mp4').split('/').pop().split('?')[0] || 'video.mp4';
    let code = '';

    if (shortUrl) {
      try {
        const shortUrlPath = new URL(shortUrl).pathname.split('/').filter(Boolean);
        code = shortUrlPath[0] || '';
      } catch (_) {
        // Ignore parse issues and keep falling back.
      }
    }

    if (!code && watchUrl) {
      try {
        const watchUrlPath = new URL(watchUrl).pathname.split('/').filter(Boolean);
        code = watchUrlPath[0] || '';
      } catch (_) {
        // Ignore parse issues and keep falling back.
      }
    }

    code = code || fileIdOrCode || '';
    if (!code) return '';

    return `https://www.udrop.com/file/${code}/${encodeURIComponent(safeFilename)}`;
  }

  /**
   * Authorize with UDrop API and get access token
   * @param {string} key1 - UDrop API Key 1 (64 characters)
   * @param {string} key2 - UDrop API Key 2 (64 characters)
   * @returns {Promise<{access_token: string, account_id: string}>}
   */
  async authorize(key1, key2, signal, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!key1 || !key2) {
          throw new Error(`UDrop keys missing: key1=${key1 ? 'set' : 'empty'}, key2=${key2 ? 'set' : 'empty'}`);
        }
        const formData = new FormData();
        formData.append('key1', key1);
        formData.append('key2', key2);

        const response = await fetch(`${this.apiUrl}/authorize`, {
          method: 'POST',
          body: formData,
          signal
        });

        if (!response.ok) {
          await this.handleError(response, 'Failed to authorize with UDrop');
        }

        const result = await response.json();
        
        if (result._status !== 'success' || !result.data || !result.data.access_token) {
          throw new Error(result.response || 'Authorization failed');
        }

        return {
          access_token: result.data.access_token,
          account_id: result.data.account_id
        };
      } catch (error) {
        lastError = error;
        console.error(`UDrop authorization attempt ${attempt + 1}/${retries + 1} failed:`, error.message);
        if (attempt < retries && !signal?.aborted) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw new Error(`Failed to authorize with UDrop: ${lastError.message}`);
  }

  /**
   * Upload video to UDrop
   * @param {Blob} blob - Video blob
   * @param {string} key1 - UDrop API Key 1
   * @param {string} key2 - UDrop API Key 2
   * @param {string} [filename] - Optional filename
   * @returns {Promise<UploadResult>}
   */
  async upload(blob, key1, key2, filename = 'video.mp4', signal) {
    try {
      // Step 1: Authorize and get access token
      const auth = await this.authorize(key1, key2, signal);
      console.log('🔐 UDrop authorized, account:', auth.account_id);

      // Step 2: Upload video file
      const formData = new FormData();
      
      const videoFilename = filename.split('/').pop().split('?')[0] || 'video.mp4';
      formData.append('upload_file', blob, videoFilename);
      formData.append('access_token', auth.access_token);
      formData.append('account_id', auth.account_id);
      // folder_id is optional, leave blank for root folder
      
      const response = await fetch(`${this.apiUrl}/file/upload`, {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) {
        await this.handleError(response, 'UDrop upload failed');
      }

      const result = await response.json();
      
      if (result._status !== 'success' || !result.data || result.data.length === 0) {
        throw new Error(result.response || 'Upload failed');
      }

      const fileData = result.data[0];
      
      // Step 3: Generate download URL
      let downloadUrl = this.buildDirectUrl(
        fileData.file_id,
        fileData.name || videoFilename,
        fileData.short_url,
        fileData.url
      ) || fileData.url;
      
      try {
        const downloadFormData = new FormData();
        downloadFormData.append('access_token', auth.access_token);
        downloadFormData.append('account_id', auth.account_id);
        downloadFormData.append('file_id', fileData.file_id);
        
        const downloadResponse = await fetch(`${this.apiUrl}/file/download`, {
          method: 'POST',
          body: downloadFormData,
          signal
        });
        
        if (downloadResponse.ok) {
          const downloadResult = await downloadResponse.json();
          if (downloadResult._status === 'success' && downloadResult.data && downloadResult.data.download_url) {
            downloadUrl = downloadResult.data.download_url;
            console.log('📦 [UDROP] Download URL generated:', downloadUrl);
          }
        }
      } catch (err) {
        console.warn('⚠️ [UDROP] Failed to generate download URL, using regular URL:', err.message);
      }
      
      console.log('📦 [UDROP] File uploaded successfully');
      console.log('📦 [UDROP] URL:', fileData.url);
      console.log('📦 [UDROP] Short URL:', fileData.short_url);
      console.log('📦 [UDROP] File ID:', fileData.file_id);
      console.log('📦 [UDROP] Download URL:', downloadUrl);
      
      return {
        url: downloadUrl, // Use download URL as primary URL
        deleteUrl: fileData.delete_url,
        displayUrl: fileData.url, // Keep original URL for display
        thumbUrl: null, // UDrop doesn't provide thumbnail URLs for videos
        fileId: fileData.file_id,
        shortUrl: fileData.short_url,
        deleteHash: fileData.delete_hash,
        filename: fileData.name,
        accountId: auth.account_id,
        apiStatus: result._status || '',
        apiResponse: result.response || '',
        downloadApiStatus: downloadUrl !== fileData.url ? 'success' : 'fallback',
        watchUrl: fileData.url,
        directUrl: downloadUrl
      };
    } catch (error) {
      console.error('UDrop API error:', error);
      throw new Error(`Failed to upload to UDrop: ${error.message}`);
    }
  }

  async uploadWithProgress(blob, key1, key2, filename = 'video.mp4', onProgress, signal) {
    try {
      const auth = await this.authorize(key1, key2, signal);

      const formData = new FormData();
      const videoFilename = filename.split('/').pop().split('?')[0] || 'video.mp4';
      formData.append('upload_file', blob, videoFilename);
      formData.append('access_token', auth.access_token);
      formData.append('account_id', auth.account_id);

      const result = await this.xhrUpload(`${this.apiUrl}/file/upload`, formData, onProgress, signal);

      if (result._status !== 'success' || !result.data || result.data.length === 0) {
        throw new Error(result.response || 'Upload failed');
      }

      const fileData = result.data[0];
      let downloadUrl = this.buildDirectUrl(
        fileData.file_id,
        fileData.name || videoFilename,
        fileData.short_url,
        fileData.url
      ) || fileData.url;

      try {
        const downloadFormData = new FormData();
        downloadFormData.append('access_token', auth.access_token);
        downloadFormData.append('account_id', auth.account_id);
        downloadFormData.append('file_id', fileData.file_id);

        const downloadResponse = await fetch(`${this.apiUrl}/file/download`, {
          method: 'POST',
          body: downloadFormData,
          signal
        });

        if (downloadResponse.ok) {
          const downloadResult = await downloadResponse.json();
          if (downloadResult._status === 'success' && downloadResult.data && downloadResult.data.download_url) {
            // Keep the constructed direct URL for consistency.
          }
        }
      } catch (_) {
        // Keep the constructed direct URL.
      }

      return {
        url: downloadUrl,
        deleteUrl: fileData.delete_url,
        displayUrl: fileData.url,
        thumbUrl: null,
        fileId: fileData.file_id,
        shortUrl: fileData.short_url,
        deleteHash: fileData.delete_hash,
        filename: fileData.name,
        accountId: auth.account_id,
        apiStatus: result._status || '',
        apiResponse: result.response || '',
        downloadApiStatus: downloadUrl !== fileData.url ? 'success' : 'fallback',
        watchUrl: fileData.url,
        directUrl: downloadUrl
      };
    } catch (error) {
      throw new Error(`Failed to upload to UDrop: ${error.message}`);
    }
  }
}

/**
 * TeraBox Video Uploader
 * Uploads videos to TeraBox using the PCS chunked upload protocol.
 * Auth is the session cookie (ndus + browserid + lang); the cookie can be
 * provided explicitly (settings field) or read live from the browser session
 * via chrome.cookies when empty.
 */
export class TeraBoxUploader extends BaseUploader {
  constructor() {
    super('TeraBox');
    // The dm homepage moved to a captcha gate (breaks jsToken scraping), so
    // the token is scraped from www while all /api/* calls stay on dm (which
    // is where the PCS API actually works). Fixed in 2.11.8.
    this.tokenBase = 'https://www.terabox.com';
    this.apiBase = 'https://dm.terabox.com';
    this.appId = '250528';
    this.channel = 'dubox';
    this.cookie = '';
    this.jsToken = '';
    this.CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB; doubles per 4 GB threshold
  }

  userAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  headers() {
    return {
      'Cookie': this.cookie,
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${this.apiBase}/`,
      'User-Agent': this.userAgent(),
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  /**
   * Resolve the session cookie. Prefers an explicit cookie string; otherwise
   * reads the live TeraBox session cookies from the browser.
   */
  async resolveCookie(explicitCookie) {
    const trimmed = String(explicitCookie || '').trim();
    if (trimmed) {
      this.cookie = trimmed;
      return trimmed;
    }
    if (typeof chrome !== 'undefined' && chrome.cookies?.getAll) {
      const all = await chrome.cookies.getAll({ domain: 'terabox.com' });
      // include ALL terabox cookies — captcha solve may set a verification
      // cookie that the old wanted-set filter would drop. fixed 2.11.15.
      const parts = all.map((c) => `${c.name}=${c.value}`);
      if (parts.length > 0) {
        this.cookie = parts.join('; ');
        return this.cookie;
      }
    }
    throw new Error('No TeraBox cookie available. Log in to TeraBox or paste the cookie in Settings.');
  }

  async fetchJsTokenViaHiddenTab(timeoutMs = 15000) {
    if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) return '';
    let tabId = null;
    try {
      const tab = await chrome.tabs.create({ url: `${this.tokenBase}/`, active: false, pinned: false });
      tabId = tab.id;
      await new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          chrome.tabs.get(tabId, (t) => {
            if (chrome.runtime.lastError || !t) return resolve();
            if (t.status === 'complete') return resolve();
            if (Date.now() - start > timeoutMs) return resolve();
            setTimeout(check, 300);
          });
        };
        check();
      });
      await new Promise((r) => setTimeout(r, 800));
      // try to solve the canvas captcha silently
      try {
        const hasCaptcha = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!document.getElementById('canvas') && !!document.getElementById('input'),
        });
        if (hasCaptcha?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              try {
                const c = typeof code !== 'undefined' ? code : '';
                const input = document.getElementById('input');
                if (input && c) input.value = c;
                const btn = document.getElementById('confirm');
                if (btn) btn.click();
              } catch (_) {}
            },
          });
          await new Promise((resolve) => {
            const start2 = Date.now();
            const check2 = () => {
              chrome.tabs.get(tabId, (t) => {
                if (chrome.runtime.lastError || !t) return resolve();
                if (t.status === 'complete' && t.url && !t.url.includes('simple-verify')) return resolve();
                if (Date.now() - start2 > 8000) return resolve();
                setTimeout(check2, 300);
              });
            };
            setTimeout(check2, 600);
          });
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (_) {}
      // poll for window.jsToken global (the app page sets it there)
      let token = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.jsToken || '',
        });
        if (results?.[0]?.result) {
          token = results[0].result;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      // also grab the tab's document.cookie and merge in any extra cookies
      // (verify cookie set after captcha). do NOT overwrite — document.cookie
      // excludes httpOnly cookies like ndus, so we'd lose the session.
      try {
        const cookieResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.cookie,
        });
        const tabCookie = cookieResults?.[0]?.result || '';
        if (tabCookie) {
          const existing = new Map(
            this.cookie.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
              const i = s.indexOf('=');
              return [i > 0 ? s.slice(0, i) : s, i > 0 ? s.slice(i + 1) : ''];
            })
          );
          tabCookie.split(';').forEach((s) => {
            const trimmed = s.trim();
            if (!trimmed) return;
            const i = trimmed.indexOf('=');
            if (i <= 0) return;
            const name = trimmed.slice(0, i);
            if (!existing.has(name)) existing.set(name, trimmed.slice(i + 1));
          });
          this.cookie = Array.from(existing, ([n, v]) => `${n}=${v}`).join('; ');
        }
      } catch (_) {}
      if (token) {
        try { await chrome.storage.local.set({ teraboxJsToken: token, teraboxJsTokenAt: Date.now() }); } catch (_) {}
        return token;
      }
      // fallback: HTML regex
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML,
      });
      const html = results?.[0]?.result || '';
      const m = html.match(/function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/);
      if (m?.[1]) {
        try { await chrome.storage.local.set({ teraboxJsToken: m[1], teraboxJsTokenAt: Date.now() }); } catch (_) {}
        return m[1];
      }
      return '';
    } catch (_) {
      return '';
    } finally {
      if (tabId != null) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
  }

  async fetchJsToken() {
    // hidden tab is the only way that avoids Sec-Fetch-* browser gate.
    // fetch() from a chrome-extension page always sends Sec-Fetch-Site:
    // cross-site etc. and TeraBox redirects that to /simple-verify (no
    // jsToken). a real navigation via chrome.tabs.create sends
    // Sec-Fetch-Mode: navigate and gets the landing page. silent — tab
    // is created active:false, closed after extraction. 2.11.13.
    // first try cached token (valid ~hours)
    try {
      const cached = await chrome.storage.local.get(['teraboxJsToken', 'teraboxJsTokenAt']);
      if (cached?.teraboxJsToken && Date.now() - (cached.teraboxJsTokenAt || 0) < 1000 * 60 * 60 * 12) {
        this.jsToken = cached.teraboxJsToken;
        return this.jsToken;
      }
    } catch (_) {}
    // silent hidden tab
    let token = await this.fetchJsTokenViaHiddenTab();
    if (token) {
      this.jsToken = token;
      return token;
    }
    // last resort: bare fetch (may still hit simple-verify, but try)
    let res;
    try {
      res = await fetch(`${this.tokenBase}/`, {
        credentials: 'omit',
        headers: { 'User-Agent': this.userAgent() },
      });
    } catch (fetchErr) {
      throw new Error(`TeraBox jsToken fetch failed (network): ${fetchErr.message || fetchErr}`);
    }
    const html = await res.text();
    const m = html.match(/function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/);
    if (!m?.[1]) {
      const finalUrl = res.url || '';
      throw new Error(
        `TeraBox jsToken not found (HTTP ${res.status}, final ${finalUrl}, ${html.length} bytes). ` +
        `Re-login to TeraBox.`
      );
    }
    this.jsToken = m[1];
    try { await chrome.storage.local.set({ teraboxJsToken: m[1], teraboxJsTokenAt: Date.now() }); } catch (_) {}
    return this.jsToken;
  }

  async apiRequest(pathname, params = {}, body, retried = false) {
    const qp = new URLSearchParams({
      app_id: this.appId,
      web: '1',
      channel: this.channel,
      clienttype: '0',
      ...(this.jsToken ? { jsToken: this.jsToken } : {}),
      ...params,
    });
    const res = await fetch(`${this.apiBase}${pathname}?${qp}`, {
      method: 'POST',
      headers: body instanceof FormData
        ? this.headers()
        : { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`TeraBox ${pathname} returned non-JSON: ${String(res.status)}`);
    }
    if (json.errno === 4000023 && !retried) {
      // stale jsToken → re-fetch and retry once (driver behaviour)
      await this.fetchJsToken();
      return this.apiRequest(pathname, params, body, true);
    }
    return json;
  }

  async precreate(path, size, blockList) {
    const form = new URLSearchParams({
      path,
      autoinit: '1',
      target_path: '/',
      block_list: JSON.stringify(blockList),
      local_mtime: String(Math.floor(Date.now() / 1000)),
      file_limit_switch_v34: 'true',
    });
    const json = await this.apiRequest('/api/precreate', {}, form.toString());
    if (json.errno !== 0) {
      throw new Error(`TeraBox precreate failed (errno ${json.errno}): ${json.errmsg || ''}`);
    }
    return json;
  }

  async locateUpload() {
    const res = await fetch(`https://dm-data.terabox.com/rest/2.0/pcs/file?method=locateupload`, {
      headers: this.headers(),
    });
    const json = await res.json();
    if (!json.host) {
      throw new Error('TeraBox locateupload returned no upload host.');
    }
    return json.host;
  }

  async uploadChunk(host, path, uploadid, partseq, chunkBlob, filename) {
    const qp = new URLSearchParams({
      method: 'upload',
      path,
      uploadid,
      partseq: String(partseq),
      app_id: this.appId,
      web: '1',
      channel: this.channel,
      clienttype: '0',
    });
    const form = new FormData();
    form.append('file', chunkBlob, filename);
    const res = await fetch(`https://${host}/rest/2.0/pcs/superfile2?${qp}`, {
      method: 'POST',
      headers: { 'Cookie': this.cookie, 'User-Agent': this.userAgent() },
      body: form,
    });
    const json = await res.json();
    if (!json.md5) {
      throw new Error(`TeraBox chunk ${partseq} upload failed: ${JSON.stringify(json)}`);
    }
    return json.md5;
  }

  async create(path, size, uploadid, blockList) {
    const form = new URLSearchParams({
      path,
      size: String(size),
      uploadid,
      target_path: '/',
      block_list: JSON.stringify(blockList),
      local_mtime: String(Math.floor(Date.now() / 1000)),
    });
    const json = await this.apiRequest('/api/create', { isdir: '0', rtype: '1' }, form.toString());
    if (json.errno !== 0) {
      throw new Error(`TeraBox create failed (errno ${json.errno}): ${json.errmsg || ''}`);
    }
    return json;
  }

  async getDownloadLink(path) {
    const qp = new URLSearchParams({ target: JSON.stringify([path]), dlink: '1', origin: 'dlna' });
    const res = await fetch(`${this.apiBase}/api/filemetas?${qp}`, { headers: this.headers() });
    const json = await res.json();
    if (json.errno !== 0 || !json.info?.[0]?.dlink) {
      return '';
    }
    return json.info[0].dlink;
  }

  calculateChunkSize(streamSize) {
    let chunkSize = 4 * 1024 * 1024;
    let threshold = 4 * 1024 * 1024 * 1024;
    if (streamSize < chunkSize) return Math.max(streamSize, 1);
    while (streamSize > threshold) {
      chunkSize <<= 1;
      threshold <<= 1;
    }
    return chunkSize;
  }

  async upload(blob, cookie, filename, signal) {
    return this._upload(blob, cookie, filename, null, signal);
  }

  async uploadWithProgress(blob, cookie, filename, onProgress, signal) {
    return this._upload(blob, cookie, filename, onProgress, signal);
  }

  async _upload(blob, cookie, filename, onProgress, signal) {
    try {
      const safeName = String(filename || 'video.mp4').split('/').pop().split('?')[0] || 'video.mp4';
      const path = `/${safeName}`;

      await this.resolveCookie(cookie);
      // No upfront jsToken fetch. TeraBox's homepage is captcha/verify-gated
      // for browser fetch requests (Sec-Fetch-* headers), so scraping the
      // token there no longer works. The PCS API accepts requests WITHOUT a
      // jsToken using just the session cookie; apiRequest retries with a
      // freshly fetched token only when the server explicitly asks for one
      // (errno 4000023). Fixed in 2.11.12.

      const size = blob.size;
      const chunkSize = this.calculateChunkSize(size);
      const chunkCount = Math.max(1, Math.ceil(size / chunkSize));
      const dummyBlock = '5910a591dd8fc18c32a8f3df4fdc1761';
      const dummyBlocks = new Array(chunkCount).fill(dummyBlock);

      const pre = await this.precreate(path, size, dummyBlocks);
      if (pre.return_type === 2) {
        // rapid upload: file already exists server-side
        return this._buildResult(path, pre);
      }

      const host = await this.locateUpload();
      const blockList = [];
      let uploaded = 0;
      for (let i = 0; i < chunkCount; i++) {
        if (signal?.aborted) throw new Error('Upload aborted');
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, size);
        const chunk = blob.slice(start, end);
        const md5 = await this.uploadChunk(host, path, pre.uploadid, i, chunk, safeName);
        blockList.push(md5);
        uploaded += (end - start);
        if (typeof onProgress === 'function') {
          onProgress({ loaded: uploaded, total: size, percent: Math.round((uploaded / size) * 100) });
        }
      }

      const created = await this.create(path, size, pre.uploadid, blockList);
      return this._buildResult(path, created);
    } catch (error) {
      throw new Error(`Failed to upload to TeraBox: ${error.message}`);
    }
  }

  async _buildResult(path, info) {
    let dlink = '';
    try {
      dlink = await this.getDownloadLink(path);
    } catch (_) {
      // keep fallback page URL
    }
    const fallbackUrl = `https://www.terabox.com${path}`;
    const fsId = String(info.fs_id ?? info.file_id ?? '');
    return {
      url: dlink || fallbackUrl,
      displayUrl: dlink || fallbackUrl,
      watchUrl: dlink || fallbackUrl,
      directUrl: dlink,
      thumbUrl: null,
      thumbnailUrl: null,
      deleteUrl: null,
      fileId: fsId,
      filename: path.split('/').pop(),
      apiStatus: info.errno === 0 ? 'success' : 'error',
      apiMessage: info.errmsg || '',
    };
  }
}

