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
  async upload(blob, apiKey, originalFilename = 'image.jpg') {
    const formData = new FormData();
    
    // Extract filename from URL or use default
    const filename = originalFilename.split('/').pop().split('?')[0] || 'image.jpg';
    formData.append('source', blob, filename);
    formData.append('key', apiKey);
    
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        body: formData
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
  async upload(blob, apiKey) {
    const formData = new FormData();
    
    // Convert blob to base64
    const base64 = await this.blobToBase64(blob);
    formData.append('image', base64);
    
    try {
      const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
        method: 'POST',
        body: formData
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
    this.apiUrl = 'https://filemoonapi.com/api/upload/server';
  }

  /**
   * Get upload server URL
   * @param {string} apiKey - Filemoon API key
   * @returns {Promise<string>} Upload server URL
   */
  async getUploadServer(apiKey) {
    try {
      const response = await fetch(`${this.apiUrl}?key=${apiKey}`);
      
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
  async upload(blob, apiKey, filename = 'video.mp4') {
    try {
      // Step 1: Get upload server URL
      const uploadServerUrl = await this.getUploadServer(apiKey);
      console.log('📡 Filemoon upload server:', uploadServerUrl);

      // Step 2: Upload to the server
      const formData = new FormData();
      
      // Extract filename from URL or use default
      const videoFilename = filename.split('/').pop().split('?')[0] || 'video.mp4';
      formData.append('file', blob, videoFilename);
      formData.append('key', apiKey);
      
      const response = await fetch(uploadServerUrl, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        await this.handleError(response, 'Filemoon upload failed');
      }

      const result = await response.json();
      
      if (result.status !== 200 || !result.files || result.files.length === 0) {
        throw new Error(result.msg || result.error?.message || 'Upload failed');
      }

      const fileData = result.files[0];
      
      // Construct the file URL from filecode
      const fileUrl = `https://filemoon.sx/e/${fileData.filecode}`;
      
      console.log('🎬 [FILEMOON] File uploaded successfully, filecode:', fileData.filecode);
      console.log('🎬 [FILEMOON] Embed URL:', fileUrl);
      console.log('ℹ️ [FILEMOON] Thumbnail will be fetched later when gallery loads (video needs time to process)');
      
      return {
        url: fileUrl,
        deleteUrl: null,
        displayUrl: fileUrl,
        thumbUrl: null, // Will be fetched later when gallery loads
        filecode: fileData.filecode,
        filename: fileData.filename
      };
    } catch (error) {
      console.error('Filemoon API error:', error);
      throw new Error(`Failed to upload to Filemoon: ${error.message}`);
    }
  }
}
