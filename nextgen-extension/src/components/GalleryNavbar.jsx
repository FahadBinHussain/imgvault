import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Upload, Search, Trash2, Settings, FolderOpen, Image } from 'lucide-react';
import ThemeToggleButton from './ThemeToggleButton';

export default function GalleryNavbar({
  collectionId,
  currentCollection,
  navigate,
  images,
  defaultGallerySource,
  reload,
  toggleSelectionMode,
  selectionMode,
  collectionsLoading,
  collections,
  trashLoading,
  trashedImages,
  openUploadModal,
  searchQuery,
  setSearchQuery,
  selectedImages,
  selectAll,
  filteredImages,
  displayCount,
  deselectAll,
  setShowBulkDeleteConfirm,
  isDeleting,
  onHeightChange,
  isTrashPage = false,
  isSettingsPage = false,
  onEmptyTrash,
}) {
  const navRef = useRef(null);
  const visibleCount = Number.isFinite(displayCount)
    ? displayCount
    : (Array.isArray(filteredImages) ? filteredImages.length : (Array.isArray(images) ? images.length : 0));

  useEffect(() => {
    if (!navRef.current || !onHeightChange) return;

    const updateHeight = () => {
      onHeightChange(navRef.current?.offsetHeight || 0);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(navRef.current);

    return () => observer.disconnect();
  }, [onHeightChange, selectionMode]);

  return (
    <div ref={navRef} className="fixed top-0 left-0 right-0 z-50 w-full">
      <div className="bg-base-200/95 backdrop-blur-sm border-b border-base-content/10">
        <div className="px-4 sm:px-6 py-2.5">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Logo/Title */}
            <div className="flex items-center gap-3 min-w-0">
              {collectionId && currentCollection ? (
                <>
                  <button
                    onClick={() => navigate('/gallery')}
                    className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content"
                    title="Back to All Images"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="w-4 h-4 text-base-content/60 flex-shrink-0" />
                    <h1 className="text-sm font-medium text-base-content truncate">{currentCollection.name}</h1>
                  </div>
                </>
              ) : (
                <>
                  <img src="/icons/icon48.png" alt="ImgVault" className="w-6 h-6 rounded" />
                  <div className="min-w-0 hidden sm:block">
                    <h1 className="text-sm font-medium text-base-content truncate">
                      {isSettingsPage ? 'ImgVault Settings' : isTrashPage ? 'ImgVault Trash' : 'ImgVault'}
                    </h1>
                    <p className="text-xs text-base-content/60 truncate">
                      {isSettingsPage
                        ? 'Configuration'
                        : `${visibleCount} ${isTrashPage ? 'item' : 'image'}${visibleCount !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Center: Search */}
            {!isSettingsPage && (
              <div className="flex-1 max-w-md hidden md:block">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md bg-base-100/70 border border-base-content/20 text-sm text-base-content placeholder-base-content/50 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-colors"
                />
              </div>
              </div>
            )}

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
              <ThemeToggleButton />

              {!isSettingsPage && (
                <button
                  onClick={reload}
                  className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}

              {!isSettingsPage && (
                <button
                  onClick={toggleSelectionMode}
                  className={`p-1.5 rounded-md transition-colors flex items-center gap-1.5 text-sm ${
                    selectionMode
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'hover:bg-base-content/10 text-base-content/70 hover:text-base-content'
                  }`}
                  title={selectionMode ? 'Exit Selection Mode' : 'Enter Selection Mode'}
                >
                  <span className="hidden sm:inline text-xs">{selectionMode ? 'Cancel' : 'Select'}</span>
                </button>
              )}

              {!isTrashPage && !isSettingsPage && (
                <button
                  onClick={() => navigate('/collections')}
                  className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content relative"
                  title="Collections"
                >
                  <FolderOpen className="w-4 h-4" />
                  {!collectionsLoading && collections.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-base-300 text-base-content text-[10px] font-medium rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1">
                      {collections.length}
                    </span>
                  )}
                </button>
              )}

              {!isSettingsPage && (
                <button
                  onClick={() => navigate('/settings')}
                  className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}

              {(isTrashPage || isSettingsPage) ? (
                <button
                  onClick={() => navigate('/gallery')}
                  className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content"
                  title="Gallery"
                >
                  <Image className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => navigate('/trash')}
                  className="p-1.5 rounded-md hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content relative"
                  title="Trash"
                >
                  <Trash2 className="w-4 h-4" />
                  {!trashLoading && trashedImages.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500/90 text-white text-[10px] font-medium rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1">
                      {trashedImages.length}
                    </span>
                  )}
                </button>
              )}

              {isTrashPage && typeof onEmptyTrash === 'function' && images.length > 0 && (
                <button
                  onClick={onEmptyTrash}
                  className="px-2.5 py-1.5 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                  title="Empty Trash"
                >
                  <span className="hidden sm:inline">Empty</span>
                  <span className="sm:hidden">🗑️</span>
                </button>
              )}

              {!isTrashPage && !isSettingsPage && <div className="w-px h-4 bg-base-content/20 mx-1"></div>}

              {!isTrashPage && !isSettingsPage && (
                <button
                  onClick={openUploadModal}
                  className="px-2.5 py-1.5 rounded-md bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile search */}
          {!isSettingsPage && (
            <div className="mt-2 md:hidden">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                className="w-full pl-8 pr-3 py-1.5 rounded-md bg-base-100/70 border border-base-content/20 text-sm text-base-content placeholder-base-content/50 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-colors"
              />
            </div>
            </div>
          )}

          {selectionMode && !isSettingsPage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 pt-2 border-t border-base-content/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-base-content/70">{selectedImages.size} selected</span>
                  <button
                    onClick={selectAll}
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    All ({filteredImages.length})
                  </button>
                  {selectedImages.size > 0 && (
                    <button
                      onClick={deselectAll}
                      className="text-xs text-base-content/70 hover:text-base-content transition-colors"
                    >
                      None
                    </button>
                  )}
                </div>
                {selectedImages.size > 0 && (
                  <button
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="px-2 py-1 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
