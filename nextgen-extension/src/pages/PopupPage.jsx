/**
 * @fileoverview Main Popup Page Component
 * @version 2.0.0
 */

import React, { useState, useEffect } from 'react';
import { Settings, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button, Input, Textarea, Card, IconButton, Spinner } from '../components/UI';
import { usePendingImage, useImageUpload, useChromeStorage } from '../hooks/useChromeExtension';

export default function PopupPage() {
  const [pendingImage, clearPending] = usePendingImage();
  const [settings] = useChromeStorage('pixvidApiKey', null, 'sync');
  const { uploadImage, uploading, progress, error: uploadError } = useImageUpload();

  const [imageData, setImageData] = useState(null);
  const [pageUrl, setPageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [isPageUrlEditable, setIsPageUrlEditable] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (pendingImage) {
      setImageData(pendingImage);
      setPageUrl(pendingImage.pageUrl || '');
      clearPending();
    }
  }, [pendingImage, clearPending]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageData({
          srcUrl: reader.result,
          pageUrl: window.location.href,
          pageTitle: 'Uploaded from computer',
          timestamp: Date.now()
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!imageData) return;

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
        tags: tagsArray
      });

      setShowSuccess(true);
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const openSettings = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  };

  const openGallery = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
  };

  // No image view
  if (!imageData) {
    return (
      <div className="w-[420px] min-h-[400px] bg-gradient-primary">
        <div className="glass-card border-none">
          {/* Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <img src="/icons/icon48.png" alt="ImgVault" className="w-8 h-8" />
              <div className="flex-1">
                <h2 className="text-xl font-bold gradient-text">ImgVault</h2>
                <p className="text-sm text-slate-300">Your personal image vault</p>
              </div>
              <IconButton icon={ImageIcon} title="Gallery" onClick={openGallery} />
              <IconButton icon={Settings} title="Settings" onClick={openSettings} />
            </div>
          </div>

          {/* Empty State */}
          <div className="p-8 text-center">
            <div className="text-6xl mb-4">🖼️</div>
            <h3 className="text-lg font-semibold text-white mb-2">No Image Selected</h3>
            <p className="text-slate-300 mb-4">
              Right-click any image on a webpage and select "Save to ImgVault"
            </p>
            <p className="text-slate-400 mb-4">— or —</p>
            <div>
              <input
                type="file"
                id="fileInput"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="primary"
                onClick={() => document.getElementById('fileInput').click()}
              >
                📤 Upload from Computer
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success view
  if (showSuccess) {
    return (
      <div className="w-[420px] min-h-[400px] bg-gradient-primary flex items-center justify-center">
        <Card className="text-center p-8">
          <div className="text-6xl mb-4">✅</div>
          <h3 className="text-xl font-bold text-white mb-2">Image Saved!</h3>
          <p className="text-slate-300">Successfully uploaded to your vault</p>
        </Card>
      </div>
    );
  }

  // Image upload view
  return (
    <div className="w-[420px] bg-gradient-primary">
      <div className="glass-card border-none">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/icons/icon48.png" alt="ImgVault" className="w-8 h-8" />
            <div className="flex-1">
              <h2 className="text-xl font-bold gradient-text">Save to Vault</h2>
              <p className="text-sm text-slate-300">Preserve with context</p>
            </div>
            <IconButton icon={Settings} title="Settings" onClick={openSettings} />
          </div>
        </div>

        {/* Image Preview */}
        <div className="p-6 space-y-4">
          <div className="relative rounded-lg overflow-hidden bg-black/20">
            <img
              src={imageData.srcUrl}
              alt="Preview"
              className="w-full h-auto max-h-64 object-contain"
            />
            <div className="absolute bottom-2 right-2">
              <input
                type="file"
                id="replaceFile"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                size="sm"
                variant="glass"
                onClick={() => document.getElementById('replaceFile').click()}
              >
                📁 Replace
              </Button>
            </div>
          </div>

          {/* Google Drive tip */}
          {imageData.isGoogleDrive && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <span className="text-xl">💡</span>
              <p className="text-sm text-yellow-200">
                For maximum quality from Google Drive, download the file first then use "Replace" button
              </p>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                🌐 Source Page URL
              </label>
              <div className="flex gap-2">
                <Input
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  readOnly={!isPageUrlEditable}
                  className="flex-1"
                />
                <IconButton
                  icon={isPageUrlEditable ? X : Settings}
                  title={isPageUrlEditable ? 'Lock' : 'Edit'}
                  onClick={() => setIsPageUrlEditable(!isPageUrlEditable)}
                />
              </div>
            </div>

            <Textarea
              label="📝 Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`From: ${imageData.pageTitle || 'Unknown'}`}
              rows={3}
            />

            <Input
              label="🏷️ Tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="design, inspiration, reference"
            />
          </div>

          {/* Upload Progress */}
          {progress && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              {uploading && <Spinner size="sm" />}
              <span className="text-sm text-slate-200">{progress}</span>
            </div>
          )}

          {/* Error Message */}
          {uploadError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm text-red-200">{uploadError.message}</p>
            </div>
          )}

          {/* Upload Button */}
          <Button
            variant="primary"
            className="w-full"
            onClick={handleUpload}
            disabled={uploading || !settings}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
                <span>Uploading...</span>
              </div>
            ) : (
              <span>💾 Save to Vault</span>
            )}
          </Button>

          {!settings && (
            <p className="text-center text-sm text-yellow-300">
              ⚠️ Please configure API keys in settings first
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
