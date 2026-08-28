/**
 * @fileoverview Trash Page Component
 * @version 2.0.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Undo2, Trash2, AlertTriangle,
  FileText, Calendar, Link2,
  File, Image as ImageIcon, Hash, Fingerprint, Video
} from 'lucide-react';
import { Button, IconButton, Card, Modal, Spinner, Toast } from '../components/UI';
import { useTrash, useChromeStorage } from '../hooks/useChromeExtension';
import { useKeyboardShortcuts, SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import TimelineScrollbar from '../components/TimelineScrollbar';
import PremiumBackground from '../components/PremiumBackground';
import GalleryNavbar from '../components/GalleryNavbar';
import { getPreferredVideoProviderLink } from '../utils/videoProviderLinks';
import { getPreferredImageProviderLink } from '../utils/imageProviderLinks';
import {
  getMediaItemKind,
  getOverviewEntries,
  getTechnicalMetadataEntries,
} from '@shared/mediaFieldRegistry.js';
import MediaDetailModal from '../components/MediaDetailModal';

export default function TrashPage() {
  const navigate = useNavigate();
  const { trashedImages, loading, reload, restoreFromTrash, permanentlyDelete, emptyTrash } = useTrash();
  const [defaultVideoSource] = useChromeStorage('defaultVideoSource', 'filemoon', 'sync');
  const [selectedImage, setSelectedImage] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [toast, setToast] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadedImages, setLoadedImages] = useState(new Set());
  const [activeTab, setActiveTab] = useState('noobs'); // 'noobs' or 'nerds'
  const [fullImageDetails, setFullImageDetails] = useState(null);
  const [loadingNerdsTab, setLoadingNerdsTab] = useState(false);
  const [editingCreationDate, setEditingCreationDate] = useState(false);
  const [editedCreationDate, setEditedCreationDate] = useState('');

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [showBulkRestoreConfirm, setShowBulkRestoreConfirm] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [failedImages, setFailedImages] = useState(new Set());
  const [modalImageFailed, setModalImageFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [navbarHeight, setNavbarHeight] = useState(0);

  // Timeline scrollbar refs
  const pageContainerRef = useRef(null);
  const dateGroupRefs = useRef({});
  const [timelineData, setTimelineData] = useState([]);

  // Lazy load full image details when nerds tab is clicked
  const loadFullImageDetails = async (imageId) => {
    console.log('[TRASH] loadFullImageDetails called for ID:', imageId);
    
    if (fullImageDetails?.id === imageId) {
      console.log('[TRASH] Cache hit - details already loaded');
      return;
    }

    console.log('[TRASH] Cache miss - fetching details from backend');
    setLoadingNerdsTab(true);
    
    try {
      console.log('[TRASH] Sending getTrashedImageById request...');
      const response = await chrome.runtime.sendMessage({
        action: 'getTrashedImageById',
        data: { id: imageId }
      });

      console.log('[TRASH] Response received:', response.success ? 'SUCCESS' : 'FAILED');
      console.log('[TRASH] Response data:', response.data);
      console.log('[TRASH] Full response:', response);

      if (response.success && response.data) {
        console.log('[TRASH] Full image details loaded:', {
          id: response.data.id,
          fileName: response.data.fileName,
          fileType: response.data.fileType,
          fileSize: response.data.fileSize,
          width: response.data.width,
          height: response.data.height,
          sha256: response.data.sha256 ? 'present' : 'missing',
          pHash: response.data.pHash ? 'present' : 'missing',
          aHash: response.data.aHash ? 'present' : 'missing',
          dHash: response.data.dHash ? 'present' : 'missing'
        });
        setFullImageDetails(response.data);
      } else {
        console.error('[TRASH] Failed to load details - response:', response);
      }
    } catch (error) {
      console.error('[TRASH] Exception while loading full image details:', error);
    } finally {
      setLoadingNerdsTab(false);
    }
  };

  const handleTabSwitch = (tabName) => {
    console.log('[TRASH TAB SWITCH] Switching to:', tabName);
    console.log('[TRASH TAB SWITCH] Selected image:', selectedImage?.id);
    console.log('[TRASH TAB SWITCH] Current fullImageDetails:', fullImageDetails?.id);
    
    setActiveTab(tabName);
    
    // Lazy load full details ONLY when "For Nerds" tab is clicked
    if (tabName === 'nerds' && selectedImage) {
      console.log('[TRASH TAB SWITCH] Nerds tab clicked - loading full details');
      // Force immediate load
      setTimeout(() => loadFullImageDetails(selectedImage.id), 0);
    } else if (tabName === 'noobs') {
      console.log('[TRASH TAB SWITCH] Noobs tab clicked - no loading needed');
    }
  };

  const handleImageLoad = (imageId, failed = false) => {
    if (failed) {
      setFailedImages(prev => new Set(prev).add(imageId));
    }
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

  // Graceful fallback: if a trashed item's hosted source was removed (or the
  // host hangs), the browser may never fire onLoad/onError for its image. Stop
  // the infinite shimmer after a grace period so the card resolves instead of
  // loading forever.
  useEffect(() => {
    if (loading || trashedImages.length === 0) return;
    const timers = trashedImages.map(image => setTimeout(() => {
      setLoadedImages(prev => {
        if (prev.has(image.id)) return prev;
        return new Set(prev).add(image.id);
      });
    }, 12000));
    return () => timers.forEach(clearTimeout);
  }, [loading, trashedImages]);

  // Toggle selection mode
  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedImages(new Set()); // Clear selections when toggling
  };

  // Toggle image selection
  const toggleImageSelection = (imageId, e) => {
    e.stopPropagation();
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    setSelectedImages(newSelected);
  };

  // Select all images
  const selectAll = () => {
    const allIds = new Set(filteredTrashedImages.map(img => img.id));
    setSelectedImages(allIds);
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedImages(new Set());
  };

  // Bulk restore selected images
  const handleBulkRestore = async () => {
    if (selectedImages.size === 0) return;
    
    setShowBulkRestoreConfirm(false);
    setIsProcessing(true);
    
    try {
      showToast(`♻️ Restoring ${selectedImages.size} item${selectedImages.size > 1 ? 's' : ''}...`, 'info', 0);
      
      const restorePromises = Array.from(selectedImages).map(id => restoreFromTrash(id));
      await Promise.all(restorePromises);
      
      showToast(`✅ ${selectedImages.size} item${selectedImages.size > 1 ? 's' : ''} restored successfully!`, 'success', 3000);
      setSelectedImages(new Set());
      setSelectionMode(false);
    } catch (error) {
      console.error('Bulk restore failed:', error);
      showToast(`❌ ${error.message || 'Failed to restore some items'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  // Bulk delete selected images permanently
  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) return;
    
    setShowBulkDeleteConfirm(false);
    setIsProcessing(true);
    
    try {
      showToast(`🔥 Permanently deleting ${selectedImages.size} item${selectedImages.size > 1 ? 's' : ''} from trash and hosts where possible...`, 'info', 0);
      
      const deletePromises = Array.from(selectedImages).map(id => permanentlyDelete(id));
      await Promise.all(deletePromises);
      
      showToast(`✅ ${selectedImages.size} item${selectedImages.size > 1 ? 's' : ''} permanently deleted!`, 'success', 3000);
      setSelectedImages(new Set());
      setSelectionMode(false);
    } catch (error) {
      console.error('Bulk delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to delete some items'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
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
      showToast('♻️ Restoring item...', 'info', 0);
      await restoreFromTrash(selectedImage.id);
      
      showToast('✅ Item restored successfully!', 'success', 3000);
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
      showToast('🔥 Permanently deleting from trash and hosts where possible...', 'info', 0);
      await permanentlyDelete(selectedImage.id);
      
      showToast('✅ Item permanently deleted!', 'success', 3000);
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

  const handleSaveCreationDate = async () => {
    if (!fullImageDetails || !selectedImage) return;

    const newDate = new Date(editedCreationDate);
    if (isNaN(newDate.getTime())) {
      showToast('❌ Invalid date format', 'error', 3000);
      return;
    }

    setIsProcessing(true);
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'updateTrashedImage',
        data: {
          id: fullImageDetails.id,
          updates: { creationDate: newDate.toISOString() }
        }
      });

      if (response.success) {
        const updatedDetails = { ...fullImageDetails, creationDate: newDate.toISOString() };
        setFullImageDetails(updatedDetails);
        setEditingCreationDate(false);
        showToast('✅ Creation date updated', 'success', 3000);
      } else {
        throw new Error(response.error || 'Failed to update');
      }
    } catch (error) {
      console.error('Failed to update creation date:', error);
      showToast(`❌ ${error.message || 'Failed to update'}`, 'error', 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditingCreationDate = () => {
    if (fullImageDetails?.creationDate) {
      const date = new Date(fullImageDetails.creationDate);
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      setEditedCreationDate(localDate.toISOString().slice(0, 16));
      setEditingCreationDate(true);
    }
  };

  const cancelEditingCreationDate = () => {
    setEditingCreationDate(false);
    setEditedCreationDate('');
  };

  const getImageUrl = (image, useFullSize = false) => {
    const videoUrl = getPreferredVideoProviderLink(image, defaultVideoSource, 'watchUrl');
    // Prefer the full hosted image everywhere; keep thumb as a last fallback.
    if (useFullSize) {
      return videoUrl || getPreferredImageProviderLink(image, 'imgbb', 'url') || image.sourceImageUrl;
    }
    return (
      getPreferredImageProviderLink(image, 'imgbb', 'url') ||
      getPreferredImageProviderLink(image, 'imgbb', 'thumbnailUrl') ||
      image.sourceImageUrl ||
      image.imgbbThumbUrl
    );
  };

  const getVideoDirectUrl = (image) => {
    return getPreferredVideoProviderLink(image, defaultVideoSource, 'directUrl');
  };

  const isLinkItem = (image) => {
    return getMediaItemKind(image) === 'link';
  };

  const getVideoPosterUrl = (image) => {
    const isLikelyVideoUrl = (url) => typeof url === 'string' && /\.(mp4|webm|mov|m4v|mkv|avi|ogv)(?:[?#].*)?$/i.test(url.trim());
    const firstImageLikeUrl = (...urls) => urls.find((url) => typeof url === 'string' && url.trim() && !isLikelyVideoUrl(url)) || '';
    const videoThumb =
      getPreferredVideoProviderLink(image, defaultVideoSource, 'thumbnailUrl') ||
      '';
    return firstImageLikeUrl(
      image?.videoThumbnailUrl,
      image?.linkPreviewImageUrl,
      videoThumb,
      getPreferredImageProviderLink(image, 'imgbb', 'thumbnailUrl'),
      image?.imgbbThumbUrl,
      getPreferredImageProviderLink(image, 'imgbb', 'url')
    );
  };

  // Overview rows for the details panel. Shared resolver surfaces base registry
  // fields plus provider URLs stored only nested (imageHosts / videoHosts /
  // legacy filemoonUrl-udropUrl) so every trashed item shows its URL even when
  // the top-level mirror fields are missing.
  const getOverviewEntriesFor = (item) => getOverviewEntries(item, { extraKeys: ['deletedAt'] });

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

  const filteredTrashedImages = trashedImages.filter((img) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;

    const haystack = [
      img?.pageTitle,
      img?.description,
      img?.sourcePageUrl,
      ...(img?.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });

  const groupedImages = groupImagesByDate(filteredTrashedImages);

  // Build timeline data for scrollbar (grouped by month/year)
  useEffect(() => {
    const dateKeys = Object.keys(groupedImages);
    const monthGroups = {};
    
    // Group dates by month/year
    dateKeys.forEach(dateKey => {
      // Get the first image from this date group to extract the actual date
      const firstImage = groupedImages[dateKey][0];
      if (firstImage && firstImage.deletedAt) {
        const date = new Date(firstImage.deletedAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        
        if (!monthGroups[monthKey]) {
          monthGroups[monthKey] = {
            label: monthLabel,
            element: dateGroupRefs.current[dateKey], // Use first date group in month as anchor
            sortDate: date
          };
        }
      }
    });
    
    // Convert to array and sort by date (newest first)
    const timeline = Object.values(monthGroups)
      .sort((a, b) => b.sortDate - a.sortDate)
      .map(group => ({
        date: group.label,
        label: group.label,
        element: group.element
      }));
    
    setTimelineData(timeline);
  }, [groupedImages]);

  // Keyboard navigation for the detail modal (mirrors gallery)
  const openTrashItemModal = (image) => {
    setModalImageFailed(false);
    setSelectedImage(image);
    setActiveTab('noobs');
    setFullImageDetails(null);
  };

  const navigateToNextImage = () => {
    if (!selectedImage || filteredTrashedImages.length === 0) return;
    const currentIndex = filteredTrashedImages.findIndex((img) => img.id === selectedImage.id);
    if (currentIndex === -1 || currentIndex === filteredTrashedImages.length - 1) return;
    openTrashItemModal(filteredTrashedImages[currentIndex + 1]);
  };

  const navigateToPreviousImage = () => {
    if (!selectedImage || filteredTrashedImages.length === 0) return;
    const currentIndex = filteredTrashedImages.findIndex((img) => img.id === selectedImage.id);
    if (currentIndex <= 0) return;
    openTrashItemModal(filteredTrashedImages[currentIndex - 1]);
  };

  useKeyboardShortcuts({
    [SHORTCUTS.ARROW_RIGHT]: navigateToNextImage,
    [SHORTCUTS.ARROW_LEFT]: navigateToPreviousImage,
    [SHORTCUTS.ESCAPE]: () => {
      if (selectedImage) setSelectedImage(null);
      else if (selectionMode) setSelectionMode(false);
    },
    [SHORTCUTS.DELETE]: () => {
      if (selectedImage && !showDeleteConfirm) setShowDeleteConfirm(true);
    },
  });

  const renderTrashMedia = (item, { isModalAnimating }) => {
    const animCls = isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100';
    if (item.filemoonUrl) {
      return (
        <iframe
          src={item.filemoonUrl}
          className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out ${animCls}`}
          frameBorder="0"
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      );
    }
    if (item.udropUrl) {
      return (
        <video
          src={item.udropUrl}
          controls
          className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out ${animCls}`}
        />
      );
    }
    if (isLinkItem(item)) {
      const previewUrl = item.linkPreviewImageUrl || getImageUrl(item, true);
      return (
        <div className={`w-full max-w-2xl rounded-[var(--radius-box)] shadow-2xl bg-base-100 overflow-hidden relative z-10 transition-all duration-700 ease-out ${animCls}`}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={item.pageTitle || 'Link preview'}
              onError={() => setModalImageFailed(true)}
              className="w-full h-auto max-h-[60vh] object-contain"
            />
          ) : (
            <div className="w-64 h-64 flex flex-col items-center justify-center gap-3 mx-auto">
              <Link2 className="w-16 h-16 text-base-content/40" />
              <span className="text-sm text-base-content/50">No preview available</span>
            </div>
          )}
          {item.linkUrl && (
            <div className="p-4 border-t border-base-300">
              <a
                href={item.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-base-content hover:text-info transition-colors"
              >
                <Link2 className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium truncate">{item.pageTitle || item.linkUrl}</span>
              </a>
            </div>
          )}
        </div>
      );
    }
    return (
      <>
        <img
          src={getImageUrl(item, true)}
          alt={item.pageTitle}
          onError={() => setModalImageFailed(true)}
          className={`max-w-full max-h-full object-contain rounded-[var(--radius-box)] shadow-2xl relative z-10
                   hover:scale-[1.02] hover:shadow-[0_0_80px_rgba(239,68,68,0.3)]
                   transition-all duration-700 ${animCls}`}
        />
        {modalImageFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-base-200/80" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>
            <ImageIcon style={{ width: 56, height: 56 }} />
            <span className="text-sm px-4 py-1.5 rounded-md" style={{ background: 'oklch(from var(--color-base-content) l c h / 0.06)' }}>
              Source removed or unavailable
            </span>
          </div>
        )}
      </>
    );
  };

  const renderTrashOverviewFooter = (
    <div className="mt-4 p-4 bg-warning/10 border border-warning/30 rounded-[var(--radius-box)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-warning mt-0.5 flex-shrink-0" size={18} />
        <div className="text-sm">
          <p className="font-medium text-warning">Item Still Hosted</p>
          <p className="text-base-content/80 mt-1">
            This item remains accessible via its URLs. Use "Delete Permanently" to remove it from all hosts.
          </p>
        </div>
      </div>
    </div>
  );

  const renderTrashTechnicalField = ([key, value], index) => {
    if (key === 'creationDate') {
      return (
        <div key={key}>
          <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
            <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
            <Calendar className="w-3.5 h-3.5" />
            Creation Date
            {!editingCreationDate && (
              <button
                onClick={startEditingCreationDate}
                className="ml-auto text-info hover:text-info-content text-xs px-2 py-0.5 rounded bg-info/20 hover:bg-info/30 transition-colors"
                title="Edit"
              >
                Edit
              </button>
            )}
          </div>
          {editingCreationDate ? (
            <div className="bg-base-200 rounded p-2 space-y-2">
              <input
                type="datetime-local"
                value={editedCreationDate}
                onChange={(e) => setEditedCreationDate(e.target.value)}
                className="w-full bg-base-100 text-base-content font-mono text-sm px-2 py-1 rounded border border-base-content/30 focus:border-info focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCreationDate}
                  disabled={isProcessing}
                  className="px-3 py-1 text-xs rounded bg-success/20 text-success hover:bg-success/30 transition-colors disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={cancelEditingCreationDate}
                  disabled={isProcessing}
                  className="px-3 py-1 text-xs rounded bg-base-content/20 text-base-content hover:bg-base-content/30 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="g-field">
              <p className="text-base-content font-mono text-sm">
                {value ? new Date(value).toLocaleString() : 'N/A'}
              </p>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={key}>
        <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
          {key === 'sha256' ? (
            <Fingerprint className="w-3.5 h-3.5" />
          ) : key === 'pHash' || key === 'aHash' || key === 'dHash' ? (
            <Hash className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
          {key === 'sha256' ? 'SHA-256' : key}
        </div>
        <div className="g-field">
          <p className="text-base-content font-mono text-sm break-all">
            {value === null || value === undefined || value === ''
              ? 'N/A'
              : typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
          </p>
        </div>
      </div>
    );
  };

  const renderTrashActions = (
    <>
      <button
        onClick={() => setShowRestoreConfirm(true)}
        disabled={isProcessing}
        className="g-action g-action-prim"
        style={{ height: 32, padding: '0 14px' }}
      >
        <Undo2 style={{ width: 13, height: 13 }} />
        <span>Restore</span>
      </button>
      <button
        onClick={() => setShowDeleteConfirm(true)}
        disabled={isProcessing}
        className="g-action g-action-danger"
        style={{ height: 32, padding: '0 14px' }}
      >
        <Trash2 style={{ width: 13, height: 13 }} />
        <span>Delete Forever</span>
      </button>
    </>
  );

  const trashTechnicalEntries = useMemo(() => {
    if (!selectedImage) return [];
    const source = fullImageDetails || selectedImage;
    const entries = getTechnicalMetadataEntries(source);
    if (source.creationDate) {
      entries.unshift(['creationDate', source.creationDate]);
    }
    return entries;
  }, [selectedImage, fullImageDetails]);

  return (
  <div ref={pageContainerRef} className="min-h-screen bg-base-200 text-base-content overflow-y-auto prem-page">`n      <PremiumBackground />
      {/* Timeline Scrollbar */}
      <TimelineScrollbar dateGroups={timelineData} containerRef={pageContainerRef} />
      
      <div className="w-full px-6">
        <GalleryNavbar
          navigate={navigate}
          images={filteredTrashedImages}
          reload={reload}
          toggleSelectionMode={toggleSelectionMode}
          selectionMode={selectionMode}
          collectionsLoading={false}
          collections={[]}
          trashLoading={loading}
          trashedImages={trashedImages}
          openUploadModal={() => {}}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedImages={selectedImages}
          selectAll={selectAll}
          filteredImages={filteredTrashedImages}
          deselectAll={deselectAll}
          setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
          isDeleting={isProcessing}
          onHeightChange={setNavbarHeight}
          isTrashPage={true}
          onEmptyTrash={() => setShowEmptyTrashConfirm(true)}
        />

        <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '120px' }} />

        {/* Warning Message */}
        {trashedImages.length > 0 && !selectionMode && (
          <div className="px-6 mb-6">
            <div className="p-4 bg-warning/15 border border-warning/40 rounded-[var(--radius-box)] backdrop-blur-sm flex items-start gap-3">
              <AlertTriangle className="text-warning mt-1 flex-shrink-0" size={20} />
              <div className="text-sm">
                <p className="font-medium text-warning">Trash keeps saved host URLs</p>
                <p className="text-base-content/80 mt-1">
                  Saved host URLs are kept so restore and retry still work. Permanent delete removes the vault row and attempts host cleanup when a provider delete URL exists.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Actions Bar - Shown when in selection mode */}
        {selectionMode && trashedImages.length > 0 && (
          <div className="px-6 mb-6">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 rounded-[var(--radius-box)] bg-error/15 border border-error/40 backdrop-blur-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-base-content font-semibold">
                    {selectedImages.size} selected
                  </span>
                  <button
                    onClick={selectAll}
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-box)] bg-base-100/70 hover:bg-base-100 
                             text-base-content transition-all duration-200"
                  >
                    Select All ({trashedImages.length})
                  </button>
                  {selectedImages.size > 0 && (
                    <button
                      onClick={deselectAll}
                      className="px-3 py-1.5 text-sm rounded-[var(--radius-box)] bg-base-100/70 hover:bg-base-100 
                               text-base-content transition-all duration-200"
                    >
                      Deselect All
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedImages.size > 0 && (
                    <>
                      <button
                        onClick={() => setShowBulkRestoreConfirm(true)}
                        disabled={isProcessing}
                        className="px-4 py-2 rounded-[var(--radius-box)] bg-success/20 hover:bg-success/30 
                                 text-success-content font-medium flex items-center gap-2
                                 transition-all duration-200 disabled:opacity-50"
                      >
                        <Undo2 className="w-4 h-4" />
                        Restore Selected
                      </button>
                      <button
                        onClick={() => setShowBulkDeleteConfirm(true)}
                        disabled={isProcessing}
                        className="px-4 py-2 rounded-[var(--radius-box)] bg-error/20 hover:bg-error/30 
                                 text-error-content font-medium flex items-center gap-2
                                 transition-all duration-200 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Permanently
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        <div className="px-6">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col justify-center items-center py-32">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-error to-warning rounded-full blur-2xl opacity-50 animate-pulse"></div>
              <Spinner size="lg" className="relative z-10" />
            </div>
            <p className="mt-6 text-base-content text-lg font-medium">Loading trash...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && trashedImages.length === 0 && (
          <div className="glass-card rounded-[var(--radius-box)] backdrop-blur-xl bg-base-100/70 border border-base-300 
                        shadow-2xl p-16 text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-error to-warning rounded-full blur-3xl opacity-30"></div>
              <div className="text-8xl relative z-10 drop-shadow-2xl">🗑️</div>
            </div>
            <h3 className="text-3xl font-bold text-base-content mb-3 drop-shadow-lg">Trash is Empty</h3>
            <p className="text-base-content/70 text-lg max-w-md mx-auto">
              Deleted images will appear here. You can restore them or delete them permanently.
            </p>
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10" ref={el => dateGroupRefs.current[date] = el}>
            <h2 className="text-2xl font-bold text-base-content mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-error to-warning w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Masonry Grid - 3 columns on mobile, 4 on tablet, 5 on desktop, 6 on large screens */}
            <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-4 sm:gap-6 space-y-4 sm:space-y-6">
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
                  onClick={(e) => {
                    if (selectionMode) {
                      toggleImageSelection(image.id, e);
                    } else {
                      console.log('[TRASH] Image clicked:', image.id);
                      console.log('[TRASH] Image data:', image);
                      console.log('[TRASH] internalAddedTimestamp:', image.internalAddedTimestamp);
                      setModalImageFailed(false);
                      setSelectedImage(image);
                      setActiveTab('noobs');
                      setFullImageDetails(null);
                    }
                  }}
                >
                  {/* Soft glow effect on hover */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-error/40 to-warning/40 
                                rounded-[var(--radius-box)] opacity-0 group-hover:opacity-100 blur-xl 
                                transition-all duration-700 ease-out"></div>
                  
                  {/* Card with soft shadows and smooth animations */}
                  <div className="relative bg-base-100 border border-base-300 
                                rounded-[var(--radius-box)] overflow-hidden shadow-lg group-hover:shadow-2xl
                                transform transition-all duration-500 ease-out 
                                group-hover:scale-[1.04] group-hover:-translate-y-2">
                    {/* Selection Checkbox - shown in selection mode */}
                    {selectionMode && (
                      <div className="absolute top-2 right-2 z-20">
                        <div className={`w-6 h-6 rounded-[var(--radius-box)] border-2 flex items-center justify-center
                                      transition-all duration-200 ${
                          selectedImages.has(image.id)
                            ? 'bg-error border-error/80'
                            : 'bg-base-300/70 border-base-content/50 backdrop-blur-sm'
                        }`}>
                          {selectedImages.has(image.id) && (
                                <span className="text-sm font-bold">✓</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Loading skeleton with shimmer - only for non-video items */}
                    {!loadedImages.has(image.id) && !image.filemoonUrl && !isLinkItem(image) && (
                      <div className="absolute inset-0 bg-base-300 overflow-hidden">
                        <div className="absolute inset-0 shimmer"></div>
                      </div>
                    )}
                    
                    {/* Render image or video embed */}
                    {getVideoDirectUrl(image) ? (
                      <video
                        src={getVideoDirectUrl(image)}
                        poster={getVideoPosterUrl(image) || undefined}
                        className="w-full h-auto object-cover"
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          handleImageLoad(image.id);
                        }}
                        onCanPlayThrough={() => handleImageLoad(image.id)}
                        onError={() => handleImageLoad(image.id)}
                      />
                    ) : getVideoPosterUrl(image) ? (
                      <div className="relative w-full overflow-hidden aspect-video bg-base-200">
                        <img
                          src={getVideoPosterUrl(image)}
                          alt={image.title || 'Video preview'}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          onLoad={() => handleImageLoad(image.id)}
                          onError={() => handleImageLoad(image.id)}
                        />
                      </div>
                    ) : isLinkItem(image) ? (
                      <div className="w-full aspect-video bg-base-200 flex flex-col items-center justify-center gap-3">
                        {image.linkPreviewImageUrl || getImageUrl(image) ? (
                          <img
                            src={image.linkPreviewImageUrl || getImageUrl(image)}
                            alt={image.pageTitle || 'Link preview'}
                            onLoad={() => handleImageLoad(image.id)}
                            onError={() => handleImageLoad(image.id, true)}
                            className={`w-full h-full object-contain transition-all duration-700 ease-out
                                     ${loadedImages.has(image.id)
                                       ? 'opacity-100'
                                       : 'opacity-0'}`}
                            loading="lazy"
                          />
                        ) : (
                          <>
                            <Link2 className="w-12 h-12 text-base-content/40" />
                            <span className="text-xs text-base-content/50">Link</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <img
                        src={getImageUrl(image)}
                        alt={image.pageTitle || 'Trashed image'}
                        onLoad={() => handleImageLoad(image.id)}
                        onError={() => handleImageLoad(image.id, true)}
                        className={`w-full h-auto object-contain transition-all duration-700 ease-out
                                 ${loadedImages.has(image.id)
                                   ? 'opacity-100'
                                   : 'opacity-0'}`}
                        loading="lazy"
                      />
                    )}

                    {failedImages.has(image.id) && !image.filemoonUrl && !isLinkItem(image) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-base-300/60" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.35)' }}>
                        <ImageIcon style={{ width: 32, height: 32 }} />
                        <span className="text-xs px-3 py-1 rounded-md" style={{ background: 'oklch(from var(--color-base-content) l c h / 0.06)' }}>
                          Source removed or unavailable
                        </span>
                      </div>
                    )}
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-base-300 via-base-300/60 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out">
                      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2 
                                    transform translate-y-2 group-hover:translate-y-0 
                                    transition-transform duration-500 ease-out">
                        <p className="text-base-content text-sm font-semibold truncate drop-shadow-xl">
                          {image.pageTitle || 'Untitled'}
                        </p>
                        <p className="text-base-content/70 text-xs">
                          Deleted: {formatDate(image.deletedAt)}
                        </p>
                        {image.tags && image.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {image.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-[var(--radius-box)] bg-base-100/70 backdrop-blur-sm 
                                         text-base-content border border-base-content/30 font-medium shadow-lg"
                              >
                                {tag}
                              </span>
                            ))}
                            {image.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-[var(--radius-box)] bg-base-100/70 backdrop-blur-sm 
                                             text-base-content border border-base-content/30 font-medium shadow-lg">
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
      <MediaDetailModal
        isOpen={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        item={selectedImage}
        activeTab={activeTab}
        onTabChange={handleTabSwitch}
        isLink={isLinkItem(selectedImage)}
        overviewEntries={getOverviewEntriesFor(selectedImage)}
        technicalEntries={trashTechnicalEntries}
        technicalLoading={loadingNerdsTab}
        renderMedia={renderTrashMedia}
        actions={renderTrashActions}
        renderTechnicalField={renderTrashTechnicalField}
        overviewFooter={renderTrashOverviewFooter}
        technicalEmptyText="No extra technical fields on this document."
      />

      {/* Restore Confirmation Modal */}
      <Modal isOpen={showRestoreConfirm} onClose={() => setShowRestoreConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated icon */}
          <div className="flex items-center justify-center mb-4"><Undo2 size={48} style={{color:"var(--color-success)",opacity:.7}} /></div>
          
          <h3 className="text-2xl font-bold text-success">
            Restore Image?
          </h3>
          
          <p className="text-base-content/80 text-lg leading-relaxed">
            This will restore the image back to your gallery.
            <br />
            <span className="font-semibold text-success">You can access it normally again.</span>
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowRestoreConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300
                       text-base-content font-medium
                       hover:bg-base-300 hover:scale-105
                       active:scale-95
                       transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            <button
              onClick={handleRestore}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                       bg-success text-success-content
                       border border-success/40
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-xl
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when restoring */}
              {isProcessing && (
                <div className="absolute inset-0 bg-success-content animate-ping opacity-10" />
              )}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-success-content/30 border-t-success-content rounded-full animate-spin" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <Undo2 className="w-5 h-5 group-hover:-rotate-12 transition-transform duration-300" />
                    <span>Restore</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>
      
      {/* Permanent Delete Confirmation Modal */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated warning icon */}
          <div className="flex items-center justify-center mb-4"><AlertTriangle size={48} style={{color:"var(--color-error)",opacity:.7}} /></div>
          
          <h3 className="text-2xl font-bold text-error">
            Permanently Delete?
          </h3>
          
          <div className="text-left bg-error/10 border border-error/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete the item from:
            </p>
            <ul className="list-disc list-inside text-base-content/80 space-y-1 ml-2">
              {selectedImage?.imgbbUrl && <li>ImgBB hosting</li>}
              {selectedImage?.pixvidUrl && !selectedImage?.filemoonUrl && !selectedImage?.udropUrl && <li>Pixvid hosting</li>}
              {selectedImage?.filemoonUrl && <li className="text-warning">⚠️ Filemoon video (must be manually deleted from dashboard)</li>}
              {selectedImage?.udropUrl && <li className="text-warning">⚠️ UDrop video (must be manually deleted from dashboard)</li>}
              <li>Your trash bin</li>
            </ul>
          </div>
          
          <p className="text-warning font-semibold text-lg flex items-center justify-center gap-2">
            <AlertTriangle size={20} />
            This action cannot be undone!
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300
                       text-base-content font-medium
                       hover:bg-base-300 hover:scale-105
                       active:scale-95
                       transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            <button
              onClick={handlePermanentDelete}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                       bg-error text-error-content
                       border border-error/40
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-xl
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when deleting */}
              {isProcessing && (
                <div className="absolute inset-0 bg-error-content animate-ping opacity-10" />
              )}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-error-content/30 border-t-error-content rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Delete Forever</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Restore Confirmation Modal */}
      <Modal isOpen={showBulkRestoreConfirm} onClose={() => !isProcessing && setShowBulkRestoreConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated icon */}
          <div className="flex items-center justify-center mb-4"><Undo2 size={48} style={{color:"var(--color-success)",opacity:.7}} /></div>
          
          <h3 className="text-2xl font-bold text-success">
            Restore {selectedImages.size} Image{selectedImages.size > 1 ? 's' : ''}?
          </h3>
          
          <p className="text-base-content/80 text-lg leading-relaxed">
            This will restore {selectedImages.size} image{selectedImages.size > 1 ? 's' : ''} back to your gallery.
            <br />
            <span className="font-semibold text-success">They will be removed from trash.</span>
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowBulkRestoreConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300
                       text-base-content font-medium
                       hover:bg-base-300 hover:scale-105
                       active:scale-95
                       transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            <button
              onClick={handleBulkRestore}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                       bg-success text-success-content
                       border border-success/40
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-xl
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isProcessing && (
                <div className="absolute inset-0 bg-success-content animate-ping opacity-10" />
              )}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-success-content/30 border-t-success-content rounded-full animate-spin" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <Undo2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Restore All</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal isOpen={showBulkDeleteConfirm} onClose={() => !isProcessing && setShowBulkDeleteConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated warning icon */}
          <div className="flex items-center justify-center mb-4"><Trash2 size={48} style={{color:"var(--color-error)",opacity:.7}} /></div>
          
          <h3 className="text-2xl font-bold text-error">
            Permanently Delete {selectedImages.size} Item{selectedImages.size > 1 ? 's' : ''}?
          </h3>
          
          <div className="text-left bg-error/10 border border-error/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete <span className="font-bold text-error">{selectedImages.size} item{selectedImages.size > 1 ? 's' : ''}</span> from:
            </p>
            <ul className="list-disc list-inside text-base-content/80 space-y-1 ml-2">
              <li>Provider hosts where a saved delete URL exists</li>
              <li>Your trash bin</li>
            </ul>
          </div>
          
          <p className="text-warning font-semibold text-lg flex items-center justify-center gap-2">
            <AlertTriangle size={20} />
            This action cannot be undone!
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowBulkDeleteConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300
                       text-base-content font-medium
                       hover:bg-base-300 hover:scale-105
                       active:scale-95
                       transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            <button
              onClick={handleBulkDelete}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                       bg-error text-error-content
                       border border-error/40
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-xl
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isProcessing && (
                <div className="absolute inset-0 bg-error-content animate-ping opacity-10" />
              )}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-error-content/30 border-t-error-content rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Empty Trash Confirmation Modal */}
      <Modal isOpen={showEmptyTrashConfirm} onClose={() => setShowEmptyTrashConfirm(false)}>
        <div className="text-center space-y-6">
          {/* Animated warning icon */}
          <div className="flex items-center justify-center mb-4"><Trash2 size={48} style={{color:"var(--color-error)",opacity:.7}} /></div>
          
          <h3 className="text-2xl font-bold text-error">
            Empty Entire Trash?
          </h3>
          
          <div className="text-left bg-error/10 border border-error/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete <span className="font-bold text-error">{trashedImages.length} item{trashedImages.length !== 1 ? 's' : ''}</span> from:
            </p>
            <ul className="list-disc list-inside text-base-content/80 space-y-1 ml-2">
              <li>Provider hosts where a saved delete URL exists</li>
              <li>Your trash bin</li>
            </ul>
          </div>
          
          <p className="text-warning font-semibold text-lg flex items-center justify-center gap-2">
            <AlertTriangle size={20} />
            This action cannot be undone!
          </p>
          
          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowEmptyTrashConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300
                       text-base-content font-medium
                       hover:bg-base-300 hover:scale-105
                       active:scale-95
                       transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            <button
              onClick={handleEmptyTrash}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                       bg-error text-error-content
                       border border-error/40
                       transform transition-all duration-300
                       hover:scale-105 hover:shadow-xl
                       active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {/* Animated pulse effect when deleting */}
              {isProcessing && (
                <div className="absolute inset-0 bg-error-content animate-ping opacity-10" />
              )}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-error-content/30 border-t-error-content rounded-full animate-spin" />
                    <span>Emptying...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Empty Trash</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

