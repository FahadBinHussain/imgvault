/**
 * @fileoverview Gallery Page Component
 * @version 2.0.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Trash2, Download, X, FolderOpen,
  FileText, Calendar, Cloud, Link2, Globe, AlignLeft, Tag,
  File, Database, Image as ImageIcon, Ruler, Hash, Fingerprint
} from 'lucide-react';
import { Button, Input, IconButton, Card, Modal, Spinner, Toast, Textarea } from '../components/UI';
import { useImages, useImageUpload, useTrash, useChromeStorage, useCollections, useChromeMessage } from '../hooks/useChromeExtension';
import { useKeyboardShortcuts, SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import TimelineScrollbar from '../components/TimelineScrollbar';
import GalleryNavbar from '../components/GalleryNavbar';
import { sitesConfig, isWarningSite, isGoodQualitySite, getSiteDisplayName } from '../config/sitesConfig';
import { FilemoonUploader, UDropUploader } from '../utils/uploaders';

export default function GalleryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { collectionId } = useParams();
  const { images, loading, reload, deleteImage } = useImages();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { uploadImage, cancelUpload, uploading, progress, error: uploadError, logs: uploadLogs } = useImageUpload();
  const { collections, loading: collectionsLoading, createCollection, reload: reloadCollections } = useCollections();
  const sendMessage = useChromeMessage();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [defaultVideoSource] = useChromeStorage('defaultVideoSource', 'filemoon', 'sync');
  const [firebaseConfig] = useChromeStorage('firebaseConfig', null, 'sync');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [fullImageDetails, setFullImageDetails] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('noobs'); // 'noobs' or 'nerds'
  const [loadingNerdsTab, setLoadingNerdsTab] = useState(false);
  const [editingField, setEditingField] = useState(null); // Track which field is being edited
  const [editValues, setEditValues] = useState({}); // Store temporary edit values
  const [toast, setToast] = useState(null); // Toast notification state
  const [isDeleting, setIsDeleting] = useState(false); // Track deletion progress
  const [loadedImages, setLoadedImages] = useState(new Set()); // Track loaded images for fade-in
  const [isModalAnimating, setIsModalAnimating] = useState(false); // Track modal animation state
  const [navbarHeight, setNavbarHeight] = useState(0);
  
  // Timeline scrollbar refs
  const pageContainerRef = useRef(null);
  const dateGroupRefs = useRef({});
  const [timelineData, setTimelineData] = useState([]);
  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadImageData, setUploadImageData] = useState(null);
  const [uploadPageUrl, setUploadPageUrl] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadMetadata, setUploadMetadata] = useState(null);
  const [uploadPreviewSrc, setUploadPreviewSrc] = useState('');
  const [uploadPreviewResolving, setUploadPreviewResolving] = useState(false);
  const [uploadPreviewFallbackTried, setUploadPreviewFallbackTried] = useState(false);
  const [duplicateData, setDuplicateData] = useState(null);
  const [isLocalUpload, setIsLocalUpload] = useState(false); // Track if current image is from local file
  const [selectedCollectionId, setSelectedCollectionId] = useState(''); // Selected collection for upload
  const [showCreateCollection, setShowCreateCollection] = useState(false); // Show create collection input
  const [newCollectionName, setNewCollectionName] = useState(''); // New collection name
  const [isManualUploadMode, setIsManualUploadMode] = useState(false); // Track if triggered by context menu with no srcUrl
  const [uploadModalMetaTab, setUploadModalMetaTab] = useState('noobs');
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  
  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  
  // Auto-upload state
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [pendingDownloadFile, setPendingDownloadFile] = useState(null);
  const [pendingDownloadSourceUrl, setPendingDownloadSourceUrl] = useState('');
  const uploadPreviewUrlRef = useRef(null);
  const activeVideoUploadControllerRef = useRef(null);
  
  // IndexedDB helpers for storing directory handle
  const saveDirectoryHandle = async (handle) => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readwrite');
      await waitForRequest(tx.objectStore('handles').put(handle, 'downloadFolder'));
      await waitForTransaction(tx);
      console.log('✅ [IDB] Directory handle saved');
    } catch (err) {
      console.error('❌ [IDB] Failed to save directory handle:', err);
    } finally {
      db?.close();
    }
  };
  
  const getDirectoryHandle = async () => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readonly');
      const handle = await waitForRequest(tx.objectStore('handles').get('downloadFolder'));
      await waitForTransaction(tx);
      
      if (handle) {
        console.log('✅ [IDB] Directory handle retrieved from storage');
        // Do not force permission checks here. They can require user gesture
        // and would make us drop into picker every time.
        return handle;
      }
      console.log('ℹ️ [IDB] No directory handle found in storage');
      return null;
    } catch (err) {
      console.error('❌ [IDB] Failed to get directory handle:', err);
      return null;
    } finally {
      db?.close();
    }
  };
  
  const clearDirectoryHandle = async () => {
    let db = null;
    try {
      db = await openDB();
      const tx = db.transaction('handles', 'readwrite');
      await waitForRequest(tx.objectStore('handles').delete('downloadFolder'));
      await waitForTransaction(tx);
      console.log('🗑️ [IDB] Directory handle cleared');
    } catch (err) {
      console.error('❌ [IDB] Failed to clear directory handle:', err);
    } finally {
      db?.close();
    }
  };
  
  const waitForRequest = (request) => {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const waitForTransaction = (tx) => {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  };

  const openDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ImgVaultDB', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
    });
  };
  
  // Handle image load for fade-in effect
  const handleImageLoad = (imageId) => {
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

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

  // Select all images in current view
  const selectAll = () => {
    const allIds = new Set(filteredImages.map(img => img.id));
    setSelectedImages(allIds);
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedImages(new Set());
  };

  // Bulk delete selected images
  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) return;
    
    setShowBulkDeleteConfirm(false);
    setIsDeleting(true);
    
    try {
      showToast(`🗑️ Moving ${selectedImages.size} image${selectedImages.size > 1 ? 's' : ''} to trash...`, 'info', 0);
      
      const deletePromises = Array.from(selectedImages).map(id => deleteImage(id));
      await Promise.all(deletePromises);
      
      showToast(`✅ ${selectedImages.size} image${selectedImages.size > 1 ? 's' : ''} moved to trash!`, 'success', 3000);
      setSelectedImages(new Set());
      setSelectionMode(false);
    } catch (error) {
      console.error('Bulk delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to delete some images'}`, 'error', 4000);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredImages = useMemo(() => {
    return images.filter(img => {
      // Filter by collection if collectionId is provided
      if (collectionId && img.collectionId !== collectionId) {
        return false;
      }

      // Filter by search query
      const query = searchQuery.toLowerCase();
      return (
        img.pageTitle?.toLowerCase().includes(query) ||
        img.description?.toLowerCase().includes(query) ||
        img.tags?.some(tag => tag.toLowerCase().includes(query)) ||
        img.sourceImageUrl?.toLowerCase().includes(query) ||
        img.sourcePageUrl?.toLowerCase().includes(query)
      );
    });
  }, [images, collectionId, searchQuery]);

  const selectedItemForType =
    fullImageDetails?.id === selectedImage?.id ? fullImageDetails : selectedImage;

  const isTruthyFlag = (value) =>
    value === true ||
    value === 1 ||
    value === '1' ||
    (typeof value === 'string' && value.trim().toLowerCase() === 'true');

  const hasMeaningfulValue = (value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized || normalized === 'false' || normalized === 'null' || normalized === 'n/a') {
        return false;
      }
      return true;
    }
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    return Boolean(value);
  };

  const isHttpUrl = (value) =>
    typeof value === 'string' && /^https?:\/\//i.test(value.trim());

  const hasVideoHostUrl = (
    isHttpUrl(selectedItemForType?.filemoonWatchUrl) ||
    isHttpUrl(selectedItemForType?.udropWatchUrl) ||
    isHttpUrl(selectedItemForType?.filemoonDirectUrl) ||
    isHttpUrl(selectedItemForType?.udropDirectUrl)
  );

  const hasExplicitVideoType = (
    isTruthyFlag(selectedItemForType?.isVideo) ||
    selectedItemForType?.fileType?.startsWith?.('video/')
  );

  const isSelectedVideo = Boolean(
    hasExplicitVideoType ||
    hasVideoHostUrl
  );
  const isSelectedLink = isTruthyFlag(selectedItemForType?.isLink);

  const modalImage =
    fullImageDetails?.id === selectedImage?.id
      ? { ...selectedImage, ...fullImageDetails }
      : selectedImage;
  const baseImageFieldKeys = [
    'pixvidUrl',
    'pixvidDeleteUrl',
    'imgbbUrl',
    'imgbbDeleteUrl',
    'imgbbThumbUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'pageTitle',
    'fileName',
    'fileSize',
    'width',
    'height',
    'fileType',
    'fileTypeSource',
    'creationDate',
    'creationDateSource',
    'internalAddedTimestamp',
    'tags',
    'description',
    'collectionId'
  ];
  const baseVideoFieldKeys = [
    'sourceImageUrl',
    'sourcePageUrl',
    'pageTitle',
    'fileName',
    'fileSize',
    'fileType',
    'fileTypeSource',
    'creationDate',
    'creationDateSource',
    'internalAddedTimestamp',
    'duration',
    'width',
    'height',
    'tags',
    'description',
    'collectionId',
    'isVideo',
    'filemoonWatchUrl',
    'filemoonDirectUrl',
    'udropWatchUrl',
    'udropDirectUrl'
  ];
  const baseLinkFieldKeys = [
    'linkUrl',
    'pageTitle',
    'description',
    'tags',
    'collectionId',
    'internalAddedTimestamp',
    'faviconUrl',
    'linkPreviewImageUrl',
    'lastVisitedAt',
    'isLink'
  ];
  const activeBaseFieldKeys = isSelectedLink ? baseLinkFieldKeys : (isSelectedVideo ? baseVideoFieldKeys : baseImageFieldKeys);
  const displayedBaseFieldKeys = activeBaseFieldKeys;
  const countedBaseFieldCount = displayedBaseFieldKeys.length;
  const inlineActionClass = 'shrink-0 inline-flex items-center gap-1.5 rounded-full border border-base-content/12 bg-base-200/70 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/72 transition-all duration-200 hover:border-base-content/22 hover:bg-base-200 hover:text-base-content hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';
  const firebaseProjectId = firebaseConfig?.projectId || '';
  const firestoreCollectionName = modalImage?.deletedAt ? 'trash' : 'images';
  const canOpenFirestoreConsole = Boolean(firebaseProjectId && selectedImage?.id);
  const firestoreConsoleUrl = canOpenFirestoreConsole
    ? `https://console.firebase.google.com/u/1/project/${encodeURIComponent(firebaseProjectId)}/firestore/databases/-default-/data/~2F${encodeURIComponent(firestoreCollectionName)}~2F${encodeURIComponent(selectedImage.id)}?view=panel-view`
    : '';
  const getPreferredVideoWatchUrl = (item) => {
    if (!item) return '';
    return defaultVideoSource === 'udrop'
      ? (item.udropWatchUrl || item.filemoonWatchUrl || '')
      : (item.filemoonWatchUrl || item.udropWatchUrl || '');
  };

  const getFileNameFromPath = (filePath = '') => {
    const normalized = String(filePath || '').trim();
    if (!normalized) return '';
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '';
  };

  const normalizeFileToken = (value = '') =>
    String(value || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const extractMediaIdFromName = (name = '') => {
    const text = String(name || '');
    const endBracketMatch = text.match(/\[([^\]]+)\](?:\.[^.]+)?$/);
    if (endBracketMatch?.[1]) return endBracketMatch[1];
    const genericBracketMatch = text.match(/\[([0-9A-Za-z_-]{6,})\]/);
    if (genericBracketMatch?.[1]) return genericBracketMatch[1];
    const genericIdMatch = text.match(/([0-9]{10,})/);
    return genericIdMatch?.[1] || '';
  };

  const getFileFromDirectoryHandle = async (dirHandle, expectedFileName, sourcePathForFallback = '') => {
    console.log('🔎 [AUTO-LOAD] Resolver input:', {
      expectedFileName,
      sourcePathForFallback,
      directoryName: dirHandle?.name || '(unknown)',
    });

    const mediaId =
      extractMediaIdFromName(expectedFileName) ||
      extractMediaIdFromName(getFileNameFromPath(sourcePathForFallback)) ||
      extractMediaIdFromName(sourcePathForFallback);

    console.log('🧩 [AUTO-LOAD] Extracted mediaId:', mediaId || '(none)');

    if (mediaId) {
      const normalizedNeedle = normalizeFileToken(`[${mediaId}]`);
      const matchingFiles = [];
      let scannedCount = 0;
      for await (const [entryName, entryHandle] of dirHandle.entries()) {
        if (entryHandle?.kind !== 'file') continue;
        scannedCount += 1;
        const normalizedEntryName = normalizeFileToken(entryName);
        if (!normalizedEntryName.includes(normalizedNeedle) && !normalizedEntryName.includes(normalizeFileToken(mediaId))) {
          continue;
        }
        console.log('🎯 [AUTO-LOAD] ID match candidate:', entryName);
        const file = await entryHandle.getFile();
        matchingFiles.push(file);
      }
      console.log(`📚 [AUTO-LOAD] ID scan complete. Scanned files: ${scannedCount}, candidates: ${matchingFiles.length}`);

      if (matchingFiles.length > 0) {
        matchingFiles.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
        console.log('✅ [AUTO-LOAD] Using ID-matched file:', matchingFiles[0].name);
        return matchingFiles[0];
      }
    }

    const expectedNormalized = normalizeFileToken(expectedFileName);
    if (expectedNormalized) {
      let scannedCount = 0;
      for await (const [entryName, entryHandle] of dirHandle.entries()) {
        if (entryHandle?.kind !== 'file') continue;
        scannedCount += 1;
        if (normalizeFileToken(entryName) !== expectedNormalized) continue;
        console.log('✅ [AUTO-LOAD] Using normalized exact filename match:', entryName);
        return await entryHandle.getFile();
      }
      console.log(`⚠️ [AUTO-LOAD] No normalized exact filename match after scanning ${scannedCount} files`);
    }

    try {
      const exactHandle = await dirHandle.getFileHandle(expectedFileName);
      console.log('✅ [AUTO-LOAD] Using native exact getFileHandle match');
      return await exactHandle.getFile();
    } catch (exactErr) {
      console.log('⚠️ [AUTO-LOAD] Native exact getFileHandle failed:', exactErr?.name, exactErr?.message);
      if (exactErr?.name !== 'NotFoundError') {
        throw exactErr;
      }
    }

    const fallbackName = getFileNameFromPath(sourcePathForFallback);
    const extensionMatch = (expectedFileName || fallbackName || '').match(/\.([a-z0-9]+)$/i);
    const extension = extensionMatch?.[1]?.toLowerCase() || '';
    if (extension) {
      const now = Date.now();
      const recentCandidates = [];
      let scannedCount = 0;
      for await (const [entryName, entryHandle] of dirHandle.entries()) {
        if (entryHandle?.kind !== 'file') continue;
        scannedCount += 1;
        if (!entryName.toLowerCase().endsWith(`.${extension}`)) continue;
        const file = await entryHandle.getFile();
        const ageMs = Math.abs(now - (file.lastModified || 0));
        if (ageMs > 10 * 60 * 1000) continue;
        console.log(`🕒 [AUTO-LOAD] Recent extension candidate (${extension}):`, file.name, `ageMs=${ageMs}`);
        recentCandidates.push(file);
      }
      console.log(`📚 [AUTO-LOAD] Extension fallback scan complete. Scanned files: ${scannedCount}, recent candidates: ${recentCandidates.length}`);
      if (recentCandidates.length > 0) {
        recentCandidates.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
        console.log(`✅ [AUTO-LOAD] Using newest recent .${extension} fallback:`, recentCandidates[0].name);
        return recentCandidates[0];
      }
    }

    if (!mediaId) {
      console.log('❌ [AUTO-LOAD] Resolver failed: no mediaId and no fallback match');
      throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    }
    console.log('❌ [AUTO-LOAD] Resolver failed: mediaId exists but no file matched');
    throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
  };
  const getPreferredVideoDirectUrl = (item) => {
    if (!item) return '';
    return defaultVideoSource === 'udrop'
      ? (item.udropDirectUrl || item.filemoonDirectUrl || '')
      : (item.filemoonDirectUrl || item.udropDirectUrl || '');
  };
  const shouldRenderModalVideoPlayer = (item) => (
    defaultVideoSource === 'udrop' && Boolean(item?.udropDirectUrl)
  );
  const getLinkPreviewImage = (item) => (
    item?.linkPreviewImageUrl ||
    item?.sourceImageUrl ||
    ''
  );
  const formatBaseFieldValue = (value) => {
    if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
    if (value === null) return 'null';
    if (value === undefined || value === '') return 'N/A';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  };
  const nerdsExcludedKeys = new Set([
    ...baseImageFieldKeys,
    ...baseVideoFieldKeys,
    ...baseLinkFieldKeys
  ]);
  const nerdsEntries = fullImageDetails
    ? Object.entries(fullImageDetails)
      .filter(([key, value]) => {
        if (key === 'id') return false;
        if (nerdsExcludedKeys.has(key)) return false;
        return value !== undefined && value !== null && value !== '';
      })
      .sort(([a], [b]) => a.localeCompare(b))
    : [];
  const nerdsVisibleFieldCount = fullImageDetails ? nerdsEntries.length : '...';
  const isResolvingModalMediaType = Boolean(
    selectedImage?.id &&
    fullImageDetails?.id !== selectedImage?.id &&
    !selectedImage?.isVideo &&
    !selectedImage?.fileType &&
    !selectedImage?.filemoonWatchUrl &&
    !selectedImage?.udropWatchUrl &&
    !selectedImage?.filemoonDirectUrl &&
    !selectedImage?.udropDirectUrl
  );

  useEffect(() => {
    if (!selectedImage?.id) return;
    if (fullImageDetails?.id === selectedImage.id) return;
    loadFullImageDetails(selectedImage.id);
  }, [selectedImage?.id, fullImageDetails?.id]);

  // Get current collection name
  const currentCollection = collectionId 
    ? collections.find(c => c.id === collectionId)
    : null;

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const getUploadLogColorClass = (type) =>
    type === 'error'
      ? 'bg-error/10 text-error border-error/20'
      : type === 'success'
        ? 'bg-success/10 text-success border-success/20'
        : type === 'warning'
          ? 'bg-warning/10 text-warning border-warning/20'
          : 'bg-base-200/70 text-base-content/80 border-base-content/10';

  const renderUploadLog = (entry, index) => {
    const colorClass = getUploadLogColorClass(entry.type);

    return (
      <div key={`${entry.timestamp}-${index}`} className={`rounded-[var(--radius-box)] border px-3 py-2 text-sm leading-5 ${colorClass}`}>
        <span className="mr-2 text-xs opacity-60">[{entry.timestamp}]</span>
        <span className="whitespace-pre-wrap break-all font-mono text-[12px]">{entry.message}</span>
      </div>
    );
  };

  const appendClientUploadLog = async (message, type = 'info') => {
    const result = await chrome.storage.local.get(['uploadStatusLogs']);
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };
    const nextLogs = [entry, ...(result.uploadStatusLogs || [])].slice(0, 200);
    await chrome.storage.local.set({ uploadStatusLogs: nextLogs });
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  };

  const uploadVideoDirectly = async (uploadData) => {
    const uploadController = new AbortController();
    activeVideoUploadControllerRef.current = uploadController;

    await chrome.storage.local.set({
      uploadActive: true,
      uploadStatus: 'Preparing direct video upload...',
      uploadStatusLogs: [],
    });

    await appendClientUploadLog('Attempting direct video uploads from the extension page...');

    try {
      const settings = await sendMessage('getVideoHostSettings');
      await appendClientUploadLog(`Video payload ready: ${formatBytes(uploadData.fileSize || uploadData.fileBlob?.size || 0)}.`);
      let udropResult = null;
      let filemoonResult = null;
      let hostSucceeded = false;

      if (settings?.udropKey1 && settings?.udropKey2) {
        const udropUploader = new UDropUploader();
        await appendClientUploadLog('Starting UDrop XHR upload...');
        await chrome.storage.local.set({ uploadStatus: 'Uploading video to UDrop...' });

        try {
          udropResult = await udropUploader.uploadWithProgress(
            uploadData.fileBlob,
            settings.udropKey1,
            settings.udropKey2,
            uploadData.fileName || 'video.mp4',
            async ({ loaded, total, percent }) => {
              const totalLabel = total ? formatBytes(total) : formatBytes(uploadData.fileBlob?.size || 0);
              const loadedLabel = formatBytes(loaded);
              const message = percent !== null
                ? `UDrop upload progress: ${percent}% (${loadedLabel} / ${totalLabel})`
                : `UDrop upload progress: ${loadedLabel} sent`;
              await chrome.storage.local.set({ uploadStatus: message });
              await appendClientUploadLog(message);
            },
            uploadController.signal
          );
        } catch (error) {
          await appendClientUploadLog(`UDrop XHR upload failed: ${error.message || String(error)}`, 'error');
          await appendClientUploadLog('Normal UDrop upload fallback is currently disabled for testing.', 'warning');
          // Fallback retained intentionally for later re-enable:
          // udropResult = await udropUploader.upload(
          //   uploadData.fileBlob,
          //   settings.udropKey1,
          //   settings.udropKey2,
          //   uploadData.fileName || 'video.mp4'
          // );
          throw error;
        }

        await appendClientUploadLog(`UDrop API status: ${udropResult.apiStatus || 'unknown'}`);
        if (udropResult.apiResponse) {
          await appendClientUploadLog(`UDrop API message: ${udropResult.apiResponse}`);
        }
        await appendClientUploadLog(`UDrop authorized, account: ${udropResult.accountId || 'unknown'}`);
        await appendClientUploadLog('[UDROP] File uploaded successfully', 'success');
        await appendClientUploadLog(`[UDROP] URL: ${udropResult.displayUrl || udropResult.url || ''}`);
        if (udropResult.shortUrl) {
          await appendClientUploadLog(`[UDROP] Short URL: ${udropResult.shortUrl}`);
        }
        if (udropResult.fileId) {
          await appendClientUploadLog(`[UDROP] File ID: ${udropResult.fileId}`);
        }
        if (udropResult.url) {
          await appendClientUploadLog(`[UDROP] Download URL: ${udropResult.url}`);
        }
        hostSucceeded = true;
      }

      if (settings?.filemoonApiKey) {
        const filemoonUploader = new FilemoonUploader();
        await appendClientUploadLog('Starting Filemoon upload after UDrop finished...');
        await chrome.storage.local.set({ uploadStatus: 'Uploading video to Filemoon...' });

        try {
          filemoonResult = await filemoonUploader.uploadWithProgress(
            uploadData.fileBlob,
            settings.filemoonApiKey,
            uploadData.fileName || 'video.mp4',
            async ({ loaded, total, percent }) => {
              const totalLabel = total ? formatBytes(total) : formatBytes(uploadData.fileBlob?.size || 0);
              const loadedLabel = formatBytes(loaded);
              const message = percent !== null
                ? `Filemoon upload progress: ${percent}% (${loadedLabel} / ${totalLabel})`
                : `Filemoon upload progress: ${loadedLabel} sent`;
              await chrome.storage.local.set({ uploadStatus: message });
              await appendClientUploadLog(message);
            },
            uploadController.signal
          );
        } catch (error) {
          await appendClientUploadLog(`Filemoon XHR upload failed: ${error.message || String(error)}`, 'error');
          await appendClientUploadLog('Normal Filemoon upload fallback is currently disabled for testing.', 'warning');
          // Fallback retained intentionally for later re-enable:
          // filemoonResult = await filemoonUploader.upload(
          //   uploadData.fileBlob,
          //   settings.filemoonApiKey,
          //   uploadData.fileName || 'video.mp4'
          // );
          throw error;
        }

        await appendClientUploadLog(`Filemoon API status: ${filemoonResult.apiStatus || 'unknown'}`);
        if (filemoonResult.apiMessage) {
          await appendClientUploadLog(`Filemoon API message: ${filemoonResult.apiMessage}`);
        }
        if (filemoonResult.filecode) {
          await appendClientUploadLog(`Filemoon filecode: ${filemoonResult.filecode}`);
        }
        if (filemoonResult.url) {
          await appendClientUploadLog(`Filemoon embed URL: ${filemoonResult.url}`);
        }
        await appendClientUploadLog('[FILEMOON] File uploaded successfully', 'success');
        hostSucceeded = true;
      }

      if (!hostSucceeded) {
        throw new Error('No video host is configured for direct upload.');
      }

      await chrome.storage.local.set({ uploadStatus: 'Saving video metadata...' });
      const saved = await sendMessage('saveUploadedVideo', {
        ...uploadData,
        udropResult,
        filemoonResult,
      });
      await appendClientUploadLog(`[SAVE VIDEO] Saved successfully with ID: ${saved.id}`, 'success');
      return saved;
    } catch (error) {
      await appendClientUploadLog(`Direct video upload failed: ${error.message || String(error)}`, 'error');
      throw error;
    } finally {
      if (activeVideoUploadControllerRef.current === uploadController) {
        activeVideoUploadControllerRef.current = null;
      }
      await chrome.storage.local.set({ uploadActive: false });
    }
  };

  const revokeUploadPreviewUrl = () => {
    if (uploadPreviewUrlRef.current) {
      URL.revokeObjectURL(uploadPreviewUrlRef.current);
      uploadPreviewUrlRef.current = null;
    }
  };

  const extractVideoFileMetadata = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const objectUrl = URL.createObjectURL(file);

      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
      };

      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : null;
        const width = Number.isFinite(video.videoWidth) ? video.videoWidth : null;
        const height = Number.isFinite(video.videoHeight) ? video.videoHeight : null;
        cleanup();
        resolve({ duration, width, height });
      };
      video.onerror = () => {
        cleanup();
        resolve({ duration: null, width: null, height: null });
      };
      video.src = objectUrl;
    });
  };

  const handleDelete = async () => {
    if (!selectedImage) return;
    
    setIsDeleting(true);
    setShowDeleteConfirm(false);
    
    try {
      showToast('🗑️ Moving to trash...', 'info', 0);
      await deleteImage(selectedImage.id);
      
      showToast('✅ Image moved to trash! (Hosts preserved)', 'success', 3000);
      setSelectedImage(null);
      setFullImageDetails(null);
    } catch (error) {
      console.error('Delete failed:', error);
      showToast(`❌ ${error.message || 'Failed to move to trash'}`, 'error', 4000);
    } finally {
      setIsDeleting(false);
    }
  };

  // Image navigation functions for keyboard shortcuts
  const navigateToNextImage = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex === -1 || currentIndex === filteredImages.length - 1) return;
    
    setSelectedImage(filteredImages[currentIndex + 1]);
    setActiveTab('noobs'); // Reset to noobs tab (default view)
    setFullImageDetails(null); // Clear cached details for new image
  };

  const navigateToPreviousImage = () => {
    if (!selectedImage || filteredImages.length === 0) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex <= 0) return;
    
    setSelectedImage(filteredImages[currentIndex - 1]);
    setActiveTab('noobs'); // Reset to noobs tab (default view)
    setFullImageDetails(null); // Clear cached details for new image
  };

  const closeImageModal = () => {
    setSelectedImage(null);
    setFullImageDetails(null);
  };

  // Keyboard shortcuts for image modal
  useKeyboardShortcuts({
    [SHORTCUTS.ARROW_RIGHT]: navigateToNextImage,
    [SHORTCUTS.ARROW_LEFT]: navigateToPreviousImage,
    [SHORTCUTS.ESCAPE]: () => {
      if (selectedImage) closeImageModal();
      else if (showUploadModal) closeUploadModal();
      else if (selectionMode) setSelectionMode(false);
    },
    [SHORTCUTS.DELETE]: () => {
      if (selectedImage && !showDeleteConfirm) {
        setShowDeleteConfirm(true);
      }
    },
    // Global shortcuts
    [SHORTCUTS.U]: () => {
      if (!selectedImage && !showUploadModal) openUploadModal();
    },
    [SHORTCUTS.SLASH]: () => {
      // Focus search
      document.querySelector('input[placeholder*="Search"]')?.focus();
    },
    [SHORTCUTS.CTRL_K]: () => {
      // Focus search (alternative)
      document.querySelector('input[placeholder*="Search"]')?.focus();
    },
    [SHORTCUTS.S]: () => {
      if (!selectedImage && !showUploadModal) toggleSelectionMode();
    },
    [SHORTCUTS.CTRL_S]: (e) => {
      // Save image if in modal
      if (selectedImage) {
        e.preventDefault();
        handleSave();
      }
    },
  }, true, [selectedImage, filteredImages, showUploadModal, showDeleteConfirm, selectionMode]);

  // Upload modal handlers
  const openUploadModal = () => {
    if (uploading && uploadImageData) {
      setShowUploadModal(true);
      return;
    }

    revokeUploadPreviewUrl();
    setShowUploadModal(true);
    setUploadImageData(null);
    setUploadPageUrl('');
    setUploadDescription('');
    setUploadTags('');
    setUploadMetadata(null);
    setUploadPreviewSrc('');
    setUploadPreviewResolving(false);
    setUploadPreviewFallbackTried(false);
    setDuplicateData(null);
    setIsLocalUpload(false);
    setSelectedCollectionId('');
    setShowCreateCollection(false);
    setNewCollectionName('');
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);

    if (uploading) {
      showToast('Upload will continue in the background. You can reopen the modal to check logs later.', 'info', 3500);
    }
  };

  useEffect(() => {
    setUploadPreviewSrc(uploadImageData?.srcUrl || '');
    setUploadPreviewResolving(false);
    setUploadPreviewFallbackTried(false);
  }, [uploadImageData?.srcUrl]);

  const resolveProtectedUploadPreview = async () => {
    if (!uploadImageData?.srcUrl || uploadImageData?.isVideo || uploadPreviewFallbackTried) {
      return;
    }

    setUploadPreviewFallbackTried(true);
    setUploadPreviewResolving(true);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'resolveImagePreview',
        imageUrl: uploadImageData.srcUrl,
        pageUrl: uploadPageUrl || uploadImageData.pageUrl || ''
      });

      if (response?.success && response?.dataUrl) {
        setUploadPreviewSrc(response.dataUrl);
      }
    } catch (error) {
      console.error('Failed to resolve protected upload preview:', error);
    } finally {
      setUploadPreviewResolving(false);
    }
  };

  const terminateUploadJob = async () => {
    try {
      if (uploadImageData?.isVideo && activeVideoUploadControllerRef.current) {
        activeVideoUploadControllerRef.current.abort();
      } else {
        await cancelUpload();
      }

      await chrome.storage.local.set({ uploadActive: false, uploadStatus: '' });
      setShowUploadModal(false);
      showToast('Upload cancelled.', 'warning', 3000);
    } catch (error) {
      console.error('Failed to cancel upload:', error);
      showToast(`Failed to cancel upload: ${error.message || String(error)}`, 'error', 4000);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // Save current page metadata before replacing
      const savedPageUrl = uploadPageUrl;
      const savedPageTitle = uploadImageData?.pageTitle;
      
      await processMediaFile(file, savedPageUrl, savedPageTitle);
      
      // Mark this as a local upload
      setIsLocalUpload(true);
      
      // Show success feedback
      const fileType = file.type.startsWith('video/') ? 'Video' : 'Image';
      showToast(`✅ ${fileType} loaded successfully!`, 'success', 3000);
    }
  };

  const processMediaFile = async (file, preservePageUrl = null, preservePageTitle = null) => {
    revokeUploadPreviewUrl();

    const finalPageUrl = preservePageUrl && preservePageUrl !== 'Uploaded manually'
      ? preservePageUrl
      : 'Uploaded manually';
    const finalPageTitle = preservePageTitle && preservePageTitle !== 'Uploaded manually'
      ? preservePageTitle
      : 'Uploaded manually';
    const isVideo = file.type.startsWith('video/');
    const previewUrl = isVideo ? URL.createObjectURL(file) : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    if (isVideo) {
      uploadPreviewUrlRef.current = previewUrl;
    }
    setUploadImageData({
      srcUrl: previewUrl,
      fileName: file.name,
      pageTitle: finalPageTitle,
      timestamp: Date.now(),
      file,
      isVideo,
      fileType: file.type
    });
    setUploadPageUrl(finalPageUrl);

    try {
      const localVideoMetadata = isVideo ? await extractVideoFileMetadata(file) : null;
      const response = await chrome.runtime.sendMessage({
        action: 'extractMetadata',
        imageUrl: isVideo ? null : previewUrl,
        pageUrl: finalPageUrl,
        fileName: file.name,
        fileMimeType: file.type,
        fileLastModified: file.lastModified,
        isVideo
      });

      if (response.success && response.metadata) {
        setUploadMetadata({
          ...response.metadata,
          duration: localVideoMetadata?.duration ?? response.metadata.duration ?? null,
          width: localVideoMetadata?.width ?? response.metadata.width ?? null,
          height: localVideoMetadata?.height ?? response.metadata.height ?? null,
        });
        console.log('📸 Extracted metadata:', response.metadata);
      } else if (localVideoMetadata) {
        setUploadMetadata({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileTypeSource: 'File object',
          creationDate: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          creationDateSource: file.lastModified ? 'OS lastModified' : 'Unknown',
          duration: localVideoMetadata.duration,
          width: localVideoMetadata.width,
          height: localVideoMetadata.height,
        });
      }
    } catch (error) {
      console.error('Failed to extract metadata:', error);
    }
  };

  useEffect(() => {
    return () => {
      revokeUploadPreviewUrl();
    };
  }, []);

  useEffect(() => {
    if (showUploadModal) {
      setUploadModalMetaTab('noobs');
    }
  }, [showUploadModal, uploadImageData?.isVideo]);

  // Drag & Drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };
  
  // Handle folder selection for auto-upload
  const handleSelectDownloadFolder = async () => {
    if (!pendingDownloadFile) return;
    
    try {
      // Check if File System Access API is supported
      if (!('showDirectoryPicker' in window)) {
        console.log('⚠️ [AUTO-LOAD] File System Access API not supported');
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast('⚠️ Please manually select the file to upload.', 'warning', 4000);
        return;
      }
      
      // Extract filename from path (supports both "\" and "/")
      const fileName = getFileNameFromPath(pendingDownloadFile);
      const savedHandle = await getDirectoryHandle();
      if (savedHandle) {
        try {
          const file = await getFileFromDirectoryHandle(savedHandle, fileName, pendingDownloadFile);
          setShowFolderPrompt(false);
          setPendingDownloadFile(null);
          setPendingDownloadSourceUrl('');
          await processMediaFile(file, pendingDownloadSourceUrl || 'native-download://upload', 'Downloaded Video');
          setIsLocalUpload(true);
          setShowUploadModal(true);
          showToast(`Loaded "${fileName}" from saved folder.`, 'success', 3000);
          return;
        } catch (savedHandleErr) {
          const errorName = savedHandleErr?.name || '';
          if ((errorName === 'NotAllowedError' || errorName === 'SecurityError') && typeof savedHandle.requestPermission === 'function') {
            try {
              const permission = await savedHandle.requestPermission({ mode: 'read' });
              if (permission === 'granted') {
                const file = await getFileFromDirectoryHandle(savedHandle, fileName, pendingDownloadFile);
                setShowFolderPrompt(false);
                setPendingDownloadFile(null);
                setPendingDownloadSourceUrl('');
                await processMediaFile(file, pendingDownloadSourceUrl || 'native-download://upload', 'Downloaded Video');
                setIsLocalUpload(true);
                setShowUploadModal(true);
                showToast(`Loaded "${fileName}" from saved folder.`, 'success', 3000);
                return;
              }
            } catch (permissionErr) {
              console.log('⚠️ [AUTO-LOAD] Saved handle permission retry failed:', permissionErr.message);
            }
          }

          // Keep the saved folder for transient misses (e.g. file not moved yet)
          // and only clear when the handle itself is invalid/forbidden.
          if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
            await clearDirectoryHandle();
          }
        }
      }
      console.log('📁 [AUTO-LOAD] Extracted filename:', fileName);
      
      console.log('📂 [AUTO-LOAD] Showing directory picker...');
      // Request permission to read the directory
      const dirHandle = await window.showDirectoryPicker({ 
        id: 'video-downloads',
        startIn: 'videos',
        mode: 'read'
      });
      
      console.log('✅ [AUTO-LOAD] Directory permission granted:', dirHandle.name);
      
      // Request persistent permission if supported
      if (typeof dirHandle.requestPermission === 'function') {
        try {
          const permission = await dirHandle.requestPermission({ mode: 'read' });
          console.log('🔐 [AUTO-LOAD] Requested persistent permission:', permission);
        } catch (permErr) {
          console.log('⚠️ [AUTO-LOAD] Permission request failed:', permErr.message);
        }
      }
      
      // Save to IndexedDB for future use
      await saveDirectoryHandle(dirHandle);
      
      // Get the file
      console.log('📄 [AUTO-LOAD] Getting file handle for:', fileName);
      const file = await getFileFromDirectoryHandle(dirHandle, fileName, pendingDownloadFile);
      
      console.log('✅ [AUTO-LOAD] File loaded successfully:', file.name, file.size, 'bytes');
      
      // Hide the prompt
      setShowFolderPrompt(false);
      setPendingDownloadFile(null);
      setPendingDownloadSourceUrl('');
      
      // Process and show modal
      await processMediaFile(file, pendingDownloadSourceUrl || 'native-download://upload', 'Downloaded Video');
      setIsLocalUpload(true);
      setShowUploadModal(true);
      showToast(`✅ Video "${fileName}" loaded successfully!`, 'success', 3000);
      
    } catch (err) {
      console.error('❌ [AUTO-LOAD] Error:', err.name, err.message);
      if (err.name === 'AbortError') {
        console.log('⚠️ [AUTO-LOAD] User cancelled folder selection');
        setShowFolderPrompt(false);
        showToast('❌ Folder selection cancelled.', 'error', 3000);
      } else if (err.name === 'NotFoundError') {
        console.log('⚠️ [AUTO-LOAD] File not found in selected folder');
        const fileName = getFileNameFromPath(pendingDownloadFile);
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast(`⚠️ File "${fileName}" not found in selected folder. Please select it manually.`, 'warning', 5000);
      } else {
        console.error('❌ [AUTO-LOAD] Unexpected error:', err);
        setShowFolderPrompt(false);
        setShowUploadModal(true);
        showToast('⚠️ Failed to load file. Please select it manually.', 'warning', 4000);
      }
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Check if it's an image or video
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        await processMediaFile(file);
        setShowUploadModal(true);
      } else {
        showToast('❌ Please drop an image or video file', 'error', 3000);
      }
    }
  };

  // Add drag & drop event listeners
  useEffect(() => {
    const handleWindowDragEnter = (e) => handleDragEnter(e);
    const handleWindowDragLeave = (e) => handleDragLeave(e);
    const handleWindowDragOver = (e) => handleDragOver(e);
    const handleWindowDrop = (e) => handleDrop(e);

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  const handleUploadSubmit = async (ignoreDuplicates = false) => {
    if (!uploadImageData) return;

    // Clear previous duplicate data when starting new upload
    setDuplicateData(null);

    try {
      const tagsArray = uploadTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Create upload data object with only serializable values
      const hasRealSourceUrl = /^https?:\/\//i.test(String(uploadPageUrl || ''));
      const uploadData = {
        imageUrl: String(uploadImageData.srcUrl || ''),
        fileBlob: uploadImageData.file || null,
        originalSourceUrl: hasRealSourceUrl
          ? String(uploadPageUrl || '')
          : ((isLocalUpload || uploadPageUrl === 'Uploaded manually') ? 'Uploaded manually' : String(uploadPageUrl || '')),
        pageUrl: String(uploadPageUrl || ''),
        pageTitle: String(uploadImageData.pageTitle || ''),
        fileName: String(uploadImageData.fileName || ''),
        fileSize: uploadImageData.file?.size || uploadMetadata?.fileSize || null,
        description: String(uploadDescription || ''),
        tags: tagsArray.map(t => String(t)),
        ignoreDuplicate: Boolean(ignoreDuplicates),
        fileMimeType: uploadImageData.file?.type || null,
        fileLastModified: uploadImageData.file?.lastModified || null,
        collectionId: selectedCollectionId || null,
        isVideo: Boolean(uploadImageData.isVideo),
        fileType: uploadImageData.fileType || uploadImageData.file?.type || null,
        duration: uploadMetadata?.duration ?? null,
        width: uploadMetadata?.width ?? null,
        height: uploadMetadata?.height ?? null,
      };

      console.log('Uploading with data (keys):', Object.keys(uploadData));
      console.log('Media URL length:', uploadData.imageUrl.length);
      console.log('Has file blob:', Boolean(uploadData.fileBlob));
      console.log('Is Video:', uploadData.isVideo);
      
      // Try to JSON.stringify to check if it's serializable
      try {
        JSON.stringify(uploadData);
        console.log('✓ Data is serializable');
      } catch (e) {
        console.error('✗ Data is NOT serializable:', e);
        throw new Error('Upload data contains non-serializable values');
      }

      if (uploadData.isVideo && uploadData.fileBlob) {
        await uploadVideoDirectly(uploadData);
      } else {
        await uploadImage(uploadData);
      }

      // Close modal first for better UX
      setShowUploadModal(false);
      setDuplicateData(null);
      
      // Then reload both images and collections, and show toast
      await Promise.all([reload(), reloadCollections()]); // Refresh gallery and collections
      const mediaType = uploadData.isVideo ? 'Video' : 'Image';
      showToast(`✅ ${mediaType} uploaded successfully!`, 'success', 3000);
    } catch (err) {
      console.error('Upload failed:', err);
      
      const errorMessage = err?.message || String(err) || 'Upload failed';
      
      // Check if error has duplicate data (only for images)
      if (err?.duplicate && !uploadImageData.isVideo) {
        console.log('Duplicate data found:', err.duplicate);
        console.log('All duplicates found:', err.allDuplicates);
        // Set both single duplicate and all duplicates
        setDuplicateData({
          primary: err.duplicate,
          all: err.allDuplicates || [err.duplicate]
        });
      } else {
        // For non-duplicate errors, show toast
        showToast(`❌ ${errorMessage}`, 'error', 4000);
      }
    }
  };

  // Lazy load full image details when nerds tab is clicked
  const loadFullImageDetails = async (imageId) => {
    console.log('💾 [LAZY LOAD] loadFullImageDetails() called for ID:', imageId);
    
    if (fullImageDetails?.id === imageId) {
      console.log('✅ [CACHE HIT] Full details already loaded for this image - SKIPPING fetch');
      console.log('� [CACHE DATA] Cached details:', {
        id: fullImageDetails.id,
        fileName: fullImageDetails.fileName,
        fileType: fullImageDetails.fileType,
        fileSize: fullImageDetails.fileSize,
        sha256: fullImageDetails.sha256 ? 'present' : 'missing',
        pHash: fullImageDetails.pHash ? 'present' : 'missing'
      });
      return;
    }

    console.log('⚠️  [CACHE MISS] No cached details found - FETCHING from backend...');
    console.log('💡 [OPTIMIZATION] This data was NOT loaded with the gallery');
    console.log('⏱️  [TIMING] Loading NOW on user demand (lazy loading)');
    
    setLoadingNerdsTab(true);
    
    try {
      console.log('📡 [API CALL] Sending getImageById request to background script...');
      const response = await chrome.runtime.sendMessage({
        action: 'getImageById',
        data: { id: imageId }
      });

      console.log('📨 [API RESPONSE] Received response:', response.success ? 'SUCCESS' : 'FAILED');

      if (response.success && response.data) {
        console.log('✅ [LAZY LOAD] Full image details loaded successfully!');
        console.log('📊 [LOADED DATA]:', {
          fileName: response.data.fileName,
          fileType: response.data.fileType,
          fileSize: response.data.fileSize,
          dimensions: `${response.data.width}x${response.data.height}`,
          sha256: response.data.sha256 ? 'present' : 'missing',
          pHash: response.data.pHash ? 'present' : 'missing',
          aHash: response.data.aHash ? 'present' : 'missing',
          dHash: response.data.dHash ? 'present' : 'missing'
        });
        console.log('💾 [CACHE UPDATE] Storing details in state for future use');
        setFullImageDetails(response.data);
      } else {
        console.error('❌ [API ERROR] Failed to load details - no data in response');
      }
    } catch (error) {
      console.error('❌ [ERROR] Exception while loading full image details:', error);
    } finally {
      console.log('🏁 [DONE] Setting loadingNerdsTab to false');
      setLoadingNerdsTab(false);
    }
  };

  const handleTabSwitch = (tabName) => {
    console.log('═══════════════════════════════════════════');
    console.log('🔄 [TAB SWITCH] User clicked:', tabName);
    setActiveTab(tabName);
    
    // Lazy load full details ONLY when "For Nerds" tab is clicked
    if (tabName === 'nerds' && selectedImage) {
      console.log('🔍 [NERD TAB CLICKED] Checking if we need to load full details...');
      console.log('📦 [CACHE CHECK] Current fullImageDetails:', fullImageDetails ? 'EXISTS' : 'NULL');
      console.log('🆔 [CACHE CHECK] Selected image ID:', selectedImage.id);
      console.log('🆔 [CACHE CHECK] Cached details ID:', fullImageDetails?.id || 'N/A');
      loadFullImageDetails(selectedImage.id);
    } else if (tabName === 'noobs') {
      console.log('👶 [NOOBS TAB] Switched to For Noobs tab - NO lazy loading needed');
    }
    console.log('═══════════════════════════════════════════');
  };

  const startEditing = (field) => {
    setEditingField(field);
    const currentValue = modalImage?.[field] ?? selectedImage?.[field] ?? '';
    if (field === 'tags') {
      const tagsValue = Array.isArray(modalImage?.tags)
        ? modalImage.tags.join(', ')
        : (Array.isArray(selectedImage?.tags) ? selectedImage.tags.join(', ') : '');
      setEditValues({ ...editValues, [field]: tagsValue });
    } else if (field === 'creationDate' && currentValue) {
      const date = new Date(currentValue);
      const offset = date.getTimezoneOffset() * 60000;
      const localDate = new Date(date.getTime() - offset);
      setEditValues({ ...editValues, [field]: localDate.toISOString().slice(0, 16) });
    } else {
      setEditValues({ ...editValues, [field]: currentValue });
    }
  };

  const saveEdit = async (field) => {
    try {
      let value = editValues[field];
      if (field === 'tags') {
        value = value.split(',').map(t => t.trim()).filter(t => t);
      } else if (field === 'creationDate' && value) {
        value = new Date(value).toISOString();
      }
      
      // Handle collectionId change specially - need to update counts
      if (field === 'collectionId') {
        const oldCollectionId = selectedImage.collectionId;
        const newCollectionId = value || null;
        
        console.log('📝 [Collection Edit]', { oldCollectionId, newCollectionId });
        
        // Update the image's collectionId
        const updateData = { collectionId: newCollectionId };
        const updateResult = await chrome.runtime.sendMessage({
          action: 'updateImage',
          data: { id: selectedImage.id, ...updateData }
        });
        
        if (!updateResult.success) {
          throw new Error(updateResult.error || 'Failed to update image');
        }
        
        // Update collection counts
        try {
          if (oldCollectionId) {
            console.log('➖ Decrementing old collection:', oldCollectionId);
            const oldCollection = collections.find(c => c.id === oldCollectionId);
            if (oldCollection) {
              const decrementResult = await chrome.runtime.sendMessage({
                action: 'updateCollection',
                data: {
                  id: oldCollectionId,
                  updates: {
                    imageCount: Math.max(0, (oldCollection.imageCount || 1) - 1)
                  }
                }
              });
              if (!decrementResult.success) {
                console.error('Failed to decrement old collection count:', decrementResult.error);
              }
            }
          }
          
          if (newCollectionId) {
            console.log('➕ Incrementing new collection:', newCollectionId);
            const newCollection = collections.find(c => c.id === newCollectionId);
            if (newCollection) {
              const incrementResult = await chrome.runtime.sendMessage({
                action: 'updateCollection',
                data: {
                  id: newCollectionId,
                  updates: {
                    imageCount: (newCollection.imageCount || 0) + 1
                  }
                }
              });
              if (!incrementResult.success) {
                console.error('Failed to increment new collection count:', incrementResult.error);
              }
            }
          }
        } catch (countError) {
          console.error('Error updating collection counts:', countError);
          // Don't fail the whole operation if count update fails
        }
        
        setSelectedImage({ ...selectedImage, collectionId: newCollectionId });
        setFullImageDetails((prev) =>
          prev && prev.id === selectedImage.id
            ? { ...prev, collectionId: newCollectionId }
            : prev
        );
        setEditingField(null);
        
        // Reload both images and collections to reflect the changes
        await Promise.all([reload(), reloadCollections()]);
        return;
      }
      
      const updateData = { [field]: value };
      await chrome.runtime.sendMessage({
        action: 'updateImage',
        data: { id: selectedImage.id, ...updateData }
      });
      
      setSelectedImage({ ...selectedImage, [field]: value });
      setFullImageDetails((prev) =>
        prev && prev.id === selectedImage.id
          ? { ...prev, [field]: value }
          : prev
      );
      setEditingField(null);
    } catch (error) {
      console.error('Failed to update field:', error);
      alert('Failed to update');
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValues({});
  };

    const downloadImage = async (url, source) => {
      try {
        // For Filemoon, direct URLs are already stored as /d/{filecode}
        if (source === 'filemoon') {
          window.open(url, '_blank', 'noopener,noreferrer');
          showToast('✅ Opening Filemoon download page...', 'success', 3000);
          return;
        }
      
      // For UDrop, open in new tab
      if (source === 'udrop') {
        window.open(url, '_blank');
        showToast('✅ Opening UDrop download page...', 'success', 3000);
        return;
      }
      
      // For direct image URLs (Pixvid, ImgBB), download directly
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Extract filename from URL
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const filename = pathParts[pathParts.length - 1] || `image-${source}.jpg`;
      
      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed');
    }
  };

  const openDuplicateMatchInNewTab = (dup) => {
    const candidateUrls = [
      dup?.sourcePageUrl,
      dup?.originalSourceUrl,
      dup?.sourceImageUrl,
      dup?.pageUrl,
      dup?.imgbbUrl,
      dup?.pixvidUrl
    ].filter(Boolean);

    const jumpUrl = candidateUrls.find((url) => {
      if (typeof url !== 'string') return false;
      return /^https?:\/\//i.test(url);
    });

    if (!jumpUrl) {
      showToast('❌ No valid URL found for this duplicate match', 'error', 3000);
      return;
    }

    window.open(jumpUrl, '_blank', 'noopener,noreferrer');
    showToast('✅ Opened duplicate match in a new tab', 'success', 2000);
  };

  const groupImagesByDate = (images) => {
    const groups = {};
    images.forEach(img => {
      const date = new Date(img.internalAddedTimestamp);
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

  const groupedImages = useMemo(() => groupImagesByDate(filteredImages), [filteredImages]);

  // Build timeline data for scrollbar (grouped by month/year)
  useEffect(() => {
    const dateKeys = Object.keys(groupedImages);
    const monthGroups = {};
    
    // Group dates by month/year
    dateKeys.forEach(dateKey => {
      // Get the first image from this date group to extract the actual date
      const firstImage = groupedImages[dateKey][0];
      if (firstImage && firstImage.internalAddedTimestamp) {
        const date = new Date(firstImage.internalAddedTimestamp);
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

  // Check for pending image from right-click context menu
  useEffect(() => {
    console.log('🚀 GalleryPage useEffect running - checking for pending image...');
    const checkPendingImage = async () => {
      try {
        const { pendingImage } = await chrome.storage.local.get('pendingImage');
        console.log('📦 Pending image from storage:', pendingImage);
        console.log('📦 Has srcUrl?', !!pendingImage?.srcUrl);
        console.log('📦 srcUrl value:', pendingImage?.srcUrl);
        
        if (pendingImage) {
          // Clear the pending image
          await chrome.storage.local.remove('pendingImage');
          
          if (pendingImage.srcUrl) {
            console.log('✅ Pending image found! Opening modal...');
            const derivedFileName = pendingImage.fileName ||
              (pendingImage.srcUrl.startsWith('data:')
                ? (pendingImage.isYouTubeFrame ? 'youtube-frame.png' : 'image.png')
                : (pendingImage.srcUrl.split('/').pop().split('?')[0] || 'image.jpg'));
            // Normal flow - has srcUrl
            setUploadImageData({
              srcUrl: pendingImage.srcUrl,
              fileName: derivedFileName,
              pageTitle: pendingImage.pageTitle || '',
              isWarningSite: pendingImage.isWarningSite || false,
              warningSiteName: pendingImage.warningSiteName || '',
              isGoodQualitySite: pendingImage.isGoodQualitySite || false,
              goodQualitySiteName: pendingImage.goodQualitySiteName || ''
            });
            setUploadPageUrl(pendingImage.pageUrl || '');
            
            // Open the upload modal
            setShowUploadModal(true);
            console.log('🎨 Modal should be open now!');
            
            // Extract metadata
            try {
              const response = await chrome.runtime.sendMessage({
                action: 'extractMetadata',
                imageUrl: pendingImage.srcUrl,
                pageUrl: pendingImage.pageUrl,
                fileName: derivedFileName
              });

              if (response.success) {
                setUploadMetadata(response.metadata);
                
                // Check for duplicates
                if (response.metadata.duplicateImage) {
                  setDuplicateData(response.metadata.duplicateImage);
                }
              }
            } catch (error) {
              console.error('Failed to extract metadata:', error);
            }
          } else {
            // No srcUrl - show modal with upload prompt
            console.log('⚠️ No srcUrl - showing upload prompt');
            setUploadPageUrl(pendingImage.pageUrl || '');
            setIsManualUploadMode(true);
            setShowUploadModal(true);
            console.log('🎨 Modal opened with upload prompt!');
          }
        } else {
          console.log('❌ No pending image found in storage');
        }
      } catch (error) {
        console.error('❌ Error checking pending image:', error);
      }
    };
    
    checkPendingImage();
  }, []);

  // Handle auto-open upload from debug page
  useEffect(() => {
    const hydratePendingAutoUpload = async () => {
      if (location.state?.autoOpenUpload) {
        return;
      }

      try {
        const { pendingAutoUpload } = await chrome.storage.local.get('pendingAutoUpload');
        if (!pendingAutoUpload?.autoOpenUpload || pendingAutoUpload?.pausedUntilFocus) {
          return;
        }

        navigate(location.pathname, { replace: true, state: pendingAutoUpload });
      } catch (error) {
        console.error('Failed to hydrate pending auto-upload state:', error);
      }
    };

    hydratePendingAutoUpload();
  }, [location.pathname, location.state?.autoOpenUpload, navigate]);

  useEffect(() => {
    const retryPendingAutoUpload = async () => {
      if (location.state?.autoOpenUpload || showUploadModal) {
        return;
      }

      try {
        const { pendingAutoUpload } = await chrome.storage.local.get('pendingAutoUpload');
        if (pendingAutoUpload?.autoOpenUpload && !pendingAutoUpload?.pausedUntilFocus) {
          navigate(location.pathname, { replace: true, state: pendingAutoUpload });
        }
      } catch (error) {
        console.error('Failed to retry pending auto-upload hydration:', error);
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        retryPendingAutoUpload();
      }
    };

    window.addEventListener('focus', retryPendingAutoUpload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', retryPendingAutoUpload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [location.pathname, location.state?.autoOpenUpload, navigate, showUploadModal]);

  useEffect(() => {
    if (location.state?.autoOpenUpload) {
      // If a file was provided (from debug page with File System API)
      if (location.state?.uploadFile) {
        const file = location.state.uploadFile;
        console.log('🐛 Debug page upload file received:', file.name);
        
        // Process the file and open modal
        const processFile = async () => {
          await processMediaFile(file, 'debug://upload', 'Debug Upload');
          setIsLocalUpload(true);
          setShowUploadModal(true);
          
          const fileType = file.type.startsWith('video/') ? 'Video' : 'Image';
          showToast(`✅ ${fileType} loaded successfully!`, 'success', 3000);
        };
        
        processFile();
      } else if (location.state?.downloadFilePath) {
        // Auto-load file using saved directory handle
        console.log('🐛 [AUTO-LOAD] Starting auto-load for:', location.state.downloadFilePath);
        setPendingDownloadSourceUrl(String(location.state.downloadSourceUrl || '').trim());
        setShowUploadModal(true);
        
        const loadDownloadedFile = async () => {
          try {
            const fileName = getFileNameFromPath(location.state.downloadFilePath);
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            console.log('� [AUTO-LOAD] Extracted filename:', fileName);
            
            // Try to get saved directory handle
            let dirHandle = await getDirectoryHandle();
            
            if (dirHandle) {
              try {
                console.log('✅ [AUTO-LOAD] Using saved directory handle');
                // Retry briefly in case file visibility lags after host completion.
                let file = null;
                let lastErr = null;
                for (let attempt = 1; attempt <= 30; attempt++) {
                  try {
                    file = await getFileFromDirectoryHandle(dirHandle, fileName, location.state.downloadFilePath);
                    break;
                  } catch (candidateErr) {
                    lastErr = candidateErr;
                    if (candidateErr?.name !== 'NotFoundError' || attempt === 30) {
                      throw candidateErr;
                    }
                    console.log(`⏳ [AUTO-LOAD] File not visible yet (attempt ${attempt}/30). Retrying...`);
                    await sleep(500);
                  }
                }
                if (!file && lastErr) throw lastErr;
                
                console.log('✅ [AUTO-LOAD] File loaded successfully:', file.name, file.size, 'bytes');
                
                // Process and show modal
                await processMediaFile(file, location.state.downloadSourceUrl || pendingDownloadSourceUrl || 'native-download://upload', 'Downloaded Video');
                setIsLocalUpload(true);
                setShowUploadModal(true);
                showToast(`✅ Video "${fileName}" loaded successfully!`, 'success', 3000);
                return;
              } catch (fileErr) {
                console.log('⚠️ [AUTO-LOAD] Failed to access file with saved handle:', fileErr.message);
                const errorName = fileErr?.name || '';
                if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
                  await clearDirectoryHandle();
                }
              }
            }
            
            // No saved handle or it failed. We need a user gesture to open the picker,
            // so hand off to the existing folder-prompt UI instead of auto-opening it here.
            console.log('📂 [AUTO-LOAD] No usable directory handle. Prompting user to pick the download folder...');
            setPendingDownloadFile(location.state.downloadFilePath);
            setShowFolderPrompt(true);
            showToast(`Select the download folder to load "${fileName}" automatically.`, 'info', 4000);
            
          } catch (err) {
            console.error('❌ [AUTO-LOAD] Unexpected error:', err);
            setPendingDownloadFile(location.state.downloadFilePath);
            setShowFolderPrompt(true);
            showToast('Select the download folder to finish loading the downloaded file.', 'warning', 4000);
          }
        };
        
        loadDownloadedFile();
      } else {
        // Just open the upload modal (for native download without file path)
        console.log('🐛 Auto-opening upload modal after download');
        setShowUploadModal(true);
        showToast('✅ Download complete! Please select the downloaded file to upload.', 'info', 4000);
      }
      
      // Clear the navigation state
      chrome.storage.local.remove('pendingAutoUpload').catch(() => {});
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  return (
  <div ref={pageContainerRef} className="min-h-screen bg-base-200 text-base-content overflow-y-auto">
      {/* Drag & Drop Overlay with Animated Highlights */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 pointer-events-none"
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 via-secondary-500/20 to-primary-500/20 backdrop-blur-sm" />
            
            {/* Animated border glow */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute inset-8"
            >
              {/* Pulsing border */}
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 40px rgba(139, 92, 246, 0.4)',
                    '0 0 0 4px rgba(236, 72, 153, 0.3), 0 0 60px rgba(236, 72, 153, 0.4)',
                    '0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 40px rgba(139, 92, 246, 0.4)',
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="w-full h-full rounded-[var(--radius-box)] border-4 border-dashed border-base-content/40"
              />
              
              {/* Center content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ 
                    type: "spring",
                    stiffness: 200,
                    damping: 15,
                    delay: 0.1
                  }}
                  className="relative mb-6"
                >
                  {/* Glowing background */}
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 0.8, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl"
                  />
                  
                  {/* Upload icon */}
                  <div className="relative z-10 bg-base-100 rounded-full p-8 shadow-2xl">
                    <Upload className="w-20 h-20 text-primary-600" />
                  </div>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-center"
                >
                  <h3 className="text-4xl font-bold text-base-content mb-3 drop-shadow-2xl">
                    Drop your image here
                  </h3>
                  <p className="text-xl text-base-content/80 drop-shadow-lg">
                    Release to upload to ImgVault
                  </p>
                </motion.div>
                
                {/* Floating particles */}
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      x: [0, Math.random() * 200 - 100],
                      y: [0, Math.random() * 200 - 100],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeOut"
                    }}
                    className="absolute w-3 h-3 bg-base-content/60 rounded-full blur-sm"
                    style={{
                      left: '50%',
                      top: '50%',
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Scrollbar */}
      <TimelineScrollbar dateGroups={timelineData} containerRef={pageContainerRef} />

      <GalleryNavbar
        key={`gallery-navbar-${collectionId || 'all'}`}
        collectionId={collectionId}
        currentCollection={currentCollection}
        navigate={navigate}
        images={images}
        defaultGallerySource={defaultGallerySource}
        reload={reload}
        toggleSelectionMode={toggleSelectionMode}
        selectionMode={selectionMode}
        collectionsLoading={collectionsLoading}
        collections={collections}
        trashLoading={trashLoading}
        trashedImages={trashedImages}
        openUploadModal={openUploadModal}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedImages={selectedImages}
        selectAll={selectAll}
        filteredImages={filteredImages}
        displayCount={filteredImages.length}
        deselectAll={deselectAll}
        setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
        isDeleting={isDeleting}
        onHeightChange={setNavbarHeight}
      />

      <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '180px' }} />

      <div className="w-full px-3 sm:px-6">
  <div className="px-0">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col justify-center items-center py-32">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-2xl opacity-50 animate-pulse"></div>
              <Spinner size="lg" className="relative z-10" />
            </div>
            <p className="mt-6 text-base-content/85 text-lg font-medium">Loading your vault...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && images.length === 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="glass-card rounded-[var(--radius-box)] backdrop-blur-xl bg-base-100/80 border border-base-content/20 
                      shadow-2xl p-16 text-center relative overflow-hidden"
            style={{ willChange: 'transform, opacity' }}
          >
            {/* Animated background gradient */}
            <motion.div
              className="absolute inset-0 opacity-20"
              style={{ willChange: 'background' }}
              animate={{
                background: [
                  'radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 80% 50%, rgba(236, 72, 153, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 50% 80%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 50% 20%, rgba(236, 72, 153, 0.3) 0%, transparent 50%)',
                  'radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
                ],
              }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            />
            
            {/* Icon with pulse animation */}
            <motion.div 
              className="relative inline-block mb-8"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
              style={{ willChange: 'transform' }}
            >
              <motion.div 
                className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-3xl"
                style={{ willChange: 'transform, opacity' }}
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.3, 0.5, 0.3]
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div 
                className="text-9xl relative z-10 drop-shadow-2xl"
                style={{ willChange: 'transform' }}
                animate={{ 
                  y: [0, -10, 0],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                🖼️
              </motion.div>
            </motion.div>
            
            {/* Text with stagger animation */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.3 }}
              style={{ willChange: 'transform, opacity' }}
            >
              <h3 className="text-4xl font-bold mb-4 drop-shadow-lg bg-gradient-to-r from-base-content to-base-content/70 bg-clip-text text-transparent">
                Your Vault is Empty
              </h3>
              <p className="text-base-content/70 text-lg mb-10 max-w-md mx-auto leading-relaxed">
                Start building your collection by uploading your first image
              </p>
            </motion.div>
            
            {/* CTA Button with hover effects */}
            <motion.button
              onClick={openUploadModal}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.3 }}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
              style={{ willChange: 'transform' }}
              className="group relative px-10 py-5 rounded-[var(--radius-box)] bg-gradient-to-r from-primary-500 to-secondary-500 
                       text-primary-content font-bold text-lg shadow-2xl overflow-hidden
                       transition-all duration-150"
            >
              {/* Button shine effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-base-content/20 to-transparent"
                initial={{ x: '-100%' }}
                whileHover={{ x: '100%' }}
                transition={{ duration: 0.4 }}
                style={{ willChange: 'transform' }}
              />
              
              <span className="relative z-10 flex items-center gap-3">
                <Upload className="w-6 h-6" />
                Upload First Image
              </span>
              
              {/* Glow effect on hover */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-primary-400 to-secondary-400 blur-xl opacity-0 group-hover:opacity-50 transition-opacity duration-150"
                style={{ zIndex: -1 }}
              />
            </motion.button>
            
            {/* Floating particles */}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 bg-base-content/20 rounded-full"
                style={{
                  left: `${20 + i * 12}%`,
                  top: `${30 + (i % 3) * 20}%`,
                  willChange: 'transform, opacity'
                }}
                animate={{
                  y: [0, -20, 0],
                  opacity: [0.2, 0.5, 0.2],
                }}
                transition={{
                  duration: 2 + i * 0.3,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.15,
                }}
              />
            ))}
          </motion.div>
        )}

        {/* Gallery Grid */}
        {!loading && Object.keys(groupedImages).map(date => (
          <div key={date} className="mb-10" ref={el => dateGroupRefs.current[date] = el}>
            <h2 className="text-2xl font-bold text-base-content mb-6 flex items-center gap-3">
              <span className="bg-gradient-to-r from-primary-500 to-secondary-500 w-1 h-8 rounded-full"></span>
              {date}
            </h2>
            
            {/* Horizontal row-first grid (left-to-right ordering by time) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-6">
              {groupedImages[date].map((img, index) => (
                <motion.div
                  key={img.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    duration: 0.3,
                    delay: Math.min(index * 0.02, 1.0), // Cap the delay to prevent excessive staggering
                    ease: 'easeOut'
                  }}
                  whileHover={{ scale: 1.01 }}
                  className="group relative cursor-pointer"
                  onClick={(e) => {
                    if (selectionMode) {
                      toggleImageSelection(img.id, e);
                    } else {
                      setIsModalAnimating(true);
                      setSelectedImage(img);
                      setActiveTab('noobs');
                      setFullImageDetails(null);
                      setTimeout(() => setIsModalAnimating(false), 300);
                    }
                  }}
                >
                  {/* Soft glow effect on hover */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/40 to-secondary-500/40 
                                rounded-[var(--radius-box)] opacity-0 group-hover:opacity-100 blur-xl 
                                transition-all duration-700 ease-out"></div>
                  
                  {/* Card with soft shadows and smooth animations */}
                  <div className="relative bg-base-100/80 backdrop-blur-sm border border-base-content/20
                                rounded-[var(--radius-box)] overflow-hidden shadow-lg group-hover:shadow-xl
                                transform transition-all duration-300 ease-out">
                    {/* Selection Checkbox - shown in selection mode */}
                    {selectionMode && (
                      <div className="absolute top-2 right-2 z-20">
                        <div className={`w-6 h-6 rounded-[var(--radius-box)] border-2 flex items-center justify-center
                                      transition-all duration-200 ${
                          selectedImages.has(img.id)
                            ? 'bg-primary-500 border-primary-400'
                            : 'bg-base-300/70 border-base-content/40 backdrop-blur-sm'
                        }`}>
                          {selectedImages.has(img.id) && (
                            <span className="text-sm font-bold">✓</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Loading skeleton with shimmer - only show for non-video items */}
                    {!loadedImages.has(img.id) && !getPreferredVideoWatchUrl(img) && !img.isLink && (
                        <div className="absolute inset-0 bg-base-300 overflow-hidden">
                          <div className="absolute inset-0 shimmer"></div>
                        </div>
                      )}
                      
                    {/* Render image or video thumbnail/embed */}
                    {img.isLink ? (
                        (() => {
                          const linkPreviewImage = getLinkPreviewImage(img);
                          return (
                            <div className="relative w-full aspect-video bg-base-200">
                              {linkPreviewImage ? (
                                <img
                                  src={linkPreviewImage}
                                  alt={img.pageTitle || 'Link preview'}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  onLoad={() => handleImageLoad(img.id)}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-base-content/45">
                                  <Link2 className="w-10 h-10" />
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : getPreferredVideoWatchUrl(img) ? (
                        shouldRenderModalVideoPlayer(img) ? (
                          <video
                            src={getPreferredVideoDirectUrl(img)}
                            className="w-full aspect-video object-cover pointer-events-none"
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedData={() => handleImageLoad(img.id)}
                          />
                        ) : (
                          <iframe
                           src={getPreferredVideoWatchUrl(img)}
                            className="w-full aspect-video object-cover pointer-events-none"
                            frameBorder="0"
                            scrolling="no"
                            style={{ pointerEvents: 'none' }}
                            onLoad={() => handleImageLoad(img.id)}
                          />
                        )
                      ) : (
                        <img
                          src={img.imgbbUrl || img.pixvidUrl}
                        alt={img.pageTitle}
                        onLoad={() => handleImageLoad(img.id)}
                        className={`w-full object-cover transition-all duration-700 ease-out
                                 group-hover:scale-110
                                 ${loadedImages.has(img.id) 
                                   ? 'opacity-100' 
                                   : 'opacity-0'}`}
                        loading="lazy"
                      />
                    )}
                    
                    {/* Video play icon overlay */}
                    {getPreferredVideoWatchUrl(img) && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-base-300/80 backdrop-blur-sm rounded-full p-4">
                          <svg className="w-12 h-12 text-base-content" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </div>
                      </div>
                    )}
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out">
                      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2 
                                    transform translate-y-2 group-hover:translate-y-0 
                                    transition-transform duration-500 ease-out">
                        <p className="text-base-content text-sm font-semibold truncate drop-shadow-xl">
                          {img.pageTitle || 'Untitled'}
                        </p>
                        {img.tags && img.tags.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {img.tags.slice(0, 2).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-[var(--radius-box)] bg-base-100/70 backdrop-blur-sm 
                                         text-base-content border border-base-content/30 font-medium shadow-lg"
                              >
                                {tag}
                              </span>
                            ))}
                            {img.tags.length > 2 && (
                              <span className="text-xs px-2.5 py-1 rounded-[var(--radius-box)] bg-base-100/70 backdrop-blur-sm 
                                             text-base-content border border-base-content/30 font-medium shadow-lg">
                                +{img.tags.length - 2}
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

        {/* Animated Photo Viewer / Lightbox Modal */}
        <Modal
          isOpen={!!selectedImage}
          onClose={() => {
            setSelectedImage(null);
            setActiveTab('noobs');
            setFullImageDetails(null);
          }}
          className="!max-w-[95vw] !w-full !h-[95vh] !p-0 !overflow-hidden"
        >
          {selectedImage && (
            <div className={`flex flex-col lg:flex-row h-full relative transition-all duration-500 ease-out
                          ${isModalAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
              
              {/* Dark Overlay Background with Fade */}
              <div className={`absolute inset-0 bg-base-300/90 transition-opacity duration-500
                            ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} />

              {/* LEFT SIDE - IMAGE/VIDEO with Zoom Animation */}
              <div className="flex-1 min-h-[35vh] lg:min-h-0 flex items-center justify-center bg-gradient-to-br from-base-300 to-base-200 p-3 sm:p-6 lg:p-8 relative z-10">
                {/* Radial glow effect */}
                <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              w-4/5 h-4/5 bg-primary/10 rounded-full blur-3xl
                              transition-all duration-700 ease-out
                              ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}></div>
                
                {/* Conditional rendering for video or image */}
                {modalImage?.isLink ? (
                  (() => {
                    const linkPreviewUrl = modalImage?.linkUrl || modalImage?.sourcePageUrl || '';
                    const linkPreviewImage = getLinkPreviewImage(modalImage);
                    return (
                      <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 overflow-hidden border border-base-content/10 bg-base-100
                                 transition-all duration-700 ease-out
                                 ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
                        <div className="h-full p-4 sm:p-6">
                          <div className="h-full rounded-[var(--radius-box)] border border-base-content/12 bg-base-100 overflow-hidden">
                            <div className="h-full flex flex-col md:flex-row">
                              <div className="flex-1 p-4 sm:p-6 flex flex-col justify-between min-w-0">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-base-content/70">
                                    <Link2 className="w-4 h-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wide">Saved Link</span>
                                  </div>
                                  <h3 className="text-xl font-bold text-base-content leading-snug">
                                    {modalImage?.pageTitle || 'Untitled Link'}
                                  </h3>
                                  <p className="text-base-content/70 text-sm leading-relaxed">
                                    {modalImage?.description || 'Saved page bookmark'}
                                  </p>
                                </div>
                                <a
                                  href={linkPreviewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-info text-sm break-all hover:underline mt-4"
                                >
                                  {linkPreviewUrl || 'N/A'}
                                </a>
                              </div>
                              <div className="md:w-[42%] lg:w-[40%] h-48 md:h-auto bg-base-200 border-t md:border-t-0 md:border-l border-base-content/10">
                                {linkPreviewImage ? (
                                  <img
                                    src={linkPreviewImage}
                                    alt={modalImage?.pageTitle || 'Link preview'}
                                    className="w-full h-full object-contain"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-base-content/45">
                                    <Link2 className="w-12 h-12" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : shouldRenderModalVideoPlayer(modalImage) ? (
                  <video
                    src={getPreferredVideoDirectUrl(modalImage)}
                    className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 bg-black object-contain
                             transition-all duration-700 ease-out
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                    controls
                    preload="metadata"
                    playsInline
                  />
                ) : getPreferredVideoWatchUrl(modalImage) ? (
                  <iframe
                    src={getPreferredVideoWatchUrl(modalImage)}
                    className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10
                             transition-all duration-700 ease-out
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                    frameBorder="0"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                ) : isResolvingModalMediaType ? (
                  <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 flex items-center justify-center bg-base-200/60
                             transition-all duration-700 ease-out
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
                    <div className="text-center space-y-3">
                      <Spinner size="lg" />
                      <div className="text-sm text-base-content/70">Loading media details...</div>
                    </div>
                  </div>
                ) : (
                  <img
                    src={modalImage.imgbbUrl || modalImage.pixvidUrl}
                    alt={modalImage.pageTitle}
                    className={`max-w-full max-h-full object-contain rounded-[var(--radius-box)] shadow-2xl relative z-10
                             transition-all duration-700 ease-out
                             hover:scale-[1.02] hover:shadow-primary/30
                             ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                  />
                )}
              </div>

              {/* RIGHT SIDE - DETAILS with Slide-up Animation */}
  <div className={`w-full lg:w-[550px] lg:flex-shrink-0 bg-base-100 border-t lg:border-t-0 lg:border-l border-base-content/20 
                            overflow-y-auto flex flex-col relative z-10
                            transition-all duration-500 ease-out
                            ${isModalAnimating ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--p)) hsl(var(--b3))' }}
              >
                {/* Close Button with Fade Animation */}
                <button
                  onClick={() => {
                    setSelectedImage(null);
                    setActiveTab('noobs');
                    setFullImageDetails(null);
                  }}
                  className={`absolute top-4 right-4 z-50 w-11 h-11 rounded-full bg-error/20 
                           hover:bg-error/35 border border-error/50 hover:border-error 
                           flex items-center justify-center transition-all duration-300 
                           hover:scale-110 hover:rotate-90 group shadow-xl
                           ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`}
                  title="Close"
                >
                  <span className="text-error group-hover:text-error-content text-2xl font-bold">✕</span>
                </button>

                <div className="p-6 flex-1 pt-16">
              {/* Details Header */}
              <h2 className="text-2xl font-bold text-base-content mb-4">
                Details
              </h2>

              {/* Tab Navigation */}
              <div className="flex items-center justify-between gap-3 mb-4 border-b border-base-content/20">
                {!isSelectedLink && <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
                <button
                  onClick={() => handleTabSwitch('noobs')}
                  className={`px-4 py-2 font-semibold transition-all flex items-center gap-2 ${
                    activeTab === 'noobs'
            ? 'text-info border-b-2 border-info'
            : 'text-base-content/60 hover:text-base-content/85'
                  }`}
                >
                  <span>For Noobs 👶</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    activeTab === 'noobs' 
            ? 'bg-info/20 text-info' 
            : 'bg-base-300/70 text-base-content/60'
                  }`}>
                    {countedBaseFieldCount}
                  </span>
                </button>
                <button
                  onClick={() => handleTabSwitch('nerds')}
                  className={`px-4 py-2 font-semibold transition-all flex items-center gap-2 ${
                    activeTab === 'nerds'
            ? 'text-success border-b-2 border-success'
            : 'text-base-content/60 hover:text-base-content/85'
                  }`}
                >
                  <span>For Nerds 🤓</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    activeTab === 'nerds' 
            ? 'bg-success/20 text-success' 
            : 'bg-base-300/70 text-base-content/60'
                  }`}>
                    {nerdsVisibleFieldCount}
                  </span>
                </button>
                </div>}
                <button
                  onClick={() => {
                    setShowDeleteConfirm(true);
                  }}
                  className="group relative shrink-0 px-4 py-2 rounded-[var(--radius-box)] overflow-hidden
                           bg-error text-error-content
                           border border-error/30
                           transition-all duration-300
                           hover:scale-105 hover:shadow-xl
                           active:scale-95
                           disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="relative flex items-center gap-2 font-semibold">
                    <Trash2 className="w-4 h-4 group-hover:rotate-12 transition-transform duration-300" />
                    <span>Delete</span>
                  </div>
                </button>
              </div>

              {/* For Noobs Tab */}
              {(activeTab === 'noobs' || isSelectedLink) && (
                <div className="space-y-4">
                  <div className="space-y-3 pr-2">
                    <div>
                      <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                        <span className="font-mono">firestoreDocumentId</span>
                      </div>
                      <div className="bg-base-100/60 rounded p-2 flex items-start justify-between gap-3">
                        <p className="text-base-content font-mono text-sm break-all flex-1">
                          {formatBaseFieldValue(selectedImage?.id)}
                        </p>
                        {canOpenFirestoreConsole && (
                          <a
                            href={firestoreConsoleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={inlineActionClass}
                          >
                            Open
                          </a>
                        )}
                      </div>
                    </div>
                    {displayedBaseFieldKeys.map((key, index) => (
                      <div key={key}>
                        <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                          <span className="text-primary font-bold">{index + 1}.</span>
                          <span className="font-mono">{key}</span>
                        </div>
                        <div className="bg-base-100/60 rounded p-2">
                          {key === 'collectionId' ? (
                            editingField === 'collectionId' ? (
                              <div className="space-y-3">
                                <select
                                  value={editValues.collectionId ?? (modalImage?.collectionId || '')}
                                  onChange={(e) => setEditValues({ ...editValues, collectionId: e.target.value })}
                                  className="w-full px-3 py-2 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 text-base-content focus:outline-none focus:border-primary"
                                >
                                  <option value="">No Collection</option>
                                  {collections.map((collection) => (
                                    <option key={collection.id} value={collection.id}>
                                      {collection.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEdit('collectionId')}>
                                    Save Collection
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingField(null);
                                      setEditValues((prev) => ({ ...prev, collectionId: modalImage?.collectionId || '' }));
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-base-content font-mono text-sm break-all">
                                  {collections.find((collection) => collection.id === modalImage?.collectionId)?.name ||
                                    formatBaseFieldValue(modalImage?.collectionId)}
                                </p>
                                <Button variant="ghost" size="sm" onClick={() => startEditing('collectionId')}>
                                  {modalImage?.collectionId ? 'Change Collection' : 'Add to Collection'}
                                </Button>
                              </div>
                            )
                          ) : key === 'pixvidUrl' || key === 'imgbbUrl' || key === 'filemoonDirectUrl' || key === 'udropDirectUrl' ? (
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-base-content font-mono text-sm break-all flex-1">
                                {formatBaseFieldValue(modalImage?.[key])}
                              </p>
                              <Button
                                className={inlineActionClass}
                                onClick={() => downloadImage(
                                  modalImage?.[key],
                                  key === 'pixvidUrl'
                                    ? 'pixvid'
                                    : key === 'imgbbUrl'
                                      ? 'imgbb'
                                      : key === 'filemoonDirectUrl'
                                        ? 'filemoon'
                                        : 'udrop'
                                )}
                                disabled={!modalImage?.[key]}
                              >
                                <Download className="w-3.5 h-3.5" />
                                Download
                              </Button>
                            </div>
                          ) : key === 'sourceImageUrl' || key === 'sourcePageUrl' || key === 'linkUrl' ? (
                            editingField === key ? (
                              <div className="space-y-3">
                                <input
                                  type="url"
                                  value={editValues[key] ?? (modalImage?.[key] || '')}
                                  onChange={(e) => setEditValues({ ...editValues, [key]: e.target.value })}
                                  placeholder={
                                    key === 'sourceImageUrl'
                                      ? 'https://example.com/image.jpg'
                                      : 'https://example.com/page'
                                  }
                                  className="w-full px-3 py-2 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 text-base-content focus:outline-none focus:border-primary"
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEdit(key)}>
                                    Save URL
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingField(null);
                                      setEditValues((prev) => ({ ...prev, [key]: modalImage?.[key] || '' }));
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-base-content font-mono text-sm break-all flex-1">
                                  {formatBaseFieldValue(modalImage?.[key])}
                                </p>
                                <div className="flex items-center gap-2">
                                  <Button
                                    className={`${inlineActionClass} px-2 py-2`}
                                    onClick={() => window.open(modalImage?.[key], '_blank', 'noopener,noreferrer')}
                                    disabled={!modalImage?.[key]}
                                    title="Open in new tab"
                                    aria-label={`Open ${key} in new tab`}
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => startEditing(key)}>
                                    Edit
                                  </Button>
                                </div>
                              </div>
                            )
                          ) : key === 'description' ? (
                            editingField === 'description' ? (
                              <div className="space-y-3">
                                <textarea
                                  value={editValues.description ?? (modalImage?.description || '')}
                                  onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                                  rows={4}
                                  placeholder="Add a description..."
                                  className="w-full px-3 py-2 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 text-base-content focus:outline-none focus:border-primary resize-y"
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEdit('description')}>
                                    Save Description
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingField(null);
                                      setEditValues((prev) => ({ ...prev, description: modalImage?.description || '' }));
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-base-content font-mono text-sm whitespace-pre-wrap break-words flex-1">
                                  {formatBaseFieldValue(modalImage?.description)}
                                </p>
                                <Button variant="ghost" size="sm" onClick={() => startEditing('description')}>
                                  Edit
                                </Button>
                              </div>
                            )
                          ) : key === 'creationDate' ? (
                            editingField === 'creationDate' ? (
                              <div className="space-y-3">
                                <input
                                  type="datetime-local"
                                  value={editValues.creationDate ?? (modalImage?.creationDate ? (() => { const d = new Date(modalImage.creationDate); const offset = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - offset).toISOString().slice(0, 16); })() : '')}
                                  onChange={(e) => setEditValues({ ...editValues, creationDate: e.target.value })}
                                  className="w-full px-3 py-2 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 text-base-content focus:outline-none focus:border-primary font-mono text-sm"
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEdit('creationDate')}>
                                    Save Date
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingField(null);
                                      setEditValues((prev) => ({ ...prev, creationDate: modalImage?.creationDate || '' }));
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-base-content font-mono text-sm">
                                  {modalImage?.creationDate ? new Date(modalImage.creationDate).toLocaleString() : 'N/A'}
                                </p>
                                <Button variant="ghost" size="sm" onClick={() => startEditing('creationDate')}>
                                  Edit
                                </Button>
                              </div>
                            )
                          ) : (
                            <p className="text-base-content font-mono text-sm break-all">
                              {formatBaseFieldValue(modalImage?.[key])}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                    <div className="pt-4 border-t border-base-content/20">
                      {isResolvingModalMediaType ? (
                        <div className="text-sm text-base-content/60 italic">
                          Loading media details...
                        </div>
                      ) : isSelectedVideo && !modalImage.filemoonDirectUrl && !modalImage.udropDirectUrl ? (
                        <div className="text-sm text-base-content/60 italic">
                          No direct video download URLs available.
                        </div>
                      ) : null}
                    </div>
                </div>
              )}

              {/* For Nerds Tab */}
              {activeTab === 'nerds' && !isSelectedLink && (
                <div className="space-y-4">
                  {loadingNerdsTab && !fullImageDetails ? (
                    <div className="flex justify-center items-center py-10">
                      <Spinner size="md" />
                      <span className="ml-3 text-base-content/70">Loading technical details...</span>
                    </div>
                  ) : (
                    <div className="space-y-4 pr-2">
                      {fullImageDetails && nerdsEntries.length === 0 && (
                        <div className="text-sm text-base-content/60 italic">
                          No extra technical fields on this document.
                        </div>
                      )}

                      {fullImageDetails && nerdsEntries.map(([key, value], index) => (
                          <div key={key}>
                            <div className="text-xs font-semibold text-base-content/60 mb-1 flex items-center gap-2">
                              <span className="text-primary font-bold">{index + 1}.</span>
                              {key === 'sha256' ? (
                                <Fingerprint className="w-3.5 h-3.5" />
                              ) : key === 'pHash' || key === 'aHash' || key === 'dHash' ? (
                                <Hash className="w-3.5 h-3.5" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                              {key === 'sha256' ? 'SHA-256' : key}
                            </div>
                            <div className="bg-base-100/60 rounded p-2">
                              <p className="text-base-content font-mono text-sm break-all">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal isOpen={showDeleteConfirm} onClose={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="text-center space-y-6">
            {/* Animated warning icon */}
            <div className="text-7xl animate-bounce">🗑️</div>
            
            <h3 className="text-2xl font-bold text-warning">
              Move to Trash?
            </h3>
            
            <p className="text-base-content/80 text-lg leading-relaxed">
              This will move the image to trash. The image will remain accessible on hosting providers.
              <br />
              <span className="font-semibold text-warning">You can restore it later from the trash.</span>
            </p>
            
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10
                         text-base-content font-medium
                         hover:bg-base-300 hover:scale-105
                         active:scale-95
                         transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                         bg-warning text-warning-content
                         border border-warning/40
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-xl
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-warning-content animate-ping opacity-10" />
                )}
                <div className="relative flex items-center gap-2 font-bold text-lg">
                  {isDeleting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-warning-content/30 border-t-warning-content rounded-full animate-spin" />
                      <span>Moving...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Move to Trash</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </Modal>

        {/* Bulk Delete Confirmation Modal */}
        <Modal isOpen={showBulkDeleteConfirm} onClose={() => !isDeleting && setShowBulkDeleteConfirm(false)}>
          <div className="text-center space-y-6">
            {/* Animated warning icon */}
            <div className="text-7xl animate-bounce">🗑️</div>
            
            <h3 className="text-2xl font-bold text-warning">
              Move {selectedImages.size} Image{selectedImages.size > 1 ? 's' : ''} to Trash?
            </h3>
            
            <p className="text-base-content/80 text-lg leading-relaxed">
              This will move {selectedImages.size} image{selectedImages.size > 1 ? 's' : ''} to trash. The images will remain accessible on hosting providers.
              <br />
              <span className="font-semibold text-warning">You can restore them later from the trash.</span>
            </p>
            
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10
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
                disabled={isDeleting}
                className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden
                         bg-warning text-warning-content
                         border border-warning/40
                         transform transition-all duration-300
                         hover:scale-105 hover:shadow-xl
                         active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {/* Animated pulse effect when deleting */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-warning-content animate-ping opacity-10" />
                )}
                <div className="relative flex items-center gap-2 font-bold text-lg">
                  {isDeleting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-warning-content/30 border-t-warning-content rounded-full animate-spin" />
                      <span>Moving...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span>Move to Trash</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </Modal>

        {/* Floating Action Button (FAB) - Google Photos Style */}
        {!loading && images.length > 0 && (
          <button
            onClick={openUploadModal}
            className="fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full 
                     bg-gradient-to-r from-primary-500 to-secondary-500
                     text-primary-content shadow-2xl hover:shadow-[0_8px_30px_rgb(99,102,241,0.4)]
                     transform transition-all duration-300 ease-out
                     hover:scale-110 active:scale-95
                     flex items-center justify-center
                     group"
            title="Upload Image"
          >
            {/* Pulsing ring effect */}
            <div className="absolute inset-0 rounded-full bg-primary-400 animate-ping opacity-20"></div>
            
            {/* Icon */}
            <Upload className="w-7 h-7 relative z-10 transition-transform duration-300 
                             group-hover:rotate-12" />
          </button>
        )}

        {/* Upload Modal */}
        <Modal
          isOpen={showUploadModal}
          onClose={closeUploadModal}
          fullscreen={true}
          className="!bg-base-100 !backdrop-blur-none !border-base-content/20 shadow-2xl"
          title={
            <div className="flex items-center justify-between w-full">
              <span>Upload Image</span>
              <div className="flex gap-2">
                <button
                  onClick={uploading ? terminateUploadJob : closeUploadModal}
                  className="px-4 py-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 hover:bg-base-300
                           text-base-content text-sm font-medium transition-colors"
                >
                  {uploading ? 'Terminate Upload' : 'Cancel'}
                </button>
                <button
                  onClick={() => handleUploadSubmit(false)}
                  disabled={uploading || !uploadImageData}
                  className="px-4 py-2 rounded-[var(--radius-box)] bg-gradient-to-r from-primary-500 to-secondary-500 
                           hover:from-primary-600 hover:to-secondary-600 text-primary-content text-sm font-medium 
                           transition-all disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-lg hover:shadow-xl"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          }
        >
          <div className="h-[calc(100vh-11rem)] min-h-0 overflow-hidden">
            {!uploadImageData ? (
              <div className="space-y-4 h-full overflow-y-auto pr-2">
                {/* Manual Upload Mode Message */}
                {isManualUploadMode && (
                  <div className="p-6 rounded-[var(--radius-box)] bg-orange-500/20 border-2 border-orange-500/50">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl flex-shrink-0">⚠️</span>
                      <div className="flex-1">
                        <h3 className="text-warning font-bold text-lg mb-3">
                          Image Source Not Available
                        </h3>
                        <p className="text-base-content/85 text-sm leading-relaxed mb-4">
                          The image you tried to save doesn't have a direct URL that the extension can access. This commonly happens with:
                        </p>
                        <ul className="text-base-content/75 text-sm space-y-2 mb-4 list-disc list-inside">
                          <li>Lazy-loaded images that haven't fully loaded yet</li>
                          <li>Images embedded as base64 data</li>
                          <li>Protected or dynamically generated images</li>
                        </ul>
                        <p className="text-warning font-semibold text-sm">
                          📥 Please download the image manually from the page, then upload it below:
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                <label className="block">
                  <div className="flex items-center justify-center w-full min-h-[calc(100vh-16rem)] px-4 transition 
                                bg-base-200 border-2 border-dashed border-base-content/20 rounded-[var(--radius-box)] 
                                hover:border-primary hover:bg-base-300/60 cursor-pointer
                                group">
                    <div className="text-center">
                      <Upload className="w-16 h-16 mx-auto text-base-content/40 group-hover:text-primary 
                                       transition-colors mb-4" />
                      <p className="text-base-content text-lg font-medium mb-2">
                        Click to select an image or video
                      </p>
                      <p className="text-base-content/70 text-sm">
                        or drag and drop
                      </p>
                      <p className="text-base-content/55 text-xs mt-2">
                        Images: PNG, JPG, GIF up to 10MB<br/>
                        Videos: MP4, WebM, AVI, MOV
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,36%)_1fr] gap-6 h-full min-h-0">
                {/* Left Column - Sticky Media Preview */}
                <div className="min-h-0 xl:pr-2 xl:overflow-y-auto">
                  <div className="space-y-3">
                    <div className="relative rounded-[var(--radius-box)] overflow-hidden bg-base-200 border border-base-content/15">
                      {uploadImageData.isVideo ? (
                        <video
                          src={uploadImageData.srcUrl}
                          controls
                          className="w-full h-auto max-h-96 object-contain"
                        />
                      ) : (
                        <>
                          {uploadPreviewResolving && !uploadPreviewSrc ? (
                            <div className="w-full h-64 max-h-96 flex items-center justify-center">
                              <div className="text-center space-y-3">
                                <Spinner size="md" />
                                <div className="text-sm text-base-content/70">Loading preview...</div>
                              </div>
                            </div>
                          ) : (
                            <img
                              src={uploadPreviewSrc || uploadImageData.srcUrl}
                              alt="Preview"
                              className="w-full h-auto max-h-96 object-contain"
                              onError={resolveProtectedUploadPreview}
                            />
                          )}
                        </>
                      )}
                      <button
                        onClick={() => setUploadImageData(null)}
                        className="absolute top-4 right-4 p-2 rounded-[var(--radius-box)] bg-error/85 hover:bg-error 
                                 transition-colors shadow-lg"
                        title={`Remove ${uploadImageData.isVideo ? 'video' : 'image'}`}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* Site-specific replace tips */}
                    {uploadImageData?.isWallHere && (
                      <div className="p-3 rounded-[var(--radius-box)] bg-error/20 border-2 border-error/50 shadow-lg animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-error text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-error font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-base-content/85 text-xs mb-2">
                              For best quality from WallHere, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceWallHereFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceWallHereFile').click()}
                              className="w-full px-3 py-1.5 rounded-[var(--radius-box)] bg-error hover:brightness-95 
                                       border-2 border-error/40 text-error-content text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Sohu replace tip */}
                    {uploadImageData?.isSohu && (
                      <div className="p-3 rounded-[var(--radius-box)] bg-error/20 border-2 border-error/50 shadow-lg animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-error text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-error font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-base-content/85 text-xs mb-2">
                              For best quality from Sohu, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceSohuFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceSohuFile').click()}
                              className="w-full px-3 py-1.5 rounded-[var(--radius-box)] bg-error hover:brightness-95 
                                       border-2 border-error/40 text-error-content text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Airbnb replace tip */}
                    {uploadImageData?.isAirbnb && (
                      <div className="p-3 rounded-[var(--radius-box)] bg-error/20 border-2 border-error/50 shadow-lg animate-pulse-slow">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 text-error text-lg animate-bounce">⚠️</div>
                          <div className="flex-1">
                            <p className="text-error font-bold text-xs mb-1">
                              🔥 Quality Warning
                            </p>
                            <p className="text-base-content/85 text-xs mb-2">
                              For best quality from Airbnb, download the full resolution file first then replace it below.
                            </p>
                            <input
                              type="file"
                              id="replaceAirbnbFile"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => document.getElementById('replaceAirbnbFile').click()}
                              className="w-full px-3 py-1.5 rounded-[var(--radius-box)] bg-error hover:brightness-95 
                                       border-2 border-error/40 text-error-content text-xs font-bold
                                       transition-all duration-200 hover:scale-105 active:scale-95
                                       flex items-center justify-center gap-1.5 shadow-lg"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Replace with Downloaded Image
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Metadata Computation Details */}
                    {uploadMetadata && (
                      <details className="p-4 rounded-[var(--radius-box)] bg-info/10 border border-info/30 space-y-3" open={false}>
                        <summary className="cursor-pointer list-none text-info font-semibold text-sm flex items-center gap-2">
                          <span>🔍</span>
                          Metadata Computation
                        </summary>
                        
                        {/* MIME Type */}
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-base-content/70">MIME Type:</div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-base-content/60">File Object:</span>
                              <span className="text-base-content font-mono bg-base-300/70 px-2 py-0.5 rounded">
                                {uploadImageData?.file?.type || 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-base-content/60">EXIF:</span>
                              <span className="text-base-content font-mono bg-base-300/70 px-2 py-0.5 rounded">
                                {uploadMetadata.exifMetadata?.MIMEType || uploadMetadata.exifMetadata?.FileType || 'Not present'}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-blue-500/20">
                              <div className="text-info font-medium">Logic:</div>
                              <div className="text-base-content/80 mt-1">
                                Use File object, verify against EXIF if present
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Creation Date */}
                        <div className="space-y-2 pt-2 border-t border-blue-500/20">
                          <div className="text-xs font-medium text-base-content/70">Creation Date:</div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-base-content/60 flex-shrink-0">File Object:</span>
                              <span className="text-base-content font-mono bg-base-300/70 px-2 py-0.5 rounded text-right">
                                {uploadImageData?.file?.lastModified 
                                  ? new Date(uploadImageData.file.lastModified).toLocaleString()
                                  : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-base-content/60 flex-shrink-0">EXIF:</span>
                              <span className="text-base-content font-mono bg-base-300/70 px-2 py-0.5 rounded text-right">
                                {uploadMetadata.exifMetadata?.DateTimeOriginal || 
                                 uploadMetadata.exifMetadata?.DateTime || 
                                 uploadMetadata.exifMetadata?.CreateDate || 
                                 'Not present'}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-blue-500/20">
                              <div className="text-info font-medium">Logic:</div>
                              <div className="text-base-content/80 mt-1">
                                Prefer EXIF if exists, fallback to OS lastModified
                              </div>
                            </div>
                          </div>
                        </div>
                      </details>
                    )}
                    
                    {/* Upload Progress */}
                    {uploading && (
                      <div className="p-4 rounded-[var(--radius-box)] bg-primary-500/10 border border-primary-500/30 space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl animate-pulse">{uploadImageData?.isVideo ? '🎬' : '🖼️'}</span>
                          <div className="flex-1">
                            <div className="text-sm text-primary-200 mb-2">
                              <span>
                                {uploadImageData?.isVideo 
                                  ? 'Uploading video to UDrop...' 
                                  : 'Uploading image to Pixvid and ImgBB...'}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-base-300 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 
                                         animate-pulse"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/70 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-base-content">Live Upload Log</h4>
                              <p className="text-xs text-base-content/60">
                                Current uploader output. Full history stays in the Logs page.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate('/logs')}
                              className="btn btn-ghost btn-xs"
                            >
                              Open Logs
                            </button>
                          </div>

                          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                            {uploadLogs.length === 0 ? (
                              <div className="rounded-[var(--radius-box)] border border-dashed border-base-content/15 px-4 py-6 text-center text-sm text-base-content/60">
                                Waiting for uploader logs...
                              </div>
                            ) : (
                              uploadLogs.map((entry, index) => renderUploadLog(entry, index))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Scrollable Form Fields */}
                <div className="min-h-0 space-y-4 overflow-y-auto pr-2"
                     style={{ scrollbarGutter: 'stable' }}>
                  
                  {/* Duplicate Detection - Enhanced UI - Moved to top of right column */}
                  {duplicateData && (
                    <div className="space-y-4 p-5 rounded-[var(--radius-box)] bg-warning/10 border-2 border-warning/30">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 text-warning text-2xl">⚠️</div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-warning font-semibold text-lg mb-2">
                            {duplicateData.all ? `${duplicateData.all.length} Duplicate${duplicateData.all.length !== 1 ? 's' : ''} Found!` : 'Duplicate Found!'}
                          </h4>
                          <p className="text-base-content/80 text-sm mb-4">
                            {duplicateData.all && duplicateData.all.length > 1 
                              ? `This image matches ${duplicateData.all.length} existing images in your vault.`
                              : 'This image already exists in your vault.'}
                          </p>
                          
                          {/* Show all duplicate images */}
                          <div className="space-y-3">
                            {(duplicateData.all || [duplicateData.primary || duplicateData]).map((dup, index) => {
                              const matchType = dup.matchType || 'unknown';
                              const matchReason = dup.matchReason || 'Unknown match';
                              const similarity = dup.similarity || null;
                              
                              return (
                                <div key={index} className="rounded-[var(--radius-box)] overflow-hidden border border-warning/30 bg-base-200">
                                  <div className="w-full flex items-center justify-center bg-base-300/60 p-2 relative">
                                    {/* Match badge */}
                                    <div className="absolute top-2 left-2 px-2 py-1 rounded-[var(--radius-box)] bg-base-100/90 border border-warning/40">
                                      <span className="text-xs font-medium text-warning">
                                        {matchType === 'context' && '🔗 Context'}
                                        {matchType === 'exact' && '🔐 Exact'}
                                        {matchType === 'visual' && '👁️ Visual'}
                                        {matchType === 'unknown' && '❓ Unknown'}
                                      </span>
                                    </div>
                                    <img
                                      src={dup.imgbbUrl || dup.pixvidUrl}
                                      alt={`Duplicate ${index + 1}`}
                                      className="max-w-full max-h-24 object-contain rounded"
                                    />
                                  </div>
                                  <div className="p-3 bg-base-300/50">
                                    <p className="text-base-content text-sm font-medium truncate">
                                      {dup.pageTitle || 'Untitled'}
                                    </p>
                                    {dup.sourcePageUrl && (
                                      <p className="text-base-content/60 text-xs truncate mt-1">
                                        {dup.sourcePageUrl}
                                      </p>
                                    )}
                                    <div className="mt-2 pt-2 border-t border-base-content/10">
                                      <p className="text-xs text-base-content/75">
                                        {matchReason}
                                        {similarity && ` - ${similarity}% similar`}
                                      </p>
                                      <button
                                        onClick={() => openDuplicateMatchInNewTab(dup)}
                                        className="mt-2 px-2.5 py-1 rounded-[var(--radius-box)] bg-info/15 hover:bg-info/25 border border-info/30 text-info text-xs font-medium transition-colors"
                                      >
                                        Open Match
                                      </button>
                                      {dup.hashResults && (
                                        <div className="flex gap-2 mt-1">
                                          {dup.hashResults.pHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                                              pHash ✓
                                            </span>
                                          )}
                                          {dup.hashResults.aHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                                              aHash ✓
                                            </span>
                                          )}
                                          {dup.hashResults.dHash?.match && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                                              dHash ✓
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Action buttons */}
                            <div className="sticky bottom-0 flex gap-3 mt-4 pt-3 bg-base-100/95 backdrop-blur-sm border-t border-warning/20">
                            <button
                              onClick={() => setDuplicateData(null)}
                              className="flex-1 px-4 py-2.5 rounded-[var(--radius-box)] bg-base-300 hover:bg-base-content/15 
                                       text-base-content font-medium transition-colors text-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUploadSubmit(true)}
                              disabled={uploading}
                              className="flex-1 px-4 py-2.5 rounded-[var(--radius-box)] bg-warning hover:brightness-95 font-medium 
                                       transition-all disabled:opacity-50 disabled:cursor-not-allowed
                                       shadow-lg hover:shadow-xl text-sm"
                            >
                              {uploading ? 'Uploading...' : 'Upload Anyway'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Form Fields - Alphabetically ordered */}
                  {uploadImageData ? (
                    <div className="space-y-4">
                      <div className="flex gap-2 border-b border-base-content/15 pb-3">
                        <button
                          onClick={() => setUploadModalMetaTab('noobs')}
                          className={`px-3 py-1.5 rounded-[var(--radius-box)] text-sm font-semibold transition-colors ${
                            uploadModalMetaTab === 'noobs'
                              ? 'bg-primary/20 text-primary'
                              : 'bg-base-200 text-base-content/70 hover:text-base-content'
                          }`}
                        >
                          {`For Noobs (${uploadImageData?.isVideo ? 21 : 20})`}
                        </button>
                        <button
                          onClick={() => setUploadModalMetaTab('nerds')}
                          className={`px-3 py-1.5 rounded-[var(--radius-box)] text-sm font-semibold transition-colors ${
                            uploadModalMetaTab === 'nerds'
                              ? 'bg-success/20 text-success'
                              : 'bg-base-200 text-base-content/70 hover:text-base-content'
                          }`}
                        >
                          {`For Nerds (${
                            Object.entries(uploadMetadata || {})
                              .filter(([key, value]) => {
                                const noobKeys = new Set(
                                  (
                                    uploadImageData?.isVideo
                                      ? [
                                          'sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'fileName', 'fileSize',
                                          'fileType', 'fileTypeSource', 'creationDate', 'creationDateSource',
                                          'internalAddedTimestamp', 'duration', 'width', 'height', 'tags',
                                          'description', 'collectionId', 'isVideo', 'filemoonWatchUrl',
                                          'filemoonDirectUrl', 'udropWatchUrl', 'udropDirectUrl'
                                        ]
                                      : [
                                          'pixvidUrl', 'pixvidDeleteUrl', 'imgbbUrl', 'imgbbDeleteUrl', 'imgbbThumbUrl',
                                          'sourceImageUrl', 'sourcePageUrl', 'pageTitle', 'fileName', 'fileSize',
                                          'width', 'height', 'fileType', 'fileTypeSource', 'creationDate',
                                          'creationDateSource', 'internalAddedTimestamp', 'tags', 'description', 'collectionId'
                                        ]
                                  )
                                );
                                return !noobKeys.has(key) && value !== undefined && value !== null && value !== '';
                              }).length
                          })`}
                        </button>
                      </div>

                      {/* Quality Tip for specific sites */}
                      {(() => {
                        if (uploadImageData?.isVideo) {
                          return null;
                        }

                        const shouldShowWarning = isWarningSite(uploadPageUrl) || uploadImageData?.isWarningSite;
                        const shouldShowGoodQuality = isGoodQualitySite(uploadPageUrl) || uploadImageData?.isGoodQualitySite;

                        if (shouldShowWarning) {
                          const siteName = getSiteDisplayName(uploadPageUrl, sitesConfig.warningSites);
                          return (
                            <div className="mt-3 p-3 rounded-[var(--radius-box)] bg-warning/10 border-2 border-warning/30 shadow-lg animate-pulse-slow">
                              <div className="flex items-start gap-2">
                                <div className="flex-shrink-0 text-error text-lg mt-0.5 animate-bounce">⚠️</div>
                                <div className="flex-1">
                                  <p className="text-warning font-bold text-sm mb-1">
                                    🔥 Quality Warning
                                  </p>
                                  <p className="text-base-content/80 text-xs mb-2">
                                    For best quality, download the image first from {siteName} instead of saving directly from the page. This ensures you get the highest quality version.
                                  </p>
                                  <input
                                    type="file"
                                    id="replaceUploadFile"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                  />
                                  <button
                                    onClick={() => document.getElementById('replaceUploadFile').click()}
                                    className="mt-1 px-3 py-1.5 rounded-[var(--radius-box)] bg-warning hover:bg-warning/90
                                              border-2 border-warning/40 text-warning-content text-xs font-bold
                                              transition-all duration-200 hover:scale-105 active:scale-95
                                              flex items-center gap-1.5 shadow-lg hover:shadow-xl"
                                  >
                                    <Upload className="w-3.5 h-3.5" />
                                    Replace with Downloaded Image
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (shouldShowGoodQuality) {
                          const siteName = getSiteDisplayName(uploadPageUrl, sitesConfig.goodQualitySites);
                          return (
                            <div className="mt-3 p-3 rounded-[var(--radius-box)] bg-success/10 border-2 border-success/30 shadow-lg">
                              <div className="flex items-start gap-2">
                                <div className="flex-shrink-0 text-success text-lg mt-0.5">✓</div>
                                <div className="flex-1">
                                  <p className="text-success font-bold text-sm mb-1">
                                    ✨ Best Quality
                                  </p>
                                  <p className="text-base-content/80 text-xs">
                                    This image from {siteName} is already in the best available quality. You're all set!
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        }



                        return null;
                      })()}

                      {(() => {
                        const isVideoUpload = Boolean(uploadImageData?.isVideo);
                        const normalizedSourceUrl = /^https?:\/\//i.test(String(uploadPageUrl || ''))
                          ? String(uploadPageUrl || '')
                          : (uploadPageUrl === 'Uploaded manually'
                            ? 'Uploaded manually'
                            : String(uploadImageData?.srcUrl || 'Uploaded manually'));
                        const normalizedTags = uploadTags
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean);

                        const noobsFields = isVideoUpload
                          ? [
                              ['sourceImageUrl', normalizedSourceUrl],
                              ['sourcePageUrl', String(uploadPageUrl || 'N/A')],
                              ['pageTitle', String(uploadImageData?.pageTitle || 'N/A')],
                              ['fileName', String(uploadImageData?.fileName || 'N/A')],
                              ['fileSize', uploadMetadata?.fileSize || uploadImageData?.file?.size || 'N/A'],
                              ['fileType', uploadImageData?.fileType || uploadImageData?.file?.type || uploadMetadata?.fileType || 'N/A'],
                              ['fileTypeSource', uploadMetadata?.fileTypeSource || 'N/A'],
                              ['creationDate', uploadMetadata?.creationDate || 'N/A'],
                              ['creationDateSource', uploadMetadata?.creationDateSource || 'N/A'],
                              ['internalAddedTimestamp', 'Auto-generated on save'],
                              ['duration', uploadMetadata?.duration ?? 'N/A'],
                              ['width', uploadMetadata?.width ?? 'N/A'],
                              ['height', uploadMetadata?.height ?? 'N/A'],
                              ['tags', normalizedTags.length ? normalizedTags.join(', ') : '[]'],
                              ['description', uploadDescription || ''],
                              ['collectionId', selectedCollectionId || null],
                              ['isVideo', true],
                              ['filemoonWatchUrl', 'Pending (set after upload)'],
                              ['filemoonDirectUrl', 'Pending (set after upload)'],
                              ['udropWatchUrl', 'Pending (set after upload)'],
                              ['udropDirectUrl', 'Pending (set after upload)'],
                            ]
                          : [
                              ['pixvidUrl', 'Pending (set after upload)'],
                              ['pixvidDeleteUrl', 'Pending (set after upload)'],
                              ['imgbbUrl', 'Pending (set after upload)'],
                              ['imgbbDeleteUrl', 'Pending (set after upload)'],
                              ['imgbbThumbUrl', 'Pending (set after upload)'],
                              ['sourceImageUrl', normalizedSourceUrl],
                              ['sourcePageUrl', String(uploadPageUrl || 'N/A')],
                              ['pageTitle', String(uploadImageData?.pageTitle || 'N/A')],
                              ['fileName', String(uploadImageData?.fileName || 'N/A')],
                              ['fileSize', uploadMetadata?.fileSize || uploadImageData?.file?.size || 'N/A'],
                              ['width', uploadMetadata?.width ?? 'N/A'],
                              ['height', uploadMetadata?.height ?? 'N/A'],
                              ['fileType', uploadImageData?.fileType || uploadImageData?.file?.type || uploadMetadata?.fileType || 'N/A'],
                              ['fileTypeSource', uploadMetadata?.fileTypeSource || 'N/A'],
                              ['creationDate', uploadMetadata?.creationDate || 'N/A'],
                              ['creationDateSource', uploadMetadata?.creationDateSource || 'N/A'],
                              ['internalAddedTimestamp', 'Auto-generated on save'],
                              ['tags', normalizedTags.length ? normalizedTags.join(', ') : '[]'],
                              ['description', uploadDescription || ''],
                              ['collectionId', selectedCollectionId || null],
                            ];

                        const noobKeys = new Set(noobsFields.map(([key]) => key));
                        const nerdEntries = Object.entries(uploadMetadata || {})
                          .filter(([key, value]) => !noobKeys.has(key) && value !== undefined && value !== null && value !== '')
                          .sort(([a], [b]) => a.localeCompare(b));

                        if (uploadModalMetaTab === 'nerds') {
                          if (nerdEntries.length === 0) {
                            return (
                              <div className="rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 p-4 text-sm text-base-content/70">
                                {`No extra metadata fields detected for this ${isVideoUpload ? 'video' : 'image'}.`}
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 p-4">
                              {nerdEntries.map(([key, value], index) => (
                                <div key={key}>
                                  <label className="block text-xs font-medium text-base-content/60 mb-1">
                                    {`${index + 1}. ${key}`}
                                  </label>
                                  <div className="px-3 py-2 rounded-[var(--radius-box)] bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono">
                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 p-4">
                            <div className="text-sm font-medium text-base-content/80 mb-1">
                              {`${isVideoUpload ? 'Video' : 'Image'} Fields To Save (${noobsFields.length})`}
                            </div>
                            {noobsFields.map(([key, value], index) => (
                              <div key={key}>
                                <label className="block text-xs font-medium text-base-content/60 mb-1">
                                  {`${index + 1}. ${key}`}
                                </label>
                                {key === 'description' ? (
                                  <Textarea
                                    value={uploadDescription}
                                    onChange={(e) => setUploadDescription(e.target.value)}
                                    placeholder="Add a description..."
                                    rows={3}
                                    className="w-full px-3 py-2 rounded-[var(--radius-box)] bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono resize-none
                                             focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                                  />
                                ) : (
                                  <div className="px-3 py-2 rounded-[var(--radius-box)] bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono">
                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                  <div className="space-y-4">
                  
                  {/* description */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      description
                    </label>
                    <Textarea
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      placeholder="Add a description..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                               text-base-content placeholder-base-content/40 
                               focus:outline-none focus:border-primary focus:ring-2 
                               focus:ring-primary/20 transition-all resize-none"
                    />
                  </div>

                  {/* collection */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      collection (optional)
                    </label>
                    <select
                      value={selectedCollectionId}
                      onChange={(e) => {
                        if (e.target.value === '__create_new__') {
                          setShowCreateCollection(true);
                        } else {
                          setSelectedCollectionId(e.target.value);
                          setShowCreateCollection(false);
                        }
                      }}
                      className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                               text-base-content 
                               focus:outline-none focus:border-primary focus:ring-2 
                               focus:ring-primary/20 transition-all"
                    >
                      <option value="">No Collection</option>
                      {collections.map(collection => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))}
                      <option value="__create_new__">+ Create New Collection</option>
                    </select>
                    
                    {showCreateCollection && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={newCollectionName}
                          onChange={(e) => setNewCollectionName(e.target.value)}
                          placeholder="Collection name"
                          className="flex-1 px-4 py-2 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                                   text-base-content placeholder-base-content/40 
                                   focus:outline-none focus:border-primary focus:ring-2 
                                   focus:ring-primary/20 transition-all"
                          onKeyPress={async (e) => {
                            if (e.key === 'Enter' && newCollectionName.trim()) {
                              try {
                                const newCollection = await createCollection({ name: newCollectionName.trim() });
                                setSelectedCollectionId(newCollection.id);
                                setShowCreateCollection(false);
                                setNewCollectionName('');
                                showToast('✅ Collection created!', 'success', 2000);
                              } catch (error) {
                                showToast(`❌ ${error.message}`, 'error', 3000);
                              }
                            }
                          }}
                        />
                        <button
                          onClick={async () => {
                            if (newCollectionName.trim()) {
                              try {
                                const newCollection = await createCollection({ name: newCollectionName.trim() });
                                setSelectedCollectionId(newCollection.id);
                                setShowCreateCollection(false);
                                setNewCollectionName('');
                                showToast('✅ Collection created!', 'success', 2000);
                              } catch (error) {
                                showToast(`❌ ${error.message}`, 'error', 3000);
                              }
                            }
                          }}
                          className="px-4 py-2 rounded-[var(--radius-box)] bg-primary hover:brightness-95 
                                   font-medium transition-colors"
                        >
                          Create
                        </button>
                        <button
                          onClick={() => {
                            setShowCreateCollection(false);
                            setNewCollectionName('');
                            setSelectedCollectionId('');
                          }}
                          className="px-4 py-2 rounded-[var(--radius-box)] bg-base-300 hover:bg-base-content/15 
                                   text-base-content font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* pageTitle */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      pageTitle
                    </label>
                    <input
                      type="text"
                      value={uploadImageData?.pageTitle || ''}
                      onChange={(e) => setUploadImageData(prev => ({ ...prev, pageTitle: e.target.value }))}
                      placeholder="Page title"
                      className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                               text-base-content placeholder-base-content/40 
                               focus:outline-none focus:border-primary focus:ring-2 
                               focus:ring-primary/20 transition-all"
                    />
                  </div>

                  {/* sourceImageUrl (Read-only) */}
                  {uploadImageData && (
                    <div>
                      <label className="block text-sm font-medium text-base-content/70 mb-2">
                        sourceImageUrl
                      </label>
                      <div className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                                    text-base-content/75 font-mono text-xs break-all">
                        {/^https?:\/\//i.test(String(uploadPageUrl || ''))
                          ? uploadPageUrl
                          : (uploadPageUrl === 'Uploaded manually' ? 'Uploaded manually' : uploadImageData.srcUrl)}
                      </div>
                    </div>
                  )}
                  
                  {/* sourcePageUrl */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      sourcePageUrl
                    </label>
                    <input
                      type="url"
                      value={uploadPageUrl}
                      onChange={(e) => setUploadPageUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/15 
                               text-base-content placeholder-base-content/40 
                               focus:outline-none focus:border-primary focus:ring-2 
                               focus:ring-primary/20 transition-all"
                     />
                  </div>

                  {/* tags */}
                  <div>
                    <label className="block text-sm font-medium text-base-content/70 mb-2">
                      tags
                    </label>
                    <input
                      type="text"
                      value={uploadTags}
                      onChange={(e) => setUploadTags(e.target.value)}
                      placeholder="nature, sunset, photography"
                      className="w-full px-4 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 
                               text-base-content placeholder-base-content/40 
                               focus:outline-none focus:border-primary-500 focus:ring-2 
                               focus:ring-primary-500/20 transition-all"
                    />
                  </div>

                  {/* Display ALL metadata fields that will be saved */}
                  {uploadMetadata && (() => {
                    const isVideoUpload = Boolean(uploadImageData?.isVideo);
                    const normalizedSourceUrl = /^https?:\/\//i.test(String(uploadPageUrl || ''))
                      ? String(uploadPageUrl || '')
                      : 'Uploaded manually';
                    const normalizedTags = uploadTags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean);

                    if (isVideoUpload) {
                      const videoFields = [
                        ['sourceImageUrl', normalizedSourceUrl],
                        ['sourcePageUrl', String(uploadPageUrl || 'N/A')],
                        ['pageTitle', String(uploadImageData?.pageTitle || 'N/A')],
                        ['fileName', String(uploadImageData?.fileName || 'N/A')],
                        ['fileSize', uploadMetadata?.fileSize || uploadImageData?.file?.size || 'N/A'],
                        ['fileType', uploadImageData?.fileType || uploadImageData?.file?.type || uploadMetadata?.fileType || 'N/A'],
                        ['fileTypeSource', uploadMetadata?.fileTypeSource || 'N/A'],
                        ['creationDate', uploadMetadata?.creationDate || 'N/A'],
                        ['creationDateSource', uploadMetadata?.creationDateSource || 'N/A'],
                        ['internalAddedTimestamp', 'Auto-generated on save'],
                        ['duration', uploadMetadata?.duration ?? 'N/A'],
                        ['width', uploadMetadata?.width ?? 'N/A'],
                        ['height', uploadMetadata?.height ?? 'N/A'],
                        ['tags', normalizedTags.length ? normalizedTags.join(', ') : '[]'],
                        ['description', uploadDescription || ''],
                        ['collectionId', selectedCollectionId || null],
                        ['isVideo', true],
                        ['filemoonWatchUrl', 'Pending (set after upload)'],
                        ['filemoonDirectUrl', 'Pending (set after upload)'],
                        ['udropWatchUrl', 'Pending (set after upload)'],
                        ['udropDirectUrl', 'Pending (set after upload)'],
                      ];

                      return (
                        <div className="space-y-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 p-4">
                          <div className="text-sm font-medium text-base-content/80 mb-1">
                            Video Fields To Save (21)
                          </div>
                          {videoFields.map(([key, value], index) => (
                            <div key={key}>
                              <label className="block text-xs font-medium text-base-content/60 mb-1">
                                {`${index + 1}. ${key}`}
                              </label>
                              <div className="px-3 py-2 rounded-[var(--radius-box)] bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    const allFields = {
                      'aHash': uploadMetadata.aHash || 'N/A',
                      'Creation Date': uploadMetadata.creationDate
                        ? new Date(uploadMetadata.creationDate).toLocaleString()
                        : 'N/A',
                      'creationDateSource': uploadMetadata.creationDateSource || 'N/A',
                      'dHash': uploadMetadata.dHash || 'N/A',
                      'File Name': uploadImageData?.fileName || 'N/A',
                      'File Size': uploadMetadata.fileSize
                        ? `${(uploadMetadata.fileSize / 1024).toFixed(2)} KB`
                        : 'N/A',
                      'fileTypeSource': uploadMetadata.fileTypeSource || 'N/A',
                      'Height': uploadMetadata.height || 'N/A',
                      'MIME Type': uploadMetadata.mimeType || uploadMetadata.fileType || 'N/A',
                      'pHash': uploadMetadata.pHash || 'N/A',
                      'SHA-256': uploadMetadata.sha256 || 'N/A',
                      'Width': uploadMetadata.width || 'N/A',
                      ...(uploadMetadata.exifMetadata || {})
                    };

                    const sortedFields = Object.entries(allFields).sort(([keyA], [keyB]) =>
                      keyA.localeCompare(keyB)
                    );

                    return (
                      <details className="space-y-3 rounded-[var(--radius-box)] bg-base-200 border border-base-content/10 p-4" open={false}>
                        <summary className="cursor-pointer list-none text-sm font-medium text-base-content/80 mb-3">
                          Raw Metadata Fields ({sortedFields.length})
                        </summary>
                        {sortedFields.map(([key, value]) => (
                          <div key={key}>
                            <label className="block text-xs font-medium text-base-content/60 mb-1">
                              {key}
                            </label>
                            <div className="px-3 py-2 rounded-[var(--radius-box)] bg-base-100 border border-base-content/10 text-base-content text-xs break-all font-mono">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
                          </div>
                        ))}
                      </details>
                    );
                  })()}
                </div>
                  )}

                {/* Error Message */}
                {uploadError && !duplicateData && (
                  <div className="p-4 rounded-[var(--radius-box)] bg-error/10 border border-error/30 text-error text-sm">
                    {uploadError?.message || String(uploadError)}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </Modal>

        {/* Toast Notifications */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        
        {/* Folder Selection Prompt for Auto-Upload */}
        {showFolderPrompt && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-base-content/50 backdrop-blur-sm">
            <div className="bg-base-100 border border-base-content/10 rounded-[var(--radius-box)] p-8 max-w-md w-full shadow-2xl text-base-content">
              <div className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-primary text-primary-content rounded-full flex items-center justify-center">
                  <FolderOpen className="w-8 h-8" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold text-base-content mb-2">
                    📂 Select Download Folder
                  </h2>
                  <p className="text-base-content/70">
                    Your video has been downloaded! Please select the folder where it was saved to automatically load it.
                  </p>
                  {pendingDownloadFile && (
                    <p className="mt-3 text-sm text-base-content/80 font-mono bg-base-200 p-2 rounded">
                {getFileNameFromPath(pendingDownloadFile)}
                    </p>
                  )}
                </div>
                
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setShowFolderPrompt(false);
                      setPendingDownloadFile(null);
                      setPendingDownloadSourceUrl('');
                      showToast('❌ Auto-upload cancelled', 'error', 2000);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleSelectDownloadFolder}
                    className="flex-1 flex items-center justify-center gap-2"
                  >
                    <FolderOpen size={20} />
                    Select Folder
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}



