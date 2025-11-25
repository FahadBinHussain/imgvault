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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="glass-card rounded-2xl p-8 mb-8 backdrop-blur-xl bg-white/10 border border-white/20 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl blur-lg opacity-50"></div>
                <img src="/icons/icon48.png" alt="ImgVault" className="w-12 h-12 relative z-10" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent">
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
                         transition-all hover:scale-105 active:scale-95"
                title="Refresh"
              >
                <RefreshCw className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => chrome.tabs.create({ url: 'popup.html' })}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                         text-white font-semibold shadow-lg hover:shadow-xl hover:scale-105 
                         active:scale-95 transition-all flex items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition-opacity"></div>
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, description, or tags..."
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-white/10 border border-white/20 
                         text-white placeholder-slate-400 focus:outline-none focus:border-primary-300 
                         focus:bg-white/15 transition-all"
              />
            </div>
          </div>
        </div>

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
          <div className="glass-card rounded-2xl backdrop-blur-xl bg-white/10 border border-white/20 
                        shadow-2xl p-16 text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl opacity-30"></div>
              <div className="text-8xl relative z-10">🖼️</div>
            </div>
            <h3 className="text-3xl font-bold text-white mb-3">Your Vault is Empty</h3>
            <p className="text-slate-300 text-lg mb-8 max-w-md mx-auto">
              Start building your collection by uploading your first image
            </p>
            <button
              onClick={() => chrome.tabs.create({ url: 'popup.html' })}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       text-white font-semibold text-lg shadow-lg hover:shadow-2xl 
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {groupedImages[date].map(img => (
                <div
                  key={img.id}
                  className="group relative aspect-square rounded-2xl overflow-hidden cursor-pointer
                           transform transition-all duration-300 hover:scale-105 hover:-translate-y-2"
                  onClick={() => {
                    setSelectedImage(img);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                  }}
                >
                  {/* Glow effect */}
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-500 to-secondary-500 
                                rounded-2xl opacity-0 group-hover:opacity-75 blur transition-opacity"></div>
                  
                  {/* Card */}
                  <div className="relative h-full bg-slate-800 border border-white/10 rounded-2xl overflow-hidden">
                    <img
                      src={img.imgbbUrl || img.pixvidUrl}
                      alt={img.pageTitle}
                      className="w-full h-full object-cover transition-transform duration-500 
                               group-hover:scale-110"
                      loading="lazy"
                    />
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2">
                        <p className="text-white text-sm font-semibold truncate drop-shadow-lg">
                          {img.pageTitle || 'Untitled'}
                        </p>
                        {img.tags && img.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {img.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm 
                                         text-white border border-white/30 font-medium"
                              >
                                {tag}
                              </span>
                            ))}
                            {img.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm 
                                             text-white border border-white/30 font-medium">
                                +{img.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Floating badge */}
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 
                                  transition-all duration-300 transform group-hover:scale-100 scale-90">
                      <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md 
                                    flex items-center justify-center border border-white/30">
                        <ExternalLink className="w-5 h-5 text-white" />
                      </div>
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
            setFullImageDetails(null);
          }}
          className="!max-w-7xl !w-full !h-[90vh] !p-0 !overflow-hidden"
        >
          {selectedImage && (
            <div className="flex h-full">
              {/* LEFT SIDE - IMAGE */}
              <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-8 relative">
                {/* Radial glow effect */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              w-4/5 h-4/5 bg-primary-500/10 rounded-full blur-3xl"></div>
                
                <img
                  src={selectedImage.imgbbUrl || selectedImage.pixvidUrl}
                  alt={selectedImage.pageTitle}
                  className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl relative z-10
                           transition-transform hover:scale-[1.02]"
                />
              </div>

              {/* RIGHT SIDE - DETAILS */}
              <div className="w-[450px] flex-shrink-0 bg-slate-800/90 backdrop-blur-xl border-l border-white/10 
                            overflow-y-auto flex flex-col"
                   style={{ scrollbarWidth: 'thin', scrollbarColor: '#6366f1 #1e293b' }}
              >
                <div className="p-6 flex-1">
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
                      <div className="text-xs font-semibold text-slate-400 mb-1">Source URL</div>
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
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-400 mb-1">Page URL</div>
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
                              className="px-3 py-1 rounded-full bg-primary-500/20 text-primary-200 text-sm"
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

                  {/* Download Buttons */}
                  <div className="flex gap-2 pt-4 border-t border-white/10">
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
                <div className="flex gap-2 pt-4 border-t border-white/10 mt-6">
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
