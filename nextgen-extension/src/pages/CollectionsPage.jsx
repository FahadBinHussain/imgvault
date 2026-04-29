/**
 * @fileoverview Collections Page Component
 * @version 2.0.0
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderOpen, Trash2, Plus, X, Edit2, Check } from 'lucide-react';
import { Button, Input, Modal, Spinner, Toast } from '../components/UI';
import { useCollections, useImages, useChromeStorage } from '../hooks/useChromeExtension';
import PremiumBackground from '../components/PremiumBackground';
import GalleryNavbar from '../components/GalleryNavbar';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const {
    collections,
    loading: collectionsLoading,
    createCollection,
    deleteCollection,
    updateCollection,
    reload,
  } = useCollections();
  const { images, loading: imagesLoading } = useImages();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [navbarHeight, setNavbarHeight] = useState(0);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [editingCollection, setEditingCollection] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      showToast('Collection name is required', 'error');
      return;
    }

    try {
      await createCollection({
        name: newCollectionName.trim(),
        description: newCollectionDescription.trim(),
      });
      showToast('Collection created successfully', 'success');
      setShowCreateModal(false);
      setNewCollectionName('');
      setNewCollectionDescription('');
      reload();
    } catch (error) {
      showToast(error.message || 'Failed to create collection', 'error');
    }
  };

  const handleDeleteCollection = async () => {
    if (!collectionToDelete) {
      return;
    }

    try {
      await deleteCollection(collectionToDelete.id);
      showToast('Collection deleted successfully', 'success');
      setShowDeleteConfirm(false);
      setCollectionToDelete(null);
      reload();
    } catch (error) {
      showToast(error.message || 'Failed to delete collection', 'error');
    }
  };

  const handleUpdateCollection = async (collectionId, updates) => {
    try {
      await updateCollection(collectionId, updates);
      showToast('Collection updated successfully', 'success');
      setEditingCollection(null);
      reload();
    } catch (error) {
      showToast(error.message || 'Failed to update collection', 'error');
    }
  };

  const getCollectionImages = (collectionId) => images.filter((img) => img.collectionId === collectionId);

  const getImageUrl = (img) => {
    if (defaultGallerySource === 'pixvid') {
      return img.pixvidUrl || img.imgbbUrl;
    }
    return img.imgbbUrl || img.pixvidUrl;
  };

  if (collectionsLoading || imagesLoading) {
    return (
      <div className="min-h-screen bg-base-200 text-base-content flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200 text-base-content prem-page">`n      <PremiumBackground />
      <GalleryNavbar
        navigate={navigate}
        images={images}
        reload={reload}
        toggleSelectionMode={() => {}}
        selectionMode={false}
        collectionsLoading={collectionsLoading}
        collections={collections}
        trashLoading={false}
        trashedImages={[]}
        openUploadModal={() => {}}
        searchQuery=""
        setSearchQuery={() => {}}
        selectedImages={new Set()}
        selectAll={() => {}}
        filteredImages={images}
        deselectAll={() => {}}
        setShowBulkDeleteConfirm={() => {}}
        isDeleting={false}
        onHeightChange={setNavbarHeight}
      />

      <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '90px' }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 space-y-6">
        <div className="bg-base-100 border border-base-300 rounded-[var(--radius-box)] shadow-xl p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-[var(--radius-box)] bg-primary/15 text-primary flex items-center justify-center">
                <FolderOpen className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Collections</h1>
                <p className="text-sm text-base-content/70 mt-1">
                  Organize your saved items into reusable groups.
                </p>
              </div>
            </div>

            <Button
              onClick={() => setShowCreateModal(true)}
              variant="primary"
              className="justify-center gap-2 shadow-lg shadow-primary/10 hover:shadow-xl hover:shadow-primary/20"
            >
              <Plus className="w-4 h-4" />
              New Collection
            </Button>
          </div>
        </div>

        {collections.length === 0 ? (
          <div className="bg-base-100 border border-base-300 rounded-[var(--radius-box)] shadow-xl text-center py-20 px-6">
            <FolderOpen className="w-20 h-20 text-base-content/25 mx-auto mb-4" />
            <p className="text-base-content/70 text-xl mb-6">No collections yet</p>
            <Button onClick={() => setShowCreateModal(true)} variant="primary">
              <Plus className="w-5 h-5 mr-2" />
              Create Your First Collection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            {collections.map((collection) => {
              const collectionImages = getCollectionImages(collection.id);
              const isEditing = editingCollection?.id === collection.id;

              return (
                <motion.div
                  key={collection.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-6 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <Input
                        value={editingCollection.name}
                        onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
                        placeholder="Collection name"
                        className="bg-base-200 border-base-300"
                      />
                      <Input
                        value={editingCollection.description || ''}
                        onChange={(e) => setEditingCollection({ ...editingCollection, description: e.target.value })}
                        placeholder="Description (optional)"
                        className="bg-base-200 border-base-300"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            handleUpdateCollection(collection.id, {
                              name: editingCollection.name,
                              description: editingCollection.description,
                            })
                          }
                          variant="primary"
                          size="sm"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button onClick={() => setEditingCollection(null)} variant="outline" size="sm">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-4 gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-xl font-bold text-base-content mb-1 truncate">{collection.name}</h3>
                          {collection.description && (
                            <p className="text-base-content/60 text-sm">{collection.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingCollection({ ...collection })}
                            className="p-2 rounded-[var(--radius-box)] bg-base-200 hover:bg-base-300 border border-base-300 transition-all duration-200"
                            title="Edit collection"
                          >
                            <Edit2 className="w-4 h-4 text-base-content/70" />
                          </button>
                          <button
                            onClick={() => {
                              setCollectionToDelete(collection);
                              setShowDeleteConfirm(true);
                            }}
                            className="p-2 rounded-[var(--radius-box)] bg-base-200 hover:bg-base-300 border border-base-300 transition-all duration-200"
                            title="Delete collection"
                          >
                            <Trash2 className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      </div>

                      <div className="mb-4">
                        <p className="text-base-content/70 text-sm">
                          {collectionImages.length} {collectionImages.length === 1 ? 'image' : 'images'}
                        </p>
                        {collection.createdAt && (
                          <p className="text-base-content/50 text-xs mt-1">
                            Created {new Date(collection.createdAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>

                      {collectionImages.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {collectionImages.slice(0, 6).map((img) => (
                            <div
                              key={img.id}
                              className="aspect-square rounded-[var(--radius-box)] overflow-hidden bg-base-200 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
                              onClick={() => navigate(`/gallery/${collection.id}`)}
                            >
                              <img src={getImageUrl(img)} alt={img.pageTitle} className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}

                      <Button onClick={() => navigate(`/gallery/${collection.id}`)} variant="outline" className="w-full">
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

      {showCreateModal && (
        <Modal isOpen={true} onClose={() => setShowCreateModal(false)} title="Create New Collection">
          <div className="space-y-4">
            <Input
              label="Collection Name *"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="e.g., Wallpapers, Inspiration, Memes"
              autoFocus
            />
            <Input
              label="Description (optional)"
              value={newCollectionDescription}
              onChange={(e) => setNewCollectionDescription(e.target.value)}
              placeholder="What's this collection about?"
            />
            <div className="flex gap-3 pt-4">
              <Button onClick={handleCreateCollection} variant="primary" className="flex-1">
                <Plus className="w-4 h-4 mr-2" />
                Create
              </Button>
              <Button onClick={() => setShowCreateModal(false)} variant="outline" className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showDeleteConfirm && collectionToDelete && (
        <Modal isOpen={true} onClose={() => setShowDeleteConfirm(false)} title="Delete Collection?">
          <div className="space-y-4">
            <p className="text-base-content/80">
              Are you sure you want to delete the collection "{collectionToDelete.name}"?
            </p>
            <p className="text-base-content/60 text-sm">
              Images in this collection will not be deleted, only the collection itself.
            </p>
            <div className="flex gap-3 pt-4">
              <Button onClick={handleDeleteCollection} variant="danger" className="flex-1">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button onClick={() => setShowDeleteConfirm(false)} variant="outline" className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

