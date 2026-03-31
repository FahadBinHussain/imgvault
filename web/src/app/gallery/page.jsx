'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { 
  Image, 
  Search, 
  Grid, 
  List, 
  ExternalLink,
  Calendar,
  Tag,
  Loader2,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FileText,
  Pencil,
  Save
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'
import GalleryLightbox from '../components/GalleryLightbox'

async function readJsonSafely(res) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function getPreferredImageUrl(image, preferredProvider = 'imgbb') {
  if (preferredProvider === 'pixvid') {
    return image.pixvidUrl || image.imgbbUrl || image.imgbbThumbUrl || image.sourceImageUrl || null
  }

  return image.imgbbUrl || image.imgbbThumbUrl || image.pixvidUrl || image.sourceImageUrl || null
}

// Skeleton Loader Component with Shimmer
function SkeletonCard({ viewMode }) {
  return (
    <div className={`glass rounded-2xl overflow-hidden ${viewMode === 'list' ? 'flex' : ''}`} style={{ minHeight: viewMode === 'list' ? 'auto' : '200px' }}>
      <div className={`${viewMode === 'list' ? 'w-32 h-28' : 'h-full min-h-[200px]'} relative overflow-hidden bg-dark-800/50`}>
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
      </div>
      {viewMode === 'list' && (
        <div className="p-4 space-y-3 flex-1">
          <div className="relative overflow-hidden rounded h-4 bg-dark-700/50">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
          </div>
          <div className="relative overflow-hidden rounded h-3 bg-dark-700/50 w-1/2">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
          </div>
        </div>
      )}
    </div>
  )
}

// Empty State Component
function EmptyState({ hasConfig }) {
  if (!hasConfig) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mb-8 animate-float">
          <Settings className="w-12 h-12 text-primary-400" />
        </div>
        <h3 className="text-2xl font-bold mb-3 gradient-text">Configure Firebase First</h3>
        <p className="text-dark-400 mb-8 max-w-md mx-auto">Set up your Firebase config to start viewing your images</p>
        <a 
          href="/settings" 
          className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all duration-300 hover:-translate-y-1"
        >
          <Settings className="w-5 h-5" />
          Go to Settings
        </a>
      </div>
    )
  }

  return (
    <div className="text-center py-20 animate-fade-in">
      <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mb-8 animate-float">
        <Sparkles className="w-12 h-12 text-primary-400" />
      </div>
      <h3 className="text-2xl font-bold mb-3">No Images Yet</h3>
      <p className="text-dark-400 mb-8 max-w-md mx-auto">Start saving images from the Chrome extension to see them here</p>
      <a 
        href="https://github.com/FahadBinHussain/ImgVault" 
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-8 py-4 glass rounded-2xl font-semibold hover:bg-white/10 transition-all duration-300 hover:-translate-y-1 gradient-border"
      >
        <ExternalLink className="w-5 h-5" />
        Get the Extension
      </a>
    </div>
  )
}

// Lightbox Modal Component
function Lightbox({ image, images, currentIndex, onClose, onNavigate, onSaveEdits }) {
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
    setEditValues(toEditValues(image))
  }, [image?.id, toEditValues])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex])

  const handlePrev = () => {
    if (currentIndex > 0) {
      onNavigate(currentIndex - 1)
      setIsLoading(true)
    }
  }

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      onNavigate(currentIndex + 1)
      setIsLoading(true)
    }
  }

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

  const imageUrl = image.imgbbUrl || image.imgbbThumbUrl || image.pixvidUrl || image.sourceImageUrl

  // Format file size
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
    const isEditableField = activeTab === 'noobs' && isEditing && editableNoobFields.has(key)
    const displayValue = formatFieldValue(key, rawValue)
    const label = formatFieldLabel(key)

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
      {/* Left side - Image */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-6 lg:p-8 relative min-h-[45vh] lg:min-h-0">
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-6 sm:right-6 p-2 sm:p-3 glass rounded-full hover:bg-white/20 transition-all duration-300 z-10"
        >
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {/* Navigation buttons */}
        {currentIndex > 0 && (
          <button 
            onClick={(e) => { e.stopPropagation(); handlePrev() }}
            className="absolute left-2 sm:left-6 p-2 sm:p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:-translate-x-1"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
        
        {currentIndex < images.length - 1 && (
          <button 
            onClick={(e) => { e.stopPropagation(); handleNext() }}
            className="absolute right-2 sm:right-6 p-2 sm:p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:translate-x-1"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* Image container */}
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

        {/* Counter */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 glass rounded-full text-sm">
          {currentIndex + 1} / {images.length}
        </div>
      </div>

      {/* Right side - Details Panel */}
      <div className="w-full lg:w-[400px] max-h-[50vh] lg:max-h-none bg-dark-900/95 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-white/10 overflow-y-auto flex flex-col">
        <div className="p-6 flex-1">
          {/* Tab Navigation */}
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-4">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('noobs'); }}
              className={`px-4 py-2 font-semibold transition-all rounded-lg ${
                activeTab === 'noobs'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-dark-400 hover:text-white hover:bg-white/5'
              }`}
            >
              For Noobs 👶
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('nerds'); }}
              className={`px-4 py-2 font-semibold transition-all rounded-lg ${
                activeTab === 'nerds'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-dark-400 hover:text-white hover:bg-white/5'
              }`}
            >
              For Nerds 🤓
            </button>
          </div>

          {/* For Noobs Tab */}
          {activeTab === 'noobs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-dark-400">You can edit these 8 fields.</p>
                <div className="flex items-center gap-2">
                  {isEditing ? (
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
                  )}
                </div>
              </div>

              {saveError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">
                  {saveError}
                </div>
              )}

              {noobFields.map((field, index) => renderMetadataField(field, index))}
            </div>
          )}

          {/* For Nerds Tab */}
          {activeTab === 'nerds' && (
            <div className="space-y-4">
              {nerdFields.map((field, index) => renderMetadataField(field, index))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Image Card Component
function ImageCard({ image, index, viewMode, onClick, className = '', preferredProvider = 'imgbb' }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  
  const imageUrl = getPreferredImageUrl(image, preferredProvider)

  return (
    <div 
      className={`group relative glass rounded-2xl overflow-hidden cursor-pointer transition-all duration-500 hover:-translate-y-2 hover:shadow-xl hover:shadow-primary-500/10 ${viewMode === 'list' ? 'flex' : ''} ${className}`}
      style={{ 
        animationDelay: `${index * 50}ms`,
        animation: 'fadeInUp 0.6s ease-out forwards',
        opacity: 0
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {/* Image Container */}
      <div
        className={`${viewMode === 'list' ? 'w-28 h-24 sm:w-40 sm:h-28 flex-shrink-0' : 'h-auto'} bg-dark-900 relative overflow-hidden`}
        style={viewMode !== 'list' && !isLoaded ? { minHeight: '220px' } : undefined}
      >
        {imageUrl ? (
          <>
            {!isLoaded && (
              <div className="absolute inset-0 bg-dark-800/70">
                <div
                  className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  style={{ backgroundSize: '200% 100%' }}
                />
              </div>
            )}
            <img
              src={imageUrl}
              alt={image.pageTitle || 'Saved image'}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-contain' : 'h-auto object-contain'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center">
            <Image className="w-12 h-12 text-dark-500" />
          </div>
        )}
        
        {/* Hover overlay */}
        <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
        </div>

        {/* Gradient border effect */}
        <div className={`absolute inset-0 rounded-2xl transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
          style={{
            background: 'linear-gradient(135deg, rgba(92, 124, 250, 0.3), transparent, rgba(92, 124, 250, 0.1))',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Content - Only show in list mode */}
      {viewMode === 'list' && (
        <div className="p-4 space-y-3 flex-1 flex flex-col justify-center">
          <h3 className="text-sm font-semibold truncate transition-colors duration-300 group-hover:text-primary-400" title={image.pageTitle || 'Untitled'}>
            {image.pageTitle || 'Untitled'}
          </h3>
          <div className="flex items-center gap-2 text-xs text-dark-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {image.internalAddedTimestamp
                ? new Date(image.internalAddedTimestamp).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })
                : 'Unknown date'}
            </span>
          </div>
          {image.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {image.tags.slice(0, 3).map((tag) => (
                <span
                  key={`${image.id}-${tag}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-500/10 text-primary-300 text-xs font-medium transition-all duration-300 hover:bg-primary-500/20"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Group images by date helper
function groupImagesByDate(images) {
  const groups = {}
  
  images.forEach((img) => {
    const date = img.internalAddedTimestamp 
      ? new Date(img.internalAddedTimestamp).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      : 'Unknown Date'
    
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(img)
  })
  
  return Object.entries(groups).map(([date, imgs]) => ({
    date,
    images: imgs
  }))
}

// Date Header Component
function DateHeader({ date }) {
  return (
    <div className="col-span-full py-4 flex items-center gap-4">
      <div className="flex-shrink-0 w-16 text-right">
        <span className="text-sm font-semibold text-primary-400">
          {date.split(' ')[1]?.replace(',', '') || ''}
        </span>
        <div className="text-xs text-dark-400">
          {date.split(' ')[0]}
        </div>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
    </div>
  )
}

// Main Gallery Component
export default function GalleryPage() {
  const { data: session, status } = useSession()
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasConfig, setHasConfig] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [shareStatus, setShareStatus] = useState('')
  const [preferredProvider, setPreferredProvider] = useState('imgbb')

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
    }
    
    if (status === 'authenticated') {
      checkConfig()
    }
  }, [status])

  const checkConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      const configured = !!data.config
      setHasConfig(configured)
      setPreferredProvider(data?.settings?.defaultGallerySource === 'pixvid' ? 'pixvid' : 'imgbb')

      if (!configured) {
        setImages([])
        return
      }

      const imagesRes = await fetch('/api/images', { cache: 'no-store' })
      const imagesData = await imagesRes.json()

      if (!imagesRes.ok) {
        throw new Error(imagesData.error || 'Failed to load images')
      }

      setImages(Array.isArray(imagesData.images) ? imagesData.images : [])
    } catch (error) {
      console.error('Failed to check config:', error)
      setLoadError(error.message || 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }

  const filteredImages = images.filter((img) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true

    const haystack = [
      img.pageTitle,
      img.description,
      img.sourcePageUrl,
      ...(img.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(q)
  })

  const handleImageClick = useCallback((image, index) => {
    setShareStatus('')
    setSelectedImage(image)
    setSelectedIndex(index)
  }, [])

  const handleCloseLightbox = useCallback(() => {
    setShareStatus('')
    setSelectedImage(null)
    setSelectedIndex(-1)
  }, [])

  const handleNavigate = useCallback((index) => {
    setShareStatus('')
    setSelectedImage(filteredImages[index])
    setSelectedIndex(index)
  }, [filteredImages])

  const handleSaveImageEdits = useCallback(async (imageId, updates) => {
    const res = await fetch('/api/images', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: imageId, updates }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.error || 'Failed to save metadata changes')
    }

    const updatedImage = data?.image || { id: imageId, ...updates }

    setImages((prevImages) =>
      prevImages.map((img) => (img.id === imageId ? { ...img, ...updatedImage } : img))
    )

    setSelectedImage((prevSelected) =>
      prevSelected?.id === imageId ? { ...prevSelected, ...updatedImage } : prevSelected
    )
  }, [])

  const handleShareImage = useCallback(async (image) => {
    try {
      setShareStatus('Creating share link...')

      const res = await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageId: image.id,
          imageData: image,
        }),
      })

      const data = await readJsonSafely(res)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create share link')
      }

      const shareUrl = new URL(data.url, window.location.origin).toString()
      await navigator.clipboard.writeText(shareUrl)
      setShareStatus('Share link copied to clipboard.')
    } catch (error) {
      setShareStatus(error?.message || 'Failed to create share link')
    }
  }, [])

  if (status === 'loading' || loading) {
    return (
  <main className="min-h-screen theme-surface">
    <AppNavbar mode="dashboard" activeRoute="gallery" />
  <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <div className="h-10 bg-dark-800/50 rounded-xl w-48 mb-3 animate-pulse" />
              <div className="h-5 bg-dark-800/50 rounded w-64 animate-pulse" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <SkeletonCard key={i} viewMode="grid" />
              ))}
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <>
  <main className="min-h-screen theme-surface">
    <AppNavbar mode="dashboard" activeRoute="gallery" />
        
  <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
              <div className="animate-fade-in">
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">
                  <span className="gradient-text">Gallery</span>
                </h1>
                <p className="text-dark-400">
                  {images.length > 0 
                    ? `${images.length} image${images.length > 1 ? 's' : ''} saved`
                    : 'Your saved images from across the web'}
                </p>
                {images.length > 0 && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-300">
                    <span className="inline-block h-2 w-2 rounded-full bg-primary-400" />
                    Viewing from {preferredProvider === 'pixvid' ? 'Pixvid' : 'ImgBB'}
                  </div>
                )}
              </div>
            
              {images.length > 0 && (
                <div className="w-full md:w-auto flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
                  {/* Search */}
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                      type="text"
                      placeholder="Search images..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 pr-4 py-3 bg-dark-800/50 border border-white/5 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 focus:bg-dark-800 w-full sm:w-64 transition-all duration-300 sm:focus:w-80 focus:shadow-lg focus:shadow-primary-500/10"
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-dark-400" />
                      </button>
                    )}
                  </div>
                  
                  {/* View toggle */}
                  <div className="flex items-center gap-1 glass rounded-xl p-1.5">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2.5 rounded-lg transition-all duration-300 ${viewMode === 'grid' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white hover:bg-white/5'}`}
                    >
                      <Grid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2.5 rounded-lg transition-all duration-300 ${viewMode === 'list' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white hover:bg-white/5'}`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Content */}
            {loadError ? (
              <div className="glass rounded-2xl p-8 text-red-400 text-center animate-fade-in">
                <p className="font-medium">{loadError}</p>
              </div>
            ) : filteredImages.length === 0 ? (
              <EmptyState hasConfig={hasConfig} />
            ) : viewMode === 'grid' ? (
              /* Google Photos style with date headers */
              <div className="space-y-8">
                {groupImagesByDate(filteredImages).map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                      {group.images.map((img) => {
                        const globalIndex = filteredImages.findIndex(i => i.id === img.id)
                        return (
                          <ImageCard 
                            key={img.id}
                            image={img}
                            index={globalIndex}
                            viewMode={viewMode}
                            preferredProvider={preferredProvider}
                            onClick={() => handleImageClick(img, globalIndex)}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* List Layout */
              <div className="space-y-8">
                {groupImagesByDate(filteredImages).map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {group.images.map((img) => {
                        const globalIndex = filteredImages.findIndex(i => i.id === img.id)
                        return (
                          <ImageCard 
                            key={img.id}
                            image={img}
                            index={globalIndex}
                            viewMode={viewMode}
                            preferredProvider={preferredProvider}
                            onClick={() => handleImageClick(img, globalIndex)}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Lightbox */}
      {selectedImage && (
        <GalleryLightbox
          image={selectedImage}
          images={filteredImages}
          currentIndex={selectedIndex}
          onClose={handleCloseLightbox}
          onNavigate={handleNavigate}
          onSaveEdits={handleSaveImageEdits}
          onShare={handleShareImage}
          shareStatus={shareStatus}
          preferredProvider={preferredProvider}
        />
      )}

      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scale-in {
          from { 
            opacity: 0;
            transform: scale(0.95);
          }
          to { 
            opacity: 1;
            transform: scale(1);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }

        .animate-scale-in {
          animation: scale-in 0.3s ease-out forwards;
        }
      `}</style>
    </>
  )
}
