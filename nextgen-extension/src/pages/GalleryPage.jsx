/**
 * @fileoverview Gallery Page Component
 * @version 2.0.0
 */

import React, { useState } from 'react';
import { RefreshCw, Upload, Search, Trash2, Download, ExternalLink } from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner } from '../components/UI';
import { useImages } from '../hooks/useChromeExtension';

export default function GalleryPage() {
  const { images, loading, reload, deleteImage } = useImages();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const filteredImages = images.filter(img => {
    const query = searchQuery.toLowerCase();
    return (
      img.pageTitle?.toLowerCase().includes(query) ||
      img.description?.toLowerCase().includes(query) ||
      img.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  });

  const handleDelete = async () => {
    if (selectedImage) {
      await deleteImage(selectedImage.id);
      setShowDeleteConfirm(false);
      setSelectedImage(null);
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
    <div className="min-h-screen bg-gradient-primary p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="glass-card rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img src="/icons/icon48.png" alt="ImgVault" className="w-10 h-10" />
              <div>
                <h1 className="text-2xl font-bold gradient-text">Gallery</h1>
                <p className="text-sm text-slate-300">{images.length} images in vault</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconButton icon={RefreshCw} title="Refresh" onClick={reload} />
              <Button
                variant="primary"
                size="sm"
                onClick={() => chrome.tabs.create({ url: 'popup.html' })}
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, description, or tags..."
              className="pl-10"
            />
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <Spinner size="lg" />
          </div>
        )}

        {/* Empty State */}
        {!loading && images.length === 0 && (
          <Card className="text-center py-20">
            <div className="text-6xl mb-4">🖼️</div>
            <h3 className="text-xl font-bold text-white mb-2">No Images Yet</h3>
            <p className="text-slate-300 mb-4">Start saving images to your vault</p>
            <Button variant="primary" onClick={() => chrome.tabs.create({ url: 'popup.html' })}>
              Upload First Image
            </Button>
          </Card>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">{date}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {groupedImages[date].map(img => (
                <div
                  key={img.id}
                  className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer
                           bg-white/5 border border-white/10 hover:border-white/30 transition-all"
                  onClick={() => setSelectedImage(img)}
                >
                  <img
                    src={img.imgbbUrl || img.pixvidUrl}
                    alt={img.pageTitle}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent
                                opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-white text-sm font-medium truncate">
                        {img.pageTitle || 'Untitled'}
                      </p>
                      {img.tags && img.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {img.tags.slice(0, 2).map(tag => (
                            <span
                              key={tag}
                              className="text-xs px-2 py-0.5 rounded bg-white/20 text-white"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Image Detail Modal */}
        <Modal
          isOpen={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          className="max-w-4xl"
        >
          {selectedImage && (
            <div className="space-y-4">
              <img
                src={selectedImage.imgbbUrl || selectedImage.pixvidUrl}
                alt={selectedImage.pageTitle}
                className="w-full rounded-lg"
              />
              <div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {selectedImage.pageTitle || 'Untitled'}
                </h3>
                {selectedImage.description && (
                  <p className="text-slate-300 mb-3">{selectedImage.description}</p>
                )}
                {selectedImage.tags && selectedImage.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {selectedImage.tags.map(tag => (
                      <span
                        key={tag}
                        className="px-3 py-1 rounded-full bg-primary-500/20 text-primary-200 text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => window.open(selectedImage.sourcePageUrl, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Source Page
                </Button>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => window.open(selectedImage.pixvidUrl, '_blank')}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(true);
                  }}
                  className="text-red-300 border-red-300/30 hover:border-red-300/50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
          <div className="text-center space-y-4">
            <div className="text-5xl">⚠️</div>
            <h3 className="text-xl font-bold text-white">Delete Image?</h3>
            <p className="text-slate-300">
              This action cannot be undone. The image will be permanently removed from your vault.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="glass" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleDelete}
                className="text-red-300 border-red-300/30 hover:border-red-300/50"
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
