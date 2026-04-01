/**
 * @fileoverview Gallery Page Component
 * @version 2.0.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Trash2, Download, X, FolderOpen,
  FileText, Calendar, Cloud, Link2, Globe, AlignLeft, Tag,
  File, Database, Image as ImageIcon, Ruler, Hash, Fingerprint
} from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner, Toast, Textarea } from '../components/UI';
import { useImages, useImageUpload, useTrash, useChromeStorage, useCollections } from '../hooks/useChromeExtension';
import { useKeyboardShortcuts, SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import TimelineScrollbar from '../components/TimelineScrollbar';
import GalleryNavbar from '../components/GalleryNavbar';
import { sitesConfig, isWarningSite, isGoodQualitySite, getSiteDisplayName } from '../config/sitesConfig';

export default function GalleryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { collectionId } = useParams();
  const { images, loading, reload, deleteImage } = useImages();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { uploadImage, uploading, progress, error: uploadError } = useImageUpload();
  const { collections, loading: collectionsLoading, createCollection, reload: reloadCollections } = useCollections();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [fullImageDetails, setFullImageDetails] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('noobs'); // 'noobs' or 'nerds'
  const [loadingNerdsTab, setLoadingNerdsTab] = useState(false);
  const [editingField, setEditingField] = useState(null); // Track which field is being edited
  const [editValues, setEditValues] = useState({}); // Store temporary edit values
  const [toast, setToast] = useState(null); // Toast notification state
  const [isDeleting, setIsDeleting] = useState(false); // Track deletion progress
  const [loadedImages, setLoadedImages] = useState(new Set()); // Track loaded images for fade-in
  const [isModalAnimating, setIsModalAnimating] = useState(false); // Track modal animation state
  const [navbarHeight, setNavbarHeight] = useState(0);
  
  // Timeline scrollbar refs
  const pageContainerRef = useRef(null);
  const dateGroupRefs = useRef({});
  const [timelineData, setTimelineData] = useState([]);
  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadImageData, setUploadImageData] = useState(null);
  const [uploadPageUrl, setUploadPageUrl] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadMetadata, setUploadMetadata] = useState(null);
  const [duplicateData, setDuplicateData] = useState(null);
  const [isLocalUpload, setIsLocalUpload] = useState(false); // Track if current image is from local file
  const [selectedCollectionId, setSelectedCollectionId] = useState(''); // Selected collection for upload
  const [showCreateCollection, setShowCreateCollection] = useState(false); // Show create collection input
  const [newCollectionName, setNewCollectionName] = useState(''); // New collection name
  const [isManualUploadMode, setIsManualUploadMode] = useState(false); // Track if triggered by context menu with no srcUrl
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  
  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  
  // Auto-upload state
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [pendingDownloadFile, setPendingDownloadFile] = useState(null);
  
  // IndexedDB helpers for storing directory handle
  const saveDirectoryHandle = async (handle) => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readwrite');
      await waitForRequest(tx.objectStore('handles').put(handle, 'downloadFolder'));
      await waitForTransaction(tx);
      console.log('✅ [IDB] Directory handle saved');
    } catch (err) {
      console.error('❌ [IDB] Failed to save directory handle:', err);
    } finally {
      db?.close();
    }
  };
  
  const getDirectoryHandle = async () => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readonly');
      const handle = await waitForRequest(tx.objectStore('handles').get('downloadFolder'));
      await waitForTransaction(tx);
      
      if (handle) {
        console.log('✅ [IDB] Directory handle retrieved from storage');
        
        // Try to verify/request permission
        try {
          if (typeof handle.queryPermission === 'function') {
            const permission = await handle.queryPermission({ mode: 'read' });
            console.log('🔐 [IDB] Current permission:', permission);
            
            if (permission === 'granted') {
              console.log('✅ [IDB] Permission already granted');
              return handle;
            } else if (permission === 'prompt') {
              console.log('🔔 [IDB] Requesting permission...');
              const newPermission = await handle.requestPermission({ mode: 'read' });
              if (newPermission === 'granted') {
                console.log('✅ [IDB] Permission granted after request');
                return handle;
              } else {
                console.log('❌ [IDB] Permission denied');
                await clearDirectoryHandle();
              }
            }
          } else {
            console.log('⚠️ [IDB] queryPermission not supported, trying direct access');
            // Browser doesn't support queryPermission, just return the handle and let file access fail if no permission
            return handle;
          }
        } catch (permErr) {
          console.log('⚠️ [IDB] Permission check failed:', permErr.message);
        }
      }
      return null;
    } catch (err) {
      console.error('❌ [IDB] Failed to get directory handle:', err);
      return null;
    }
  };
  
  const clearDirectoryHandle = async () => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readwrite');
      await waitForRequest(tx.objectStore('handles').delete('downloadFolder'));
      await waitForTransaction(tx);
      console.log('🗑️ [IDB] Directory handle cleared');
    } catch (err) {
      console.error('❌ [IDB] Failed to clear directory handle:', err);
    }
  };
  
  const waitForRequest = (request) => {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const waitForTransaction = (tx) => {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  };

  const openDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ImgVaultDB', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
    });
  };
  
  // Handle image load for fade-in effect
  const handleImageLoad = (imageId) => {
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

  // Toggle selection mode
  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedImages(new Set()); // Clear selections when toggling
  };

  // Toggle image selection
  const toggleImageSelection = (imageId, e) => {
    e.stopPropagation();
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    setSelectedImages(newSelected);
  };

  // Select all images in current view
  const selectAll = () => {
    const allIds = new Set(filteredImages.map(img => img.id));
    setSelectedImages(allIds);
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedImages(new Set());
  };

  // Bulk delete selected images
  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) return;
    
    setShowBulkDeleteConfirm(false);
    setIsDeleting(true);
    
    try {
      showToast(`🗑️ Moving ${selectedImages.size} image${selectedImages.size > 1 ? 's' : ''} to trash...`, 'info', 0);
      
      const deletePromises = Array.from(selectedImages).map(id => deleteImage(id));
      await Promise.all(deletePromises);
      
      showToast(`✅ ${selectedImages.size} image${selectedImages.size > 1 ? 's' : ''} moved to trash!`, 'success', 3000);
      setSelectedImages(new Set());
      setSelectionMode(false);
    } catch (error) {
      console.error('Bulk delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to delete some images'}`, 'error', 4000);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredImages = images.filter(img => {
    // Filter by collection if collectionId is provided
    if (collectionId && img.collectionId !== collectionId) {
      return false;
    }
    
    // Filter by search query
    const query = searchQuery.toLowerCase();
    return (
      img.pageTitle?.toLowerCase().includes(query) ||
      img.description?.toLowerCase().includes(query) ||
      img.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  });

  // Get current collection name
  const currentCollection = collectionId 
    ? collections.find(c => c.id === collectionId)
    : null;

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const handleDelete = async () => {
    if (!selectedImage) return;
    
    setIsDeleting(true);
    setShowDeleteConfirm(false);
    
    try {
      showToast('🗑️ Moving to trash...', 'info', 0);
      await deleteImage(selectedImage.id);
      
      showToast('✅ Image moved to trash! (Hosts preserved)', 'success', 3000);
      setSelectedImage(null);
      setFullImageDetails(null);
    } catch (error) {
      console.error('Delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to move to trash'}`, 'error', 4000);
    } finally {
      setIsDeleting(false);
    }
  };

  // Image navigation functions for keyboard shortcuts
  const navigateToNextImage = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex === -1 || currentIndex === filteredImages.length - 1) return;
    
    setSelectedImage(filteredImages[currentIndex + 1]);
    setActiveTab('noobs'); // Reset to noobs tab (default view)
    setFullImageDetails(null); // Clear cached details for new image
  };

  const navigateToPreviousImage = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex <= 0) return;
    
    setSelectedImage(filteredImages[currentIndex - 1]);
    setActiveTab('noobs'); // Reset to noobs tab (default view)
    setFullImageDetails(null); // Clear cached details for new image
  };

  const closeImageModal = () => {
    setSelectedImage(null);
    setFullImageDetails(null);
  };

  // Keyboard shortcuts for image modal
  useKeyboardShortcuts({
    [SHORTCUTS.ARROW_RIGHT]: navigateToNextImage,
    [SHORTCUTS.ARROW_LEFT]: navigateToPreviousImage,
    [SHORTCUTS.ESCAPE]: () => {
      if (selectedImage) closeImageModal();
      else if (showUploadModal) setShowUploadModal(false);
      else if (selectionMode) setSelectionMode(false);
    },
    [SHORTCUTS.DELETE]: () => {
      if (selectedImage && !showDeleteConfirm) {
        setShowDeleteConfirm(true);
      }
    },
    // Global shortcuts
    [SHORTCUTS.U]: () => {
      if (!selectedImage && !showUploadModal) openUploadModal();
    },
    [SHORTCUTS.SLASH]: () => {
      // Focus search
      document.querySelector('input[placeholder*="Search"]')?.focus();
    },
    [SHORTCUTS.CTRL_K]: () => {
      // Focus search (alternative)
      document.querySelector('input[placeholder*="Search"]')?.focus();
    },
    [SHORTCUTS.S]: () => {
      if (!selectedImage && !showUploadModal) toggleSelectionMode();
    },
    [SHORTCUTS.CTRL_S]: (e) => {
      // Save image if in modal
      if (selectedImage) {
        e.preventDefault();
        handleSave();
      }
    },
  }, true, [selectedImage, filteredImages, showUploadModal, showDeleteConfirm, selectionMode]);

  // Upload modal handlers
  const openUploadModal = () => {
    setShowUploadModal(true);
    setUploadImageData(null);
    setUploadPageUrl('');
    setUploadDescription('');
    setUploadTags('');
    setUploadMetadata(null);
    setDuplicateData(null);
    setIsLocalUpload(false);
    setSelectedCollectionId('');
    setShowCreateCollection(false);
    setNewCollectionName('');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // Save current page metadata before replacing
      const savedPageUrl = uploadPageUrl;
      const savedPageTitle = uploadImageData?.pageTitle;
      
      await processMediaFile(file, savedPageUrl, savedPageTitle);
      
      // Mark this as a local upload
      setIsLocalUpload(true);
      
      // Show success feedback
      const fileType = file.type.startsWith('video/') ? 'Video' : 'Image';
      showToast(`✅ ${fileType} loaded successfully!`, 'success', 3000);
    }
  };

  const processMediaFile = async (file, preservePageUrl = null, preservePageTitle = null) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      // Determine what values to use
      const finalPageUrl = preservePageUrl && preservePageUrl !== 'Uploaded manually' 
        ? preservePageUrl 
        : 'Uploaded manually';
      const finalPageTitle = preservePageTitle && preservePageTitle !== 'Uploaded manually' 
        ? preservePageTitle 
        : 'Uploaded manually';
      
      const isVideo = file.type.startsWith('video/');
      
      setUploadImageData({
        srcUrl: reader.result,
        fileName: file.name,
        pageTitle: finalPageTitle,
        timestamp: Date.now(),
        file: file, // Store the original file object for MIME and date extraction
        isVideo: isVideo,
        fileType: file.type
      });
      setUploadPageUrl(finalPageUrl);
      
      // Extract metadata from the media file
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'extractMetadata',
          imageUrl: isVideo ? null : reader.result, // Don't send video data for metadata extraction
          pageUrl: finalPageUrl,
          fileName: file.name,
          fileMimeType: file.type,
          fileLastModified: file.lastModified,
          isVideo: isVideo
        });
        
        if (response.success && response.metadata) {
          setUploadMetadata(response.metadata);
          console.log('📸 Extracted metadata:', response.metadata);
        }
      } catch (error) {
        console.error('Failed to extract metadata:', error);
      }
    };
    reader.readAsDataURL(file);
  };

  // Drag & Drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };
  
  // Handle folder selection for auto-upload
  const handleSelectDownloadFolder = async () => {
    if (!pendingDownloadFile) return;
    
    try {
      // Check if File System Access API is supported
      if (!('showDirectoryPicker' in window)) {
        console.log('⚠️ [AUTO-LOAD] File System Access API not supported');
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast('⚠️ Please manually select the file to upload.', 'warning', 4000);
        return;
      }
      
      // Extract filename from path
      const fileName = pendingDownloadFile.split('\\').pop();
      const savedHandle = await getDirectoryHandle();
      if (savedHandle) {
        try {
          const fileHandle = await savedHandle.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          setShowFolderPrompt(false);
          setPendingDownloadFile(null);
          await processMediaFile(file, 'native-download://upload', 'Downloaded Video');
          setIsLocalUpload(true);
          setShowUploadModal(true);
          showToast(`Loaded "${fileName}" from saved folder.`, 'success', 3000);
          return;
        } catch (savedHandleErr) {
          await clearDirectoryHandle();
        }
      }
      console.log('📁 [AUTO-LOAD] Extracted filename:', fileName);
      
      console.log('📂 [AUTO-LOAD] Showing directory picker...');
      // Request permission to read the directory
      const dirHandle = await window.showDirectoryPicker({ 
        id: 'video-downloads',
        startIn: 'videos',
        mode: 'read'
      });
      
      console.log('✅ [AUTO-LOAD] Directory permission granted:', dirHandle.name);
      
      // Request persistent permission if supported
      if (typeof dirHandle.requestPermission === 'function') {
        try {
          const permission = await dirHandle.requestPermission({ mode: 'read' });
          console.log('🔐 [AUTO-LOAD] Requested persistent permission:', permission);
        } catch (permErr) {
          console.log('⚠️ [AUTO-LOAD] Permission request failed:', permErr.message);
        }
      }
      
      // Save to IndexedDB for future use
      await saveDirectoryHandle(dirHandle);
      
      // Get the file
      console.log('📄 [AUTO-LOAD] Getting file handle for:', fileName);
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      
      console.log('✅ [AUTO-LOAD] File loaded successfully:', file.name, file.size, 'bytes');
      
      // Hide the prompt
      setShowFolderPrompt(false);
      setPendingDownloadFile(null);
      
      // Process and show modal
      await processMediaFile(file, 'native-download://upload', 'Downloaded Video');
      setIsLocalUpload(true);
      setShowUploadModal(true);
      showToast(`✅ Video "${fileName}" loaded successfully!`, 'success', 3000);
      
    } catch (err) {
      console.error('❌ [AUTO-LOAD] Error:', err.name, err.message);
      if (err.name === 'AbortError') {
        console.log('⚠️ [AUTO-LOAD] User cancelled folder selection');
        setShowFolderPrompt(false);
        showToast('❌ Folder selection cancelled.', 'error', 3000);
      } else if (err.name === 'NotFoundError') {
        console.log('⚠️ [AUTO-LOAD] File not found in selected folder');
        const fileName = pendingDownloadFile.split('\\').pop();
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast(`⚠️ File "${fileName}" not found in selected folder. Please select it manually.`, 'warning', 5000);
      } else {
        console.error('❌ [AUTO-LOAD] Unexpected error:', err);
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast('⚠️ Failed to load file. Please select it manually.', 'warning', 4000);
      }
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Check if it's an image or video
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        await processMediaFile(file);
        setShowUploadModal(true);
      } else {
        showToast('❌ Please drop an image or video file', 'error', 3000);
      }
    }
  };

  // Add drag & drop event listeners
  useEffect(() => {
    const handleWindowDragEnter = (e) => handleDragEnter(e);
    const handleWindowDragLeave = (e) => handleDragLeave(e);
    const handleWindowDragOver = (e) => handleDragOver(e);
    const handleWindowDrop = (e) => handleDrop(e);

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  const handleUploadSubmit = async (ignoreDuplicates = false) => {
    if (!uploadImageData) return;

    // Clear previous duplicate data when starting new upload
    setDuplicateData(null);

    try {
      const tagsArray = uploadTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Create upload data object with only serializable values
      const uploadData = {
        imageUrl: String(uploadImageData.srcUrl || ''),
        originalSourceUrl: (isLocalUpload || uploadPageUrl === 'Uploaded manually') ? 'Uploaded manually' : String(uploadPageUrl || ''),
        pageUrl: String(uploadPageUrl || ''),
        pageTitle: String(uploadImageData.pageTitle || ''),
        fileName: String(uploadImageData.fileName || ''),
        description: String(uploadDescription || ''),
        tags: tagsArray.map(t => String(t)),
        ignoreDuplicate: Boolean(ignoreDuplicates),
        fileMimeType: uploadImageData.file?.type || null,
        fileLastModified: uploadImageData.file?.lastModified || null,
        collectionId: selectedCollectionId || null,
        isVideo: Boolean(uploadImageData.isVideo),
        fileType: uploadImageData.fileType || uploadImageData.file?.type || null
      };

      console.log('Uploading with data (keys):', Object.keys(uploadData));
      console.log('Media URL length:', uploadData.imageUrl.length);
      console.log('Is Video:', uploadData.isVideo);
      
      // Try to JSON.stringify to check if it's serializable
      try {
        JSON.stringify(uploadData);
        console.log('✓ Data is serializable');
      } catch (e) {
        console.error('✗ Data is NOT serializable:', e);
        throw new Error('Upload data contains non-serializable values');
      }

      await uploadImage(uploadData);

      // Close modal first for better UX
      setShowUploadModal(false);
      setDuplicateData(null);
      
      // Then reload both images and collections, and show toast
      await Promise.all([reload(), reloadCollections()]); // Refresh gallery and collections
      const mediaType = uploadData.isVideo ? 'Video' : 'Image';
      showToast(`✅ ${mediaType} uploaded successfully!`, 'success', 3000);
    } catch (err) {
      console.error('Upload failed:', err);
      
      const errorMessage = err?.message || String(err) || 'Upload failed';
      
      // Check if error has duplicate data (only for images)
      if (err?.duplicate && !uploadImageData.isVideo) {
        console.log('Duplicate data found:', err.duplicate);
        console.log('All duplicates found:', err.allDuplicates);
        // Set both single duplicate and all duplicates
        setDuplicateData({
          primary: err.duplicate,
          all: err.allDuplicates || [err.duplicate]
        });
      } else {
        // For non-duplicate errors, show toast
        showToast(`❌ ${errorMessage}`, 'error', 4000);
      }
    }
  };

  // Lazy load full image details when nerds tab is clicked
  const loadFullImageDetails = async (imageId) => {
    console.log('💾 [LAZY LOAD] loadFullImageDetails() called for ID:', imageId);
    
    if (fullImageDetails?.id === imageId) {
      console.log('✅ [CACHE HIT] Full details already loaded for this image - SKIPPING fetch');
      console.log('� [CACHE DATA] Cached details:', {
        id: fullImageDetails.id,
        fileName: fullImageDetails.fileName,
        fileType: fullImageDetails.fileType,
        fileSize: fullImageDetails.fileSize,
        sha256: fullImageDetails.sha256 ? 'present' : 'missing',
        pHash: fullImageDetails.pHash ? 'present' : 'missing'
      });
      return;
    }

    console.log('⚠️  [CACHE MISS] No cached details found - FETCHING from backend...');
    console.log('💡 [OPTIMIZATION] This data was NOT loaded with the gallery');
    console.log('⏱️  [TIMING] Loading NOW on user demand (lazy loading)');
    
    setLoadingNerdsTab(true);
    
    try {
      console.log('📡 [API CALL] Sending getImageById request to background script...');
      const response = await chrome.runtime.sendMessage({
        action: 'getImageById',
        data: { id: imageId }
      });

      console.log('📨 [API RESPONSE] Received response:', response.success ? 'SUCCESS' : 'FAILED');

      if (response.success && response.data) {
        console.log('✅ [LAZY LOAD] Full image details loaded successfully!');
        console.log('📊 [LOADED DATA]:', {
          fileName: response.data.fileName,
          fileType: response.data.fileType,
          fileSize: response.data.fileSize,
          dimensions: `${response.data.width}x${response.data.height}`,
          sha256: response.data.sha256 ? 'present' : 'missing',
          pHash: response.data.pHash ? 'present' : 'missing',
          aHash: response.data.aHash ? 'present' : 'missing',
          dHash: response.data.dHash ? 'present' : 'missing'
        });
        console.log('💾 [CACHE UPDATE] Storing details in state for future use');
        setFullImageDetails(response.data);
      } else {
        console.error('❌ [API ERROR] Failed to load details - no data in response');
      }
    } catch (error) {
      console.error('❌ [ERROR] Exception while loading full image details:', error);
    } finally {
      console.log('🏁 [DONE] Setting loadingNerdsTab to false');
      setLoadingNerdsTab(false);
    }
  };

  const handleTabSwitch = (tabName) => {
    console.log('═══════════════════════════════════════════');
    console.log('🔄 [TAB SWITCH] User clicked:', tabName);
    setActiveTab(tabName);
    
    // Lazy load full details ONLY when "For Nerds" tab is clicked
    if (tabName === 'nerds' && selectedImage) {
      console.log('🔍 [NERD TAB CLICKED] Checking if we need to load full details...');
      console.log('📦 [CACHE CHECK] Current fullImageDetails:', fullImageDetails ? 'EXISTS' : 'NULL');
      console.log('🆔 [CACHE CHECK] Selected image ID:', selectedImage.id);
      console.log('🆔 [CACHE CHECK] Cached details ID:', fullImageDetails?.id || 'N/A');
      loadFullImageDetails(selectedImage.id);
    } else if (tabName === 'noobs') {
      console.log('👶 [NOOBS TAB] Switched to For Noobs tab - NO lazy loading needed');
    }
    console.log('═══════════════════════════════════════════');
  };

  const startEditing = (field) => {
    setEditingField(field);
    if (field === 'tags') {
      setEditValues({ ...editValues, [field]: selectedImage.tags?.join(', ') || '' });
    } else {
      setEditValues({ ...editValues, [field]: selectedImage[field] || '' });
    }
  };

  const saveEdit = async (field) => {
    try {
      let value = editValues[field];
      if (field === 'tags') {
        value = value.split(',').map(t => t.trim()).filter(t => t);
      }
      
      // Handle collectionId change specially - need to update counts
      if (field === 'collectionId') {
        const oldCollectionId = selectedImage.collectionId;
        const newCollectionId = value || null;
        
        console.log('📝 [Collection Edit]', { oldCollectionId, newCollectionId });
        
        // Update the image's collectionId
        const updateData = { collectionId: newCollectionId };
        const updateResult = await chrome.runtime.sendMessage({
          action: 'updateImage',
          data: { id: selectedImage.id, ...updateData }
        });
        
        if (!updateResult.success) {
          throw new Error(updateResult.error || 'Failed to update image');
        }
        
        // Update collection counts
        try {
          if (oldCollectionId) {
            console.log('➖ Decrementing old collection:', oldCollectionId);
            const oldCollection = collections.find(c => c.id === oldCollectionId);
            if (oldCollection) {
              const decrementResult = await chrome.runtime.sendMessage({
                action: 'updateCollection',
                data: {
                  id: oldCollectionId,
                  updates: {
                    imageCount: Math.max(0, (oldCollection.imageCount || 1) - 1)
                  }
                }
              });
              if (!decrementResult.success) {
                console.error('Failed to decrement old collection count:', decrementResult.error);
              }
            }
          }
          
          if (newCollectionId) {
            console.log('➕ Incrementing new collection:', newCollectionId);
            const newCollection = collections.find(c => c.id === newCollectionId);
            if (newCollection) {
              const incrementResult = await chrome.runtime.sendMessage({
                action: 'updateCollection',
                data: {
                  id: newCollectionId,
                  updates: {
                    imageCount: (newCollection.imageCount || 0) + 1
                  }
                }
              });
              if (!incrementResult.success) {
                console.error('Failed to increment new collection count:', incrementResult.error);
              }
            }
          }
        } catch (countError) {
          console.error('Error updating collection counts:', countError);
          // Don't fail the whole operation if count update fails
        }
        
        setSelectedImage({ ...selectedImage, collectionId: newCollectionId });
        setEditingField(null);
        
        // Reload both images and collections to reflect the changes
        await Promise.all([reload(), reloadCollections()]);
        return;
      }
      
      const updateData = { [field]: value };
      await chrome.runtime.sendMessage({
        action: 'updateImage',
        data: { id: selectedImage.id, ...updateData }
      });
      
      setSelectedImage({ ...selectedImage, [field]: value });
      setEditingField(null);
    } catch (error) {
      console.error('Failed to update field:', error);
      alert('Failed to update');
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValues({});
  };

  const downloadImage = async (url, source) => {
    try {
      // For Filemoon, convert embed URL to download URL
      if (source === 'filemoon') {
        // Extract filecode from URL (format: https://filemoon.sx/e/FILECODE)
        const match = url.match(/\/e\/([^\/\?]+)/);
        if (match && match[1]) {
          const filecode = match[1];
          const downloadUrl = `https://bysesayeveum.com/download/${filecode}`;
          window.open(downloadUrl, '_blank');
          showToast('✅ Opening Filemoon download page...', 'success', 3000);
        } else {
          // Fallback to opening the embed URL
          window.open(url, '_blank');
          showToast('✅ Opening Filemoon page...', 'success', 3000);
        }
        return;
      }
      
      // For UDrop, open in new tab
      if (source === 'udrop') {
        window.open(url, '_blank');
        showToast('✅ Opening UDrop download page...', 'success', 3000);
        return;
      }
      
      // For direct image URLs (Pixvid, ImgBB), download directly
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Extract filename from URL
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const filename = pathParts[pathParts.length - 1] || `image-${source}.jpg`;
      
      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed');
    }
  };

  const openDuplicateMatchInNewTab = (dup) => {
    const candidateUrls = [
      dup?.sourcePageUrl,
      dup?.originalSourceUrl,
      dup?.sourceImageUrl,
      dup?.pageUrl,
      dup?.imgbbUrl,
      dup?.pixvidUrl
    ].filter(Boolean);

    const jumpUrl = candidateUrls.find((url) => {
      if (typeof url !== 'string') return false;
      return /^https?:\/\//i.test(url);
    });

    if (!jumpUrl) {
      showToast('❌ No valid URL found for this duplicate match', 'error', 3000);
      return;
    }

    window.open(jumpUrl, '_blank', 'noopener,noreferrer');
    showToast('✅ Opened duplicate match in a new tab', 'success', 2000);
  };

  const groupImagesByDate = (images) => {
    const groups = {};
    images.forEach(img => {
      const date = new Date(img.internalAddedTimestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      let dateKey;
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = date.toLocaleDateString();
      }
      
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(img);
    });
    return groups;
  };

  const groupedImages = groupImagesByDate(filteredImages);

  // Build timeline data for scrollbar (grouped by month/year)
  useEffect(() => {
    const dateKeys = Object.keys(groupedImages);
    const monthGroups = {};
    
    // Group dates by month/year
    dateKeys.forEach(dateKey => {
      // Get the first image from this date group to extract the actual date
      const firstImage = groupedImages[dateKey][0];
      if (firstImage && firstImage.internalAddedTimestamp) {
        const date = new Date(firstImage.internalAddedTimestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        
        if (!monthGroups[monthKey]) {
          monthGroups[monthKey] = {
            label: monthLabel,
            element: dateGroupRefs.current[dateKey], // Use first date group in month as anchor
            sortDate: date
          };
        }
      }
    });
    
    // Convert to array and sort by date (newest first)
    const timeline = Object.values(monthGroups)
      .sort((a, b) => b.sortDate - a.sortDate)
      .map(group => ({
        date: group.label,
        label: group.label,
        element: group.element
      }));
    
    setTimelineData(timeline);
  }, [groupedImages]);

  // Check for pending image from right-click context menu
  useEffect(() => {
    console.log('🚀 GalleryPage useEffect running - checking for pending image...');
    const checkPendingImage = async () => {
      try {
        const { pendingImage } = await chrome.storage.local.get('pendingImage');
        console.log('📦 Pending image from storage:', pendingImage);
        console.log('📦 Has srcUrl?', !!pendingImage?.srcUrl);
        console.log('📦 srcUrl value:', pendingImage?.srcUrl);
        
        if (pendingImage) {
          // Clear the pending image
          await chrome.storage.local.remove('pendingImage');
          
          if (pendingImage.srcUrl) {
            console.log('✅ Pending image found! Opening modal...');
            // Normal flow - has srcUrl
            setUploadImageData({
              srcUrl: pendingImage.srcUrl,
              fileName: pendingImage.srcUrl.split('/').pop().split('?')[0] || 'image.jpg',
              pageTitle: pendingImage.pageTitle || '',
              isBase64: pendingImage.isBase64 || false,
              isWarningSite: pendingImage.isWarningSite || false,
              warningSiteName: pendingImage.warningSiteName || '',
              isGoodQualitySite: pendingImage.isGoodQualitySite || false,
              goodQualitySiteName: pendingImage.goodQualitySiteName || ''
            });
            setUploadPageUrl(pendingImage.pageUrl || '');
            
            // Open the upload modal
            setShowUploadModal(true);
            console.log('🎨 Modal should be open now!');
            
            // Extract metadata
            try {
              const response = await chrome.runtime.sendMessage({
                action: 'extractMetadata',
                imageUrl: pendingImage.srcUrl,
                pageUrl: pendingImage.pageUrl,
                fileName: pendingImage.srcUrl.split('/').pop().split('?')[0]
              });

              if (response.success) {
                setUploadMetadata(response.metadata);
                
                // Check for duplicates
                if (response.metadata.duplicateImage) {
                  setDuplicateData(response.metadata.duplicateImage);
                }
              }
            } catch (error) {
              console.error('Failed to extract metadata:', error);
            }
          } else {
            // No srcUrl - show modal with upload prompt
            console.log('⚠️ No srcUrl - showing upload prompt');
            setUploadPageUrl(pendingImage.pageUrl || '');
            setIsManualUploadMode(true);
            setShowUploadModal(true);
            console.log('🎨 Modal opened with upload prompt!');
          }
        } else {
          console.log('❌ No pending image found in storage');
        }
      } catch (error) {
        console.error('❌ Error checking pending image:', error);
      }
    };
    
    checkPendingImage();
  }, []);

  // Handle auto-open upload from debug page
  useEffect(() => {
    if (location.state?.autoOpenUpload) {
      // If a file was provided (from debug page with File System API)
      if (location.state?.uploadFile) {
        const file = location.state.uploadFile;
        console.log('🐛 Debug page upload file received:', file.name);
        
        // Process the file and open modal
        const processFile = async () => {
          await processMediaFile(file, 'debug://upload', 'Debug Upload');
          setIsLocalUpload(true);
          setShowUploadModal(true);
          
          const fileType = file.type.startsWith('video/') ? 'Video' : 'Image';
          showToast(`✅ ${fileType} loaded successfully!`, 'success', 3000);
        };
        
        processFile();
      } else if (location.state?.downloadFilePath) {
        // Auto-load file using saved directory handle
        console.log('🐛 [AUTO-LOAD] Starting auto-load for:', location.state.downloadFilePath);
        
        const loadDownloadedFile = async () => {
          try {
            const fileName = location.state.downloadFilePath.split('\\').pop();
            console.log('� [AUTO-LOAD] Extracted filename:', fileName);
            
            // Try to get saved directory handle
            let dirHandle = await getDirectoryHandle();
            
            if (dirHandle) {
              try {
                console.log('✅ [AUTO-LOAD] Using saved directory handle');
                // Try to access the file
                const fileHandle = await dirHandle.getFileHandle(fileName);
                const file = await fileHandle.getFile();
                
                console.log('✅ [AUTO-LOAD] File loaded successfully:', file.name, file.size, 'bytes');
                
                // Process and show modal
                await processMediaFile(file, 'native-download://upload', 'Downloaded Video');
                setIsLocalUpload(true);
                setShowUploadModal(true);
                showToast(`✅ Video "${fileName}" loaded successfully!`, 'success', 3000);
                return;
              } catch (fileErr) {
                console.log('⚠️ [AUTO-LOAD] Failed to access file with saved handle:', fileErr.message);
                // Clear the invalid handle
                await clearDirectoryHandle();
              }
            }
            
            // No saved handle or it failed. We need a user gesture to open the picker,
            // so hand off to the existing folder-prompt UI instead of auto-opening it here.
            console.log('📂 [AUTO-LOAD] No usable directory handle. Prompting user to pick the download folder...');
            setPendingDownloadFile(location.state.downloadFilePath);
            setShowFolderPrompt(true);
            showToast(`Select the download folder to load "${fileName}" automatically.`, 'info', 4000);
            
          } catch (err) {
            console.error('❌ [AUTO-LOAD] Unexpected error:', err);
            setPendingDownloadFile(location.state.downloadFilePath);
            setShowFolderPrompt(true);
            showToast('Select the download folder to finish loading the downloaded file.', 'warning', 4000);
          }
        };
        
        loadDownloadedFile();
      } else {
        // Just open the upload modal (for native download without file path)
        console.log('🐛 Auto-opening upload modal after download');
        setShowUploadModal(true);
        showToast('✅ Download complete! Please select the downloaded file to upload.', 'info', 4000);
      }
      
      // Clear the navigation state
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  return (
  <div ref={pageContainerRef} className="min-h-screen bg-base-200 text-base-content overflow-y-auto">
      {/* Drag & Drop Overlay with Animated Highlights */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 pointer-events-none"
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 via-secondary-500/20 to-primary-500/20 backdrop-blur-sm" />
            
            {/* Animated border glow */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute inset-8"
            >
              {/* Pulsing border */}
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 40px rgba(139, 92, 246, 0.4)',
                    '0 0 0 4px rgba(236, 72, 153, 0.3), 0 0 60px rgba(236, 72, 153, 0.4)',
                    '0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 40px rgba(139, 92, 246, 0.4)',
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="w-full h-full rounded-3xl border-4 border-dashed border-base-content/40"
              />
              
              {/* Center content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ 
                    type: "spring",
                    stiffness: 200,
                    damping: 15,
                    delay: 0.1
                  }}
                  className="relative mb-6"
                >
                  {/* Glowing background */}
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 0.8, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl"
                  />
                  
                  {/* Upload icon */}
                  <div className="relative z-10 bg-base-100 rounded-full p-8 shadow-2xl">
                    <Upload className="w-20 h-20 text-primary-600" />
                  </div>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-center"
                >
                  <h3 className="text-4xl font-bold text-base-content mb-3 drop-shadow-2xl">
                    Drop your image here
                  </h3>
                  <p className="text-xl text-base-content/80 drop-shadow-lg">
                    Release to upload to ImgVault
                  </p>
                </motion.div>
                
                {/* Floating particles */}
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      x: [0, Math.random() * 200 - 100],
                      y: [0, Math.random() * 200 - 100],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeOut"
                    }}
                    className="absolute w-3 h-3 bg-base-content/60 rounded-full blur-sm"
                    style={{
                      left: '50%',
                      top: '50%',
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Scrollbar */}
      <TimelineScrollbar dateGroups={timelineData} containerRef={pageContainerRef} />

      <GalleryNavbar
        key={`gallery-navbar-${collectionId || 'all'}-${filteredImages.length}-${images.length}`}
        collectionId={collectionId}
        currentCollection={currentCollection}
        navigate={navigate}
        images={images}
        defaultGallerySource={defaultGallerySource}
        reload={reload}
        toggleSelectionMode={toggleSelectionMode}
        selectionMode={selectionMode}
        collectionsLoading={collectionsLoading}
        collections={collections}
        trashLoading={trashLoading}
        trashedImages={trashedImages}
        openUploadModal={openUploadModal}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedImages={selectedImages}
        selectAll={selectAll}
        filteredImages={filteredImages}
        displayCount={filteredImages.length}
        deselectAll={deselectAll}
        setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
        isDeleting={isDeleting}
        onHeightChange={setNavbarHeight}
      />

      <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '180px' }} />

      <div className="w-full px-3 sm:px-6">
  <div className="px-0">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col justify-center items-center py-32">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-2xl opacity-50 animate-pulse"></div>
              <Spinner size="lg" className="relative z-10" />
            </div>
            <p className="mt-6 text-base-content/85 text-lg font-medium">Loading your vault...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && images.length === 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="glass-card rounded-3xl backdrop-blur-xl bg-base-100/80 border border-base-content/20 
                      shadow-2xl p-16 text-center relative overflow-hidden"
            style={{ willChange: 'transform, opacity' }}
          >
            {/* Animated background gradient */}
            <motion.div
              className="absolute inset-0 opacity-20"
              style={{ willChange: 'background' }}
              animate={{
                background: [
                  'radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 80% 50%, rgba(236, 72, 153, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 50% 80%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 50% 20%, rgba(236, 72, 153, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                ],
              }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            />
            
            {/* Icon with pulse animation */}
            <motion.div 
              className="relative inline-block mb-8"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
              style={{ willChange: 'transform' }}
            >
              <motion.div 
                className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl"
                style={{ willChange: 'transform, opacity' }}
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.3, 0.5, 0.3]
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div 
                className="text-9xl relative z-10 drop-shadow-2xl"
                style={{ willChange: 'transform' }}
                animate={{ 
                  y: [0, -10, 0],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                🖼️
              </motion.div>
            </motion.div>
            
            {/* Text with stagger animation */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.3 }}
              style={{ willChange: 'transform, opacity' }}
            >
              <h3 className="text-4xl font-bold mb-4 drop-shadow-lg bg-gradient-to-r from-base-content to-base-content/70 bg-clip-text text-transparent">
                Your Vault is Empty
              </h3>
              <p className="text-base-content/70 text-lg mb-10 max-w-md mx-auto leading-relaxed">
                Start building your collection by uploading your first image
              </p>
            </motion.div>
            
            {/* CTA Button with hover effects */}
            <motion.button
              onClick={openUploadModal}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.3 }}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
              style={{ willChange: 'transform' }}
              className="group relative px-10 py-5 rounded-2xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       text-primary-content font-bold text-lg shadow-2xl overflow-hidden
                       transition-all duration-150"
            >
              {/* Button shine effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-base-content/20 to-transparent"
                initial={{ x: '-100%' }}
                whileHover={{ x: '100%' }}
                transition={{ duration: 0.4 }}
                style={{ willChange: 'transform' }}
              />
              
              <span className="relative z-10 flex items-center gap-3">
                <Upload className="w-6 h-6" />
                Upload First Image
              </span>
              
              {/* Glow effect on hover */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-primary-400 to-secondary-400 blur-xl opacity-0 group-hover:opacity-50 transition-opacity duration-150"
                style={{ zIndex: -1 }}
              />
            </motion.button>
            
            {/* Floating particles */}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 bg-base-content/20 rounded-full"
                style={{
                  left: `${20 + i * 12}%`,
                  top: `${30 + (i % 3) * 20}%`,
                  willChange: 'transform, opacity'
                }}
                animate={{
                  y: [0, -20, 0],
                  opacity: [0.2, 0.5, 0.2],
                }}
                transition={{
                  duration: 2 + i * 0.3,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.15,
                }}
              />
            ))}
          </motion.div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10" ref={el => dateGroupRefs.current[date] = el}>
            <h2 className="text-2xl font-bold text-base-content mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-primary-500 to-secondary-500 w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Masonry Grid - 3 columns on mobile, 4 on tablet, 5 on desktop, 6 on large screens */}
            <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-3 sm:gap-4 md:gap-6 space-y-3 sm:space-y-4 md:space-y-6">
              {groupedImages[date].map((img, index) => (
                <motion.div
                  key={img.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.05,
                    ease: [0.25, 0.46, 0.45, 0.94]
                  }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  className="group relative break-inside-avoid mb-6 cursor-pointer"
                  onClick={(e) => {
                    if (selectionMode) {
                      toggleImageSelection(img.id, e);
                    } else {
                      setIsModalAnimating(true);
                      setSelectedImage(img);
                      setActiveTab('noobs');
                      setFullImageDetails(null);
                      setTimeout(() => setIsModalAnimating(false), 300);
                    }
                  }}
                >
                  {/* Soft glow effect on hover */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/40 to-secondary-500/40 
                                rounded-xl opacity-0 group-hover:opacity-100 blur-xl 
                                transition-all duration-700 ease-out"></div>
                  
                  {/* Card with soft shadows and smooth animations */}
                  <div className="relative bg-base-100/80 backdrop-blur-sm border border-base-content/20 
                                rounded-xl overflow-hidden shadow-lg group-hover:shadow-2xl
                                transform transition-all duration-500 ease-out 
                                group-hover:scale-[1.04] group-hover:-translate-y-2">
                    {/* Selection Checkbox - shown in selection mode */}
                    {selectionMode && (
                      <div className="absolute top-2 right-2 z-20">
                        <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center
                                      transition-all duration-200 ${
                          selectedImages.has(img.id)
                            ? 'bg-primary-500 border-primary-400'
                            : 'bg-base-300/70 border-base-content/40 backdrop-blur-sm'
                        }`}>
                          {selectedImages.has(img.id) && (
                            <span className="text-primary-content text-sm font-bold">✓</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Loading skeleton with shimmer - only show for non-video items */}
                    {!loadedImages.has(img.id) && !img.filemoonUrl && !img.udropUrl && (
                      <div className="absolute inset-0 bg-base-300 overflow-hidden">
                        <div className="absolute inset-0 shimmer"></div>
                      </div>
                    )}
                    
                    {/* Render image or video thumbnail/embed */}
                    {img.filemoonUrl ? (
                      <iframe
                        src={img.filemoonUrl}
                        className="w-full aspect-video object-cover pointer-events-none"
                        frameBorder="0"
                        scrolling="no"
                        style={{ pointerEvents: 'none' }}
                        onLoad={() => handleImageLoad(img.id)}
                      />
                    ) : img.udropUrl ? (
                      <video
                        src={img.udropUrl}
                        className="w-full aspect-video object-cover"
                        style={{ pointerEvents: 'none' }}
                        onLoadedMetadata={() => handleImageLoad(img.id)}
                      />
                    ) : (
                      <img
                        src={img.imgbbUrl || img.pixvidUrl}
                        alt={img.pageTitle}
                        onLoad={() => handleImageLoad(img.id)}
                        className={`w-full object-cover transition-all duration-700 ease-out
                                 group-hover:scale-110
                                 ${loadedImages.has(img.id) 
                                   ? 'opacity-100' 
                                   : 'opacity-0'}`}
                        loading="lazy"
                      />
                    )}
                    
                    {/* Video play icon overlay */}
                    {(img.filemoonUrl || img.udropUrl) && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-base-300/80 backdrop-blur-sm rounded-full p-4">
                          <svg className="w-12 h-12 text-base-content" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </div>
                      </div>
                    )}
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out">
                      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2 
                                    transform translate-y-2 group-hover:translate-y-0 
                                    transition-transform duration-500 ease-out">
                        <p className="text-base-content text-sm font-semibold truncate drop-shadow-xl">
                          {img.pageTitle || 'Untitled'}
                        </p>
                        {img.tags && img.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {img.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-lg bg-base-100/70 backdrop-blur-sm 
                                         text-base-content border border-base-content/30 font-medium shadow-lg"
                              >
                                {tag}
                              </span>
                            ))}
                            {img.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-lg bg-base-100/70 backdrop-blur-sm 
                                             text-base-content border border-base-content/30 font-medium shadow-lg">
                                +{img.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}

        {/* Animated Photo Viewer / Lightbox Modal */}
        <Modal
          isOpen={!!selectedImage}
          onClose={() => {
            setSelectedImage(null);
            setActiveTab('noobs');
            setFullImageDetails(null);
          }}
          className="!max-w-[95vw] !w-full !h-[95vh] !p-0 !overflow-hidden"
        >
          {selectedImage && (
            <div className={`flex flex-col lg:flex-row h-full relative transition-all duration-500 ease-out
                          ${isModalAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
              
              {/* Dark Overlay Background with Fade */}
              <div className={`absolute inset-0 bg-base-300/90 transition-opacity duration-500
                            ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} />

              {/* LEFT SIDE - IMAGE/VIDEO with Zoom Animation */}
              <div className="flex-1 min-h-[35vh] lg:min-h-0 flex items-center justify-center bg-gradient-to-br from-base-300 to-base-200 p-3 sm:p-6 lg:p-8 relative z-10">
                {/* Radial glow effect */}
                <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              w-4/5 h-4/5 bg-primary/10 rounded-full blur-3xl
                              transition-all duration-700 ease-out
                              ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}></div>
                
                {/* Conditional rendering for video or image */}
                {selectedImage.filemoonUrl ? (
                  <iframe
                    src={selectedImage.filemoonUrl}
                    className={`w-full h-full rounded-2xl shadow-2xl relative z-10
                             transition-all duration-700 ease-out
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                    frameBorder="0"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                ) : selectedImage.udropUrl ? (
                  <video
                    src={selectedImage.udropUrl}
                    controls
                    className={`w-full h-full rounded-2xl shadow-2xl relative z-10
                             transition-all duration-700 ease-out
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                  />
                ) : (
                  <img
                    src={selectedImage.imgbbUrl || selectedImage.pixvidUrl}
                    alt={selectedImage.pageTitle}
                    className={`max-w-full max-h-full object-contain rounded-2xl shadow-2xl relative z-10
                             transition-all duration-700 ease-out
                             hover:scale-[1.02] hover:shadow-primary/30
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                  />
                )}
              </div>

              {/* RIGHT SIDE - DETAILS with Slide-up Animation */}
  <div className={`w-full lg:w-[550px] lg:flex-shrink-0 bg-base-100 border-t lg:border-t-0 lg:border-l border-base-content/20 
                            overflow-y-auto flex flex-col relative z-10
                            transition-all duration-500 ease-out
                            ${isModalAnimating ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--p)) hsl(var(--b3))' }}
              >
                {/* Close Button with Fade Animation */}
                <button
                  onClick={() => {
                    setSelectedImage(null);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                  }}
                  className={`absolute top-4 right-4 z-50 w-11 h-11 rounded-full bg-error/20 
                           hover:bg-error/35 border border-error/50 hover:border-error 
                           flex items-center justify-center transition-all duration-300 
                           hover:scale-110 hover:rotate-90 group shadow-xl
                           ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`}
                  title="Close"
                >
                  <span className="text-error group-hover:text-error-content text-2xl font-bold">✕</span>
                </button>

                <div className="p-6 flex-1 pt-16">
              {/* Details Header */}
              <h2 className="text-2xl font-bold text-base-content mb-4">
                Details
              </h2>

              {/* Tab Navigation */}
              <div className="flex gap-2 mb-4 border-b border-base-content/20 overflow-x-auto whitespace-nowrap">
                <button
                  onClick={() => handleTabSwitch('noobs')}
                  className={`px-4 py-2 font-semibold transition-all flex items-center gap-2 ${
                    activeTab === 'noobs'
            ? 'text-info border-b-2 border-info'
            : 'text-base-content/60 hover:text-base-content/85'
                  }`}
                >
                  <span>For Noobs 👶</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    activeTab === 'noobs' 
            ? 'bg-info/20 text-info' 
            : 'bg-base-300/70 text-base-content/60'
                  }`}>
                    {/* Count: Title, Added To Vault, Collection (conditional), Pixvid/Filemoon/UDrop URLs, ImgBB URL, Source URL, Page URL, Description, Tags */}
                    {(() => {
                      let count = 6; // Title, Added To Vault, Source URL, Page URL, Description, Tags
                      if (selectedImage?.collectionId) count++; // Collection
                      // Images show Pixvid URL, videos show Filemoon/UDrop
                      if (selectedImage?.pixvidUrl && !selectedImage?.filemoonUrl && !selectedImage?.udropUrl) count++; // Pixvid URL (images only)
                      if (selectedImage?.imgbbUrl) count++; // ImgBB URL
                      if (selectedImage?.filemoonUrl) count++; // Filemoon URL (videos)
                      if (selectedImage?.udropUrl) count++; // UDrop URL (videos)
                      return count;
                    })()}
                  </span>
                </button>
                <button
                  onClick={() => handleTabSwitch('nerds')}
                  className={`px-4 py-2 font-semibold transition-all flex items-center gap-2 ${
                    activeTab === 'nerds'
            ? 'text-success border-b-2 border-success'
            : 'text-base-content/60 hover:text-base-content/85'
                  }`}
                >
                  <span>For Nerds 🤓</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    activeTab === 'nerds' 
            ? 'bg-success/20 text-success' 
            : 'bg-base-300/70 text-base-content/60'
                  }`}>
                    {fullImageDetails ? (() => {
                      // Count base technical fields (excluding Document ID)
                      let count = 7; // File Name, File Type, File Size, SHA-256, pHash, aHash, dHash
                      
                      // Add width and height if present
                      if (fullImageDetails.width) count++;
                      if (fullImageDetails.height) count++;
                      
                      // Count EXIF fields (everything that's not in knownFields)
                      const knownFields = new Set([
                        'id', 'pixvidUrl', 'imgbbUrl',
                        'sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'fileName', 'fileSize', 'tags', 'description',
                        'internalAddedTimestamp', 'sha256', 'pHash', 'aHash', 'dHash', 'width', 'height', 'fileType'
                      ]);
                      
                      const exifFields = Object.keys(fullImageDetails).filter(key => !knownFields.has(key));
                      count += exifFields.length;
                      
                      return count;
                    })() : '...'}
                  </span>
                </button>
              </div>

              {/* For Noobs Tab */}
              {activeTab === 'noobs' && (
                <div className="space-y-4">
                  {/* Details Grid */}
                  {(() => {
                    let noobsFieldCounter = 0;
                    const fieldNo = () => `${++noobsFieldCounter}.`;

                    return (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Title
                        </span>
                        {editingField !== 'pageTitle' && (
                          <button
                            onClick={() => startEditing('pageTitle')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'pageTitle' ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editValues.pageTitle || ''}
                            onChange={(e) => setEditValues({ ...editValues, pageTitle: e.target.value })}
                            className="w-full px-3 py-2 rounded bg-base-100 border border-base-content/25 text-base-content text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('pageTitle')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-base-content font-medium">
                          {selectedImage.pageTitle || 'Untitled'}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Added To Vault
                        </span>
                        {editingField !== 'internalAddedTimestamp' && (
                          <button
                            onClick={() => startEditing('internalAddedTimestamp')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'internalAddedTimestamp' ? (
                        <div className="space-y-2">
                          <input
                            type="datetime-local"
                            value={editValues.internalAddedTimestamp 
                              ? new Date(editValues.internalAddedTimestamp).toISOString().slice(0, 16)
                              : ''}
                            onChange={(e) => setEditValues({ 
                              ...editValues, 
                              internalAddedTimestamp: new Date(e.target.value).toISOString()
                            })}
                            className="w-full px-3 py-2 rounded bg-base-100 border border-base-content/25 text-base-content text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('internalAddedTimestamp')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-base-content">
                          {selectedImage.internalAddedTimestamp
                            ? new Date(selectedImage.internalAddedTimestamp).toLocaleString('en-US', {
                                weekday: 'short',
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit'
                              })
                            : 'N/A'}
                        </div>
                      )}
                    </div>

                    {/* Collection */}
                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Collection
                        </span>
                        {editingField !== 'collectionId' && (
                          <button
                            onClick={() => startEditing('collectionId')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      
                      {editingField === 'collectionId' ? (
                        <div className="space-y-2">
                          <select
                            value={editValues.collectionId || ''}
                            onChange={(e) => setEditValues({ ...editValues, collectionId: e.target.value || null })}
                            className="w-full px-3 py-2 rounded bg-base-100 border border-base-content/25 text-base-content text-sm"
                          >
                            <option value="">No Collection</option>
                            {collections.map(col => (
                              <option key={col.id} value={col.id}>{col.name}</option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('collectionId')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : selectedImage.collectionId ? (() => {
                        const collection = collections.find(c => c.id === selectedImage.collectionId);
                        return collection ? (
                          <div className="flex items-center gap-2">
                            <div 
                              className="px-3 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-2 shadow-md"
                              style={{
                                backgroundColor: `${collection.color || '#6366f1'}20`,
                                borderColor: `${collection.color || '#6366f1'}50`,
                                borderWidth: '1px',
                                color: collection.color || '#a5b4fc'
                              }}
                            >
                              <span>{collection.name}</span>
                              <span className="text-xs opacity-70">({collection.imageCount || 0})</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-red-400">
                            Collection not found (ID: {selectedImage.collectionId})
                          </div>
                        );
                      })() : (
                        <div className="text-base-content/50 text-sm italic">
                          Not in any collection
                        </div>
                      )}
                    </div>

                    {/* Pixvid URL - Only show for images (not videos) */}
                    {selectedImage.pixvidUrl && !selectedImage.filemoonUrl && !selectedImage.udropUrl && (
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Pixvid URL
                        </div>
                        <div className="bg-base-200 rounded p-2">
                          <a
                            href={selectedImage.pixvidUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-info hover:text-info/80 break-all text-sm"
                          >
                            {selectedImage.pixvidUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    {selectedImage.imgbbUrl && (
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          ImgBB URL
                        </div>
                        <div className="bg-base-200 rounded p-2">
                          <a
                            href={selectedImage.imgbbUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-success hover:text-success/80 break-all text-sm"
                          >
                            {selectedImage.imgbbUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    {selectedImage.filemoonUrl && (
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Filemoon URL
                        </div>
                        <div className="bg-base-200 rounded p-2">
                          <a
                            href={selectedImage.filemoonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-secondary hover:text-secondary/80 break-all text-sm"
                          >
                            {selectedImage.filemoonUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    {selectedImage.udropUrl && (
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          UDrop URL
                        </div>
                        <div className="bg-base-200 rounded p-2">
                          <a
                            href={selectedImage.udropUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-warning hover:text-warning/80 break-all text-sm"
                          >
                            {selectedImage.udropUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Source URL
                        </span>
                        {editingField !== 'sourceImageUrl' && (
                          <button
                            onClick={() => startEditing('sourceImageUrl')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'sourceImageUrl' ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editValues.sourceImageUrl || ''}
                            onChange={(e) => setEditValues({ ...editValues, sourceImageUrl: e.target.value })}
                            className="w-full px-3 py-2 rounded bg-base-100/70 border border-base-content/25 text-base-content text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('sourceImageUrl')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-base-100/60 rounded p-2">
                          <a
                            href={selectedImage.sourceImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80 break-all text-sm"
                          >
                            {selectedImage.sourceImageUrl || 'N/A'}
                          </a>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Page URL
                        </span>
                        {editingField !== 'sourcePageUrl' && (
                          <button
                            onClick={() => startEditing('sourcePageUrl')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'sourcePageUrl' ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editValues.sourcePageUrl || ''}
                            onChange={(e) => setEditValues({ ...editValues, sourcePageUrl: e.target.value })}
                            className="w-full px-3 py-2 rounded bg-base-100/70 border border-base-content/25 text-base-content text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('sourcePageUrl')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-base-100/60 rounded p-2">
                          <a
                            href={selectedImage.sourcePageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80 break-all text-sm"
                          >
                            {selectedImage.sourcePageUrl || 'N/A'}
                          </a>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <AlignLeft className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Description
                        </span>
                        {editingField !== 'description' && (
                          <button
                            onClick={() => startEditing('description')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'description' ? (
                        <div className="space-y-2">
                          <textarea
                            value={editValues.description || ''}
                            onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                            className="w-full px-3 py-2 rounded bg-base-100/70 border border-base-content/25 text-base-content text-sm"
                            rows="3"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('description')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-base-content/70 text-sm">
                          {selectedImage.description || 'No description'}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Tag className="w-3.5 h-3.5" />
                          <span className="text-primary font-bold">{fieldNo()}</span>
                          Tags
                        </span>
                        {editingField !== 'tags' && (
                          <button
                            onClick={() => startEditing('tags')}
                            className="text-primary hover:text-primary/80 text-xs"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {editingField === 'tags' ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editValues.tags || ''}
                            onChange={(e) => setEditValues({ ...editValues, tags: e.target.value })}
                            placeholder="Comma separated tags"
                            className="w-full px-3 py-2 rounded bg-base-100/70 border border-base-content/25 text-base-content text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit('tags')}
                              className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30"
                            >
                              ✓ Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {selectedImage.tags && selectedImage.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedImage.tags.map(tag => (
                                <span
                                  key={tag}
                                  className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-base-content/50 italic text-sm">No tags</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                    );
                  })()}

                  {/* Download Buttons */}
                  <div className="flex gap-2 pt-4 border-t border-base-content/20">
                    {/* Show video sources if it's a video */}
                    {(selectedImage.filemoonUrl || selectedImage.udropUrl) ? (
                      <>
                        {selectedImage.filemoonUrl && (
                          <Button
                            variant="glass"
                            size="sm"
                            onClick={() => downloadImage(selectedImage.filemoonUrl, 'filemoon')}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download from Filemoon
                          </Button>
                        )}
                        {selectedImage.udropUrl && (
                          <Button
                            variant="glass"
                            size="sm"
                            onClick={() => downloadImage(selectedImage.udropUrl, 'udrop')}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download from UDrop
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Show image sources if it's an image */}
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => downloadImage(selectedImage.pixvidUrl, 'pixvid')}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download from Pixvid
                        </Button>
                        {selectedImage.imgbbUrl && (
                          <Button
                            variant="glass"
                            size="sm"
                            onClick={() => downloadImage(selectedImage.imgbbUrl, 'imgbb')}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download from ImgBB
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* For Nerds Tab */}
              {activeTab === 'nerds' && (
                <div className="space-y-4">
                  {loadingNerdsTab && !fullImageDetails ? (
                    <div className="flex justify-center items-center py-10">
                      <Spinner size="md" />
                      <span className="ml-3 text-base-content/70">Loading technical details...</span>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {/* Document ID */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Database className="w-3.5 h-3.5" />
                          Document ID
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {selectedImage.id || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* File Name */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <File className="w-3.5 h-3.5" />
                          File Name
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {fullImageDetails?.fileName || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* File Type */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5" />
                          File Type
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm">
                            {fullImageDetails?.fileType || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* File Size */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Database className="w-3.5 h-3.5" />
                          File Size
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm">
                            {fullImageDetails?.fileSize 
                              ? `${(fullImageDetails.fileSize / 1024).toFixed(2)} KB` 
                              : loadingNerdsTab ? 'Loading...' : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Width */}
                      {fullImageDetails?.width && (
                        <div>
                          <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                            <Ruler className="w-3.5 h-3.5" />
                            Width
                          </div>
                          <div className="bg-base-100/60 rounded p-2">
                            <p className="text-base-content font-mono text-sm">
                              {fullImageDetails.width}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Height */}
                      {fullImageDetails?.height && (
                        <div>
                          <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                            <Ruler className="w-3.5 h-3.5" />
                            Height
                          </div>
                          <div className="bg-base-100/60 rounded p-2">
                            <p className="text-base-content font-mono text-sm">
                              {fullImageDetails.height}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* SHA-256 */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Fingerprint className="w-3.5 h-3.5" />
                          SHA-256
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {fullImageDetails?.sha256 || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* pHash */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Hash className="w-3.5 h-3.5" />
                          pHash
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {fullImageDetails?.pHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* aHash */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Hash className="w-3.5 h-3.5" />
                          aHash
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {fullImageDetails?.aHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* dHash */}
                      <div>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <Hash className="w-3.5 h-3.5" />
                          dHash
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          <p className="text-base-content font-mono text-sm break-all">
                            {fullImageDetails?.dHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* All other EXIF fields in the same style */}
                      {fullImageDetails && (() => {
                        // Define known fields to exclude (only basic user-facing fields)
                        const knownFields = new Set([
                          'id', 'pixvidUrl', 'imgbbUrl',
                          'sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'fileName', 'fileSize', 'tags', 'description',
                          'internalAddedTimestamp', 'sha256', 'pHash', 'aHash', 'dHash', 'width', 'height', 'fileType'
                        ]);
                        
                        // Get all EXIF fields (everything that's not in knownFields) and sort alphabetically
                        const exifFields = Object.entries(fullImageDetails)
                          .filter(([key]) => !knownFields.has(key))
                          .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
                        
                        return exifFields.map(([key, value]) => (
                          <div key={key}>
                            <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5" />
                              {key}
                            </div>
                            <div className="bg-base-100/60 rounded p-2">
                              <p className="text-base-content font-mono text-sm break-all">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value || 'N/A')}
                              </p>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4 border-t border-base-content/20 mt-6">
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(true);
                    }}
                    className="group relative px-6 py-2.5 rounded-xl overflow-hidden
                             bg-error text-error-content
                             border border-error/30 
                             transform transition-all duration-300
                             hover:scale-105 hover:shadow-xl
                             active:scale-95
                             disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    <div className="relative flex items-center gap-2 font-semibold">
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Delete</span>
                    </div>
                  </button>
                </div>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal isOpen={showDeleteConfirm} onClose={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="text-center space-y-6">
            {/* Animated warning icon */}
            <div className="text-7xl animate-bounce">🗑️</div>
            
            <h3 className="text-2xl font-bold text-warning">
              Move to Trash?
            </h3>
            
            <p className="text-base-content/80 text-lg leading-relaxed">
              This will move the image to trash. The image will remain accessible on hosting providers.
              <br />
              <span className="font-semibold text-warning">You can restore it later from the trash.</span>
            </p>
            
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-3 rounded-xl bg-base-200 border border-base-content/10
                         text-base-content font-medium
                         hover:bg-base-300 hover:scale-105
                         active:scale-95
                         transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="group relative px-8 py-3 rounded-xl overflow-hidden
                         bg-warning text-warning-content
                         border border-warning/40
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-xl
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-warning-content animate-ping opacity-10" />
                )}
                <div className="relative flex items-center gap-2 font-bold text-lg">
                  {isDeleting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-warning-content/30 border-t-warning-content rounded-full animate-spin" />
                      <span>Moving...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Move to Trash</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </Modal>

        {/* Bulk Delete Confirmation Modal */}
        <Modal isOpen={showBulkDeleteConfirm} onClose={() => !isDeleting && setShowBulkDeleteConfirm(false)}>
          <div className="text-center space-y-6">
            {/* Animated warning icon */}
            <div className="text-7xl animate-bounce">🗑️</div>
            
            <h3 className="text-2xl font-bold text-warning">
              Move {selectedImages.size} Image{selectedImages.size > 1 ? 's' : ''} to Trash?
            </h3>
            
            <p className="text-base-content/80 text-lg leading-relaxed">
              This will move {selectedImages.size} image{selectedImages.size > 1 ? 's' : ''} to trash. The images will remain accessible on hosting providers.
              <br />
              <span className="font-semibold text-warning">You can restore them later from the trash.</span>
            </p>
            
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-3 rounded-xl bg-base-200 border border-base-content/10
                         text-base-content font-medium
                         hover:bg-base-300 hover:scale-105
                         active:scale-95
                         transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              
              <button
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="group relative px-8 py-3 rounded-xl overflow-hidden
                         bg-warning text-warning-content
                         border border-warning/40
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-xl
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-warning-content animate-ping opacity-10" />
                )}
                <div className="relative flex items-center gap-2 font-bold text-lg">
                  {isDeleting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-warning-content/30 border-t-warning-content rounded-full animate-spin" />
                      <span>Moving...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Move to Trash</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </Modal>

        {/* Floating Action Button (FAB) - Google Photos Style */}
        {!loading && images.length > 0 && (
          <button
            onClick={openUploadModal}
            className="fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full 
                     bg-gradient-to-r from-primary-500 to-secondary-500
                     text-primary-content shadow-2xl hover:shadow-[0_8px_30px_rgb(99,102,241,0.4)]
                     transform transition-all duration-300 ease-out
                     hover:scale-110 active:scale-95
                     flex items-center justify-center
                     group"
            title="Upload Image"
          >
            {/* Pulsing ring effect */}
            <div className="absolute inset-0 rounded-full bg-primary-400 animate-ping opacity-20"></div>
            
            {/* Icon */}
            <Upload className="w-7 h-7 relative z-10 transition-transform duration-300 
                             group-hover:rotate-12" />
          </button>
        )}

        {/* Upload Modal */}
        <Modal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          fullscreen={true}
          title={
            <div className="flex items-center justify-between w-full">
              <span>Upload Image</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 
                           text-white text-sm font-medium transition-colors disabled:opacity-50 
                           disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUploadSubmit(false)}
                  disabled={uploading || !uploadImageData}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary-500 to-secondary-500 
                           hover:from-primary-600 hover:to-secondary-600 text-white text-sm font-medium 
                           transition-all disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-lg hover:shadow-xl"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          }
        >
          <div className="h-[calc(100vh-11rem)] min-h-0 overflow-hidden">
            {/* File Upload */}
            {!uploadImageData ? (
              <div className="space-y-4 h-full overflow-y-auto pr-2">
                {/* Manual Upload Mode Message */}
                {isManualUploadMode && (
                  <div className="p-6 rounded-xl bg-orange-500/20 border-2 border-orange-500/50">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl flex-shrink-0">⚠️</span>
                      <div className="flex-1">
                        <h3 className="text-orange-100 font-bold text-lg mb-3">
                          Image Source Not Available
                        </h3>
                        <p className="text-orange-100/90 text-sm leading-relaxed mb-4">
                          The image you tried to save doesn't have a direct URL that the extension can access. This commonly happens with:
                        </p>
                        <ul className="text-orange-100/80 text-sm space-y-2 mb-4 list-disc list-inside">
                          <li>Lazy-loaded images that haven't fully loaded yet</li>
                          <li>Images embedded as base64 data</li>
                          <li>Protected or dynamically generated images</li>
                        </ul>
                        <p className="text-orange-100 font-semibold text-sm">
                          📥 Please download the image manually from the page, then upload it below:
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                <label className="block">
                  <div className="flex items-center justify-center w-full min-h-[calc(100vh-16rem)] px-4 transition 
                                bg-slate-800/50 border-2 border-dashed border-slate-600 rounded-xl 
                                hover:border-primary-500 hover:bg-slate-700/50 cursor-pointer
                                group">
                    <div className="text-center">
                      <Upload className="w-16 h-16 mx-auto text-slate-400 group-hover:text-primary-400 
                                       transition-colors mb-4" />
                      <p className="text-slate-300 text-lg font-medium mb-2">
                        Click to select an image or video
                      </p>
                      <p className="text-slate-400 text-sm">
                        or drag and drop
                      </p>
                      <p className="text-slate-500 text-xs mt-2">
                        Images: PNG, JPG, GIF up to 10MB<br/>
                        Videos: MP4, WebM, AVI, MOV
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,36%)_1fr] gap-6 h-full min-h-0">
                {/* Left Column - Sticky Media Preview */}
                <div className="min-h-0 xl:pr-2 xl:overflow-y-auto">
                  <div className="space-y-3">
                    <div className="relative rounded-xl overflow-hidden bg-slate-800/50 border border-slate-700">
                      {uploadImageData.isVideo ? (
                        <video
                          src={uploadImageData.srcUrl}
                          controls
                          className="w-full h-auto max-h-96 object-contain"
                        />
                      ) : (
                        <img
                          src={uploadImageData.srcUrl}
                          alt="Preview"
                          className="w-full h-auto max-h-96 object-contain"
                        />
                      )}
                      <button
                        onClick={() => setUploadImageData(null)}
                        className="absolute top-4 right-4 p-2 rounded-lg bg-red-500/80 hover:bg-red-500 
                                 text-white transition-colors shadow-lg"
                        title={`Remove ${uploadImageData.isVideo ? 'video' : 'image'}`}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* Base64 Warning */}
                    {uploadImageData?.isBase64 && !uploadImageData.isVideo && (
                      <div className="p-4 rounded-xl bg-orange-500/20 border-2 border-orange-500/50">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl flex-shrink-0">⚠️</span>
                          <div className="flex-1">
                            <h4 className="text-orange-100 font-bold text-sm mb-2">
                              Low Quality Image Detected
                            </h4>
                            <p className="text-orange-100/90 text-xs leading-relaxed">
                              This is a placeholder/thumbnail image (base64 data URL). For best quality, wait for the page to fully load, download the full-resolution image, then replace it using the button below.
                            </p>
                            <input
                              type="file"
                              id="replaceBase64Upload"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceBase64Upload').click()}
                              className="mt-3 w-full px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 
                                       text-white text-sm font-bold transition-colors
                                       flex items-center justify-center gap-2"
                            >
                              <Upload className="w-4 h-4" />
                              Replace with Full Quality Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Site-specific replace tips */}
                    {uploadImageData?.isWallHere && !uploadImageData?.isBase64 && (
                      <div className="p-3 rounded-xl bg-red-500/20 border-2 border-red-500/50 shadow-lg shadow-red-500/30 animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-red-400 text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-red-100 font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-red-100/90 text-xs mb-2">
                              For best quality from WallHere, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceWallHereFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceWallHereFile').click()}
                              className="w-full px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 
                                       border-2 border-red-400 text-white text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/40
                                       hover:shadow-xl hover:shadow-red-500/60"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Sohu replace tip */}
                    {uploadImageData?.isSohu && !uploadImageData?.isBase64 && (
                      <div className="p-3 rounded-xl bg-red-500/20 border-2 border-red-500/50 shadow-lg shadow-red-500/30 animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-red-400 text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-red-100 font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-red-100/90 text-xs mb-2">
                              For best quality from Sohu, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceSohuFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceSohuFile').click()}
                              className="w-full px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 
                                       border-2 border-red-400 text-white text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/40
                                       hover:shadow-xl hover:shadow-red-500/60"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Airbnb replace tip */}
                    {uploadImageData?.isAirbnb && !uploadImageData?.isBase64 && (
                      <div className="p-3 rounded-xl bg-red-500/20 border-2 border-red-500/50 shadow-lg shadow-red-500/30 animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-red-400 text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-red-100 font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-red-100/90 text-xs mb-2">
                              For best quality from Airbnb, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceAirbnbFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceAirbnbFile').click()}
                              className="w-full px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 
                                       border-2 border-red-400 text-white text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/40
                                       hover:shadow-xl hover:shadow-red-500/60"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Metadata field count */}
                    {uploadMetadata && (
                      <details className="rounded-xl bg-green-500/10 border border-green-500/30 p-4" open={false}>
                        <summary className="cursor-pointer list-none flex items-center justify-between">
                          <span className="text-green-300 font-semibold text-sm">📊 Total Firestore Fields</span>
                          <span className="text-green-200 font-bold text-2xl">
                            {(() => {
                              const formFields = ['sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'description', 'tags', 'collectionId'];
                              const coreMetadataFields = ['fileName', 'fileSize', 'fileType', 'fileTypeSource', 'width', 'height'];
                              const hashFields = ['sha256', 'pHash', 'aHash', 'dHash'];
                              const dateFields = ['creationDate', 'creationDateSource'];
                              const exifFieldsCount = uploadMetadata.exifMetadata ? Object.keys(uploadMetadata.exifMetadata).length : 0;
                              const imgbbUrls = ['imgbbUrl', 'imgbbDeleteUrl', 'imgbbThumbUrl'];
                              const pixvidUrls = ['pixvidUrl', 'pixvidDeleteUrl'];
                              const internalFields = ['internalAddedTimestamp'];
                              return formFields.length + coreMetadataFields.length + hashFields.length + dateFields.length + exifFieldsCount + imgbbUrls.length + pixvidUrls.length + internalFields.length;
                            })()}
                          </span>
                        </summary>
                        {(() => {
                      // Form fields
                      const formFields = ['sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'description', 'tags', 'collectionId'];
                      
                      // Core metadata fields
                      const coreMetadataFields = ['fileName', 'fileSize', 'fileType', 'fileTypeSource', 'width', 'height'];
                      
                      // Hash fields
                      const hashFields = ['sha256', 'pHash', 'aHash', 'dHash'];
                      
                      // Date fields
                      const dateFields = ['creationDate', 'creationDateSource'];
                      
                      // EXIF metadata fields
                      const exifFieldsCount = uploadMetadata.exifMetadata ? Object.keys(uploadMetadata.exifMetadata).length : 0;
                      
                      // ImgBB URLs (3 total)
                      const imgbbUrls = ['imgbbUrl', 'imgbbDeleteUrl', 'imgbbThumbUrl'];
                      
                      // Pixvid URLs (2 total)
                      const pixvidUrls = ['pixvidUrl', 'pixvidDeleteUrl'];
                      
                      // Internal timestamp (1 field)
                      const internalFields = ['internalAddedTimestamp'];
                      
                      const totalFields = formFields.length + coreMetadataFields.length + hashFields.length + 
                                         dateFields.length + exifFieldsCount + imgbbUrls.length + 
                                         pixvidUrls.length + internalFields.length;
                      
                      return (
                          <div className="text-xs text-green-200/70 border-t border-green-500/20 pt-3 mt-3 space-y-1">
                            <div>This includes:</div>
                            <div>• {formFields.length} form fields (including collection)</div>
                            <div>• {coreMetadataFields.length} core metadata fields</div>
                            <div>• {hashFields.length} hash fields</div>
                            <div>• {dateFields.length} date fields</div>
                            <div>• {exifFieldsCount} EXIF metadata fields</div>
                            <div>• {imgbbUrls.length} ImgBB URLs</div>
                            <div>• {pixvidUrls.length} Pixvid URLs</div>
                            <div>• {internalFields.length} internal timestamp</div>
                          </div>
                      );
                    })()}
                      </details>
                    )}
                    
                    {/* Metadata Computation Details */}
                    {uploadMetadata && (
                      <details className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3" open={false}>
                        <summary className="cursor-pointer list-none text-blue-300 font-semibold text-sm flex items-center gap-2">
                          <span>🔍</span>
                          Metadata Computation
                        </summary>
                        
                        {/* MIME Type */}
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-blue-200/70">MIME Type:</div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">File Object:</span>
                              <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded">
                                {uploadImageData?.file?.type || 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">EXIF:</span>
                              <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded">
                                {uploadMetadata.exifMetadata?.MIMEType || uploadMetadata.exifMetadata?.FileType || 'Not present'}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-blue-500/20">
                              <div className="text-blue-300 font-medium">Logic:</div>
                              <div className="text-blue-200/80 mt-1">
                                Use File object, verify against EXIF if present
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Creation Date */}
                        <div className="space-y-2 pt-2 border-t border-blue-500/20">
                          <div className="text-xs font-medium text-blue-200/70">Creation Date:</div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-slate-400 flex-shrink-0">File Object:</span>
                              <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded text-right">
                                {uploadImageData?.file?.lastModified 
                                  ? new Date(uploadImageData.file.lastModified).toLocaleString()
                                  : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-slate-400 flex-shrink-0">EXIF:</span>
                              <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded text-right">
                                {uploadMetadata.exifMetadata?.DateTimeOriginal || 
                                 uploadMetadata.exifMetadata?.DateTime || 
                                 uploadMetadata.exifMetadata?.CreateDate || 
                                 'Not present'}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-blue-500/20">
                              <div className="text-blue-300 font-medium">Logic:</div>
                              <div className="text-blue-200/80 mt-1">
                                Prefer EXIF if exists, fallback to OS lastModified
                              </div>
                            </div>
                          </div>
                        </div>
                      </details>
                    )}
                    
                    {/* Upload Progress */}
                    {uploading && (
                      <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl animate-pulse">{uploadImageData?.isVideo ? '🎬' : '🖼️'}</span>
                          <div className="flex-1">
                            <div className="text-sm text-primary-200 mb-2">
                              <span>
                                {uploadImageData?.isVideo 
                                  ? 'Uploading video to Filemoon and UDrop...' 
                                  : 'Uploading image to Pixvid and ImgBB...'}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 
                                         animate-pulse"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Scrollable Form Fields */}
                <div className="min-h-0 space-y-4 overflow-y-auto pr-2"
                     style={{ scrollbarGutter: 'stable' }}>
                  
                  {/* Duplicate Detection - Enhanced UI - Moved to top of right column */}
                  {duplicateData && (
                    <div className="space-y-4 p-5 rounded-xl bg-yellow-500/10 border-2 border-yellow-500/30">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 text-yellow-400 text-2xl">⚠️</div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-yellow-300 font-semibold text-lg mb-2">
                            {duplicateData.all ? `${duplicateData.all.length} Duplicate${duplicateData.all.length !== 1 ? 's' : ''} Found!` : 'Duplicate Found!'}
                          </h4>
                          <p className="text-yellow-200/80 text-sm mb-4">
                            {duplicateData.all && duplicateData.all.length > 1 
                              ? `This image matches ${duplicateData.all.length} existing images in your vault.`
                              : 'This image already exists in your vault.'}
                          </p>
                          
                          {/* Show all duplicate images */}
                          <div className="space-y-3">
                            {(duplicateData.all || [duplicateData.primary || duplicateData]).map((dup, index) => {
                              const matchType = dup.matchType || 'unknown';
                              const matchReason = dup.matchReason || 'Unknown match';
                              const similarity = dup.similarity || null;
                              
                              return (
                                <div key={index} className="rounded-lg overflow-hidden border border-yellow-500/30 bg-slate-800/50">
                                  <div className="w-full flex items-center justify-center bg-slate-900/30 p-2 relative">
                                    {/* Match badge */}
                                    <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-slate-900/80 border border-yellow-500/50">
                                      <span className="text-xs font-medium text-yellow-300">
                                        {matchType === 'context' && '🔗 Context'}
                                        {matchType === 'exact' && '🔐 Exact'}
                                        {matchType === 'visual' && '👁️ Visual'}
                                        {matchType === 'unknown' && '❓ Unknown'}
                                      </span>
                                    </div>
                                    <img
                                      src={dup.imgbbUrl || dup.pixvidUrl}
                                      alt={`Duplicate ${index + 1}`}
                                      className="max-w-full max-h-24 object-contain rounded"
                                    />
                                  </div>
                                  <div className="p-3 bg-slate-900/50">
                                    <p className="text-slate-300 text-sm font-medium truncate">
                                      {dup.pageTitle || 'Untitled'}
                                    </p>
                                    {dup.sourcePageUrl && (
                                      <p className="text-slate-400 text-xs truncate mt-1">
                                        {dup.sourcePageUrl}
                                      </p>
                                    )}
                                    <div className="mt-2 pt-2 border-t border-slate-700">
                                      <p className="text-xs text-yellow-300/80">
                                        {matchReason}
                                        {similarity && ` - ${similarity}% similar`}
                                      </p>
                                      <button
                                        onClick={() => openDuplicateMatchInNewTab(dup)}
                                        className="mt-2 px-2.5 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-200 text-xs font-medium transition-colors"
                                      >
                                        Open Match
                                      </button>
                                      {dup.hashResults && (
                                        <div className="flex gap-2 mt-1">
                                          {dup.hashResults.pHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                                              pHash ✓
                                            </span>
                                          )}
                                          {dup.hashResults.aHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                                              aHash ✓
                                            </span>
                                          )}
                                          {dup.hashResults.dHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                                              dHash ✓
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Action buttons */}
                          <div className="sticky bottom-0 flex gap-3 mt-4 pt-3 bg-slate-900/95 backdrop-blur-sm border-t border-yellow-500/20">
                            <button
                              onClick={() => setDuplicateData(null)}
                              className="flex-1 px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 
                                       text-white font-medium transition-colors text-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUploadSubmit(true)}
                              disabled={uploading}
                              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 
                                       hover:from-yellow-600 hover:to-orange-600 text-white font-medium 
                                       transition-all disabled:opacity-50 disabled:cursor-not-allowed
                                       shadow-lg hover:shadow-xl text-sm"
                            >
                              {uploading ? 'Uploading...' : 'Upload Anyway'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Form Fields - Alphabetically ordered */}
                  <div className="space-y-4">
                  
                  {/* description */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      description
                    </label>
                    <Textarea
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      placeholder="Add a description..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                               text-white placeholder-slate-400 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all resize-none"
                    />
                  </div>

                  {/* collection */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      collection (optional)
                    </label>
                    <select
                      value={selectedCollectionId}
                      onChange={(e) => {
                        if (e.target.value === '__create_new__') {
                          setShowCreateCollection(true);
                        } else {
                          setSelectedCollectionId(e.target.value);
                          setShowCreateCollection(false);
                        }
                      }}
                      className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                               text-white 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all"
                    >
                      <option value="">No Collection</option>
                      {collections.map(collection => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))}
                      <option value="__create_new__">+ Create New Collection</option>
                    </select>
                    
                    {showCreateCollection && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={newCollectionName}
                          onChange={(e) => setNewCollectionName(e.target.value)}
                          placeholder="Collection name"
                          className="flex-1 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-600 
                                   text-white placeholder-slate-400 
                                   focus:outline-none focus:border-primary-500 focus:ring-2 
                                   focus:ring-primary-500/20 transition-all"
                          onKeyPress={async (e) => {
                            if (e.key === 'Enter' && newCollectionName.trim()) {
                              try {
                                const newCollection = await createCollection({ name: newCollectionName.trim() });
                                setSelectedCollectionId(newCollection.id);
                                setShowCreateCollection(false);
                                setNewCollectionName('');
                                showToast('✅ Collection created!', 'success', 2000);
                              } catch (error) {
                                showToast(`❌ ${error.message}`, 'error', 3000);
                              }
                            }
                          }}
                        />
                        <button
                          onClick={async () => {
                            if (newCollectionName.trim()) {
                              try {
                                const newCollection = await createCollection({ name: newCollectionName.trim() });
                                setSelectedCollectionId(newCollection.id);
                                setShowCreateCollection(false);
                                setNewCollectionName('');
                                showToast('✅ Collection created!', 'success', 2000);
                              } catch (error) {
                                showToast(`❌ ${error.message}`, 'error', 3000);
                              }
                            }
                          }}
                          className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 
                                   text-white font-medium transition-colors"
                        >
                          Create
                        </button>
                        <button
                          onClick={() => {
                            setShowCreateCollection(false);
                            setNewCollectionName('');
                            setSelectedCollectionId('');
                          }}
                          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 
                                   text-white font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* pageTitle */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      pageTitle
                    </label>
                    <input
                      type="text"
                      value={uploadImageData?.pageTitle || ''}
                      onChange={(e) => setUploadImageData(prev => ({ ...prev, pageTitle: e.target.value }))}
                      placeholder="Page title"
                      className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                               text-white placeholder-slate-400 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all"
                    />
                  </div>

                  {/* sourceImageUrl (Read-only) */}
                  {uploadImageData && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        sourceImageUrl
                      </label>
                      <div className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 
                                    text-slate-300 font-mono text-xs break-all">
                        {isLocalUpload || uploadPageUrl === 'Uploaded manually' 
                          ? 'Uploaded manually' 
                          : uploadImageData.srcUrl}
                      </div>
                    </div>
                  )}
                  
                  {/* sourcePageUrl */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      sourcePageUrl
                    </label>
                    <input
                      type="url"
                      value={uploadPageUrl}
                      onChange={(e) => setUploadPageUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                               text-white placeholder-slate-400 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all"
                    />
                    
                    {/* Quality Tip for specific sites */}
                    {(() => {
                      const shouldShowWarning = isWarningSite(uploadPageUrl);
                      const shouldShowGoodQuality = isGoodQualitySite(uploadPageUrl);
                      
                      if (shouldShowWarning) {
                        const siteName = getSiteDisplayName(uploadPageUrl, sitesConfig.warningSites);
                        return (
                          <div className="mt-3 p-3 rounded-lg bg-warning/10 border-2 border-warning/30 shadow-lg animate-pulse-slow">
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0 text-red-400 text-lg mt-0.5 animate-bounce">⚠️</div>
                              <div className="flex-1">
                                <p className="text-warning font-bold text-sm mb-1">
                                  🔥 Quality Warning
                                </p>
                                <p className="text-base-content/80 text-xs mb-2">
                                  For best quality, download the image first from {siteName} instead of saving directly from the page. This ensures you get the highest quality version.
                                </p>
                                <input
                                  type="file"
                                  id="replaceUploadFile"
                                  accept="image/*"
                                  onChange={handleFileUpload}
                                  className="hidden"
                                />
                                <button
                                  onClick={() => document.getElementById('replaceUploadFile').click()}
                                  className="mt-1 px-3 py-1.5 rounded-lg bg-warning hover:bg-warning/90 
                                           border-2 border-warning/40 text-warning-content text-xs font-bold
                                           transition-all duration-200 hover:scale-105 active:scale-95
                                           flex items-center gap-1.5 shadow-lg hover:shadow-xl"
                                >
                                  <Upload className="w-3.5 h-3.5" />
                                  Replace with Downloaded Image
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      
                      if (shouldShowGoodQuality) {
                        const siteName = getSiteDisplayName(uploadPageUrl, sitesConfig.goodQualitySites);
                        return (
                          <div className="mt-3 p-3 rounded-lg bg-success/10 border-2 border-success/30 shadow-lg">
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0 text-green-400 text-lg mt-0.5">✓</div>
                              <div className="flex-1">
                                <p className="text-success font-bold text-sm mb-1">
                                  ✨ Best Quality
                                </p>
                                <p className="text-base-content/80 text-xs">
                                  This image from {siteName} is already in the best available quality. You're all set!
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      
                      return null;
                    })()}
                  </div>

                  {/* tags */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      tags
                    </label>
                    <input
                      type="text"
                      value={uploadTags}
                      onChange={(e) => setUploadTags(e.target.value)}
                      placeholder="nature, sunset, photography"
                      className="w-full px-4 py-3 rounded-lg bg-base-200 border border-base-content/10 
                               text-base-content placeholder-base-content/40 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all"
                    />
                  </div>

                  {/* Display ALL metadata fields that will be saved */}
                  {uploadMetadata && (() => {
                    const allFields = {
                      'aHash': uploadMetadata.aHash || 'N/A',
                      'Creation Date': uploadMetadata.creationDate 
                        ? new Date(uploadMetadata.creationDate).toLocaleString()
                        : 'N/A',
                      'creationDateSource': uploadMetadata.creationDateSource || 'N/A',
                      'dHash': uploadMetadata.dHash || 'N/A',
                      'File Name': uploadImageData?.fileName || 'N/A',
                      'File Size': uploadMetadata.fileSize 
                        ? `${(uploadMetadata.fileSize / 1024).toFixed(2)} KB` 
                        : 'N/A',
                      'fileTypeSource': uploadMetadata.fileTypeSource || 'N/A',
                      'Height': uploadMetadata.height || 'N/A',
                      'MIME Type': uploadMetadata.mimeType || uploadMetadata.fileType || 'N/A',
                      'pHash': uploadMetadata.pHash || 'N/A',
                      'SHA-256': uploadMetadata.sha256 || 'N/A',
                      'Width': uploadMetadata.width || 'N/A',
                      ...(uploadMetadata.exifMetadata || {})
                    };
                    
                    // Sort fields alphabetically
                    const sortedFields = Object.entries(allFields).sort(([keyA], [keyB]) => 
                      keyA.localeCompare(keyB)
                    );
                    
                    return (
                      <details className="space-y-3 rounded-xl bg-base-200 border border-base-content/10 p-4" open={false}>
                        <summary className="cursor-pointer list-none text-sm font-medium text-base-content/80 mb-3">
                          Raw Metadata Fields ({sortedFields.length})
                        </summary>
                        {sortedFields.map(([key, value]) => (
                          <div key={key}>
                            <label className="block text-xs font-medium text-base-content/60 mb-1">
                              {key}
                            </label>
                            <div className="px-3 py-2 rounded-lg bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
                          </div>
                        ))}
                      </details>
                    );
                  })()}
                </div>

                {/* Error Message */}
                {uploadError && !duplicateData && (
                  <div className="p-4 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
                    {uploadError?.message || String(uploadError)}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </Modal>

        {/* Toast Notifications */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        
        {/* Folder Selection Prompt for Auto-Upload */}
        {showFolderPrompt && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-base-content/50 backdrop-blur-sm">
            <div className="bg-base-100 border border-base-content/10 rounded-2xl p-8 max-w-md w-full shadow-2xl text-base-content">
              <div className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-primary text-primary-content rounded-full flex items-center justify-center">
                  <FolderOpen className="w-8 h-8" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold text-base-content mb-2">
                    📂 Select Download Folder
                  </h2>
                  <p className="text-base-content/70">
                    Your video has been downloaded! Please select the folder where it was saved to automatically load it.
                  </p>
                  {pendingDownloadFile && (
                    <p className="mt-3 text-sm text-base-content/80 font-mono bg-base-200 p-2 rounded">
                      {pendingDownloadFile.split('\\').pop()}
                    </p>
                  )}
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowFolderPrompt(false);
                      setPendingDownloadFile(null);
                      showToast('❌ Auto-upload cancelled', 'error', 2000);
                    }}
                    className="flex-1 px-6 py-3 bg-base-200 hover:bg-base-300 rounded-lg text-base-content font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSelectDownloadFolder}
                    className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 rounded-lg text-primary-content font-medium transition-all flex items-center justify-center gap-2"
                  >
                    <FolderOpen size={20} />
                    Select Folder
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
