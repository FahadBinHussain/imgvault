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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
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
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-red-400 to-pink-600 bg-clip-text text-transparent">
                🗑️ Trash
              </h1>
              <p className="text-gray-400 mt-2">
                {trashedImages.length} item{trashedImages.length !== 1 ? 's' : ''} in trash
              </p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <IconButton onClick={reload} disabled={loading} variant="secondary">
              <RefreshCw className={loading ? 'animate-spin' : ''} size={20} />
            </IconButton>
            
            {trashedImages.length > 0 && (
              <Button 
                onClick={() => setShowEmptyTrashConfirm(true)}
                variant="danger"
                disabled={isProcessing}
              >
                <Trash2 size={18} />
                Empty Trash
              </Button>
            )}
          </div>
        </div>

        {/* Warning Message */}
        {trashedImages.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-900/30 border border-yellow-600/50 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-yellow-500 mt-1 flex-shrink-0" size={20} />
            <div className="text-sm">
              <p className="font-medium text-yellow-300">Images in trash are still hosted</p>
              <p className="text-yellow-400/80 mt-1">
                Trashed images remain accessible via their URLs. To completely remove them from hosts, 
                use "Permanently Delete" or "Empty Trash".
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <Spinner size="lg" />
          </div>
        )}

        {/* Empty State */}
        {!loading && trashedImages.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🗑️</div>
            <h2 className="text-2xl font-semibold mb-2">Trash is empty</h2>
            <p className="text-gray-400">
              Deleted images will appear here
            </p>
          </div>
        )}

        {/* Images Grid */}
        {!loading && trashedImages.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <AnimatePresence>
              {trashedImages.map((image) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card 
                    className="group cursor-pointer hover:ring-2 hover:ring-red-500 transition-all overflow-hidden"
                    onClick={() => setSelectedImage(image)}
                  >
                    <div className="aspect-square relative bg-gray-800">
                      <motion.img
                        src={getImageUrl(image)}
                        alt={image.pageTitle || 'Trashed image'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: loadedImages.has(image.id) ? 1 : 0 }}
                        transition={{ duration: 0.3 }}
                        onLoad={() => handleImageLoad(image.id)}
                      />
                      
                      {/* Overlay with actions */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-0 left-0 right-0 p-3 flex justify-between items-end">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/90 font-medium truncate">
                              {image.pageTitle || 'Untitled'}
                            </p>
                            <p className="text-xs text-white/60 mt-1">
                              Deleted: {formatDate(image.deletedAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
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
