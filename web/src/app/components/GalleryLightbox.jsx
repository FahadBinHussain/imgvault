'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Pencil,
  Save,
  Share2,
  Info,
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
  omittedFields = [],
  preferredProvider = 'imgbb',
  preferredVideoSource = 'filemoon',
  firebaseProjectId = '',
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('noobs')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [isInfoExpanded, setIsInfoExpanded] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDraggingMedia, setIsDraggingMedia] = useState(false)
  const [suppressTrackTransition, setSuppressTrackTransition] = useState(false)
  const [loadedImageUrls, setLoadedImageUrls] = useState({})
  const gestureStartRef = useRef({ x: 0, y: 0 })
  const pendingSwipeNavigationRef = useRef(false)
  const mediaViewportRef = useRef(null)
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
  const getItemKind = (item) => {
    if (item?.isLink) return 'link'
    if (item?.isVideo || item?.fileType?.startsWith?.('video/')) return 'video'
    return 'image'
  }
  const getPreferredVideoWatchUrl = (item) => (
    preferredVideoSource === 'udrop'
      ? item?.udropWatchUrl || item?.filemoonWatchUrl || item?.udropUrl || item?.filemoonUrl || ''
      : item?.filemoonWatchUrl || item?.udropWatchUrl || item?.filemoonUrl || item?.udropUrl || ''
  )
  const getPreferredVideoDirectUrl = (item) => (
    preferredVideoSource === 'udrop'
      ? item?.udropDirectUrl || item?.filemoonDirectUrl || ''
      : item?.filemoonDirectUrl || item?.udropDirectUrl || ''
  )
  const getPreferredImageUrl = (item) => (
    preferredProvider === 'pixvid'
      ? item?.pixvidUrl || item?.imgbbUrl || item?.imgbbThumbUrl || item?.sourceImageUrl || ''
      : item?.imgbbUrl || item?.imgbbThumbUrl || item?.pixvidUrl || item?.sourceImageUrl || ''
  )
  const getLinkPreviewImage = (item) => item?.linkPreviewImageUrl || getPreferredImageUrl(item) || ''
  const toProxyMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    if (!/^https?:\/\//i.test(url)) return url
    return `/api/media?url=${encodeURIComponent(url)}`
  }

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
    'collectionId',
  ]

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
    'udropDirectUrl',
  ]
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
    'isLink',
  ]

  const isSelectedLink = Boolean(image?.isLink || image?.linkUrl)
  const isSelectedVideo = Boolean(
    !isSelectedLink && (
    image?.isVideo ||
    image?.fileType?.startsWith?.('video/') ||
    image?.duration ||
    image?.filemoonWatchUrl ||
    image?.udropWatchUrl ||
    image?.filemoonDirectUrl ||
    image?.udropDirectUrl
    )
  )

  const omittedFieldSet = new Set(omittedFields)
  const noobFields = isSelectedLink
    ? baseLinkFieldKeys
    : (isSelectedVideo ? baseVideoFieldKeys : baseImageFieldKeys)
  const displayedNoobFields = noobFields.filter((field) => !omittedFieldSet.has(field))
  const editableNoobFields = new Set([
    'pageTitle',
    'creationDate',
    'sourceImageUrl',
    'sourcePageUrl',
    'description',
    'tags',
    'pixvidUrl',
    'imgbbUrl',
  ])
  const nerdsExcludedKeys = new Set([
    ...baseImageFieldKeys,
    ...baseVideoFieldKeys,
    ...baseLinkFieldKeys,
    'kind',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'linkUrlCanonical',
    'extraMetadata',
  ])
  const nerdFields = Object.keys(image || {})
    .filter((field) => field !== 'id')
    .filter((field) => !nerdsExcludedKeys.has(field))
    .filter((field) => !omittedFieldSet.has(field))
    .filter((field) => {
      const value = image?.[field]
      if (value === false) return false
      return value !== undefined && value !== null && value !== ''
    })
    .sort((a, b) => a.localeCompare(b))
  const nerdVisibleFields = [...nerdFields].concat(
    redactedFields.filter((field) => !nerdFields.includes(field) && !omittedFieldSet.has(field))
  )
  const noobsVisibleFieldCount = displayedNoobFields.length
  const nerdsVisibleFieldCount = nerdVisibleFields.length
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

  const currentKind = getItemKind(image)
  const imageUrl = getPreferredImageUrl(image)
  const currentVideoWatchUrl = getPreferredVideoWatchUrl(image)
  const currentVideoDirectUrl = getPreferredVideoDirectUrl(image)
  const currentLinkPreview = toProxyMediaUrl(getLinkPreviewImage(image))
  const mobileSheetClass = 'translate-y-0'

  useEffect(() => {
    setIsEditing(false)
    setIsSaving(false)
    setSaveError('')
    setIsLoading(imageUrl ? !loadedImageUrls[imageUrl] : false)
    setIsInfoExpanded(false)
    setDragOffset(0)
    setIsDraggingMedia(false)
    setEditValues(toEditValues(image))
  }, [image?.id, imageUrl, loadedImageUrls, toEditValues])

  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target
      const isEditableTarget =
        target instanceof HTMLElement &&
        (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        )

      if (isEditableTarget) {
        return
      }

      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, images.length, onClose, onNavigate])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    const originalOverscrollBehavior = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.body.style.overflow = originalOverflow
      document.body.style.overscrollBehavior = originalOverscrollBehavior
    }
  }, [])

  useEffect(() => {
    if (!pendingSwipeNavigationRef.current) return

    const frame = window.requestAnimationFrame(() => {
      pendingSwipeNavigationRef.current = false
      setSuppressTrackTransition(false)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentIndex])

  const handleMediaTouchStart = (e) => {
    if ((e.touches?.length || 0) > 1) {
      setIsDraggingMedia(false)
      return
    }

    const touch = e.touches?.[0]
    if (!touch) return
    gestureStartRef.current = { x: touch.clientX, y: touch.clientY }
    setIsDraggingMedia(true)
  }

  const handleMediaTouchMove = (e) => {
    if ((e.touches?.length || 0) > 1) {
      setIsDraggingMedia(false)
      setDragOffset(0)
      return
    }

    const touch = e.touches?.[0]
    if (!touch) return

    const deltaX = touch.clientX - gestureStartRef.current.x
    const deltaY = touch.clientY - gestureStartRef.current.y

    if (Math.abs(deltaX) < Math.abs(deltaY)) {
      return
    }

    e.preventDefault()
    setDragOffset(deltaX)
  }

  const handleMediaTouchEnd = (e) => {
    if ((e.touches?.length || 0) > 0) {
      return
    }

    const touch = e.changedTouches?.[0]
    const deltaX = touch ? touch.clientX - gestureStartRef.current.x : dragOffset
    const viewportWidth = mediaViewportRef.current?.clientWidth || window.innerWidth || 1
    const threshold = Math.min(120, viewportWidth * 0.22)

    setIsDraggingMedia(false)

    if (deltaX <= -threshold && currentIndex < images.length - 1) {
      pendingSwipeNavigationRef.current = true
      setSuppressTrackTransition(true)
      setDragOffset(0)
      onNavigate(currentIndex + 1)
      return
    }

    if (deltaX >= threshold && currentIndex > 0) {
      pendingSwipeNavigationRef.current = true
      setSuppressTrackTransition(true)
      setDragOffset(0)
      onNavigate(currentIndex - 1)
      return
    }

    pendingSwipeNavigationRef.current = false
    setSuppressTrackTransition(false)
    setDragOffset(0)
  }

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
          <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {`${index + 1}. ${label}`}
          </div>
          <div className="rounded p-2 bg-base-200">
            <p className="text-base-content text-sm break-all font-mono">{displayValue}</p>
          </div>
        </div>
      )
    }

    return (
      <div key={key}>
        <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {`${index + 1}. ${label}`}
          </div>
          {key === 'description' && activeTab === 'noobs' && onSaveEdits && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
                setSaveError('')
              }}
              className="inline-flex items-center gap-1 rounded-[var(--radius-box)] bg-base-content/10 px-2 py-1 text-[11px] font-semibold text-base-content/80 hover:bg-base-content/15 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
        </div>

        {isEditableField ? (
          key === 'description' ? (
            <textarea
              value={editValues.description}
              onChange={(e) => setEditValues((prev) => ({ ...prev, description: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              rows={4}
              className="w-full bg-base-200 border border-base-content/15 rounded p-2 text-sm text-base-content focus:outline-none focus:border-primary-500/50"
              placeholder="Enter description"
            />
          ) : key === 'tags' ? (
            <input
              type="text"
              value={editValues.tags}
              onChange={(e) => setEditValues((prev) => ({ ...prev, tags: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-base-200 border border-base-content/15 rounded p-2 text-sm text-base-content focus:outline-none focus:border-primary-500/50"
              placeholder="tag1, tag2, tag3"
            />
          ) : (
            <input
              type="text"
              value={editValues[key] ?? ''}
              onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-base-200 border border-base-content/15 rounded p-2 text-sm text-base-content focus:outline-none focus:border-primary-500/50"
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
          <div className="rounded p-2 bg-base-200">
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
          <div className="rounded p-2 bg-base-200">
            <p className="text-base-content text-sm break-all font-mono">{displayValue}</p>
          </div>
        )}
      </div>
    )
  }

  const previousImage = currentIndex > 0 ? images[currentIndex - 1] : null
  const nextImage = currentIndex < images.length - 1 ? images[currentIndex + 1] : null
  const previousImageUrl = previousImage ? toProxyMediaUrl(getLinkPreviewImage(previousImage) || getPreferredImageUrl(previousImage)) : null
  const nextImageUrl = nextImage ? toProxyMediaUrl(getLinkPreviewImage(nextImage) || getPreferredImageUrl(nextImage)) : null
  const markImageLoaded = (url) => {
    if (!url) return
    setLoadedImageUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }))
  }
  const firestoreCollection = image?.collectionId || (image?.deletedAt ? 'trash' : 'images')
  const canOpenFirestoreConsole = Boolean(firebaseProjectId && image?.id)
  const encodedDocPath = `~2F${encodeURIComponent(firestoreCollection)}~2F${encodeURIComponent(image?.id || '')}`
  const firestoreDocUrl = canOpenFirestoreConsole
    ? `https://console.firebase.google.com/u/1/project/${encodeURIComponent(firebaseProjectId)}/firestore/databases/-default-/data/${encodedDocPath}?view=panel-view`
    : null

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-base-100 text-base-content animate-fade-in lg:flex-row"
      style={{
        backgroundColor: 'var(--color-base-100)',
        opacity: 1,
      }}
    >
      <div
        className="h-[25dvh] min-h-[25dvh] flex-none flex items-center justify-center p-2 sm:p-4 lg:p-8 relative lg:flex-1 lg:h-auto lg:min-h-0"
        onTouchStart={handleMediaTouchStart}
        onTouchEnd={handleMediaTouchEnd}
      >
        <button
          onClick={onClose}
        className="absolute top-3 right-3 sm:top-6 sm:right-6 p-2 sm:p-3 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 text-base-content shadow-lg hover:bg-base-200 transition-all duration-300 z-10"
        style={{
          backgroundColor: 'var(--color-base-100)',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          opacity: 1,
        }}
        >
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsInfoExpanded((prev) => !prev)
          }}
          className="lg:hidden absolute top-3 left-3 p-2.5 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 text-base-content shadow-lg hover:bg-base-100 transition-all duration-300 z-10"
          style={{
            backgroundColor: 'var(--color-base-100)',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            opacity: 1,
          }}
        >
          <Info className="w-5 h-5" />
        </button>

        {currentIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(currentIndex - 1)
            }}
            className="hidden lg:block absolute left-2 sm:left-6 p-2 sm:p-4 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 hover:bg-base-200 transition-all duration-300 hover:-translate-x-1"
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
            className="hidden lg:block absolute right-2 sm:right-6 p-2 sm:p-4 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 hover:bg-base-200 transition-all duration-300 hover:translate-x-1"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        <div
          ref={mediaViewportRef}
          className="relative w-full max-w-full max-h-full animate-scale-in overflow-hidden"
          style={{ touchAction: 'pan-y pinch-zoom' }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleMediaTouchStart}
          onTouchMove={handleMediaTouchMove}
          onTouchEnd={handleMediaTouchEnd}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
            </div>
          )}
          <div
            className={`flex items-center ${isDraggingMedia || suppressTrackTransition ? '' : 'transition-transform duration-300 ease-out'}`}
            style={{ transform: `translateX(calc(-100% + ${dragOffset}px))` }}
          >
            {previousImageUrl ? (
              <div className="w-full shrink-0 flex items-center justify-center pr-4">
              <img
                src={previousImageUrl}
                alt={previousImage?.pageTitle || 'Previous image'}
                className="max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl opacity-40 scale-90"
                draggable="false"
                onLoad={() => markImageLoaded(previousImageUrl)}
              />
              </div>
            ) : (
              <div className="w-full shrink-0" />
            )}

            <div className="w-full shrink-0 flex items-center justify-center px-1">
              {currentKind === 'video' ? (
                currentVideoDirectUrl ? (
                  <video
                    src={currentVideoDirectUrl}
                    controls
                    className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                    onLoadedData={() => {
                      markImageLoaded(currentVideoDirectUrl)
                      setIsLoading(false)
                    }}
                  />
                ) : currentVideoWatchUrl ? (
                  <iframe
                    src={currentVideoWatchUrl}
                    className={`w-full max-w-[960px] aspect-video rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                    frameBorder="0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    onLoad={() => setIsLoading(false)}
                  />
                ) : (
                  <img
                    src={imageUrl}
                    alt={image.pageTitle || 'Video'}
                    className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                    onLoad={() => {
                      markImageLoaded(imageUrl)
                      setIsLoading(false)
                    }}
                    draggable="false"
                  />
                )
              ) : currentKind === 'link' ? (
                <img
                  src={currentLinkPreview || imageUrl}
                  alt={image.pageTitle || 'Link preview'}
                  className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                  onLoad={() => {
                    markImageLoaded(currentLinkPreview || imageUrl)
                    setIsLoading(false)
                  }}
                  draggable="false"
                />
              ) : (
                <img
                  src={imageUrl}
                  alt={image.pageTitle || 'Image'}
                  className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                  onLoad={() => {
                    markImageLoaded(imageUrl)
                    setIsLoading(false)
                  }}
                  draggable="false"
                />
              )}
            </div>

            {nextImageUrl ? (
              <div className="w-full shrink-0 flex items-center justify-center pl-4">
              <img
                src={nextImageUrl}
                alt={nextImage?.pageTitle || 'Next image'}
                className="max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl opacity-40 scale-90"
                draggable="false"
                onLoad={() => markImageLoaded(nextImageUrl)}
              />
              </div>
            ) : (
              <div className="w-full shrink-0" />
            )}
          </div>
        </div>

      </div>

      <div
          className={`fixed lg:static left-0 right-0 bottom-0 w-full lg:w-[400px] h-[75dvh] lg:h-auto max-h-[75dvh] lg:max-h-none bg-base-100 border-t lg:border-t-0 lg:border-l border-base-content/15 overflow-y-auto flex flex-col rounded-none lg:rounded-none transition-transform duration-300 ${mobileSheetClass} lg:translate-y-0`}
          style={{
            backgroundColor: 'var(--color-base-100)',
            opacity: 1,
          }}
      >
        <div
          className="p-6 flex-1 bg-base-100"
          style={{
            backgroundColor: 'var(--color-base-100)',
            opacity: 1,
          }}
        >
          <div className="lg:hidden flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-base-content/80">Image Details</h3>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsInfoExpanded(false)
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-box)] text-sm bg-base-content/5 text-base-content/85 hover:bg-base-content/10 transition-colors"
            >
              <X className="w-4 h-4" />
              Close
            </button>
          </div>

          <div className="flex gap-2 mb-6 border-b border-base-content/15 pb-4 rounded-[var(--radius-box)] bg-base-100">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('noobs') }}
              className={`px-4 py-2 font-semibold transition-all rounded-[var(--radius-box)] flex items-center gap-2 border ${
                activeTab === 'noobs'
                  ? 'bg-primary text-primary-content border-primary shadow-sm ring-2 ring-primary/25'
                  : 'bg-base-100 border-base-content/15 text-base-content/65 hover:text-base-content hover:bg-base-content/5'
              }`}
            >
              For Noobs
              <span className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-2 rounded-full bg-base-content/10 text-base-content/80 text-xs font-semibold">
                {noobsVisibleFieldCount}
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('nerds') }}
              className={`px-4 py-2 font-semibold transition-all rounded-[var(--radius-box)] flex items-center gap-2 border ${
                activeTab === 'nerds'
                  ? 'bg-success text-success-content border-success shadow-sm ring-2 ring-success/25'
                  : 'bg-base-100 border-base-content/15 text-base-content/65 hover:text-base-content hover:bg-base-content/5'
              }`}
            >
              For Nerds
              <span className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-2 rounded-full bg-base-content/10 text-base-content/80 text-xs font-semibold">
                {nerdsVisibleFieldCount}
              </span>
            </button>
          </div>

          {activeTab === 'noobs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-end gap-2">
                <div className="flex items-center gap-2">
                  {onShare && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onShare(image)
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-box)] text-sm bg-base-content/5 text-base-content/85 hover:bg-base-content/10 transition-colors"
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
                          className="px-3 py-1.5 rounded-[var(--radius-box)] text-sm bg-base-content/5 hover:bg-base-content/10 text-base-content/80 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-box)] text-sm bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setIsEditing(true); setSaveError('') }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-box)] text-sm bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    )
                  )}
                </div>
              </div>

              {shareStatus && (
                <div className="rounded-[var(--radius-box)] border border-primary-500/30 bg-primary-500/10 text-primary-200 text-xs p-2">
                  {shareStatus}
                </div>
              )}

              {saveError && (
                <div className="rounded-[var(--radius-box)] border border-error/30 bg-error/10 text-error text-xs p-2">
                  {saveError}
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  firestoreDocumentId
                </div>
                <div className="rounded p-2 bg-base-200">
                  <p className="text-base-content text-sm break-all font-mono">{formatFieldValue('id', image?.id)}</p>
                  {canOpenFirestoreConsole && (
                    <a
                      href={firestoreDocUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-primary-400 hover:text-primary-300 text-xs break-all"
                    >
                      Open in Firebase Console
                    </a>
                  )}
                </div>
              </div>

              {displayedNoobFields.map((field, index) => renderMetadataField(field, index))}
            </div>
          )}

          {activeTab === 'nerds' && (
            <div className="space-y-4">
              {nerdVisibleFields.map((field, index) => renderMetadataField(field, index))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
