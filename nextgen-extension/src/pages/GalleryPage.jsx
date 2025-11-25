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
  const [fullImageDetails, setFullImageDetails] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('noobs'); // 'noobs' or 'nerds'
  const [loadingNerdsTab, setLoadingNerdsTab] = useState(false);

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
      setFullImageDetails(null);
    }
  };

  // Lazy load full image details when nerds tab is clicked
  const loadFullImageDetails = async (imageId) => {
    if (fullImageDetails?.id === imageId) {
      console.log('✅ [CACHE HIT] Full details already loaded');
      return;
    }

    console.log('🔍 [NERD TAB CLICKED] User wants to see technical details');
    console.log('💡 [LAZY LOAD TRIGGER] Full details not loaded yet - fetching now...');
    
    setLoadingNerdsTab(true);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getImageById',
        data: { id: imageId }
      });

      if (response.success && response.data) {
        console.log('✅ [LAZY LOAD] Full image details loaded successfully:', {
          fileName: response.data.fileName,
          fileType: response.data.fileType,
          fileSize: response.data.fileSize,
          dimensions: `${response.data.width}x${response.data.height}`,
          sha256: response.data.sha256 ? 'present' : 'missing',
          pHash: response.data.pHash ? 'present' : 'missing',
          aHash: response.data.aHash ? 'present' : 'missing',
          dHash: response.data.dHash ? 'present' : 'missing'
        });
        setFullImageDetails(response.data);
      }
    } catch (error) {
      console.error('❌ Error loading full image details:', error);
    } finally {
      setLoadingNerdsTab(false);
    }
  };

  const handleTabSwitch = (tabName) => {
    console.log('Tab clicked:', tabName);
    setActiveTab(tabName);
    
    // Lazy load full details ONLY when "For Nerds" tab is clicked
    if (tabName === 'nerds' && selectedImage) {
      loadFullImageDetails(selectedImage.id);
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
          onClose={() => {
            setSelectedImage(null);
            setActiveTab('noobs');
          }}
          className="max-w-5xl"
        >
          {selectedImage && (
            <div>
              {/* Image */}
              <div className="mb-4">
                <img
                  src={selectedImage.imgbbUrl || selectedImage.pixvidUrl}
                  alt={selectedImage.pageTitle}
                  className="w-full rounded-lg"
                />
              </div>

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
                  {/* Title and Description */}
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-2">
                      {selectedImage.pageTitle || 'Untitled'}
                    </h3>
                    {selectedImage.description && (
                      <p className="text-slate-300">{selectedImage.description}</p>
                    )}
                    {!selectedImage.description && (
                      <p className="text-slate-500 italic">No description</p>
                    )}
                  </div>

                  {/* Tags */}
                  {selectedImage.tags && selectedImage.tags.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-2">Tags</h4>
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
                    </div>
                  )}

                  {/* Source Display */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-2">Displaying from</h4>
                    <div className="flex items-center gap-2">
                      {selectedImage.imgbbUrl && (
                        <span className="px-3 py-1 rounded bg-green-500/20 text-green-300 font-semibold">
                          ImgBB
                        </span>
                      )}
                      {!selectedImage.imgbbUrl && (
                        <span className="px-3 py-1 rounded bg-blue-500/20 text-blue-300 font-semibold">
                          Pixvid
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Image URLs */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-2">Pixvid URL</h4>
                      <div className="bg-white/5 rounded p-3">
                        <a
                          href={selectedImage.pixvidUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-200 break-all font-mono text-xs"
                        >
                          {selectedImage.pixvidUrl}
                        </a>
                      </div>
                    </div>

                    {selectedImage.imgbbUrl && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-300 mb-2">ImgBB URL</h4>
                        <div className="bg-white/5 rounded p-3">
                          <a
                            href={selectedImage.imgbbUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-300 hover:text-green-200 break-all font-mono text-xs"
                          >
                            {selectedImage.imgbbUrl}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Download Buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="glass"
                      size="sm"
                      onClick={() => window.open(selectedImage.pixvidUrl, '_blank')}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download from Pixvid
                    </Button>
                    {selectedImage.imgbbUrl && (
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={() => window.open(selectedImage.imgbbUrl, '_blank')}
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
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">File Type</h4>
                          <p className="text-white font-mono text-xs">
                            {fullImageDetails?.fileType || loadingNerdsTab ? 'Loading...' : 'N/A'}
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
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Created</h4>
                          <p className="text-white font-mono text-xs">
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
                          </p>
                        </div>
                      </div>

                      {/* URLs Section */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Source Image URL</h4>
                          <div className="bg-white/5 rounded p-2">
                            <a
                              href={selectedImage.sourceImageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-300 hover:text-primary-200 break-all font-mono text-xs"
                            >
                              {selectedImage.sourceImageUrl || 'N/A'}
                            </a>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Source Page URL</h4>
                          <div className="bg-white/5 rounded p-2">
                            <a
                              href={selectedImage.sourcePageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-300 hover:text-primary-200 break-all font-mono text-xs"
                            >
                              {selectedImage.sourcePageUrl || 'N/A'}
                            </a>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 mb-1">Pixvid URL</h4>
                          <div className="bg-white/5 rounded p-2">
                            <a
                              href={selectedImage.pixvidUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-300 hover:text-blue-200 break-all font-mono text-xs"
                            >
                              {selectedImage.pixvidUrl}
                            </a>
                          </div>
                        </div>
                        {selectedImage.imgbbUrl && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-400 mb-1">ImgBB URL</h4>
                            <div className="bg-white/5 rounded p-2">
                              <a
                                href={selectedImage.imgbbUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-green-300 hover:text-green-200 break-all font-mono text-xs"
                              >
                                {selectedImage.imgbbUrl}
                              </a>
                            </div>
                          </div>
                        )}
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
              <div className="flex gap-2 pt-4 border-t border-white/10 mt-4">
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => window.open(selectedImage.sourcePageUrl, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Source Page
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
