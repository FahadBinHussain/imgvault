/**
 * @fileoverview Main Popup Page Component
 * @version 2.0.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button, Input, Textarea, Card, IconButton, Spinner } from '../components/UI';
import { usePendingImage, useImageUpload, useChromeStorage, useCollections } from '../hooks/useChromeExtension';

export default function PopupPage() {
  const navigate = useNavigate();
  const [pendingImage, clearPending] = usePendingImage();
  const [settings] = useChromeStorage('pixvidApiKey', null, 'sync');
  const { uploadImage, uploading, progress, error: uploadError } = useImageUpload();
  const { collections, createCollection } = useCollections();

  const [imageData, setImageData] = useState(null);
  const [pageUrl, setPageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [uploadMetadata, setUploadMetadata] = useState(null);
  const [isPageUrlEditable, setIsPageUrlEditable] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [duplicateData, setDuplicateData] = useState(null);
  const [showReplaced, setShowReplaced] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (pendingImage) {
      setImageData(pendingImage);
      setPageUrl(pendingImage.pageUrl || '');
      clearPending();
    }
  }, [pendingImage, clearPending]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // Save current page metadata before replacing
      const savedPageUrl = pageUrl;
      const savedPageTitle = imageData?.pageTitle;
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        setImageData({
          srcUrl: reader.result,
          pageUrl: savedPageUrl || window.location.href,
          pageTitle: savedPageTitle || 'Uploaded from computer',
          timestamp: Date.now(),
          file: file // Store the original file object for MIME and date extraction
        });
        
        // Restore original page URL if it was set
        if (savedPageUrl && savedPageUrl !== window.location.href) {
          setPageUrl(savedPageUrl);
        }
        
        // Show replaced banner
        setShowReplaced(true);
        setTimeout(() => setShowReplaced(false), 4000);
        
        // Extract metadata from the image
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'extractMetadata',
            imageUrl: reader.result,
            pageUrl: savedPageUrl || window.location.href,
            fileName: file.name,
            fileMimeType: file.type,
            fileLastModified: file.lastModified
          });
          
          if (response.success && response.metadata) {
            setUploadMetadata(response.metadata);
            console.log('📸 Extracted metadata:', response.metadata);
          }
        } catch (error) {
          console.error('Failed to extract metadata:', error);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async (ignoreDuplicate = false) => {
    if (!imageData) return;

    // Clear previous duplicate data when starting new upload
    setDuplicateData(null);

    try {
      const tagsArray = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await uploadImage({
        imageUrl: imageData.srcUrl,
        pageUrl: pageUrl,
        pageTitle: imageData.pageTitle,
        description,
        tags: tagsArray,
        ignoreDuplicate: ignoreDuplicate,
        fileMimeType: imageData.file?.type || null,
        fileLastModified: imageData.file?.lastModified || null,
        collectionId: selectedCollectionId || null
      });

      setShowSuccess(true);
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (err) {
      console.error('Upload failed:', err);
      
      // Check if error has duplicate data
      if (err?.duplicate) {
        console.log('Duplicate data found:', err.duplicate);
        setDuplicateData(err.duplicate);
      }
      // For non-duplicate errors, the error will be shown by uploadError state
    }
  };

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const openSettings = () => {
    navigate('/settings');
  };

  const openGallery = () => {
    navigate('/gallery');
  };

  // No image view
  if (!imageData) {
    return (
      <div className="w-[420px] min-h-[400px] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl">
          {/* Header with glassmorphism */}
          <div className="p-6 border-b border-white/10 backdrop-blur-xl bg-white/5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg blur-md opacity-50"></div>
                <img src="/icons/icon48.png" alt="ImgVault" className="w-10 h-10 relative z-10 rounded-lg shadow-lg" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent">ImgVault</h2>
                <p className="text-sm text-slate-300">Your personal image vault</p>
              </div>
              <button
                onClick={openGallery}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 
                         backdrop-blur-sm transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl"
                title="Gallery"
              >
                <ImageIcon className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={openSettings}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 
                         backdrop-blur-sm transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl"
                title="Settings"
              >
                <Settings className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Empty State with soft shadows and animations */}
          <div className="p-8 text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full blur-2xl opacity-30 animate-pulse"></div>
              <div className="relative text-7xl">🖼️</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Image Selected</h3>
            <p className="text-slate-300 mb-4">
              Right-click any image on a webpage and select "Save to ImgVault"
            </p>
            <div className="relative inline-block my-4">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent"></div>
              <span className="relative px-4 bg-slate-900 text-slate-400 text-sm">or</span>
            </div>
            <div className="mt-4">
              <input
                type="file"
                id="fileInput"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => document.getElementById('fileInput').click()}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                         text-white font-semibold shadow-xl hover:shadow-2xl hover:scale-105 
                         active:scale-95 transition-all duration-300 flex items-center gap-2 mx-auto"
              >
                <Upload className="w-5 h-5" />
                Upload from Computer
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success view
  if (showSuccess) {
    return (
      <div className="w-[420px] min-h-[400px] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl rounded-2xl p-8 text-center">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full blur-3xl opacity-50 animate-pulse"></div>
            <div className="relative text-7xl">✅</div>
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-green-300 to-emerald-300 bg-clip-text text-transparent mb-2">
            Image Saved!
          </h3>
          <p className="text-slate-300">Successfully uploaded to your vault</p>
        </div>
      </div>
    );
  }

  // Image upload view
  return (
    <div className="w-[420px] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl">
        {/* Header with glassmorphism */}
        <div className="p-6 border-b border-white/10 backdrop-blur-xl bg-white/5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg blur-md opacity-50"></div>
              <img src="/icons/icon48.png" alt="ImgVault" className="w-10 h-10 relative z-10 rounded-lg shadow-lg" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent">Save to Vault</h2>
              <p className="text-sm text-slate-300">Preserve with context</p>
            </div>
            <button
              onClick={openSettings}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 
                       backdrop-blur-sm transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl"
              title="Settings"
            >
              <Settings className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Image Preview with soft shadows */}
        <div className="p-6 space-y-4">
          <div className="relative rounded-xl overflow-hidden bg-slate-800/50 border border-white/10 shadow-xl group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/40 to-secondary-500/40 
                          rounded-xl opacity-0 group-hover:opacity-100 blur-xl transition-all duration-500"></div>
            <div className="relative">
              <img
                src={imageData.srcUrl}
                alt="Preview"
                className="w-full h-auto max-h-64 object-contain transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute bottom-3 right-3">
                <input
                  type="file"
                  id="replaceFile"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => document.getElementById('replaceFile').click()}
                  className="px-4 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/20 
                           backdrop-blur-sm text-white text-sm font-medium shadow-lg hover:shadow-xl 
                           transition-all duration-300 hover:scale-105 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Replace
                </button>
              </div>
            </div>
          </div>

          {/* Image Replaced Banner */}
          {showReplaced && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border-2 border-green-500/30 
                          shadow-lg animate-pulse">
              <span className="text-2xl flex-shrink-0">✅</span>
              <p className="text-sm text-green-200 font-medium">
                Image replaced! Ready to upload higher quality version
              </p>
            </div>
          )}

          {/* Google Drive tip with animation */}
          {imageData.isGoogleDrive && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border-2 border-yellow-500/30 
                          shadow-lg animate-pulse-slow">
              <span className="text-2xl flex-shrink-0">💡</span>
              <div className="flex-1">
                <p className="text-sm text-yellow-200/90 leading-relaxed mb-3">
                  For maximum quality from Google Drive, download the file first then use the button below
                </p>
                <input
                  type="file"
                  id="replaceGDriveFile"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => document.getElementById('replaceGDriveFile').click()}
                  className="px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 
                           border border-yellow-400/40 text-yellow-300 text-sm font-medium
                           transition-all duration-200 hover:scale-105 active:scale-95
                           flex items-center gap-2 shadow-lg"
                >
                  <Upload className="w-4 h-4" />
                  Replace with Downloaded Image
                </button>
              </div>
            </div>
          )}

          {/* Wallpaper Mob tip with animation */}
          {imageData.isWallpaperMob && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-purple-500/10 border-2 border-purple-500/30 
                          shadow-lg animate-pulse-slow">
              <span className="text-2xl flex-shrink-0">💡</span>
              <div className="flex-1">
                <p className="text-sm text-purple-200/90 leading-relaxed mb-3">
                  For maximum quality from Wallpaper Mob, download the file first then use the button below
                </p>
                <input
                  type="file"
                  id="replaceWallpaperMobFile"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => document.getElementById('replaceWallpaperMobFile').click()}
                  className="px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 
                           border border-purple-400/40 text-purple-300 text-sm font-medium
                           transition-all duration-200 hover:scale-105 active:scale-95
                           flex items-center gap-2 shadow-lg"
                >
                  <Upload className="w-4 h-4" />
                  Replace with Downloaded Image
                </button>
              </div>
            </div>
          )}

          {/* Form Fields with enhanced styling */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <span className="text-lg">🌐</span>
                Source Page URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  readOnly={!isPageUrlEditable}
                  className="flex-1 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                           text-white placeholder-slate-400 
                           focus:outline-none focus:border-primary-500 focus:ring-2 
                           focus:ring-primary-500/20 transition-all shadow-lg"
                />
                <button
                  onClick={() => setIsPageUrlEditable(!isPageUrlEditable)}
                  className="p-3 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 
                           backdrop-blur-sm transition-all duration-300 hover:scale-105 shadow-lg"
                  title={isPageUrlEditable ? 'Lock' : 'Edit'}
                >
                  {isPageUrlEditable ? <X className="w-5 h-5 text-white" /> : <Settings className="w-5 h-5 text-white" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <span className="text-lg">📝</span>
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`From: ${imageData.pageTitle || 'Unknown'}`}
                rows={3}
                className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                         text-white placeholder-slate-400 
                         focus:outline-none focus:border-primary-500 focus:ring-2 
                         focus:ring-primary-500/20 transition-all resize-none shadow-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <span className="text-lg">🏷️</span>
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="design, inspiration, reference"
                className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                         text-white placeholder-slate-400 
                         focus:outline-none focus:border-primary-500 focus:ring-2 
                         focus:ring-primary-500/20 transition-all shadow-lg"
              />
            </div>

            {/* Collection Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <span className="text-lg">📁</span>
                Collection (optional)
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
                className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                         text-white 
                         focus:outline-none focus:border-primary-500 focus:ring-2 
                         focus:ring-primary-500/20 transition-all shadow-lg"
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
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-600 
                             text-white placeholder-slate-400 
                             focus:outline-none focus:border-primary-500 focus:ring-2 
                             focus:ring-primary-500/20 transition-all"
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
                    className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 
                             text-white font-medium transition-colors text-sm"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateCollection(false);
                      setNewCollectionName('');
                      setSelectedCollectionId('');
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 
                             text-white font-medium transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Display ALL metadata fields that will be saved */}
            {/* Metadata Computation Details */}
            {uploadMetadata && (
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3 mb-4">
                <h4 className="text-blue-300 font-semibold text-sm flex items-center gap-2">
                  <span>🔍</span>
                  Metadata Computation
                </h4>
                
                {/* MIME Type */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-blue-200/70">MIME Type:</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">File Object:</span>
                      <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded">
                        N/A (right-click upload)
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">EXIF:</span>
                      <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded">
                        {uploadMetadata.exifMetadata?.MIMEType || uploadMetadata.exifMetadata?.FileType || 'Not present'}
                      </span>
                    </div>
                    <div className="pt-1 border-t border-blue-500/20">
                      <div className="text-blue-300 font-medium">Logic:</div>
                      <div className="text-blue-200/80 mt-1">
                        Use File object, verify against EXIF if present
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Creation Date */}
                <div className="space-y-2 pt-2 border-t border-blue-500/20">
                  <div className="text-xs font-medium text-blue-200/70">Creation Date:</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-slate-400 flex-shrink-0">File Object:</span>
                      <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded text-right">
                        N/A (right-click upload)
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-slate-400 flex-shrink-0">EXIF:</span>
                      <span className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded text-right">
                        {uploadMetadata.exifMetadata?.DateTimeOriginal || 
                         uploadMetadata.exifMetadata?.DateTime || 
                         uploadMetadata.exifMetadata?.CreateDate || 
                         'Not present'}
                      </span>
                    </div>
                    <div className="pt-1 border-t border-blue-500/20">
                      <div className="text-blue-300 font-medium">Logic:</div>
                      <div className="text-blue-200/80 mt-1">
                        Prefer EXIF if exists, fallback to OS lastModified
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {uploadMetadata && (() => {
              const allFields = {
                'File Name': imageData?.srcUrl?.split('/').pop() || 'N/A',
                'File Type': uploadMetadata.fileType || 'N/A',
                'Creation Date': uploadMetadata.creationDate 
                  ? new Date(uploadMetadata.creationDate).toLocaleString()
                  : 'N/A',
                'File Size': uploadMetadata.fileSize 
                  ? `${(uploadMetadata.fileSize / 1024).toFixed(2)} KB` 
                  : 'N/A',
                'Width': uploadMetadata.width || 'N/A',
                'Height': uploadMetadata.height || 'N/A',
                'SHA-256': uploadMetadata.sha256 || 'N/A',
                'pHash': uploadMetadata.pHash || 'N/A',
                'aHash': uploadMetadata.aHash || 'N/A',
                'dHash': uploadMetadata.dHash || 'N/A',
                ...(uploadMetadata.exifMetadata || {})
              };
              
              return (
                <div className="space-y-2">
                  {Object.entries(allFields).map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        {key}
                      </label>
                      <div className="px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-600 text-white text-xs break-all font-mono">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Upload Progress with glow */}
          {progress && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 shadow-xl">
              {uploading && (
                <div className="relative">
                  <div className="absolute inset-0 bg-primary-400 rounded-full blur-lg opacity-50 animate-pulse"></div>
                  <Spinner size="sm" className="relative z-10" />
                </div>
              )}
              <span className="text-sm text-primary-200 font-medium">{progress}</span>
            </div>
          )}

          {/* Duplicate Detection */}
          {duplicateData && (
            <div className="space-y-4 p-4 rounded-xl bg-yellow-500/10 border-2 border-yellow-500/30">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 text-yellow-400 text-2xl">⚠️</div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-yellow-300 font-semibold text-base mb-2">Duplicate Image Found!</h4>
                  <p className="text-yellow-200/80 text-sm mb-3">
                    This image already exists in your vault. Do you want to upload it anyway?
                  </p>
                  
                  {/* Show duplicate image */}
                  <div className="rounded-lg overflow-hidden border border-yellow-500/30 bg-slate-800/50 max-w-full mb-3">
                    <div className="w-full flex items-center justify-center bg-slate-900/30 p-2">
                      <img
                        src={duplicateData.imgbbUrl || duplicateData.pixvidUrl}
                        alt="Duplicate"
                        className="max-w-full max-h-32 object-contain rounded"
                      />
                    </div>
                    <div className="p-2 bg-slate-900/50">
                      <p className="text-slate-300 text-xs font-medium truncate">
                        {duplicateData.pageTitle || 'Untitled'}
                      </p>
                      {duplicateData.sourcePageUrl && (
                        <p className="text-slate-400 text-xs truncate mt-0.5">
                          {duplicateData.sourcePageUrl}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDuplicateData(null)}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 
                               text-white font-medium transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpload(true)}
                      disabled={uploading}
                      className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 
                               hover:from-yellow-600 hover:to-orange-600 text-white font-medium 
                               transition-all disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 text-sm"
                    >
                      {uploading ? 'Uploading...' : 'Upload Anyway'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message with animation */}
          {uploadError && !duplicateData && (
            <div className="p-4 rounded-xl bg-red-500/10 border-2 border-red-500/30 shadow-xl animate-shake">
              <p className="text-sm text-red-300">{uploadError.message}</p>
            </div>
          )}

          {/* Upload Button with glow effect */}
          {!duplicateData && (
            <button
              onClick={() => handleUpload(false)}
              disabled={uploading || !settings}
              className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       hover:from-primary-600 hover:to-secondary-600 text-white font-semibold text-lg
                       shadow-2xl hover:shadow-[0_8px_30px_rgb(99,102,241,0.4)]
                       transform transition-all duration-300 ease-out
                       hover:scale-105 active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                       flex items-center justify-center gap-3"
            >
              {uploading ? (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 bg-white rounded-full blur-md opacity-50 animate-pulse"></div>
                    <Spinner size="sm" className="relative z-10" />
                  </div>
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">💾</span>
                  <span>Save to Vault</span>
                </>
              )}
            </button>
          )}

          {!settings && (
            <div className="p-4 rounded-xl bg-yellow-500/10 border-2 border-yellow-500/30 text-center">
              <p className="text-sm text-yellow-300 font-medium">
                ⚠️ Please configure API keys in settings first
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
