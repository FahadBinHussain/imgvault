import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Upload, Search, Trash2, Settings, FolderOpen, Image, Cable } from 'lucide-react';
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
  isHostPage = false,
  onEmptyTrash,
}) {
  const navRef = useRef(null);
  const iconButtonClass = 'btn btn-ghost btn-sm border border-transparent text-base-content/70 hover:text-base-content';
  const activeIconButtonClass = 'btn btn-sm border border-primary/20 bg-primary/12 text-primary';
  const visibleCount = Number.isFinite(displayCount)
    ? displayCount
    : (Array.isArray(filteredImages) ? filteredImages.length : (Array.isArray(images) ? images.length : 0));
  const pageTitle = collectionId && currentCollection
    ? currentCollection.name
    : isSettingsPage
      ? 'ImgVault Settings'
      : isTrashPage
        ? 'ImgVault Trash'
        : isHostPage
          ? 'ImgVault Host'
          : 'ImgVault';
  const pageSubtitle = collectionId && currentCollection
    ? 'Collection view'
    : isSettingsPage
      ? 'Configuration'
      : isHostPage
        ? 'Native host controls'
        : `${visibleCount} ${isTrashPage ? 'item' : 'image'}${visibleCount !== 1 ? 's' : ''}`;

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
      <div className="border-b border-base-content/10 bg-base-200/92 backdrop-blur-xl shadow-sm">
        <div className="px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Logo/Title */}
            <div className="flex items-center gap-3 min-w-0">
              {collectionId && currentCollection ? (
                <>
                  <button
                    onClick={() => navigate('/gallery')}
                    className="btn btn-ghost btn-sm text-base-content/70 hover:text-base-content"
                    title="Back to All Images"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="w-4 h-4 text-base-content/60 flex-shrink-0" />
                    <div className="min-w-0">
                      <h1 className="text-sm font-semibold text-base-content truncate">{pageTitle}</h1>
                      <p className="text-xs text-base-content/60 truncate">{pageSubtitle}</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <img src="/icons/icon48.png" alt="ImgVault" className="w-6 h-6 rounded" />
                  <div className="min-w-0 hidden sm:block">
                    <h1 className="text-sm font-semibold text-base-content truncate">{pageTitle}</h1>
                    <p className="text-xs text-base-content/60 truncate">{pageSubtitle}</p>
                  </div>
                </>
              )}
            </div>

            {/* Center: Search */}
            {!isSettingsPage && !isHostPage && (
              <div className="flex-1 max-w-md hidden md:block">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                  className="input input-sm w-full pl-8 pr-3 bg-base-100/70 border border-base-content/20 text-sm text-base-content placeholder-base-content/50 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-colors"
                />
              </div>
              </div>
            )}

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
              <ThemeToggleButton />

              {!isSettingsPage && !isHostPage && (
                <button
                  onClick={reload}
                  className={iconButtonClass}
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}

              {!isSettingsPage && !isHostPage && (
                <button
                  onClick={toggleSelectionMode}
                  className={`border transition-colors flex items-center gap-1.5 text-sm px-2 py-1.5 rounded-md ${
                    selectionMode
                      ? 'border-primary/20 bg-primary/12 text-primary'
                      : 'border-transparent hover:bg-base-content/10 text-base-content/70 hover:text-base-content'
                  }`}
                  title={selectionMode ? 'Exit Selection Mode' : 'Enter Selection Mode'}
                >
                  <span className="hidden sm:inline text-xs">{selectionMode ? 'Cancel' : 'Select'}</span>
                </button>
              )}

              {!isTrashPage && (
                <button
                  onClick={() => navigate('/collections')}
                  className={`${iconButtonClass} relative`}
                  title="Collections"
                >
                  <FolderOpen className="w-4 h-4" />
                  {!collectionsLoading && collections.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 badge badge-sm bg-base-300 text-base-content min-w-[14px] h-3.5 px-1">
                      {collections.length}
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => navigate('/host')}
                className={isHostPage ? activeIconButtonClass : iconButtonClass}
                title="Native Host"
              >
                <Cable className="w-4 h-4" />
              </button>

              <button
                onClick={() => navigate('/settings')}
                className={isSettingsPage ? activeIconButtonClass : iconButtonClass}
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>

              {(isTrashPage || isSettingsPage || isHostPage) ? (
                <button
                  onClick={() => navigate('/gallery')}
                  className={iconButtonClass}
                  title="Gallery"
                >
                  <Image className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => navigate('/trash')}
                  className={`${isTrashPage ? activeIconButtonClass : iconButtonClass} relative`}
                  title="Trash"
                >
                  <Trash2 className="w-4 h-4" />
                  {!trashLoading && trashedImages.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 badge badge-sm bg-error min-w-[14px] h-3.5 px-1">
                      {trashedImages.length}
                    </span>
                  )}
                </button>
              )}

              {isTrashPage && typeof onEmptyTrash === 'function' && images.length > 0 && (
                <button
                  onClick={onEmptyTrash}
                  className="btn btn-error btn-sm text-sm font-medium"
                  title="Empty Trash"
                >
                  <span className="hidden sm:inline">Empty</span>
                  <span className="sm:hidden">🗑️</span>
                </button>
              )}

              {!isTrashPage && !isSettingsPage && !isHostPage && <div className="w-px h-4 bg-base-content/20 mx-1"></div>}

              {!isTrashPage && !isSettingsPage && !isHostPage && (
                <button
                  onClick={openUploadModal}
                  className="btn btn-primary btn-sm text-sm font-medium flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile search */}
          {!isSettingsPage && !isHostPage && (
            <div className="mt-2 md:hidden">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                className="input input-sm w-full pl-8 pr-3 bg-base-100/70 border border-base-content/20 text-sm text-base-content placeholder-base-content/50 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-colors"
              />
            </div>
            </div>
          )}

          {selectionMode && !isSettingsPage && !isHostPage && (
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
                    className="btn btn-error btn-xs disabled:opacity-50"
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
