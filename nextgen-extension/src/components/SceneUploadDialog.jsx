/**
 * @fileoverview 3D Scene Upload Dialog
 * @version 2.0.0
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, Box, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button, Input, Textarea, Modal } from './UI';
import { useSceneUpload, useCollections } from '../hooks/useChromeExtension';

export default function SceneUploadDialog({ isOpen, onClose, onUploaded }) {
  const { uploadScene, uploading, progress, error: uploadError, logs } = useSceneUpload();
  const { collections, createCollection } = useCollections();

  const [spzFile, setSpzFile] = useState(null);
  const [textureFile, setTextureFile] = useState(null);
  const [pageTitle, setPageTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const spzInputRef = useRef(null);
  const textureInputRef = useRef(null);

  const handleSpzDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file && file.name.endsWith('.spz')) {
      setSpzFile(file);
      if (!pageTitle) {
        setPageTitle(file.name.replace('.spz', ''));
      }
    }
  }, [pageTitle]);

  const handleTextureDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file && (file.name.endsWith('.webp') || file.type === 'image/webp')) {
      setTextureFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!spzFile || !textureFile) return;

    try {
      const tagsArray = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);

      // Convert to plain arrays — chrome.runtime.sendMessage structured clone
      // corrupts/zeroes large ArrayBuffers in MV3 service workers.
      const spzArray = Array.from(new Uint8Array(await spzFile.arrayBuffer()));
      const textureArray = Array.from(new Uint8Array(await textureFile.arrayBuffer()));

      const result = await uploadScene({
        spzArray,
        spzFileName: spzFile.name,
        spzFileSize: spzFile.size,
        textureArray,
        textureFileName: textureFile.name,
        textureFileSize: textureFile.size,
        textureMimeType: textureFile.type,
        pageTitle: pageTitle || spzFile.name.replace('.spz', ''),
        description,
        tags: tagsArray,
        collectionId: collectionId || null,
        pageUrl: '',
        fileLastModified: spzFile.lastModified,
      });

      resetForm();
      onClose();
      if (onUploaded) onUploaded(result);
    } catch (err) {
      console.error('Scene upload failed:', err);
    }
  };

  const resetForm = () => {
    setSpzFile(null);
    setTextureFile(null);
    setPageTitle('');
    setDescription('');
    setTags('');
    setCollectionId('');
  };

  const handleClose = () => {
    if (!uploading) {
      resetForm();
      onClose();
    }
  };

  const canUpload = spzFile && textureFile && !uploading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <Box className="w-6 h-6 text-cyan-500" />
          <span>Add 3D Scene</span>
        </div>
      }
    >
      <div className="space-y-5">
        {/* SPZ File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            spzFile
              ? 'border-cyan-500 bg-cyan-500/10'
              : 'border-base-content/30 hover:border-cyan-500/50'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleSpzDrop}
          onClick={() => spzInputRef.current?.click()}
        >
          <input
            ref={spzInputRef}
            type="file"
            accept=".spz"
            className="hidden"
            onChange={handleSpzDrop}
          />
          {spzFile ? (
            <div className="flex items-center justify-center gap-2 text-cyan-500">
              <Box className="w-5 h-5" />
              <span className="font-medium">{spzFile.name}</span>
              <span className="text-sm opacity-70">({(spzFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              <button
                onClick={(e) => { e.stopPropagation(); setSpzFile(null); }}
                className="p-1 hover:bg-cyan-500/20 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <Box className="w-8 h-8 mx-auto mb-2 text-base-content/50" />
              <p className="text-base-content/70">Drop .spz file here or click to browse</p>
              <p className="text-xs text-base-content/50 mt-1">3D Gaussian Splatting scene file</p>
            </>
          )}
        </div>

        {/* Texture File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            textureFile
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-base-content/30 hover:border-purple-500/50'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleTextureDrop}
          onClick={() => textureInputRef.current?.click()}
        >
          <input
            ref={textureInputRef}
            type="file"
            accept=".webp,image/webp"
            className="hidden"
            onChange={handleTextureDrop}
          />
          {textureFile ? (
            <div className="flex items-center justify-center gap-2 text-purple-500">
              <ImageIcon className="w-5 h-5" />
              <span className="font-medium">{textureFile.name}</span>
              <span className="text-sm opacity-70">({(textureFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              <button
                onClick={(e) => { e.stopPropagation(); setTextureFile(null); }}
                className="p-1 hover:bg-purple-500/20 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <ImageIcon className="w-8 h-8 mx-auto mb-2 text-base-content/50" />
              <p className="text-base-content/70">Drop texture .webp file here or click to browse</p>
              <p className="text-xs text-base-content/50 mt-1">Texture atlas for the 3D scene</p>
            </>
          )}
        </div>

        {/* Metadata Fields */}
        <Input
          label="Title"
          value={pageTitle}
          onChange={(e) => setPageTitle(e.target.value)}
          placeholder="Scene name"
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
        />

        <Input
          label="Tags (comma separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="3d, gaussian-splatting, scene"
        />

        {/* Collection Selector */}
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-2">
            Collection
          </label>
          <select
            className="select w-full bg-base-100/70 border border-base-content/20 text-base-content"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
          >
            <option value="">No collection</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>

        {/* Upload Progress */}
        {uploading && (
          <div className="bg-base-200/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{progress}</span>
            </div>
            {logs.length > 0 && (
              <div className="mt-2 max-h-24 overflow-y-auto text-xs space-y-1">
                {logs.slice(0, 5).map((log, i) => (
                  <div key={i} className={`${
                    log.type === 'error' ? 'text-error' :
                    log.type === 'warning' ? 'text-warning' :
                    log.type === 'success' ? 'text-success' :
                    'text-base-content/60'
                  }`}>
                    {log.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {uploadError && (
          <div className="bg-error/10 text-error rounded-lg p-3 text-sm">
            {uploadError.message || String(uploadError)}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleUpload}
            disabled={!canUpload}
            className="bg-cyan-600 hover:bg-cyan-700 border-none"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload Scene
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
