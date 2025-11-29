/**
 * @fileoverview Collections Page Component
 * @version 2.0.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RefreshCw, FolderOpen, Trash2, Settings, Plus, X, Edit2, Check
} from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner, Toast } from '../components/UI';
import { useCollections, useImages } from '../hooks/useChromeExtension';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const { collections, loading: collectionsLoading, createCollection, deleteCollection, updateCollection, reload } = useCollections();
  const { images, loading: imagesLoading } = useImages();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [editingCollection, setEditingCollection] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      showToast('❌ Collection name is required', 'error');
      return;
    }

    try {
      await createCollection({
        name: newCollectionName.trim(),
        description: newCollectionDescription.trim()
      });
      showToast('✅ Collection created successfully', 'success');
      setShowCreateModal(false);
      setNewCollectionName('');
      setNewCollectionDescription('');
      reload();
    } catch (error) {
      showToast(`❌ ${error.message || 'Failed to create collection'}`, 'error');
    }
  };

  const handleDeleteCollection = async () => {
    if (!collectionToDelete) return;

    try {
      await deleteCollection(collectionToDelete.id);
      showToast('✅ Collection deleted successfully', 'success');
      setShowDeleteConfirm(false);
      setCollectionToDelete(null);
      reload();
    } catch (error) {
      showToast(`❌ ${error.message || 'Failed to delete collection'}`, 'error');
    }
  };

  const handleUpdateCollection = async (collectionId, updates) => {
    try {
      await updateCollection(collectionId, updates);
      showToast('✅ Collection updated successfully', 'success');
      setEditingCollection(null);
      reload();
    } catch (error) {
      showToast(`❌ ${error.message || 'Failed to update collection'}`, 'error');
    }
  };

  const getCollectionImages = (collectionId) => {
    return images.filter(img => img.collectionId === collectionId);
  };

  if (collectionsLoading || imagesLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Navigation Bar */}
      <div className="sticky top-0 z-40 mb-8">
        <div className="backdrop-blur-2xl bg-white/5 border-b border-white/10 shadow-2xl">
          <div className="px-8 py-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate('/gallery')}
                  className="p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                           backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                           shadow-lg hover:shadow-xl text-white"
                  title="Back to Gallery"
                >
                  ← Back
                </button>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                  <FolderOpen className="w-8 h-8" />
                  Collections
                </h1>
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
                  onClick={() => navigate('/settings')}
                  className="p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 
                           backdrop-blur-sm transition-all duration-300 hover:scale-105 active:scale-95
                           shadow-lg hover:shadow-xl"
                  title="Settings"
                >
                  <Settings className="w-5 h-5 text-white" />
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-5 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                           hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95
                           shadow-lg flex items-center gap-2 text-white font-semibold"
                >
                  <Plus className="w-5 h-5" />
                  New Collection
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collections Grid */}
      <div className="container mx-auto px-8 pb-16">
        {collections.length === 0 ? (
          <div className="text-center py-20">
            <FolderOpen className="w-20 h-20 text-white/30 mx-auto mb-4" />
            <p className="text-white/60 text-xl mb-6">No collections yet</p>
            <Button onClick={() => setShowCreateModal(true)} variant="primary">
              <Plus className="w-5 h-5 mr-2" />
              Create Your First Collection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {collections.map((collection) => {
              const collectionImages = getCollectionImages(collection.id);
              const isEditing = editingCollection?.id === collection.id;

              return (
                <motion.div
                  key={collection.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 
                           hover:bg-white/10 transition-all duration-300 hover:scale-105 shadow-xl"
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <Input
                        value={editingCollection.name}
                        onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
                        placeholder="Collection name"
                        className="bg-white/10 text-white"
                      />
                      <Input
                        value={editingCollection.description || ''}
                        onChange={(e) => setEditingCollection({ ...editingCollection, description: e.target.value })}
                        placeholder="Description (optional)"
                        className="bg-white/10 text-white"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleUpdateCollection(collection.id, {
                            name: editingCollection.name,
                            description: editingCollection.description
                          })}
                          variant="primary"
                          size="sm"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => setEditingCollection(null)}
                          variant="secondary"
                          size="sm"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white mb-1">{collection.name}</h3>
                          {collection.description && (
                            <p className="text-white/60 text-sm">{collection.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <IconButton
                            onClick={() => setEditingCollection({ ...collection })}
                            variant="ghost"
                            size="sm"
                            title="Edit collection"
                          >
                            <Edit2 className="w-4 h-4 text-white/70" />
                          </IconButton>
                          <IconButton
                            onClick={() => {
                              setCollectionToDelete(collection);
                              setShowDeleteConfirm(true);
                            }}
                            variant="ghost"
                            size="sm"
                            title="Delete collection"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </IconButton>
                        </div>
                      </div>

                      {/* Collection Stats */}
                      <div className="mb-4">
                        <p className="text-white/70 text-sm">
                          {collectionImages.length} {collectionImages.length === 1 ? 'image' : 'images'}
                        </p>
                        {collection.createdAt && (
                          <p className="text-white/50 text-xs mt-1">
                            Created {new Date(collection.createdAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>

                      {/* Image Preview Grid */}
                      {collectionImages.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {collectionImages.slice(0, 6).map((img, idx) => (
                            <div
                              key={img.id}
                              className="aspect-square rounded-lg overflow-hidden bg-white/5 cursor-pointer
                                       hover:ring-2 hover:ring-white/30 transition-all"
                              onClick={() => setSelectedCollection(collection)}
                            >
                              <img
                                src={img.imageUrl}
                                alt={img.pageTitle}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        onClick={() => setSelectedCollection(collection)}
                        variant="secondary"
                        className="w-full"
                      >
                        View Collection
                      </Button>
                    </>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Collection Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create New Collection">
          <div className="space-y-4">
            <div>
              <label className="block text-white/80 mb-2 text-sm">Collection Name *</label>
              <Input
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="e.g., Wallpapers, Inspiration, Memes"
                className="bg-white/10 text-white"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-white/80 mb-2 text-sm">Description (optional)</label>
              <Input
                value={newCollectionDescription}
                onChange={(e) => setNewCollectionDescription(e.target.value)}
                placeholder="What's this collection about?"
                className="bg-white/10 text-white"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button onClick={handleCreateCollection} variant="primary" className="flex-1">
                <Plus className="w-4 h-4 mr-2" />
                Create
              </Button>
              <Button onClick={() => setShowCreateModal(false)} variant="secondary" className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && collectionToDelete && (
        <Modal onClose={() => setShowDeleteConfirm(false)} title="Delete Collection?">
          <div className="space-y-4">
            <p className="text-white/80">
              Are you sure you want to delete the collection "{collectionToDelete.name}"?
            </p>
            <p className="text-white/60 text-sm">
              Images in this collection will not be deleted, only the collection itself.
            </p>
            <div className="flex gap-3 pt-4">
              <Button onClick={handleDeleteCollection} variant="danger" className="flex-1">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button onClick={() => setShowDeleteConfirm(false)} variant="secondary" className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Collection View Modal */}
      {selectedCollection && (
        <Modal
          onClose={() => setSelectedCollection(null)}
          title={selectedCollection.name}
          size="full"
        >
          <div className="space-y-4">
            {selectedCollection.description && (
              <p className="text-white/70 mb-6">{selectedCollection.description}</p>
            )}
            
            {getCollectionImages(selectedCollection.id).length === 0 ? (
              <div className="text-center py-12">
                <p className="text-white/60">No images in this collection yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {getCollectionImages(selectedCollection.id).map((img) => (
                  <div
                    key={img.id}
                    className="aspect-square rounded-lg overflow-hidden bg-white/5 
                             hover:ring-2 hover:ring-white/30 transition-all cursor-pointer
                             group relative"
                  >
                    <img
                      src={img.imageUrl}
                      alt={img.pageTitle}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 
                                  transition-opacity duration-300 flex items-center justify-center">
                      <p className="text-white text-sm text-center px-2 line-clamp-2">
                        {img.pageTitle}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Toast Notifications */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
