// storage.js - Firestore REST API Storage Manager for ImgVault
// Compatible with Manifest V3 service workers

class StorageManager {
  constructor() {
    this.config = null;
    this.initialized = false;
  }

  async init() {
    console.log('🔵 StorageManager.init() called');
    const result = await chrome.storage.sync.get(['firebaseConfig']);
    console.log('🔵 Firebase config from storage:', result.firebaseConfig ? 'found' : 'not found');
    
    if (!result.firebaseConfig) {
      console.warn('⚠️ Firebase not configured');
      return false;
    }

    this.config = result.firebaseConfig;
    this.initialized = true;
    console.log('✅ StorageManager initialized with project:', this.config.projectId);
    return true;
  }

  async saveImage(imageData) {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        throw new Error('Firebase not configured. Please set up Firebase in settings.');
      }
    }

    try {
      const doc = {
        fields: {
          stored_url: { stringValue: imageData.stored_url },
          delete_url: { stringValue: imageData.delete_url || '' },
          imgbb_url: { stringValue: imageData.imgbb_url || '' },
          imgbb_delete_url: { stringValue: imageData.imgbb_delete_url || '' },
          imgbb_thumb_url: { stringValue: imageData.imgbb_thumb_url || '' },
          source_image_url: { stringValue: imageData.source_image_url },
          source_page_url: { stringValue: imageData.source_page_url },
          page_title: { stringValue: imageData.page_title || '' },
          file_type: { stringValue: imageData.file_type || '' },
          file_size: { integerValue: imageData.file_size || 0 },
          width: { integerValue: imageData.width || 0 },
          height: { integerValue: imageData.height || 0 },
          sha256: { stringValue: imageData.sha256 || '' },
          pHash: { stringValue: imageData.pHash || '' },
          aHash: { stringValue: imageData.aHash || '' },
          dHash: { stringValue: imageData.dHash || '' },
          tags: { arrayValue: { values: (imageData.tags || []).map(t => ({ stringValue: t })) } },
          notes: { stringValue: imageData.notes || '' },
          created_at: { timestampValue: new Date().toISOString() }
        }
      };

      const url = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/images?key=${this.config.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(doc)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to save to Firestore');
      }

      const result = await response.json();
      const docId = result.name.split('/').pop();
      return docId;
    } catch (error) {
      console.error('Error saving to Firestore:', error);
      throw error;
    }
  }

  async getAllImages() {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        return [];
      }
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/images?key=${this.config.apiKey}&orderBy=created_at desc`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch images');
      }

      const result = await response.json();
      
      if (!result.documents) {
        return [];
      }

      return result.documents.map(doc => {
        const id = doc.name.split('/').pop();
        const fields = doc.fields;
        
        return {
          id,
          stored_url: fields.stored_url?.stringValue || '',
          delete_url: fields.delete_url?.stringValue || '',
          imgbb_url: fields.imgbb_url?.stringValue || '',
          imgbb_delete_url: fields.imgbb_delete_url?.stringValue || '',
          imgbb_thumb_url: fields.imgbb_thumb_url?.stringValue || '',
          source_image_url: fields.source_image_url?.stringValue || '',
          source_page_url: fields.source_page_url?.stringValue || '',
          page_title: fields.page_title?.stringValue || '',
          file_type: fields.file_type?.stringValue || '',
          file_size: parseInt(fields.file_size?.integerValue || '0'),
          width: parseInt(fields.width?.integerValue || '0'),
          height: parseInt(fields.height?.integerValue || '0'),
          sha256: fields.sha256?.stringValue || '',
          pHash: fields.pHash?.stringValue || '',
          aHash: fields.aHash?.stringValue || '',
          dHash: fields.dHash?.stringValue || '',
          tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
          notes: fields.notes?.stringValue || '',
          created_at: fields.created_at?.timestampValue || ''
        };
      });
    } catch (error) {
      console.error('Error getting images:', error);
      return [];
    }
  }

  async getImageById(id) {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        return null;
      }
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/images/${id}?key=${this.config.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        return null;
      }

      const doc = await response.json();
      const fields = doc.fields;
      
      return {
        id,
        stored_url: fields.stored_url?.stringValue || '',
        delete_url: fields.delete_url?.stringValue || '',
        imgbb_url: fields.imgbb_url?.stringValue || '',
        imgbb_delete_url: fields.imgbb_delete_url?.stringValue || '',
        imgbb_thumb_url: fields.imgbb_thumb_url?.stringValue || '',
        source_image_url: fields.source_image_url?.stringValue || '',
        source_page_url: fields.source_page_url?.stringValue || '',
        page_title: fields.page_title?.stringValue || '',
        file_type: fields.file_type?.stringValue || '',
        file_size: parseInt(fields.file_size?.integerValue || '0'),
        width: parseInt(fields.width?.integerValue || '0'),
        height: parseInt(fields.height?.integerValue || '0'),
        sha256: fields.sha256?.stringValue || '',
        pHash: fields.pHash?.stringValue || '',
        aHash: fields.aHash?.stringValue || '',
        dHash: fields.dHash?.stringValue || '',
        tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
        notes: fields.notes?.stringValue || '',
        created_at: fields.created_at?.timestampValue || ''
      };
    } catch (error) {
      console.error('Error getting image:', error);
      return null;
    }
  }

  async deleteImage(id) {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        throw new Error('Firebase not configured');
      }
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/images/${id}?key=${this.config.apiKey}`;
      
      const response = await fetch(url, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete image');
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      throw error;
    }
  }

  async updateImage(id, updates) {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        throw new Error('Firebase not configured');
      }
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents/images/${id}?key=${this.config.apiKey}&updateMask.fieldPaths=${Object.keys(updates).join('&updateMask.fieldPaths=')}`;
      
      // Convert updates to Firestore format
      const firestoreData = {};
      for (const [key, value] of Object.entries(updates)) {
        firestoreData[key] = { stringValue: value };
      }
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: firestoreData
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update image');
      }
      
      return true;
    } catch (error) {
      console.error('Error updating image:', error);
      throw error;
    }
  }

  async searchImages(query) {
    const allImages = await this.getAllImages();
    const lowerQuery = query.toLowerCase();
    
    return allImages.filter(img => 
      img.page_title?.toLowerCase().includes(lowerQuery) ||
      img.source_page_url?.toLowerCase().includes(lowerQuery) ||
      img.notes?.toLowerCase().includes(lowerQuery) ||
      img.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
