'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Check,
  Loader2,
  FileText,
  Pencil,
  Save,
  Share2,
  LockKeyhole,
  RotateCcw,
  ExternalLink,
  Trash2,
  Download,
  X,
  TriangleAlert,
} from 'lucide-react'
import { MediaDetailModal } from 'imgvault-ui'
import { downloadFieldViaProxy } from '@/lib/downloads'
import { getStrictVideoProviderLink } from '@/lib/video-provider-links'
import { getStrictImageProviderLink } from '@/lib/image-provider-links'
import {
  DEFAULT_IMAGE_SOURCE,
  DEFAULT_VIDEO_SOURCE,
} from '@/lib/providerCatalog'
import {
  getDisplayFieldKeys,
  getMediaItemKind,
  getTechnicalMetadataEntries,
} from '@shared/mediaFieldRegistry.js'

// Overview fields that carry a downloadable file URL, mapped to their host —
// mirrors the extension's per-field Download buttons (same four keys).
const DOWNLOAD_FIELD_HOSTS = {
  pixvidUrl: 'pixvid',
  imgbbUrl: 'imgbb',
  filemoonDirectUrl: 'filemoon',
  udropDirectUrl: 'udrop',
}

export default function GalleryLightbox({
  image,
  images,
  currentIndex,
  onClose,
  onNavigate,
  onSaveEdits,
  onShare,
  onShareAlbum,
  onMoveToVault,
  onDelete,
  isDeleting = false,
  onRestoreFromVault,
  isRestoringFromVault = false,
  shareStatus = '',
  readWarning = '',
  redactedFields = [],
  omittedFields = [],
  preferredProvider = DEFAULT_IMAGE_SOURCE,
  preferredVideoSource = DEFAULT_VIDEO_SOURCE,
  firebaseProjectId = '',
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('noobs')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDraggingMedia, setIsDraggingMedia] = useState(false)
  const [suppressTrackTransition, setSuppressTrackTransition] = useState(false)
  const [loadedImageUrls, setLoadedImageUrls] = useState({})
  const gestureStartRef = useRef({ x: 0, y: 0 })
  const pendingSwipeNavigationRef = useRef(false)
  const mediaViewportRef = useRef(null)
  const videoRef = useRef(null)
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
  const [videoSourceFailed, setVideoSourceFailed] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState(null) // {text, tone: 'info'|'error'}
  const [isDownloadingField, setIsDownloadingField] = useState('')
  const [collectionsList, setCollectionsList] = useState([])
  const [collectionEditing, setCollectionEditing] = useState(false)
  const [collectionSelectValue, setCollectionSelectValue] = useState('')
  const [collectionSaving, setCollectionSaving] = useState(false)
  const [collectionError, setCollectionError] = useState('')

  useEffect(() => {
    if (!image) return undefined

    setCollectionEditing(false)
    setCollectionError('')

    let cancelled = false
    fetch('/api/collections', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!cancelled && Array.isArray(data.collections)) {
          setCollectionsList(data.collections)
        }
      })
      .catch((error) => {
        // unauthenticated share pages get a 401 — the row then shows the raw id, never a fake name
        console.error('collections fetch failed:', error)
      })

    return () => {
      cancelled = true
    }
  }, [image?.id])

  const handleCollectionSave = async (event) => {
    event.stopPropagation()
    if (!onSaveEdits || !image) return

    setCollectionSaving(true)
    setCollectionError('')
    try {
      await onSaveEdits(image.id, { collectionId: collectionSelectValue || null })
      setCollectionEditing(false)
    } catch (error) {
      setCollectionError(error?.message || 'Failed to update collection')
    } finally {
      setCollectionSaving(false)
    }
  }
  const isFilemoonHtmlUrl = (url) => typeof url === 'string' && /filemoon\.sx\/(?:d|e)\//i.test(url)
  const getVideoWatchUrl = (item) => (
    getStrictVideoProviderLink(item, preferredVideoSource, 'watchUrl')
  )
  const getVideoDirectUrl = (item) => (
    getStrictVideoProviderLink(item, preferredVideoSource, 'directUrl')
  )
  const getGalleryImageUrl = (item) => (
    getStrictImageProviderLink(item, preferredProvider, 'url') ||
    getStrictImageProviderLink(item, preferredProvider, 'thumbnailUrl') ||
    item?.sourceImageUrl ||
    ''
  )
  const getLinkPreviewImage = (item) => (
    item?.linkPreviewImageUrl ||
    getGalleryImageUrl(item) ||
    ''
  )
  const getModalVideoSource = (item) => {
    const directUrl = getVideoDirectUrl(item)
    const watchUrl = getVideoWatchUrl(item)
    if (isFilemoonHtmlUrl(directUrl)) return { type: 'iframe', src: directUrl }
    if (directUrl) return { type: 'video', src: directUrl }
    if (isFilemoonHtmlUrl(watchUrl)) return { type: 'iframe', src: watchUrl }
    if (watchUrl) return { type: 'watch', src: watchUrl }
    return null
  }
  const hostLabel = { filemoon: 'Filemoon', udrop: 'UDrop', terabox: 'TeraBox' }[preferredVideoSource] || preferredVideoSource
  const toProxyMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    if (!/^https?:\/\//i.test(url)) return url
    return `/api/media?url=${encodeURIComponent(url)}`
  }

  const currentKind = getMediaItemKind(image)
  const isSelectedLink = currentKind === 'link'

  const omittedFieldSet = new Set(omittedFields)
  const displayedNoobFields = getDisplayFieldKeys(image, { omittedFields })
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
  const nerdFields = getTechnicalMetadataEntries(image, { omittedFields })
    .map(([field]) => field)
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
    const trimmed = String(value ?? '').trim()
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

  const handleFieldDownload = async (key, url) => {
    const source = DOWNLOAD_FIELD_HOSTS[key]
    if (!source) return
    setDownloadNotice(null)

    // Filemoon / UDrop "direct" URLs are download PAGES (HTML), not file
    // bytes — same behavior as the extension: open the page in a new tab.
    if (source === 'filemoon' || source === 'udrop') {
      window.open(url, '_blank', 'noopener,noreferrer')
      setDownloadNotice({
        text: `Opening ${source === 'filemoon' ? 'Filemoon' : 'UDrop'} download page in a new tab...`,
        tone: 'info',
      })
      return
    }

    setIsDownloadingField(key)
    try {
      const fileName = await downloadFieldViaProxy(image, url)
      setDownloadNotice({ text: `Saved ${fileName}`, tone: 'info' })
    } catch (error) {
      setDownloadNotice({ text: error?.message || 'Download failed', tone: 'error' })
    } finally {
      setIsDownloadingField('')
    }
  }

  const imageUrl = getGalleryImageUrl(image)
  const modalVideoSource = currentKind === 'video' && !videoSourceFailed ? getModalVideoSource(image) : null
  const currentVideoWatchUrl = getVideoWatchUrl(image)
  const currentVideoDirectUrl = getVideoDirectUrl(image)
  const currentLinkPreview = toProxyMediaUrl(getLinkPreviewImage(image))

  useEffect(() => {
    setIsEditing(false)
    setIsSaving(false)
    setSaveError('')
    setVideoSourceFailed(false)
    setDownloadNotice(null)
    setIsDownloadingField('')
    setIsLoading(imageUrl ? !loadedImageUrls[imageUrl] : false)
    setDragOffset(0)
    setIsDraggingMedia(false)
    setEditValues(toEditValues(image))
  }, [image?.id, imageUrl, loadedImageUrls, toEditValues])

  useEffect(() => {
    const v = videoRef.current
    if (!v || v.tagName !== 'VIDEO') return
    v.muted = true
    v.playsInline = true
    const onMeta = () => {
      const el = videoRef.current
      if (!el) return
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    v.addEventListener('loadedmetadata', onMeta)
    requestAnimationFrame(() => {
      const el = videoRef.current
      if (!el) return
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    })
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [modalVideoSource?.type === 'video' ? modalVideoSource.src : ''])

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
      // same shortcut as the extension: Delete asks the page to open the
      // move-to-trash confirm (it never deletes without confirmation)
      if (e.key === 'Delete' && onDelete && !isEditing && !isSaving) {
        e.preventDefault()
        onDelete(image)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, images.length, onClose, onNavigate, onDelete, image, isEditing, isSaving])

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
    if (key === 'collectionId') return renderCollectionControlRow(index)
    const rawValue = image[key]
    const isRedacted = redactedFieldSet.has(key)
    const isEditableField = activeTab === 'noobs' && isEditing && editableNoobFields.has(key)
    const displayValue = isRedacted ? 'REDACTED' : formatFieldValue(key, rawValue)
    const label = formatFieldLabel(key)

    if (isRedacted) {
      return (
        <div key={key} className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-3 shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {`${index + 1}. ${label}`}
          </div>
          <div className="rounded-[var(--radius-box)] p-3 bg-base-200/70 lg:rounded lg:p-2 lg:bg-base-200">
            <p className="text-base-content text-sm break-all font-mono">{displayValue}</p>
          </div>
        </div>
      )
    }

    return (
      <div key={key} className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-3 shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
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
          <div className="rounded-[var(--radius-box)] p-3 bg-base-200/70 lg:rounded lg:p-2 lg:bg-base-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={rawValue}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 text-primary-400 hover:text-primary-300 break-all text-sm"
              >
                {rawValue}
              </a>
              {DOWNLOAD_FIELD_HOSTS[key] && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleFieldDownload(key, rawValue)
                  }}
                  disabled={Boolean(isDownloadingField)}
                  className="group inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-box)] border border-base-content/15 bg-base-content/10 px-2 py-1 text-[11px] font-semibold text-base-content/80 transition-colors hover:bg-base-content/15 disabled:opacity-50"
                >
                  {isDownloadingField === key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3 transition-transform duration-200 group-hover:translate-y-0.5" />
                  )}
                  Download
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-[var(--radius-box)] p-3 bg-base-200/70 lg:rounded lg:p-2 lg:bg-base-200">
            <p className="text-base-content text-sm break-all font-mono">{displayValue}</p>
          </div>
        )}
      </div>
    )
  }

  const previousImage = currentIndex > 0 ? images[currentIndex - 1] : null
  const nextImage = currentIndex < images.length - 1 ? images[currentIndex + 1] : null
  const previousImageUrl = previousImage ? toProxyMediaUrl(getLinkPreviewImage(previousImage) || getGalleryImageUrl(previousImage)) : null
  const nextImageUrl = nextImage ? toProxyMediaUrl(getLinkPreviewImage(nextImage) || getGalleryImageUrl(nextImage)) : null
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

  const renderDocumentIdCard = () => (
    <div>
      <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
        <FileText className="w-3.5 h-3.5" />
        firestoreDocumentId
      </div>
      <p className="mt-1 text-base-content text-sm break-all font-mono">{formatFieldValue('id', image?.id)}</p>
      {canOpenFirestoreConsole && (
        <a
          href={firestoreDocUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-primary-400 hover:text-primary-300 text-xs break-all"
        >
          Open in Firebase Console
        </a>
      )}
    </div>
  )

  // the collectionId overview row is a real control, not a raw uuid — same
  // Add/Change Collection flow as the extension's detail modal (GalleryPage).
  const currentCollection = collectionsList.find((collection) => collection.id === image?.collectionId) || null
  // NOTE: this row MUST be reached through renderMetadataField — that is the
  // renderOverviewField the modal actually receives (this JSX passes the prop
  // twice; the later one wins, so a standalone renderOverviewField override
  // here is silently dropped — live-tested dead control, fixed 2026-10-13).
  const renderCollectionControlRow = (index) => {
    const displayValue = currentCollection
      ? currentCollection.name
      : image?.collectionId
        ? image.collectionId
        : 'No Collection'

    return (
      <div key="collectionId" className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-3 shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
        <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          {`${index + 1}. ${formatFieldLabel('collectionId')}`}
        </div>
        <div className="rounded-[var(--radius-box)] p-3 bg-base-200/70 lg:rounded lg:p-2 lg:bg-base-200">
          {collectionEditing ? (
            <div className="space-y-3">
              <select
                value={collectionSelectValue}
                onChange={(e) => setCollectionSelectValue(e.target.value)}
                className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-3 py-2 text-sm text-base-content focus:border-primary-500/50 focus:outline-none"
              >
                <option value="">No Collection</option>
                {collectionsList.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
              {collectionError && (
                <div className="rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400" role="alert">
                  {collectionError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCollectionSave}
                  disabled={collectionSaving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-box)] bg-green-500/20 px-3 py-2 text-xs font-semibold text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
                >
                  {collectionSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollectionEditing(false)
                    setCollectionError('')
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-3 py-2 text-xs font-semibold text-base-content/70 transition-colors hover:bg-base-content/5"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm">{displayValue}</span>
              {onSaveEdits && !isEditing && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollectionSelectValue(image?.collectionId || '')
                    setCollectionError('')
                    setCollectionEditing(true)
                  }}
                  className="shrink-0 rounded-[var(--radius-box)] bg-base-content/5 px-2.5 py-1.5 text-xs font-semibold text-base-content/75 transition-colors hover:bg-base-content/10"
                >
                  {image?.collectionId ? 'Change Collection' : 'Add to Collection'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const actionBtnClass = 'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 px-2 text-sm font-semibold text-base-content/85 hover:bg-base-content/5 transition-colors lg:min-h-0 lg:border-0 lg:bg-base-content/5 lg:px-3 lg:py-2 lg:hover:bg-base-content/10'
  const hasLightboxActions = Boolean(
    onShare ||
      (onShareAlbum && image?.collectionId) ||
      onMoveToVault ||
      onDelete ||
      onRestoreFromVault ||
      onSaveEdits
  )

  return (
    <MediaDetailModal
      isOpen={Boolean(image)}
      onClose={onClose}
      item={image}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      overviewEntries={displayedNoobFields.map((key) => ({ key, value: image?.[key] }))}
      technicalEntries={nerdVisibleFields.map((key) => ({ key, value: image?.[key] }))}
      onPrevious={currentIndex > 0 ? () => onNavigate(currentIndex - 1) : undefined}
      onNext={currentIndex < images.length - 1 ? () => onNavigate(currentIndex + 1) : undefined}
      canGoPrevious={currentIndex > 0}
      canGoNext={currentIndex < images.length - 1}
      actions={hasLightboxActions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onShare && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShare(image)
              }}
              className={actionBtnClass}
            >
              <Share2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              Share
            </button>
          )}
          {onShareAlbum && image?.collectionId && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShareAlbum(image)
              }}
              className={actionBtnClass}
            >
              <Share2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              Share Album
            </button>
          )}
          {onMoveToVault && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMoveToVault(image)
              }}
              className={actionBtnClass}
            >
              <LockKeyhole className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              Move to Vault
            </button>
          )}
          {onDelete && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(image)
              }}
              disabled={isDeleting}
              className={`${actionBtnClass} border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50`}
            >
              <Trash2 className="w-4 h-4 transition-transform duration-200 hover:scale-110 lg:w-3.5 lg:h-3.5" />
              Delete
            </button>
          )}
          {onRestoreFromVault && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRestoreFromVault(image)
              }}
              disabled={isRestoringFromVault}
              className={`${actionBtnClass} disabled:opacity-50`}
            >
              {isRestoringFromVault ? <Loader2 className="w-4 h-4 animate-spin lg:w-3.5 lg:h-3.5" /> : <RotateCcw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />}
              {isRestoringFromVault ? 'Restoring...' : 'Restore'}
            </button>
          )}
          {onSaveEdits && isEditing && (
            <>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isSaving}
                className={`${actionBtnClass} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-box)] bg-primary px-2 text-sm font-semibold text-primary-content transition-colors hover:bg-primary/90 disabled:opacity-50 lg:min-h-0 lg:px-4 lg:py-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin lg:w-3.5 lg:h-3.5" /> : <Save className="w-4 h-4 lg:w-3.5 lg:h-3.5" />}
                Save
              </button>
            </>
          )}
          {onSaveEdits && !isEditing && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsEditing(true); setSaveError('') }}
              className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-box)] bg-base-content px-2 text-sm font-semibold text-base-100 transition-colors hover:bg-base-content/90 lg:min-h-0 lg:bg-primary lg:px-4 lg:py-2 lg:text-primary-content lg:hover:bg-primary/90"
            >
              <Pencil className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              Edit
            </button>
          )}
        </div>
      ) : null}
      overviewNotice={saveError || readWarning || shareStatus || downloadNotice ? (
        <div className="space-y-2">
          {saveError && (
            <div className="rounded-[var(--radius-box)] border border-error/30 bg-error/10 text-error text-xs p-2">
              {saveError}
            </div>
          )}
          {readWarning && (
            <div className="flex items-start gap-2 rounded-[var(--radius-box)] border border-warning/40 bg-warning/15 p-2 text-xs text-warning">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
              <span className="break-words">{readWarning}</span>
            </div>
          )}
          {shareStatus && (
            <div className="rounded-[var(--radius-box)] border border-primary-500/30 bg-primary-500/10 text-primary text-xs p-2">
              {shareStatus}
            </div>
          )}
          {downloadNotice && (
            <div
              className={`rounded-[var(--radius-box)] border p-2 text-xs ${
                downloadNotice.tone === 'error'
                  ? 'border-red-500/40 bg-red-500/15 text-red-400'
                  : 'border-primary-500/30 bg-primary-500/10 text-primary'
              }`}
            >
              {downloadNotice.text}
            </div>
          )}
        </div>
      ) : null}
      renderMedia={() => (
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
                className="max-w-full max-h-[40dvh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl opacity-40 scale-90"
                draggable="false"
                onLoad={() => markImageLoaded(previousImageUrl)}
              />
              </div>
            ) : (
              <div className="w-full shrink-0" />
            )}

            <div className="w-full shrink-0 flex items-center justify-center px-1">
              {currentKind === 'scene' ? (
                <div className="flex max-w-full flex-col items-center gap-3">
                  <iframe
                    src={`/scene-viewer?url=${encodeURIComponent(image?.spzUrl || '')}&id=${encodeURIComponent(image?.id || '')}&title=${encodeURIComponent(image?.pageTitle || '3D Scene')}`}
                    title="3D Scene viewer"
                    allow="accelerometer; gyroscope; fullscreen"
                    onLoad={() => setIsLoading(false)}
                    className="h-[min(74vh,760px)] w-[min(90vw,1152px)] max-w-full rounded-[var(--radius-box)] border-0 bg-[#f9f9fb] shadow-2xl"
                  />
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-cyan-500/90 px-2 py-1 text-[11px] font-bold text-white transition-transform duration-300 hover:scale-105">
                      3D
                    </span>
                    {image?.spzUrl && (
                      <a
                        href={image.spzUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-400 transition-colors hover:text-primary-300"
                      >
                        Open .spz file <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ) : currentKind === 'video' ? (
                modalVideoSource?.type === 'video' ? (
                  <video
                    key={modalVideoSource.src}
                    src={modalVideoSource.src}
                    controls
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    ref={videoRef}
                    className="max-w-full max-h-[40dvh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300"
                    onLoadedData={() => {
                      markImageLoaded(modalVideoSource.src)
                      setIsLoading(false)
                    }}
                    onError={() => {
                      setVideoSourceFailed(true)
                      setIsLoading(false)
                    }}
                  />
                ) : modalVideoSource?.type === 'iframe' ? (
                  <iframe
                    key={modalVideoSource.src}
                    src={modalVideoSource.src}
                    className={`w-full max-w-[960px] aspect-video rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                    frameBorder="0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    onLoad={() => setIsLoading(false)}
                  />
                ) : (
                  <div className="flex w-full max-w-[520px] flex-col items-center gap-3 rounded-[var(--radius-box)] border border-base-content/15 bg-base-200/60 px-6 py-10 text-center">
                    <svg className="w-10 h-10 text-base-content/55 transition-transform duration-500 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <p className="text-sm font-semibold text-base-content/75">
                      No playable {hostLabel} source
                    </p>
                    {videoSourceFailed && (
                      <p className="text-xs font-semibold text-error">
                        {hostLabel} link failed to load (may be expired)
                      </p>
                    )}
                    {(modalVideoSource?.src || currentVideoWatchUrl || currentVideoDirectUrl) && (
                      <a
                        href={modalVideoSource?.src || currentVideoWatchUrl || currentVideoDirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-base-content/20 bg-base-100 px-3 py-1.5 text-xs font-semibold transition-all duration-300 hover:scale-105"
                      >
                        Open {hostLabel} link <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )
              ) : currentKind === 'link' ? (
                <img
                  src={currentLinkPreview || imageUrl}
                  alt={image.pageTitle || 'Link preview'}
                  className={`max-w-full max-h-[40dvh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
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
                  className={`max-w-full max-h-[40dvh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
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
                className="max-w-full max-h-[40dvh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl opacity-40 scale-90"
                draggable="false"
                onLoad={() => markImageLoaded(nextImageUrl)}
              />
              </div>
            ) : (
              <div className="w-full shrink-0" />
            )}
          </div>
        </div>

      )}
      renderOverviewField={(entry, index) => renderMetadataField(entry.key, index)}
      renderTechnicalField={(entry, index) => renderMetadataField(entry.key, index)}
      renderDocumentId={renderDocumentIdCard}
    />
  )
}
