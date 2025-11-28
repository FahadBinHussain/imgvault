/**
 * @fileoverview Gallery Page Component
 * @version 2.0.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Upload, Search, Trash2, Download, X, Settings } from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner, Toast, Textarea } from '../components/UI';
import { useImages, useImageUpload, useTrash, useChromeStorage } from '../hooks/useChromeExtension';
import TimelineScrollbar from '../components/TimelineScrollbar';

export default function GalleryPage() {
  const { images, loading, reload, deleteImage } = useImages();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { uploadImage, uploading, progress, error: uploadError } = useImageUpload();
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
  
  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  // Handle image load for fade-in effect
  const handleImageLoad = (imageId) => {
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

  const filteredImages = images.filter(img => {
    const query = searchQuery.toLowerCase();
    return (
      img.pageTitle?.toLowerCase().includes(query) ||
      img.description?.toLowerCase().includes(query) ||
      img.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  });

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

  // Upload modal handlers
  const openUploadModal = () => {
    setShowUploadModal(true);
    setUploadImageData(null);
    setUploadPageUrl('');
    setUploadDescription('');
    setUploadTags('');
    setUploadMetadata(null);
    setDuplicateData(null);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await processImageFile(file);
    }
  };

  const processImageFile = async (file) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      setUploadImageData({
        srcUrl: reader.result,
        fileName: file.name,
        pageTitle: 'Uploaded manually', // Use "Uploaded manually" as title for local uploads
        timestamp: Date.now(),
        file: file // Store the original file object for MIME and date extraction
      });
      setUploadPageUrl('Uploaded manually'); // Set source as "Uploaded manually" for local files
      
      // Extract metadata from the image
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'extractMetadata',
          imageUrl: reader.result,
          pageUrl: 'Uploaded manually', // Set page URL as "Uploaded manually" for local files
          fileName: file.name,
          fileMimeType: file.type,
          fileLastModified: file.lastModified
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
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
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
      // Check if it's an image
      if (file.type.startsWith('image/')) {
        await processImageFile(file);
        setShowUploadModal(true);
      } else {
        showToast('❌ Please drop an image file', 'error', 3000);
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
        originalSourceUrl: uploadPageUrl === 'Uploaded manually' ? 'Uploaded manually' : String(uploadPageUrl || ''),
        pageUrl: String(uploadPageUrl || ''),
        pageTitle: String(uploadImageData.pageTitle || ''),
        fileName: String(uploadImageData.fileName || ''),
        description: String(uploadDescription || ''),
        tags: tagsArray.map(t => String(t)),
        ignoreDuplicate: Boolean(ignoreDuplicates),
        fileMimeType: uploadImageData.file?.type || null,
        fileLastModified: uploadImageData.file?.lastModified || null
      };

      console.log('Uploading with data (keys):', Object.keys(uploadData));
      console.log('Image URL length:', uploadData.imageUrl.length);
      
      // Try to JSON.stringify to check if it's serializable
      try {
        JSON.stringify(uploadData);
        console.log('✓ Data is serializable');
      } catch (e) {
        console.error('✗ Data is NOT serializable:', e);
        throw new Error('Upload data contains non-serializable values');
      }

      await uploadImage(uploadData);

      showToast('✅ Image uploaded successfully!', 'success', 3000);
      setShowUploadModal(false);
      setDuplicateData(null);
      reload(); // Refresh gallery
    } catch (err) {
      console.error('Upload failed:', err);
      
      const errorMessage = err?.message || String(err) || 'Upload failed';
      
      // Check if error has duplicate data
      if (err?.duplicate) {
        console.log('Duplicate data found:', err.duplicate);
        setDuplicateData(err.duplicate);
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
    const checkPendingImage = async () => {
      try {
        const { pendingImage } = await chrome.storage.local.get('pendingImage');
        if (pendingImage && pendingImage.srcUrl) {
          // Clear the pending image
          await chrome.storage.local.remove('pendingImage');
          
          // Populate the upload modal
          setUploadImageData({
            srcUrl: pendingImage.srcUrl,
            fileName: pendingImage.srcUrl.split('/').pop().split('?')[0] || 'image.jpg'
          });
          setUploadPageUrl(pendingImage.pageUrl || '');
          
          // Open the upload modal
          setShowUploadModal(true);
          
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
        }
      } catch (error) {
        console.error('Failed to check pending image:', error);
      }
    };
    
    checkPendingImage();
  }, []);

  return (
    <div ref={pageContainerRef} className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-y-auto">
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
                className="w-full h-full rounded-3xl border-4 border-dashed border-white/40"
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
                  <div className="relative z-10 bg-white rounded-full p-8 shadow-2xl">
                    <Upload className="w-20 h-20 text-primary-600" />
                  </div>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-center"
                >
                  <h3 className="text-4xl font-bold text-white mb-3 drop-shadow-2xl">
                    Drop your image here
                  </h3>
                  <p className="text-xl text-white/80 drop-shadow-lg">
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
                    className="absolute w-3 h-3 bg-white/60 rounded-full blur-sm"
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
      
      <div className="w-full px-6">
        {/* Glassmorphism Navigation Bar - Apple-like */}
        <div className="sticky top-0 z-40 mb-8">
          {/* Frosted glass bar */}
          <div className="backdrop-blur-2xl bg-white/5 border-b border-white/10 shadow-2xl">
            <div className="px-8 py-6">
              {/* Top Row: Logo + Actions */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl blur-lg opacity-50"></div>
                    <img src="/icons/icon48.png" alt="ImgVault" className="w-12 h-12 relative z-10 rounded-xl shadow-lg" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent drop-shadow-lg">
                      ImgVault Gallery
                    </h1>
                    <p className="text-sm text-slate-300 mt-1">
                      <span className="font-semibold text-primary-300">{images.length}</span> images in your vault
                      <span className="mx-2 text-slate-500">•</span>
                      <span className="text-slate-400">Source: </span>
                      <span className="font-medium text-white">
                        {defaultGallerySource === 'imgbb' ? 'ImgBB (Original Quality)' : 'Pixvid (Compressed Quality)'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={reload}
                    className="p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                             backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                             shadow-lg hover:shadow-xl"
                    title="Refresh"
                  >
                    <RefreshCw className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={() => window.location.href = 'settings.html'}
                    className="p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                             backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                             shadow-lg hover:shadow-xl"
                    title="Settings"
                  >
                    <Settings className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={() => window.location.href = 'trash.html'}
                    className="relative px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                             backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                             shadow-lg hover:shadow-xl flex items-center gap-2 text-white"
                    title="Trash"
                  >
                    <Trash2 className="w-5 h-5" />
                    Trash
                    {!trashLoading && trashedImages.length > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold 
                                     rounded-full w-6 h-6 flex items-center justify-center 
                                     animate-pulse shadow-lg">
                        {trashedImages.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={openUploadModal}
                    className="px-5 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                             text-white font-semibold shadow-lg hover:shadow-xl hover:scale-105 
                             active:scale-95 transition-all duration-300 flex items-center gap-2"
                  >
                    <Upload className="w-5 h-5" />
                    Upload
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                <div className="relative flex items-center shadow-lg">
                  <Search className="absolute left-4 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, description, or tags..."
                    className="w-full pl-12 pr-4 py-4 rounded-xl bg-white/10 backdrop-blur-sm 
                             border border-white/20 text-white placeholder-slate-400 
                             focus:outline-none focus:border-primary-300 focus:bg-white/15 
                             focus:shadow-xl transition-all duration-300"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col justify-center items-center py-32">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-2xl opacity-50 animate-pulse"></div>
              <Spinner size="lg" className="relative z-10" />
            </div>
            <p className="mt-6 text-white text-lg font-medium">Loading your vault...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && images.length === 0 && (
          <div className="glass-card rounded-xl backdrop-blur-xl bg-white/10 border border-white/20 
                        shadow-2xl p-16 text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl opacity-30"></div>
              <div className="text-8xl relative z-10 drop-shadow-2xl">🖼️</div>
            </div>
            <h3 className="text-3xl font-bold text-white mb-3 drop-shadow-lg">Your Vault is Empty</h3>
            <p className="text-slate-300 text-lg mb-8 max-w-md mx-auto">
              Start building your collection by uploading your first image
            </p>
            <motion.button
              onClick={openUploadModal}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       text-white font-semibold text-lg shadow-xl hover:shadow-2xl transition-shadow"
            >
              Upload First Image
            </motion.button>
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10" ref={el => dateGroupRefs.current[date] = el}>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-primary-500 to-secondary-500 w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Masonry Grid - 3 columns on mobile, 4 on tablet, 5 on desktop, 6 on large screens */}
            <div className="columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-6 space-y-6">
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
                  onClick={() => {
                    setIsModalAnimating(true);
                    setSelectedImage(img);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                    setTimeout(() => setIsModalAnimating(false), 300);
                  }}
                >
                  {/* Soft glow effect on hover */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/40 to-secondary-500/40 
                                rounded-xl opacity-0 group-hover:opacity-100 blur-xl 
                                transition-all duration-700 ease-out"></div>
                  
                  {/* Card with soft shadows and smooth animations */}
                  <div className="relative bg-slate-800/80 backdrop-blur-sm border border-white/10 
                                rounded-xl overflow-hidden shadow-lg group-hover:shadow-2xl
                                transform transition-all duration-500 ease-out 
                                group-hover:scale-[1.04] group-hover:-translate-y-2">
                    {/* Loading skeleton with shimmer */}
                    {!loadedImages.has(img.id) && (
                      <div className="absolute inset-0 bg-slate-800 overflow-hidden">
                        <div className="absolute inset-0 shimmer"></div>
                      </div>
                    )}
                    
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
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out">
                      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2 
                                    transform translate-y-2 group-hover:translate-y-0 
                                    transition-transform duration-500 ease-out">
                        <p className="text-white text-sm font-semibold truncate drop-shadow-xl">
                          {img.pageTitle || 'Untitled'}
                        </p>
                        {img.tags && img.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {img.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-lg bg-white/20 backdrop-blur-sm 
                                         text-white border border-white/30 font-medium shadow-lg"
                              >
                                {tag}
                              </span>
                            ))}
                            {img.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-lg bg-white/20 backdrop-blur-sm 
                                             text-white border border-white/30 font-medium shadow-lg">
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
            <div className={`flex h-full relative transition-all duration-500 ease-out
                          ${isModalAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
              
              {/* Dark Overlay Background with Fade */}
              <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-500
                            ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} />

              {/* LEFT SIDE - IMAGE with Zoom Animation */}
              <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-8 relative z-10">
                {/* Radial glow effect */}
                <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              w-4/5 h-4/5 bg-primary-500/10 rounded-full blur-3xl
                              transition-all duration-700 ease-out
                              ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}></div>
                
                {/* Image with smooth zoom-in transition */}
                <img
                  src={selectedImage.imgbbUrl || selectedImage.pixvidUrl}
                  alt={selectedImage.pageTitle}
                  className={`max-w-full max-h-full object-contain rounded-2xl shadow-2xl relative z-10
                           transition-all duration-700 ease-out
                           hover:scale-[1.02] hover:shadow-[0_0_80px_rgba(99,102,241,0.3)]
                           ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                />
              </div>

              {/* RIGHT SIDE - DETAILS with Slide-up Animation */}
              <div className={`w-[550px] flex-shrink-0 bg-slate-800/90 backdrop-blur-xl border-l border-white/10 
                            overflow-y-auto flex flex-col relative z-10
                            transition-all duration-500 ease-out
                            ${isModalAnimating ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}
                   style={{ scrollbarWidth: 'thin', scrollbarColor: '#6366f1 #1e293b' }}
              >
                {/* Close Button with Fade Animation */}
                <button
                  onClick={() => {
                    setSelectedImage(null);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                  }}
                  className={`absolute top-4 right-4 z-50 w-11 h-11 rounded-full bg-red-500/20 
                           hover:bg-red-500/40 border border-red-500/50 hover:border-red-500 
                           flex items-center justify-center transition-all duration-300 
                           hover:scale-110 hover:rotate-90 group shadow-xl
                           ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`}
                  title="Close"
                >
                  <span className="text-red-300 group-hover:text-red-100 text-2xl font-bold">✕</span>
                </button>

                <div className="p-6 flex-1 pt-16">
              {/* Details Header */}
              <h2 className="text-2xl font-bold text-white mb-4 bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent">
                Details
              </h2>

              {/* Tab Navigation */}
              <div className="flex gap-2 mb-4 border-b border-white/10">
                <button
                  onClick={() => handleTabSwitch('noobs')}
                  className={`px-4 py-2 font-semibold transition-all ${
                    activeTab === 'noobs'
                      ? 'text-primary-300 border-b-2 border-primary-300'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  For Noobs 👶
                </button>
                <button
                  onClick={() => handleTabSwitch('nerds')}
                  className={`px-4 py-2 font-semibold transition-all ${
                    activeTab === 'nerds'
                      ? 'text-green-300 border-b-2 border-green-300'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  For Nerds 🤓
                </button>
              </div>

              {/* For Noobs Tab */}
              {activeTab === 'noobs' && (
                <div className="space-y-4">
                  {/* Details Grid */}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1">Title</div>
                      <div className="text-white font-medium">
                        {selectedImage.pageTitle || 'Untitled'}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1">Added To Vault</div>
                      <div className="text-white">
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
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1">Display Source</div>
                      <div className="flex items-center gap-2">
                        {selectedImage.imgbbUrl ? (
                          <span className="px-3 py-1 rounded bg-green-500/20 text-green-300 font-semibold text-sm">
                            ImgBB ⚡
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded bg-blue-500/20 text-blue-300 font-semibold text-sm">
                            Pixvid ⚡
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1">Pixvid URL</div>
                      <div className="bg-white/5 rounded p-2">
                        <a
                          href={selectedImage.pixvidUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-200 break-all text-sm"
                        >
                          {selectedImage.pixvidUrl}
                        </a>
                      </div>
                    </div>

                    {selectedImage.imgbbUrl && (
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">ImgBB URL</div>
                        <div className="bg-white/5 rounded p-2">
                          <a
                            href={selectedImage.imgbbUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-300 hover:text-green-200 break-all text-sm"
                          >
                            {selectedImage.imgbbUrl}
                          </a>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
                        <span>Source URL</span>
                        {editingField !== 'sourceImageUrl' && (
                          <button
                            onClick={() => startEditing('sourceImageUrl')}
                            className="text-primary-300 hover:text-primary-200 text-xs"
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
                            className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 text-white text-sm"
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
                        <div className="bg-white/5 rounded p-2">
                          <a
                            href={selectedImage.sourceImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-300 hover:text-primary-200 break-all text-sm"
                          >
                            {selectedImage.sourceImageUrl || 'N/A'}
                          </a>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
                        <span>Page URL</span>
                        {editingField !== 'sourcePageUrl' && (
                          <button
                            onClick={() => startEditing('sourcePageUrl')}
                            className="text-primary-300 hover:text-primary-200 text-xs"
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
                            className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 text-white text-sm"
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
                        <div className="bg-white/5 rounded p-2">
                          <a
                            href={selectedImage.sourcePageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-300 hover:text-primary-200 break-all text-sm"
                          >
                            {selectedImage.sourcePageUrl || 'N/A'}
                          </a>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
                        <span>Description</span>
                        {editingField !== 'description' && (
                          <button
                            onClick={() => startEditing('description')}
                            className="text-primary-300 hover:text-primary-200 text-xs"
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
                            className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 text-white text-sm"
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
                        <div className="text-slate-300 text-sm">
                          {selectedImage.description || 'No description'}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
                        <span>Tags</span>
                        {editingField !== 'tags' && (
                          <button
                            onClick={() => startEditing('tags')}
                            className="text-primary-300 hover:text-primary-200 text-xs"
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
                            className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 text-white text-sm"
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
                                  className="px-3 py-1 rounded-full bg-primary-500/20 text-primary-200 text-sm"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-slate-500 italic text-sm">No tags</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Download Buttons */}
                  <div className="flex gap-2 pt-4 border-t border-white/10">
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
                  </div>
                </div>
              )}

              {/* For Nerds Tab */}
              {activeTab === 'nerds' && (
                <div className="space-y-4">
                  {loadingNerdsTab && !fullImageDetails ? (
                    <div className="flex justify-center items-center py-10">
                      <Spinner size="md" />
                      <span className="ml-3 text-slate-300">Loading technical details...</span>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {/* Document ID */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">Document ID</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {selectedImage.id || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* File Name */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">File Name</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {fullImageDetails?.fileName || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* File Type */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">File Type</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm">
                            {fullImageDetails?.fileType || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* File Size */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">File Size</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm">
                            {fullImageDetails?.fileSize 
                              ? `${(fullImageDetails.fileSize / 1024).toFixed(2)} KB` 
                              : loadingNerdsTab ? 'Loading...' : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Width */}
                      {fullImageDetails?.width && (
                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Width</div>
                          <div className="bg-white/5 rounded p-2">
                            <p className="text-white font-mono text-sm">
                              {fullImageDetails.width}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Height */}
                      {fullImageDetails?.height && (
                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Height</div>
                          <div className="bg-white/5 rounded p-2">
                            <p className="text-white font-mono text-sm">
                              {fullImageDetails.height}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* SHA-256 */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">SHA-256</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {fullImageDetails?.sha256 || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* pHash */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">pHash</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {fullImageDetails?.pHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* aHash */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">aHash</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {fullImageDetails?.aHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* dHash */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 mb-1">dHash</div>
                        <div className="bg-white/5 rounded p-2">
                          <p className="text-white font-mono text-sm break-all">
                            {fullImageDetails?.dHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                      </div>

                      {/* All other EXIF fields in the same style */}
                      {fullImageDetails && (() => {
                        // Define known fields to exclude
                        const knownFields = new Set([
                          'id', 'pixvidUrl', 'pixvidDeleteUrl', 'imgbbUrl', 'imgbbDeleteUrl', 'imgbbThumbUrl',
                          'sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'fileName', 'fileSize', 'tags', 'description',
                          'internalAddedTimestamp', 'sha256', 'pHash', 'aHash', 'dHash', 'width', 'height', 'fileType'
                        ]);
                        
                        // Get all EXIF fields (everything that's not in knownFields)
                        const exifFields = Object.entries(fullImageDetails).filter(([key]) => !knownFields.has(key));
                        
                        return exifFields.map(([key, value]) => (
                          <div key={key}>
                            <div className="text-xs font-semibold text-slate-400 mb-1">{key}</div>
                            <div className="bg-white/5 rounded p-2">
                              <p className="text-white font-mono text-sm break-all">
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
                <div className="flex gap-2 pt-4 border-t border-white/10 mt-6">
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(true);
                    }}
                    className="group relative px-6 py-2.5 rounded-xl overflow-hidden
                             bg-gradient-to-r from-red-500 to-rose-600
                             border border-red-400/30 
                             transform transition-all duration-300
                             hover:scale-110 hover:shadow-2xl hover:shadow-red-500/50
                             active:scale-95
                             disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {/* Animated background glow */}
                    <div className="absolute inset-0 bg-gradient-to-r from-red-400 to-rose-500 opacity-0 
                                  group-hover:opacity-100 blur-xl transition-opacity duration-300" />
                    
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                                  bg-gradient-to-r from-transparent via-white/20 to-transparent 
                                  transition-transform duration-700" />
                    
                    {/* Button content */}
                    <div className="relative flex items-center gap-2 text-white font-semibold">
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
            
            <h3 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 
                         bg-clip-text text-transparent">
              Move to Trash?
            </h3>
            
            <p className="text-slate-300 text-lg leading-relaxed">
              This will move the image to trash. The image will remain accessible on hosting providers.
              <br />
              <span className="font-semibold text-yellow-400">You can restore it later from the trash.</span>
            </p>
            
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-3 rounded-xl bg-white/10 border border-white/20
                         text-white font-medium
                         hover:bg-white/20 hover:scale-105
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
                         bg-gradient-to-r from-orange-600 to-yellow-700
                         border border-orange-400/50
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-2xl hover:shadow-orange-500/50
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-orange-400 animate-ping opacity-25" />
                )}
                
                {/* Shimmer effect */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                              bg-gradient-to-r from-transparent via-white/20 to-transparent 
                              transition-transform duration-700" />
                
                {/* Button content */}
                <div className="relative flex items-center gap-2 text-white font-bold text-lg">
                  {isDeleting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                     text-white shadow-2xl hover:shadow-[0_8px_30px_rgb(99,102,241,0.4)]
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
          <div className="space-y-6">
            {/* File Upload */}
            {!uploadImageData ? (
              <div className="space-y-4">
                <label className="block">
                  <div className="flex items-center justify-center w-full h-64 px-4 transition 
                                bg-slate-800/50 border-2 border-dashed border-slate-600 rounded-xl 
                                hover:border-primary-500 hover:bg-slate-700/50 cursor-pointer
                                group">
                    <div className="text-center">
                      <Upload className="w-16 h-16 mx-auto text-slate-400 group-hover:text-primary-400 
                                       transition-colors mb-4" />
                      <p className="text-slate-300 text-lg font-medium mb-2">
                        Click to select an image
                      </p>
                      <p className="text-slate-400 text-sm">
                        or drag and drop
                      </p>
                      <p className="text-slate-500 text-xs mt-2">
                        PNG, JPG, GIF up to 10MB
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </label>
              </div>
            ) : (
              <div className="flex gap-6">
                {/* Left Column - Sticky Image Preview */}
                <div className="w-1/3 flex-shrink-0">
                  <div className="sticky top-0 space-y-3">
                    <div className="relative rounded-xl overflow-hidden bg-slate-800/50 border border-slate-700">
                      <img
                        src={uploadImageData.srcUrl}
                        alt="Preview"
                        className="w-full h-auto max-h-96 object-contain"
                      />
                      <button
                        onClick={() => setUploadImageData(null)}
                        className="absolute top-4 right-4 p-2 rounded-lg bg-red-500/80 hover:bg-red-500 
                                 text-white transition-colors shadow-lg"
                        title="Remove image"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* Metadata field count */}
                    {uploadMetadata && (() => {
                      // Form fields
                      const formFields = ['sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'description', 'tags'];
                      
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
                        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-green-300 font-semibold text-sm">
                              📊 Total Firestore Fields
                            </span>
                            <span className="text-green-200 font-bold text-3xl">
                              {totalFields}
                            </span>
                          </div>
                          <div className="text-xs text-green-200/70 border-t border-green-500/20 pt-3 space-y-1">
                            <div>This includes:</div>
                            <div>• {formFields.length} form fields</div>
                            <div>• {coreMetadataFields.length} core metadata fields</div>
                            <div>• {hashFields.length} hash fields</div>
                            <div>• {dateFields.length} date fields</div>
                            <div>• {exifFieldsCount} EXIF metadata fields</div>
                            <div>• {imgbbUrls.length} ImgBB URLs</div>
                            <div>• {pixvidUrls.length} Pixvid URLs</div>
                            <div>• {internalFields.length} internal timestamp</div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* Metadata Computation Details */}
                    {uploadMetadata && (
                      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3">
                        <h4 className="text-blue-300 font-semibold text-sm flex items-center gap-2">
                          <span>🔍</span>
                          Metadata Computation
                        </h4>
                        
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
                      </div>
                    )}
                    
                    {/* Duplicate Detection */}
                    {duplicateData && (
                      <div className="space-y-4 p-5 rounded-xl bg-yellow-500/10 border-2 border-yellow-500/30">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 text-yellow-400 text-2xl">⚠️</div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-yellow-300 font-semibold text-lg mb-2">Duplicate Found!</h4>
                            <p className="text-yellow-200/80 text-sm mb-4">
                              This image already exists in your vault.
                            </p>
                            
                            {/* Show duplicate image */}
                            <div className="rounded-lg overflow-hidden border border-yellow-500/30 bg-slate-800/50 max-w-full">
                              <div className="w-full flex items-center justify-center bg-slate-900/30 p-2">
                                <img
                                  src={duplicateData.imgbbUrl || duplicateData.pixvidUrl}
                                  alt="Duplicate"
                                  className="max-w-full max-h-48 object-contain rounded"
                                />
                              </div>
                              <div className="p-3 bg-slate-900/50">
                                <p className="text-slate-300 text-sm font-medium truncate">
                                  {duplicateData.pageTitle || 'Untitled'}
                                </p>
                                {duplicateData.sourcePageUrl && (
                                  <p className="text-slate-400 text-xs truncate mt-1">
                                    {duplicateData.sourcePageUrl}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex gap-3 mt-4">
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
                    
                    {/* Upload Progress */}
                    {uploading && (
                      <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl animate-pulse">☁️</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-sm text-primary-200 mb-2">
                              <span>Uploading to Pixvid and ImgBB...</span>
                              <span className="font-bold">{progress}%</span>
                            </div>
                            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 
                                         transition-all duration-300 ease-out"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Scrollable Form Fields */}
                <div className="flex-1 space-y-4 max-h-[70vh] overflow-y-auto pr-2"
                     style={{ scrollbarGutter: 'stable' }}>
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
                        {uploadPageUrl === 'Uploaded manually' 
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
                  </div>

                  {/* tags */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      tags
                    </label>
                    <input
                      type="text"
                      value={uploadTags}
                      onChange={(e) => setUploadTags(e.target.value)}
                      placeholder="nature, sunset, photography"
                      className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                               text-white placeholder-slate-400 
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
                      <div className="space-y-3">
                        {sortedFields.map(([key, value]) => (
                          <div key={key}>
                            <label className="block text-xs font-medium text-slate-400 mb-1">
                              {key}
                            </label>
                            <div className="px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-600 text-white text-xs break-all font-mono">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Error Message */}
                {uploadError && !duplicateData && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
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
        </div>
      </div>
    </div>
  );
}
