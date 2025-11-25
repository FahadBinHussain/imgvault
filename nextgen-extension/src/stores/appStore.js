/**
 * @fileoverview Zustand store for global state management
 * @version 2.0.0
 */

import { create } from 'zustand';

/**
 * App store for managing global application state
 */
export const useAppStore = create((set, get) => ({
  // Settings
  settings: {
    pixvidApiKey: '',
    imgbbApiKey: '',
    firebaseConfig: null,
    defaultGallerySource: 'imgbb'
  },

  setSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),

  // Current image data
  currentImage: null,
  setCurrentImage: (image) => set({ currentImage: image }),
  clearCurrentImage: () => set({ currentImage: null }),

  // Upload state
  uploadState: {
    isUploading: false,
    progress: '',
    error: null,
    duplicate: null
  },

  setUploadState: (newState) => set((state) => ({
    uploadState: { ...state.uploadState, ...newState }
  })),

  resetUploadState: () => set({
    uploadState: {
      isUploading: false,
      progress: '',
      error: null,
      duplicate: null
    }
  }),

  // Gallery state
  galleryImages: [],
  setGalleryImages: (images) => set({ galleryImages: images }),

  // UI state
  view: 'no-image', // 'no-image' | 'image' | 'settings' | 'gallery' | 'success'
  setView: (view) => set({ view }),

  // Modal state
  modal: {
    isOpen: false,
    type: null, // 'image-detail' | 'confirm-delete' | null
    data: null
  },

  openModal: (type, data = null) => set({
    modal: { isOpen: true, type, data }
  }),

  closeModal: () => set({
    modal: { isOpen: false, type: null, data: null }
  }),
}));
