/**
 * @fileoverview Gallery Page Component
 * @version 2.0.0
 */

import React, { useState } from 'react';
import { RefreshCw, Upload, Search, Trash2, Download, X } from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner, Toast, Textarea } from '../components/UI';
import { useImages, useImageUpload } from '../hooks/useChromeExtension';

export default function GalleryPage() {
  const { images, loading, reload, deleteImage } = useImages();
  const { uploadImage, uploading, progress, error: uploadError } = useImageUpload();
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
  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadImageData, setUploadImageData] = useState(null);
  const [uploadPageUrl, setUploadPageUrl] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');

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
      showToast('🗑️ Deleting from hosts and Firebase...', 'info', 0);
      await deleteImage(selectedImage.id);
      
      showToast('✅ Image deleted successfully!', 'success', 3000);
      setSelectedImage(null);
      setFullImageDetails(null);
    } catch (error) {
      console.error('Delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to delete'}`, 'error', 4000);
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
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadImageData({
          srcUrl: reader.result,
          pageTitle: file.name,
          timestamp: Date.now()
        });
        setUploadPageUrl(window.location.href);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadSubmit = async () => {
    if (!uploadImageData) return;

    try {
      const tagsArray = uploadTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await uploadImage({
        imageUrl: uploadImageData.srcUrl,
        pageUrl: uploadPageUrl,
        pageTitle: uploadImageData.pageTitle,
        description: uploadDescription,
        tags: tagsArray
      });

      showToast('✅ Image uploaded successfully!', 'success', 3000);
      setShowUploadModal(false);
      reload(); // Refresh gallery
    } catch (err) {
      console.error('Upload failed:', err);
      showToast(`❌ ${err.message || 'Upload failed'}`, 'error', 4000);
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
      const date = new Date(img.createdAt);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-7xl mx-auto">
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
            <button
              onClick={openUploadModal}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       text-white font-semibold text-lg shadow-xl hover:shadow-2xl 
                       hover:scale-105 active:scale-95 transition-all"
            >
              Upload First Image
            </button>
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-primary-500 to-secondary-500 w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Masonry Grid - 3 columns on mobile, 4 on tablet, 5 on desktop, 6 on large screens */}
            <div className="columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-6 space-y-6">
              {groupedImages[date].map(img => (
                <div
                  key={img.id}
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
                    {/* Loading skeleton */}
                    {!loadedImages.has(img.id) && (
                      <div className="absolute inset-0 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 
                                    animate-pulse" />
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
                </div>
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
                      <div className="text-xs font-semibold text-slate-400 mb-1">Created At</div>
                      <div className="text-white">
                        {selectedImage.createdAt
                          ? new Date(selectedImage.createdAt).toLocaleString('en-US', {
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
                    <>
                      {/* Technical Details Grid */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Document ID</h4>
                          <p className="text-white font-mono text-xs break-all">{selectedImage.id || 'N/A'}</p>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">File Name</h4>
                          <p className="text-white font-mono text-xs break-all">
                            {fullImageDetails?.fileName || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">File Type</h4>
                          <p className="text-white font-mono text-xs">
                            {fullImageDetails?.fileType || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                          </p>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">File Size</h4>
                          <p className="text-white font-mono text-xs">
                            {fullImageDetails?.fileSize 
                              ? `${(fullImageDetails.fileSize / 1024).toFixed(2)} KB` 
                              : loadingNerdsTab ? 'Loading...' : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Dimensions</h4>
                          <p className="text-white font-mono text-xs">
                            {fullImageDetails?.width && fullImageDetails?.height
                              ? `${fullImageDetails.width} × ${fullImageDetails.height}`
                              : loadingNerdsTab ? 'Loading...' : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Hash Values */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-300">Hash Values</h4>
                        <div className="space-y-2">
                          <div>
                            <h5 className="text-xs font-semibold text-slate-400 mb-1">SHA-256</h5>
                            <div className="bg-white/5 rounded p-2">
                              <p className="text-white font-mono text-xs break-all">
                                {fullImageDetails?.sha256 || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                              </p>
                            </div>
                          </div>
                          <div>
                            <h5 className="text-xs font-semibold text-slate-400 mb-1">pHash</h5>
                            <div className="bg-white/5 rounded p-2">
                              <p className="text-white font-mono text-xs break-all">
                                {fullImageDetails?.pHash 
                                  ? `${fullImageDetails.pHash.substring(0, 64)}...` 
                                  : loadingNerdsTab ? 'Loading...' : 'N/A'}
                              </p>
                            </div>
                          </div>
                          <div>
                            <h5 className="text-xs font-semibold text-slate-400 mb-1">aHash</h5>
                            <div className="bg-white/5 rounded p-2">
                              <p className="text-white font-mono text-xs break-all">
                                {fullImageDetails?.aHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                              </p>
                            </div>
                          </div>
                          <div>
                            <h5 className="text-xs font-semibold text-slate-400 mb-1">dHash</h5>
                            <div className="bg-white/5 rounded p-2">
                              <p className="text-white font-mono text-xs break-all">
                                {fullImageDetails?.dHash || (loadingNerdsTab ? 'Loading...' : 'N/A')}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
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
            <div className="text-7xl animate-bounce">⚠️</div>
            
            <h3 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-rose-500 
                         bg-clip-text text-transparent">
              Delete Image?
            </h3>
            
            <p className="text-slate-300 text-lg leading-relaxed">
              This will permanently delete the image from both your vault and image hosts (Pixvid/ImgBB). 
              <br />
              <span className="font-semibold text-red-400">This action cannot be undone.</span>
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
                         bg-gradient-to-r from-red-600 to-rose-700
                         border border-red-400/50
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-2xl hover:shadow-red-500/50
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-red-400 animate-ping opacity-25" />
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
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Delete Forever</span>
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
          title="Upload Image"
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
              <div className="space-y-6">
                {/* Image Preview */}
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

                {/* Form Fields */}
                <div className="space-y-4">
                  {/* Page URL */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Page URL
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

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Description
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

                  {/* Tags */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Tags (comma-separated)
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
                </div>

                {/* Upload Progress */}
                {uploading && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Uploading...</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 
                                 transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {uploadError && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                    {uploadError}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    disabled={uploading}
                    className="flex-1 px-6 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 
                             text-white font-medium transition-colors disabled:opacity-50 
                             disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUploadSubmit}
                    disabled={uploading || !uploadImageData}
                    className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-r from-primary-500 to-secondary-500 
                             hover:from-primary-600 hover:to-secondary-600 text-white font-medium 
                             transition-all disabled:opacity-50 disabled:cursor-not-allowed
                             shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
                  >
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
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
