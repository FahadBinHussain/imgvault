import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Upload, Search, Trash2, Settings, FolderOpen, Image, Cable, FileText, Menu } from 'lucide-react';
import ThemeToggleButton from './ThemeToggleButton';

const CSS = `
.iv-nav{font-family:'Outfit',system-ui,sans-serif;position:fixed;top:0;left:0;right:0;z-index:50;width:100%}
.iv-nav-bar{border-bottom:1px solid var(--color-base-300);background:var(--color-base-200);backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);position:relative}

.iv-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--color-base-300);background:var(--color-base-100);color:var(--color-base-content);opacity:.6;cursor:pointer;transition:all .15s ease;position:relative;font-family:inherit}
.iv-icon-btn:hover{opacity:1;background:var(--color-base-200)}
.iv-icon-btn-on{opacity:1!important;color:var(--color-primary)!important;background:oklch(from var(--color-primary) l c h / 0.08)!important;border-color:oklch(from var(--color-primary) l c h / 0.15)!important}

.iv-nav-search{position:relative;flex:1;max-width:380px}
.iv-nav-search input{width:100%;height:32px;padding:0 12px 0 32px;font-size:13px;font-family:'Outfit',system-ui,sans-serif;color:var(--color-base-content);background:var(--color-base-100);border:1px solid var(--color-base-300);border-radius:9px;outline:none;transition:all .2s ease}
.iv-nav-search input:focus{border-color:var(--color-primary);box-shadow:0 0 0 2px oklch(from var(--color-primary) l c h / 0.1)}
.iv-nav-search input::placeholder{opacity:.35}
.iv-nav-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.35;pointer-events:none}

.iv-select-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:9px;font-size:12px;font-weight:500;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:1px solid transparent;background:transparent;color:var(--color-base-content);opacity:.6}
.iv-select-btn:hover{opacity:1;background:var(--color-base-200)}
.iv-select-btn-on{opacity:1!important;color:var(--color-primary)!important;background:oklch(from var(--color-primary) l c h / 0.08)!important;border-color:oklch(from var(--color-primary) l c h / 0.15)!important}

.iv-upload-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:9px;font-size:12px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;color:var(--color-primary-content);background:var(--color-primary);border:none;cursor:pointer;transition:all .2s ease;box-shadow:0 2px 12px oklch(from var(--color-primary) l c h / 0.3);position:relative;overflow:hidden}
.iv-upload-btn:hover{transform:translateY(-1px);box-shadow:0 4px 18px oklch(from var(--color-primary) l c h / 0.4);filter:brightness(1.1)}
.iv-upload-btn:active{transform:translateY(0) scale(.97)}
.iv-upload-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,hsl(0 0% 100%/.1),transparent);transform:translateX(-100%);animation:iv-shimmer 3s infinite}
@keyframes iv-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

.iv-empty-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:9px;font-size:12px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.08);border:1px solid oklch(from var(--color-error) l c h / 0.15);cursor:pointer;transition:all .15s ease}
.iv-empty-btn:hover{background:oklch(from var(--color-error) l c h / 0.12);border-color:oklch(from var(--color-error) l c h / 0.25)}

.iv-badge{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:'Outfit',system-ui,sans-serif;border-radius:6px;line-height:1}
.iv-badge-count{color:var(--color-base-content);opacity:.7;background:var(--color-base-300);border:1px solid var(--color-base-300)}
.iv-badge-error{color:#fff;background:var(--color-error)}

.iv-divider{width:1px;height:16px;background:var(--color-base-300);margin:0 4px}

.iv-title{font-size:13px;font-weight:600;color:var(--color-base-content);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.iv-subtitle{font-size:11px;color:var(--color-base-content);opacity:.4;line-height:1.2;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.iv-sel-bar{display:flex;align-items:center;justify-content:space-between;padding-top:8px;margin-top:8px;border-top:1px solid var(--color-base-300)}
.iv-sel-info{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-base-content);opacity:.5}
.iv-sel-link{font-size:12px;color:var(--color-primary);cursor:pointer;background:none;border:none;font-family:inherit;transition:opacity .15s}
.iv-sel-link:hover{opacity:.75}
.iv-sel-del{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border-radius:7px;font-size:11px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;color:#fff;background:var(--color-error);border:none;cursor:pointer;transition:all .15s ease}
.iv-sel-del:hover{filter:brightness(1.1)}
.iv-sel-del:disabled{opacity:.5;cursor:not-allowed}
`;

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
  isLogsPage = false,
  onEmptyTrash,
}) {
  const navRef = useRef(null);
  const visibleCount = Number.isFinite(displayCount)
    ? displayCount
    : (Array.isArray(filteredImages) ? filteredImages.length : (Array.isArray(images) ? images.length : 0));
  const itemsForBreakdown = Array.isArray(filteredImages) ? filteredImages : (Array.isArray(images) ? images : []);
  const breakdown = itemsForBreakdown.reduce((acc, item) => {
    if (item?.isLink) acc.links += 1;
    else if (item?.isVideo) acc.videos += 1;
    else acc.images += 1;
    return acc;
  }, { images: 0, videos: 0, links: 0 });
  const breakdownParts = [
    `${visibleCount} item${visibleCount !== 1 ? 's' : ''}`,
    `${breakdown.images} image${breakdown.images !== 1 ? 's' : ''}`,
    `${breakdown.videos} video${breakdown.videos !== 1 ? 's' : ''}`,
    `${breakdown.links} link${breakdown.links !== 1 ? 's' : ''}`,
  ];
  const pageTitle = collectionId && currentCollection
    ? currentCollection.name
    : isSettingsPage ? 'Settings'
    : isTrashPage ? 'Trash'
    : isHostPage ? 'Native Host'
    : isLogsPage ? 'Logs'
    : 'ImgVault';
  const pageSubtitle = collectionId && currentCollection
    ? 'Collection'
    : isSettingsPage ? 'Configuration'
    : isHostPage ? 'Native host controls'
    : isLogsPage ? 'Upload & host history'
    : isTrashPage ? `${visibleCount} item${visibleCount !== 1 ? 's' : ''}`
    : breakdownParts.join(' · ');

  useEffect(() => {
    if (!navRef.current || !onHeightChange) return;
    const update = () => onHeightChange(navRef.current?.offsetHeight || 0);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(navRef.current);
    return () => obs.disconnect();
  }, [onHeightChange, selectionMode]);

  const showSearch = !isSettingsPage && !isHostPage && !isLogsPage;
  const showActions = !isSettingsPage && !isHostPage && !isLogsPage;
  const isSubPage = isTrashPage || isSettingsPage || isHostPage || isLogsPage;

  return (
    <div ref={navRef} className="iv-nav">
      <style>{CSS}</style>
      <div className="iv-nav-bar" style={{ position: 'relative' }}>
        <div style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            {/* Left: Logo / Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {collectionId && currentCollection ? (
                <>
                  <button onClick={() => navigate('/gallery')} className="iv-icon-btn" title="Back to All Images">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <FolderOpen style={{ width: 14, height: 14, color: 'oklch(from var(--color-base-content) l c h / 0.4)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="iv-title">{pageTitle}</div>
                      <div className="iv-subtitle">{pageSubtitle}</div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <img src="/icons/1.png" alt="ImgVault" style={{ width: 22, height: 22, borderRadius: 6 }} />
                  <div style={{ minWidth: 0 }} className="hidden sm:block">
                    <div className="iv-title">{pageTitle}</div>
                    <div className="iv-subtitle">{pageSubtitle}</div>
                  </div>
                </>
              )}
            </div>

            {/* Center: Search */}
            {showSearch && (
              <div className="iv-nav-search hidden md:block">
                <Search className="iv-nav-search-icon" style={{ width: 14, height: 14 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                />
              </div>
            )}

            {/* Right: Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ThemeToggleButton />

              {showActions && (
                <button onClick={reload} className="iv-icon-btn" title="Refresh">
                  <RefreshCw style={{ width: 14, height: 14 }} />
                </button>
              )}

              {showActions && (
                <button
                  onClick={toggleSelectionMode}
                  className={`iv-select-btn ${selectionMode ? 'iv-select-btn-on' : ''}`}
                  title={selectionMode ? 'Exit Selection' : 'Select'}
                >
                  <span className="hidden sm:inline">{selectionMode ? 'Cancel' : 'Select'}</span>
                </button>
              )}

              {!isTrashPage && (
                <button onClick={() => navigate('/collections')} className="iv-icon-btn" title="Collections" style={{ position: 'relative' }}>
                  <FolderOpen style={{ width: 14, height: 14 }} />
                  {!collectionsLoading && collections.length > 0 && (
                    <span className="iv-badge iv-badge-count">{collections.length}</span>
                  )}
                </button>
              )}

              <button onClick={() => navigate('/host')} className={`iv-icon-btn ${isHostPage ? 'iv-icon-btn-on' : ''}`} title="Native Host">
                <Cable style={{ width: 14, height: 14 }} />
              </button>

              <button onClick={() => navigate('/logs')} className={`iv-icon-btn ${isLogsPage ? 'iv-icon-btn-on' : ''}`} title="Logs">
                <FileText style={{ width: 14, height: 14 }} />
              </button>

              <button onClick={() => navigate('/settings')} className={`iv-icon-btn ${isSettingsPage ? 'iv-icon-btn-on' : ''}`} title="Settings">
                <Settings style={{ width: 14, height: 14 }} />
              </button>

              {isSubPage ? (
                <button onClick={() => navigate('/gallery')} className="iv-icon-btn" title="Gallery">
                  <Image style={{ width: 14, height: 14 }} />
                </button>
              ) : (
                <button onClick={() => navigate('/trash')} className="iv-icon-btn" title="Trash" style={{ position: 'relative' }}>
                  <Trash2 style={{ width: 14, height: 14 }} />
                  {!trashLoading && trashedImages.length > 0 && (
                    <span className="iv-badge iv-badge-error">{trashedImages.length}</span>
                  )}
                </button>
              )}

              {isTrashPage && typeof onEmptyTrash === 'function' && images.length > 0 && (
                <button onClick={onEmptyTrash} className="iv-empty-btn" title="Empty Trash">
                  <span className="hidden sm:inline">Empty</span>
                  <span className="sm:hidden"><Trash2 style={{ width: 13, height: 13 }} /></span>
                </button>
              )}

              {showActions && <div className="iv-divider" />}

              {showActions && (
                <button onClick={openUploadModal} className="iv-upload-btn">
                  <Upload style={{ width: 13, height: 13 }} />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile search */}
          {showSearch && (
            <div className="mt-2 md:hidden">
              <div className="iv-nav-search" style={{ maxWidth: '100%' }}>
                <Search className="iv-nav-search-icon" style={{ width: 14, height: 14 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isTrashPage ? 'Search trash...' : 'Search images...'}
                />
              </div>
            </div>
          )}

          {/* Selection mode bar */}
          {selectionMode && showActions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="iv-sel-bar"
            >
              <div className="iv-sel-info">
                <span>{selectedImages.size} selected</span>
                <button onClick={selectAll} className="iv-sel-link">All ({filteredImages.length})</button>
                {selectedImages.size > 0 && (
                  <button onClick={deselectAll} className="iv-sel-link" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.4)' }}>None</button>
                )}
              </div>
              {selectedImages.size > 0 && (
                <button onClick={() => setShowBulkDeleteConfirm(true)} disabled={isDeleting} className="iv-sel-del">
                  Delete
                </button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
