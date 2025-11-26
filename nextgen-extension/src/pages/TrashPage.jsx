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
                  onClick={() => setSelectedImage(image)}
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
      <AnimatePresence>
        {selectedImage && (
          <Modal onClose={() => setSelectedImage(null)}>
            <div className="flex flex-col h-full">
              {/* Image Preview */}
              <div className="flex-shrink-0 bg-black/50 p-4 flex items-center justify-center max-h-96">
                <img
                  src={getImageUrl(selectedImage)}
                  alt={selectedImage.pageTitle}
                  className="max-w-full max-h-80 object-contain rounded"
                />
              </div>

              {/* Details */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <h3 className="text-xl font-bold mb-2">{selectedImage.pageTitle || 'Untitled'}</h3>
                  <p className="text-sm text-gray-400">
                    Deleted: {formatDate(selectedImage.deletedAt)}
                  </p>
                  {selectedImage.description && (
                    <p className="text-sm text-gray-300 mt-2">{selectedImage.description}</p>
                  )}
                </div>

                {selectedImage.tags && selectedImage.tags.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedImage.tags.map((tag, idx) => (
                        <span 
                          key={idx}
                          className="px-2 py-1 bg-purple-600/30 rounded text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-400">Source Page: </span>
                    <a 
                      href={selectedImage.sourcePageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {selectedImage.sourcePageUrl}
                    </a>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex-shrink-0 p-6 border-t border-gray-700 flex gap-3">
                <Button
                  onClick={() => setShowRestoreConfirm(true)}
                  variant="primary"
                  className="flex-1"
                  disabled={isProcessing}
                >
                  <Undo2 size={18} />
                  Restore
                </Button>
                <Button
                  onClick={() => setShowDeleteConfirm(true)}
                  variant="danger"
                  className="flex-1"
                  disabled={isProcessing}
                >
                  <Trash2 size={18} />
                  Delete Permanently
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Restore Confirmation Modal */}
      <AnimatePresence>
        {showRestoreConfirm && (
          <Modal onClose={() => setShowRestoreConfirm(false)} size="sm">
            <div className="p-6">
              <h3 className="text-xl font-bold mb-4">Restore Image?</h3>
              <p className="text-gray-300 mb-6">
                This will restore the image back to your gallery.
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowRestoreConfirm(false)}
                  variant="secondary"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRestore}
                  variant="primary"
                  className="flex-1"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Spinner size="sm" /> : 'Restore'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Permanent Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <Modal onClose={() => setShowDeleteConfirm(false)} size="sm">
            <div className="p-6">
              <h3 className="text-xl font-bold mb-4 text-red-400">Permanently Delete?</h3>
              <p className="text-gray-300 mb-4">
                This will permanently delete the image from:
              </p>
              <ul className="list-disc list-inside text-gray-300 mb-6 space-y-1">
                <li>ImgBB hosting</li>
                <li>Pixvid hosting</li>
                <li>Your trash</li>
              </ul>
              <p className="text-yellow-400 text-sm mb-6">
                ⚠️ This action cannot be undone!
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowDeleteConfirm(false)}
                  variant="secondary"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePermanentDelete}
                  variant="danger"
                  className="flex-1"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Spinner size="sm" /> : 'Delete Permanently'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Empty Trash Confirmation Modal */}
      <AnimatePresence>
        {showEmptyTrashConfirm && (
          <Modal onClose={() => setShowEmptyTrashConfirm(false)} size="sm">
            <div className="p-6">
              <h3 className="text-xl font-bold mb-4 text-red-400">Empty Trash?</h3>
              <p className="text-gray-300 mb-4">
                This will permanently delete all {trashedImages.length} images from:
              </p>
              <ul className="list-disc list-inside text-gray-300 mb-6 space-y-1">
                <li>All hosting providers (ImgBB, Pixvid)</li>
                <li>Your trash</li>
              </ul>
              <p className="text-yellow-400 text-sm mb-6">
                ⚠️ This action cannot be undone!
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowEmptyTrashConfirm(false)}
                  variant="secondary"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEmptyTrash}
                  variant="danger"
                  className="flex-1"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Spinner size="sm" /> : 'Empty Trash'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
