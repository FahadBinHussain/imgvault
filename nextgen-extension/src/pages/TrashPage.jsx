/**
 * @fileoverview Trash Page Component
 * @version 2.0.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Undo2, Trash2, AlertTriangle } from 'lucide-react';
import { Button, IconButton, Card, Modal, Spinner, Toast } from '../components/UI';
import { useTrash } from '../hooks/useChromeExtension';

export default function TrashPage() {
  const { trashedImages, loading, reload, restoreFromTrash, permanentlyDelete, emptyTrash } = useTrash();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [toast, setToast] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadedImages, setLoadedImages] = useState(new Set());
  const [activeTab, setActiveTab] = useState('noobs'); // 'noobs' or 'nerds'
  const [fullImageDetails, setFullImageDetails] = useState(null);
  const [loadingNerdsTab, setLoadingNerdsTab] = useState(false);

  // Lazy load full image details when nerds tab is clicked
  const loadFullImageDetails = async (imageId) => {
    console.log('[TRASH] loadFullImageDetails called for ID:', imageId);
    
    if (fullImageDetails?.id === imageId) {
      console.log('[TRASH] Cache hit - details already loaded');
      return;
    }

    console.log('[TRASH] Cache miss - fetching details from backend');
    setLoadingNerdsTab(true);
    
    try {
      console.log('[TRASH] Sending getTrashedImageById request...');
      const response = await chrome.runtime.sendMessage({
        action: 'getTrashedImageById',
        data: { id: imageId }
      });

      console.log('[TRASH] Response received:', response.success ? 'SUCCESS' : 'FAILED');
      console.log('[TRASH] Response data:', response.data);
      console.log('[TRASH] Full response:', response);

      if (response.success && response.data) {
        console.log('[TRASH] Full image details loaded:', {
          id: response.data.id,
          fileName: response.data.fileName,
          fileType: response.data.fileType,
          fileSize: response.data.fileSize,
          width: response.data.width,
          height: response.data.height,
          sha256: response.data.sha256 ? 'present' : 'missing',
          pHash: response.data.pHash ? 'present' : 'missing',
          aHash: response.data.aHash ? 'present' : 'missing',
          dHash: response.data.dHash ? 'present' : 'missing'
        });
        setFullImageDetails(response.data);
      } else {
        console.error('[TRASH] Failed to load details - response:', response);
      }
    } catch (error) {
      console.error('[TRASH] Exception while loading full image details:', error);
    } finally {
      setLoadingNerdsTab(false);
    }
  };

  const handleTabSwitch = (tabName) => {
    console.log('[TRASH TAB SWITCH] Switching to:', tabName);
    console.log('[TRASH TAB SWITCH] Selected image:', selectedImage?.id);
    console.log('[TRASH TAB SWITCH] Current fullImageDetails:', fullImageDetails?.id);
    
    setActiveTab(tabName);
    
    // Lazy load full details ONLY when "For Nerds" tab is clicked
    if (tabName === 'nerds' && selectedImage) {
      console.log('[TRASH TAB SWITCH] Nerds tab clicked - loading full details');
      // Force immediate load
      setTimeout(() => loadFullImageDetails(selectedImage.id), 0);
    } else if (tabName === 'noobs') {
      console.log('[TRASH TAB SWITCH] Noobs tab clicked - no loading needed');
    }
  };

  const handleImageLoad = (imageId) => {
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const handleRestore = async () => {
    if (!selectedImage) return;
    
    setIsProcessing(true);
    setShowRestoreConfirm(false);
    
    try {
      showToast('♻️ Restoring image...', 'info', 0);
      await restoreFromTrash(selectedImage.id);
      
      showToast('✅ Image restored successfully!', 'success', 3000);
      setSelectedImage(null);
    } catch (error) {
      console.error('Restore failed:', error);
      showToast(`❌ ${error.message || 'Failed to restore'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedImage) return;
    
    setIsProcessing(true);
    setShowDeleteConfirm(false);
    
    try {
      showToast('🔥 Permanently deleting from hosts and trash...', 'info', 0);
      await permanentlyDelete(selectedImage.id);
      
      showToast('✅ Image permanently deleted!', 'success', 3000);
      setSelectedImage(null);
    } catch (error) {
      console.error('Permanent delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to delete'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEmptyTrash = async () => {
    setIsProcessing(true);
    setShowEmptyTrashConfirm(false);
    
    try {
      showToast('🔥 Emptying trash...', 'info', 0);
      const deletedCount = await emptyTrash();
      
      showToast(`✅ Emptied trash! (${deletedCount} items deleted)`, 'success', 3000);
    } catch (error) {
      console.error('Empty trash failed:', error);
      showToast(`❌ ${error.message || 'Failed to empty trash'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const getImageUrl = (image) => {
    return image.imgbbThumbUrl || image.imgbbUrl || image.pixvidUrl || image.sourceImageUrl;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const groupImagesByDate = (images) => {
    const groups = {};
    images.forEach(img => {
      const date = new Date(img.deletedAt);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
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

  const groupedImages = groupImagesByDate(trashedImages);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="w-full px-6">
        {/* Glassmorphism Navigation Bar - Apple-like */}
        <div className="sticky top-0 z-40 mb-8">
          {/* Frosted glass bar */}
          <div className="backdrop-blur-2xl bg-white/5 border-b border-white/10 shadow-2xl">
            <div className="px-8 py-6">
              {/* Top Row: Logo + Actions */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => window.location.href = 'gallery.html'}
                    className="p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                             backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                             shadow-lg hover:shadow-xl text-white"
                    title="Back to Gallery"
                  >
                    ← Back
                  </button>
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-red-500 to-pink-500 rounded-xl blur-lg opacity-50"></div>
                    <div className="w-12 h-12 relative z-10 rounded-xl shadow-lg bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center text-2xl">
                      🗑️
                    </div>
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-red-300 to-pink-300 bg-clip-text text-transparent drop-shadow-lg">
                      ImgVault Trash
                    </h1>
                    <p className="text-sm text-slate-300 mt-1">
                      <span className="font-semibold text-red-300">{trashedImages.length}</span> item{trashedImages.length !== 1 ? 's' : ''} in trash
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
                    <RefreshCw className={`w-5 h-5 text-white ${loading ? 'animate-spin' : ''}`} />
                  </button>
                  {trashedImages.length > 0 && (
                    <button
                      onClick={() => setShowEmptyTrashConfirm(true)}
                      disabled={isProcessing}
                      className="px-5 py-3 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 
                               text-white font-semibold shadow-lg hover:shadow-xl hover:scale-105 
                               active:scale-95 transition-all duration-300 flex items-center gap-2
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-5 h-5" />
                      Empty Trash
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Warning Message */}
        {trashedImages.length > 0 && (
          <div className="px-6 mb-6">
            <div className="p-4 bg-yellow-900/30 border border-yellow-600/50 rounded-xl backdrop-blur-sm flex items-start gap-3">
              <AlertTriangle className="text-yellow-500 mt-1 flex-shrink-0" size={20} />
              <div className="text-sm">
                <p className="font-medium text-yellow-300">Images in trash are still hosted</p>
                <p className="text-yellow-400/80 mt-1">
                  Trashed images remain accessible via their URLs. To completely remove them from hosts, 
                  use "Permanently Delete" or "Empty Trash".
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="px-6">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col justify-center items-center py-32">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-red-500 to-pink-500 rounded-full blur-2xl opacity-50 animate-pulse"></div>
              <Spinner size="lg" className="relative z-10" />
            </div>
            <p className="mt-6 text-white text-lg font-medium">Loading trash...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && trashedImages.length === 0 && (
          <div className="glass-card rounded-xl backdrop-blur-xl bg-white/10 border border-white/20 
                        shadow-2xl p-16 text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-red-500 to-pink-500 rounded-full blur-3xl opacity-30"></div>
              <div className="text-8xl relative z-10 drop-shadow-2xl">🗑️</div>
            </div>
            <h3 className="text-3xl font-bold text-white mb-3 drop-shadow-lg">Trash is Empty</h3>
            <p className="text-slate-300 text-lg max-w-md mx-auto">
              Deleted images will appear here. You can restore them or delete them permanently.
            </p>
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-red-500 to-pink-500 w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Masonry Grid - 3 columns on mobile, 4 on tablet, 5 on desktop, 6 on large screens */}
            <div className="columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-6 space-y-6">
              {groupedImages[date].map((image, index) => (
                <motion.div
                  key={image.id}
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
                    console.log('[TRASH] Image clicked:', image.id);
                    console.log('[TRASH] Image data:', image);
                    console.log('[TRASH] createdAt:', image.createdAt);
                    setSelectedImage(image);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                  }}
                >
                  {/* Soft glow effect on hover */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-red-500/40 to-pink-500/40 
                                rounded-xl opacity-0 group-hover:opacity-100 blur-xl 
                                transition-all duration-700 ease-out"></div>
                  
                  {/* Card with soft shadows and smooth animations */}
                  <div className="relative bg-slate-800/80 backdrop-blur-sm border border-white/10 
                                rounded-xl overflow-hidden shadow-lg group-hover:shadow-2xl
                                transform transition-all duration-500 ease-out 
                                group-hover:scale-[1.04] group-hover:-translate-y-2">
                    {/* Loading skeleton with shimmer */}
                    {!loadedImages.has(image.id) && (
                      <div className="absolute inset-0 bg-slate-800 overflow-hidden">
                        <div className="absolute inset-0 shimmer"></div>
                      </div>
                    )}
                    
                    <img
                      src={getImageUrl(image)}
                      alt={image.pageTitle || 'Trashed image'}
                      onLoad={() => handleImageLoad(image.id)}
                      className={`w-full object-cover transition-all duration-700 ease-out
                               group-hover:scale-110
                               ${loadedImages.has(image.id) 
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
                          {image.pageTitle || 'Untitled'}
                        </p>
                        <p className="text-white/70 text-xs">
                          Deleted: {formatDate(image.deletedAt)}
                        </p>
                        {image.tags && image.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {image.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-lg bg-white/20 backdrop-blur-sm 
                                         text-white border border-white/30 font-medium shadow-lg"
                              >
                                {tag}
                              </span>
                            ))}
                            {image.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-lg bg-white/20 backdrop-blur-sm 
                                             text-white border border-white/30 font-medium shadow-lg">
                                +{image.tags.length - 2}
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
        </div>
      </div>

      {/* Image Detail Modal */}
      <Modal 
        isOpen={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        className="!max-w-[95vw] !w-full !h-[95vh] !p-0 !overflow-hidden"
      >
        {selectedImage && (
          <div className="flex h-full relative">
              
              {/* Dark Overlay Background */}
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

              {/* LEFT SIDE - IMAGE with Zoom Animation */}
              <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-8 relative z-10">
                {/* Radial glow effect */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              w-4/5 h-4/5 bg-red-500/10 rounded-full blur-3xl"></div>
                
                {/* Image */}
                <img
                  src={getImageUrl(selectedImage)}
                  alt={selectedImage.pageTitle}
                  className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl relative z-10
                           hover:scale-[1.02] hover:shadow-[0_0_80px_rgba(239,68,68,0.3)]
                           transition-all duration-700"
                />
              </div>

              {/* RIGHT SIDE - DETAILS */}
              <div className="w-[550px] flex-shrink-0 bg-slate-800/90 backdrop-blur-xl border-l border-white/10 
                            overflow-y-auto flex flex-col relative z-10"
                   style={{ scrollbarWidth: 'thin', scrollbarColor: '#ef4444 #1e293b' }}
              >
                {/* Close Button */}
                <button
                  onClick={() => setSelectedImage(null)}
                  className="absolute top-4 right-4 z-50 w-11 h-11 rounded-full bg-red-500/20 
                           hover:bg-red-500/40 border border-red-500/50 hover:border-red-500 
                           flex items-center justify-center transition-all duration-300 
                           hover:scale-110 hover:rotate-90 group shadow-xl"
                  title="Close"
                >
                  <span className="text-red-300 group-hover:text-red-100 text-2xl font-bold">✕</span>
                </button>

                <div className="p-6 flex-1 pt-16">
                  {/* Details Header */}
                  <h2 className="text-2xl font-bold text-white mb-4 bg-gradient-to-r from-red-300 to-pink-300 bg-clip-text text-transparent">
                    Details
                  </h2>

                  {/* Tab Navigation */}
                  <div className="flex gap-2 mb-4 border-b border-white/10">
                    <button
                      onClick={() => handleTabSwitch('noobs')}
                      className={`px-4 py-2 font-semibold transition-all ${
                        activeTab === 'noobs'
                          ? 'text-red-300 border-b-2 border-red-300'
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
                          <div className="text-xs font-semibold text-slate-400 mb-1">Deleted At</div>
                          <div className="text-white">
                            {selectedImage.deletedAt
                              ? new Date(selectedImage.deletedAt).toLocaleString('en-US', {
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
                              : fullImageDetails?.createdAt
                                ? new Date(fullImageDetails.createdAt).toLocaleString('en-US', {
                                    weekday: 'short',
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                  })
                                : 'Unknown'}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Display Source</div>
                          <div className="flex items-center gap-2">
                            {selectedImage.imgbbUrl ? (
                              <span className="px-3 py-1 rounded bg-green-500/20 text-green-300 font-semibold text-sm">
                                ImgBB ⚡
                              </span>
                            ) : selectedImage.pixvidUrl ? (
                              <span className="px-3 py-1 rounded bg-blue-500/20 text-blue-300 font-semibold text-sm">
                                Pixvid ⚡
                              </span>
                            ) : (
                              <span className="px-3 py-1 rounded bg-gray-500/20 text-gray-300 font-semibold text-sm">
                                Original ⚡
                              </span>
                            )}
                          </div>
                        </div>

                        {selectedImage.pixvidUrl && (
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
                        )}

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
                          <div className="text-xs font-semibold text-slate-400 mb-1">Source URL</div>
                          <div className="bg-white/5 rounded p-2">
                            <a
                              href={selectedImage.sourceImageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-red-300 hover:text-red-200 break-all text-sm"
                            >
                              {selectedImage.sourceImageUrl || 'N/A'}
                            </a>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Page URL</div>
                          <div className="bg-white/5 rounded p-2">
                            <a
                              href={selectedImage.sourcePageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-red-300 hover:text-red-200 break-all text-sm"
                            >
                              {selectedImage.sourcePageUrl || 'N/A'}
                            </a>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Description</div>
                          <div className="text-slate-300 text-sm">
                            {selectedImage.description || 'No description'}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-400 mb-1">Tags</div>
                          {selectedImage.tags && selectedImage.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedImage.tags.map(tag => (
                                <span
                                  key={tag}
                                  className="px-3 py-1 rounded-full bg-red-500/20 text-red-200 text-sm"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-slate-500 italic text-sm">No tags</div>
                          )}
                        </div>
                      </div>

                      {/* Warning Box */}
                      <div className="mt-4 p-4 bg-yellow-900/30 border border-yellow-600/50 rounded-xl">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="text-yellow-500 mt-0.5 flex-shrink-0" size={18} />
                          <div className="text-sm">
                            <p className="font-medium text-yellow-300">Image Still Hosted</p>
                            <p className="text-yellow-400/80 mt-1">
                              This image remains accessible via its URLs. Use "Delete Permanently" to remove it from all hosts.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* For Nerds Tab */}
                  {activeTab === 'nerds' && selectedImage && (
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
                                {fullImageDetails?.fileName || 'N/A'}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold text-slate-400 mb-1">File Type</h4>
                              <p className="text-white font-mono text-xs">
                                {fullImageDetails?.fileType || 'N/A'}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold text-slate-400 mb-1">File Size</h4>
                              <p className="text-white font-mono text-xs">
                                {fullImageDetails?.fileSize 
                                  ? `${(fullImageDetails.fileSize / 1024).toFixed(2)} KB` 
                                  : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold text-slate-400 mb-1">Dimensions</h4>
                              <p className="text-white font-mono text-xs">
                                {fullImageDetails?.width && fullImageDetails?.height
                                  ? `${fullImageDetails.width} × ${fullImageDetails.height}`
                                  : 'N/A'}
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
                                    {fullImageDetails?.sha256 || 'N/A'}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <h5 className="text-xs font-semibold text-slate-400 mb-1">pHash</h5>
                                <div className="bg-white/5 rounded p-2">
                                  <p className="text-white font-mono text-xs break-all">
                                    {fullImageDetails?.pHash 
                                      ? `${fullImageDetails.pHash.substring(0, 64)}...` 
                                      : 'N/A'}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <h5 className="text-xs font-semibold text-slate-400 mb-1">aHash</h5>
                                <div className="bg-white/5 rounded p-2">
                                  <p className="text-white font-mono text-xs break-all">
                                    {fullImageDetails?.aHash || 'N/A'}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <h5 className="text-xs font-semibold text-slate-400 mb-1">dHash</h5>
                                <div className="bg-white/5 rounded p-2">
                                  <p className="text-white font-mono text-xs break-all">
                                    {fullImageDetails?.dHash || 'N/A'}
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
                  <div className="flex gap-2 pt-6 border-t border-white/10 mt-6">
                    <button
                      onClick={() => setShowRestoreConfirm(true)}
                      disabled={isProcessing}
                      className="group relative flex-1 px-6 py-2.5 rounded-xl overflow-hidden
                               bg-gradient-to-r from-green-500 to-emerald-600
                               border border-green-400/30 
                               transform transition-all duration-300
                               hover:scale-110 hover:shadow-2xl hover:shadow-green-500/50
                               active:scale-95
                               disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      {/* Animated background glow */}
                      <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-500 opacity-0 
                                    group-hover:opacity-100 blur-xl transition-opacity duration-300" />
                      
                      {/* Shimmer effect */}
                      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                                    bg-gradient-to-r from-transparent via-white/20 to-transparent 
                                    transition-transform duration-700" />
                      
                      {/* Button content */}
                      <div className="relative flex items-center justify-center gap-2 text-white font-semibold">
                        <Undo2 className="w-5 h-5 group-hover:-rotate-12 transition-transform duration-300" />
                        <span>Restore</span>
                      </div>
                    </button>

                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isProcessing}
                      className="group relative flex-1 px-6 py-2.5 rounded-xl overflow-hidden
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
                      <div className="relative flex items-center justify-center gap-2 text-white font-semibold">
                        <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                        <span>Delete Forever</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal isOpen={showRestoreConfirm} onClose={() => setShowRestoreConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated icon */}
          <div className="text-7xl animate-bounce">♻️</div>
          
          <h3 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 
                       bg-clip-text text-transparent">
            Restore Image?
          </h3>
          
          <p className="text-slate-300 text-lg leading-relaxed">
            This will restore the image back to your gallery.
            <br />
            <span className="font-semibold text-green-400">You can access it normally again.</span>
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowRestoreConfirm(false)}
              disabled={isProcessing}
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
              onClick={handleRestore}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-xl overflow-hidden
                       bg-gradient-to-r from-green-600 to-emerald-700
                       border border-green-400/50
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-2xl hover:shadow-green-500/50
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when restoring */}
              {isProcessing && (
                <div className="absolute inset-0 bg-green-400 animate-ping opacity-25" />
              )}
              
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                            bg-gradient-to-r from-transparent via-white/20 to-transparent 
                            transition-transform duration-700" />
              
              {/* Button content */}
              <div className="relative flex items-center gap-2 text-white font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <Undo2 className="w-5 h-5 group-hover:-rotate-12 transition-transform duration-300" />
                    <span>Restore</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>
      
      {/* Permanent Delete Confirmation Modal */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated warning icon */}
          <div className="text-7xl animate-bounce">🔥</div>
          
          <h3 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-rose-500 
                       bg-clip-text text-transparent">
            Permanently Delete?
          </h3>
          
          <div className="text-left bg-red-900/20 border border-red-500/30 rounded-xl p-4 space-y-2">
            <p className="text-slate-300 leading-relaxed">
              This will permanently delete the image from:
            </p>
            <ul className="list-disc list-inside text-slate-300 space-y-1 ml-2">
              <li>ImgBB hosting (if uploaded)</li>
              <li>Pixvid hosting (if uploaded)</li>
              <li>Your trash bin</li>
            </ul>
          </div>
          
          <p className="text-yellow-400 font-semibold text-lg flex items-center justify-center gap-2">
            <AlertTriangle size={20} />
            This action cannot be undone!
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isProcessing}
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
              onClick={handlePermanentDelete}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-xl overflow-hidden
                       bg-gradient-to-r from-red-600 to-rose-700
                       border border-red-400/50
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-2xl hover:shadow-red-500/50
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when deleting */}
              {isProcessing && (
                <div className="absolute inset-0 bg-red-400 animate-ping opacity-25" />
              )}
              
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                            bg-gradient-to-r from-transparent via-white/20 to-transparent 
                            transition-transform duration-700" />
              
              {/* Button content */}
              <div className="relative flex items-center gap-2 text-white font-bold text-lg">
                {isProcessing ? (
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

      {/* Empty Trash Confirmation Modal */}
      <Modal isOpen={showEmptyTrashConfirm} onClose={() => setShowEmptyTrashConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated warning icon */}
          <div className="text-7xl animate-bounce">💥</div>
          
          <h3 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-rose-500 
                       bg-clip-text text-transparent">
            Empty Entire Trash?
          </h3>
          
          <div className="text-left bg-red-900/20 border border-red-500/30 rounded-xl p-4 space-y-2">
            <p className="text-slate-300 leading-relaxed">
              This will permanently delete <span className="font-bold text-red-300">{trashedImages.length} image{trashedImages.length !== 1 ? 's' : ''}</span> from:
            </p>
            <ul className="list-disc list-inside text-slate-300 space-y-1 ml-2">
              <li>All hosting providers (ImgBB, Pixvid)</li>
              <li>Your trash bin</li>
            </ul>
          </div>
          
          <p className="text-yellow-400 font-semibold text-lg flex items-center justify-center gap-2">
            <AlertTriangle size={20} />
            This action cannot be undone!
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowEmptyTrashConfirm(false)}
              disabled={isProcessing}
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
              onClick={handleEmptyTrash}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-xl overflow-hidden
                       bg-gradient-to-r from-red-600 to-rose-700
                       border border-red-400/50
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-2xl hover:shadow-red-500/50
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when deleting */}
              {isProcessing && (
                <div className="absolute inset-0 bg-red-400 animate-ping opacity-25" />
              )}
              
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full 
                            bg-gradient-to-r from-transparent via-white/20 to-transparent 
                            transition-transform duration-700" />
              
              {/* Button content */}
              <div className="relative flex items-center gap-2 text-white font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Emptying...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Empty Trash</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
