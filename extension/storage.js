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
          storedUrl: { stringValue: imageData.storedUrl },
          deleteUrl: { stringValue: imageData.deleteUrl || '' },
          imgbbUrl: { stringValue: imageData.imgbbUrl || '' },
          imgbbDeleteUrl: { stringValue: imageData.imgbbDeleteUrl || '' },
          imgbbThumbUrl: { stringValue: imageData.imgbbThumbUrl || '' },
          sourceImageUrl: { stringValue: imageData.sourceImageUrl },
          sourcePageUrl: { stringValue: imageData.sourcePageUrl },
          pageTitle: { stringValue: imageData.pageTitle || '' },
          fileType: { stringValue: imageData.fileType || '' },
          fileSize: { integerValue: imageData.fileSize || 0 },
          width: { integerValue: imageData.width || 0 },
          height: { integerValue: imageData.height || 0 },
          sha256: { stringValue: imageData.sha256 || '' },
          pHash: { stringValue: imageData.pHash || '' },
          aHash: { stringValue: imageData.aHash || '' },
          dHash: { stringValue: imageData.dHash || '' },
          tags: { arrayValue: { values: (imageData.tags || []).map(t => ({ stringValue: t })) } },
          notes: { stringValue: imageData.notes || '' },
          createdAt: { timestampValue: new Date().toISOString() }
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
          storedUrl: fields.storedUrl?.stringValue || fields.stored_url?.stringValue || '',
          deleteUrl: fields.deleteUrl?.stringValue || fields.delete_url?.stringValue || '',
          imgbbUrl: fields.imgbbUrl?.stringValue || fields.imgbb_url?.stringValue || '',
          imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || fields.imgbb_delete_url?.stringValue || '',
          imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || fields.imgbb_thumb_url?.stringValue || '',
          sourceImageUrl: fields.sourceImageUrl?.stringValue || fields.source_image_url?.stringValue || '',
          sourcePageUrl: fields.sourcePageUrl?.stringValue || fields.source_page_url?.stringValue || '',
          pageTitle: fields.pageTitle?.stringValue || fields.page_title?.stringValue || '',
          fileType: fields.fileType?.stringValue || fields.file_type?.stringValue || '',
          fileSize: parseInt(fields.fileSize?.integerValue || fields.file_size?.integerValue || '0'),
          width: parseInt(fields.width?.integerValue || '0'),
          height: parseInt(fields.height?.integerValue || '0'),
          sha256: fields.sha256?.stringValue || '',
          pHash: fields.pHash?.stringValue || '',
          aHash: fields.aHash?.stringValue || '',
          dHash: fields.dHash?.stringValue || '',
          tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
          notes: fields.notes?.stringValue || '',
          createdAt: fields.createdAt?.timestampValue || fields.created_at?.timestampValue || ''
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
        storedUrl: fields.storedUrl?.stringValue || fields.stored_url?.stringValue || '',
        deleteUrl: fields.deleteUrl?.stringValue || fields.delete_url?.stringValue || '',
        imgbbUrl: fields.imgbbUrl?.stringValue || fields.imgbb_url?.stringValue || '',
        imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || fields.imgbb_delete_url?.stringValue || '',
        imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || fields.imgbb_thumb_url?.stringValue || '',
        sourceImageUrl: fields.sourceImageUrl?.stringValue || fields.source_image_url?.stringValue || '',
        sourcePageUrl: fields.sourcePageUrl?.stringValue || fields.source_page_url?.stringValue || '',
        pageTitle: fields.pageTitle?.stringValue || fields.page_title?.stringValue || '',
        fileType: fields.fileType?.stringValue || fields.file_type?.stringValue || '',
        fileSize: parseInt(fields.fileSize?.integerValue || fields.file_size?.integerValue || '0'),
        width: parseInt(fields.width?.integerValue || '0'),
        height: parseInt(fields.height?.integerValue || '0'),
        sha256: fields.sha256?.stringValue || '',
        pHash: fields.pHash?.stringValue || '',
        aHash: fields.aHash?.stringValue || '',
        dHash: fields.dHash?.stringValue || '',
        tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
        notes: fields.notes?.stringValue || '',
        createdAt: fields.createdAt?.timestampValue || fields.created_at?.timestampValue || ''
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
      img.pageTitle?.toLowerCase().includes(lowerQuery) ||
      img.sourcePageUrl?.toLowerCase().includes(lowerQuery) ||
      img.notes?.toLowerCase().includes(lowerQuery) ||
      img.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
