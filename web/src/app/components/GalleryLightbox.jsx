'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Pencil,
  Save,
  Share2,
} from 'lucide-react'

export default function GalleryLightbox({
  image,
  images,
  currentIndex,
  onClose,
  onNavigate,
  onSaveEdits,
  onShare,
  shareStatus = '',
  redactedFields = [],
  preferredProvider = 'imgbb',
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('noobs')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [editValues, setEditValues] = useState({
    pageTitle: '',
    creationDate: '',
    pixvidUrl: '',
    imgbbUrl: '',
    sourceImageUrl: '',
    sourcePageUrl: '',
    description: '',
    tags: '',
  })

  const allMetadataFields = [
    'BlueMatrixColumn',
    'BlueTRC',
    'ColorSpaceData',
    'DeviceManufacturer',
    'DeviceModel',
    'GreenMatrixColumn',
    'GreenTRC',
    'JFIFVersion',
    'MediaWhitePoint',
    'PrimaryPlatform',
    'ProfileCMMType',
    'ProfileClass',
    'ProfileConnectionSpace',
    'ProfileCopyright',
    'ProfileCreator',
    'ProfileDateTime',
    'ProfileDescription',
    'ProfileFileSignature',
    'ProfileVersion',
    'RedMatrixColumn',
    'RedTRC',
    'RenderingIntent',
    'ResolutionUnit',
    'ThumbnailHeight',
    'ThumbnailWidth',
    'XResolution',
    'YResolution',
    'aHash',
    'creationDate',
    'creationDateSource',
    'dHash',
    'description',
    'fileName',
    'fileSize',
    'fileType',
    'height',
    'imgbbDeleteUrl',
    'imgbbThumbUrl',
    'imgbbUrl',
    'internalAddedTimestamp',
    'pHash',
    'pageTitle',
    'pixvidDeleteUrl',
    'pixvidUrl',
    'sha256',
    'sourceImageUrl',
    'sourcePageUrl',
    'tags',
    'width',
  ]

  const noobFields = [
    'pageTitle',
    'creationDate',
    'pixvidUrl',
    'imgbbUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'description',
    'tags',
  ]

  const nerdFields = allMetadataFields.filter((field) => !noobFields.includes(field))
  const editableNoobFields = new Set(noobFields)
  const redactedFieldSet = new Set(redactedFields)

  const toEditValues = useCallback((img) => ({
    pageTitle: img?.pageTitle ?? '',
    creationDate: img?.creationDate ?? '',
    pixvidUrl: img?.pixvidUrl ?? '',
    imgbbUrl: img?.imgbbUrl ?? '',
    sourceImageUrl: img?.sourceImageUrl ?? '',
    sourcePageUrl: img?.sourcePageUrl ?? '',
    description: img?.description ?? '',
    tags: Array.isArray(img?.tags) ? img.tags.join(', ') : '',
  }), [])

  useEffect(() => {
    setIsEditing(false)
    setIsSaving(false)
    setSaveError('')
    setIsLoading(true)
    setEditValues(toEditValues(image))
  }, [image?.id, toEditValues])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, images.length, onClose, onNavigate])

  const toNullableString = (value) => {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  const handleSave = async (e) => {
    e.stopPropagation()
    if (!onSaveEdits || isSaving) return

    setIsSaving(true)
    setSaveError('')

    try {
      const updates = {
        pageTitle: toNullableString(editValues.pageTitle),
        creationDate: toNullableString(editValues.creationDate),
        pixvidUrl: toNullableString(editValues.pixvidUrl),
        imgbbUrl: toNullableString(editValues.imgbbUrl),
        sourceImageUrl: toNullableString(editValues.sourceImageUrl),
        sourcePageUrl: toNullableString(editValues.sourcePageUrl),
        description: toNullableString(editValues.description),
        tags: editValues.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }

      await onSaveEdits(image.id, updates)
      setIsEditing(false)
    } catch (error) {
      setSaveError(error?.message || 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = (e) => {
    e.stopPropagation()
    setIsEditing(false)
    setSaveError('')
    setEditValues(toEditValues(image))
  }

  const imageUrl =
    preferredProvider === 'pixvid'
      ? image.pixvidUrl || image.imgbbUrl || image.imgbbThumbUrl || image.sourceImageUrl
      : image.imgbbUrl || image.imgbbThumbUrl || image.pixvidUrl || image.sourceImageUrl

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const isUrlField = (key) => key.toLowerCase().endsWith('url')

  const formatFieldLabel = (key) =>
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .trim()

  const formatFieldValue = (key, value) => {
    if (value === undefined || value === null || value === '') return 'N/A'
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'N/A'
    if (key === 'fileSize') return formatFileSize(Number(value))

    if (key === 'creationDate' || key === 'internalAddedTimestamp' || key === 'ProfileDateTime') {
      const dt = new Date(value)
      if (!Number.isNaN(dt.getTime())) return dt.toLocaleString()
    }

    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const renderMetadataField = (key, index) => {
    const rawValue = image[key]
    const isRedacted = redactedFieldSet.has(key)
    const isEditableField = activeTab === 'noobs' && isEditing && editableNoobFields.has(key)
    const displayValue = isRedacted ? 'REDACTED' : formatFieldValue(key, rawValue)
    const label = formatFieldLabel(key)

    if (isRedacted) {
      return (
        <div key={key}>
          <div className="text-xs font-semibold text-dark-400 mb-1 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {`${index + 1}. ${label}`}
          </div>
          <div className="bg-dark-800/50 rounded p-2">
            <p className="text-white text-sm break-all font-mono">{displayValue}</p>
          </div>
        </div>
      )
    }

    return (
      <div key={key}>
        <div className="text-xs font-semibold text-dark-400 mb-1 flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          {`${index + 1}. ${label}`}
        </div>

        {isEditableField ? (
          key === 'description' ? (
            <textarea
              value={editValues.description}
              onChange={(e) => setEditValues((prev) => ({ ...prev, description: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              rows={4}
              className="w-full bg-dark-800/70 border border-white/10 rounded p-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
              placeholder="Enter description"
            />
          ) : key === 'tags' ? (
            <input
              type="text"
              value={editValues.tags}
              onChange={(e) => setEditValues((prev) => ({ ...prev, tags: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-dark-800/70 border border-white/10 rounded p-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
              placeholder="tag1, tag2, tag3"
            />
          ) : (
            <input
              type="text"
              value={editValues[key] ?? ''}
              onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-dark-800/70 border border-white/10 rounded p-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
              placeholder={`Enter ${label}`}
            />
          )
        ) : key === 'tags' && Array.isArray(rawValue) && rawValue.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rawValue.map((tag) => (
              <span
                key={`${key}-${tag}`}
                className="px-3 py-1 rounded-full bg-primary-500/20 text-primary-300 text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : isUrlField(key) && typeof rawValue === 'string' && rawValue ? (
          <div className="bg-dark-800/50 rounded p-2">
            <a
              href={rawValue}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:text-primary-300 break-all text-sm"
            >
              {rawValue}
            </a>
          </div>
        ) : (
          <div className="bg-dark-800/50 rounded p-2">
            <p className="text-white text-sm break-all font-mono">{displayValue}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col lg:flex-row bg-black/90 backdrop-blur-xl animate-fade-in"
      onClick={onClose}
    >
      <div className="flex-1 flex items-center justify-center p-3 sm:p-6 lg:p-8 relative min-h-[45vh] lg:min-h-0">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-6 sm:right-6 p-2 sm:p-3 glass rounded-full hover:bg-white/20 transition-all duration-300 z-10"
        >
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {currentIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(currentIndex - 1)
            }}
            className="absolute left-2 sm:left-6 p-2 sm:p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:-translate-x-1"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {currentIndex < images.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(currentIndex + 1)
            }}
            className="absolute right-2 sm:right-6 p-2 sm:p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:translate-x-1"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        <div
          className="relative max-w-full max-h-full animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
            </div>
          )}
          <img
            src={imageUrl}
            alt={image.pageTitle || 'Image'}
            className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-2xl shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
            onLoad={() => setIsLoading(false)}
          />
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 glass rounded-full text-sm">
          {currentIndex + 1} / {images.length}
        </div>
      </div>

      <div className="w-full lg:w-[400px] max-h-[50vh] lg:max-h-none bg-dark-900/95 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-white/10 overflow-y-auto flex flex-col">
        <div className="p-6 flex-1">
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-4">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('noobs') }}
              className={`px-4 py-2 font-semibold transition-all rounded-lg ${
                activeTab === 'noobs'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-dark-400 hover:text-white hover:bg-white/5'
              }`}
            >
              For Noobs 👶
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('nerds') }}
              className={`px-4 py-2 font-semibold transition-all rounded-lg ${
                activeTab === 'nerds'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-dark-400 hover:text-white hover:bg-white/5'
              }`}
            >
              For Nerds 🤓
            </button>
          </div>

          {activeTab === 'noobs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-dark-400">
                  {onSaveEdits ? 'You can edit these 8 fields.' : 'Shared image preview'}
                </p>
                <div className="flex items-center gap-2">
                  {onShare && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onShare(image)
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-white/5 text-dark-100 hover:bg-white/10 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share
                    </button>
                  )}
                  {onSaveEdits && (
                    isEditing ? (
                      <>
                        <button
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                          className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 text-dark-200 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setIsEditing(true); setSaveError('') }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    )
                  )}
                </div>
              </div>

              {shareStatus && (
                <div className="rounded-lg border border-primary-500/30 bg-primary-500/10 text-primary-200 text-xs p-2">
                  {shareStatus}
                </div>
              )}

              {saveError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">
                  {saveError}
                </div>
              )}

              {noobFields.map((field, index) => renderMetadataField(field, index))}
            </div>
          )}

          {activeTab === 'nerds' && (
            <div className="space-y-4">
              {[...nerdFields]
                .concat(redactedFields.filter((field) => !nerdFields.includes(field)))
                .map((field, index) => renderMetadataField(field, index))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
