'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import {
  Trash2,
  Loader2,
  Search,
  Calendar,
  Film,
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
  Tag,
  ExternalLink,
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'

function toProxyUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (!/^https?:\/\//i.test(url)) return null
  return `/api/media?url=${encodeURIComponent(url)}`
}

function TrashThumbnail({ item }) {
  const isVideoItem = Boolean(
    item.isVideo ||
    (typeof item.fileType === 'string' && item.fileType.startsWith('video/')) ||
    item.filemoonUrl ||
    item.udropUrl
  )
  const filemoonUrl =
    typeof item.filemoonUrl === 'string' && /^https?:\/\//i.test(item.filemoonUrl)
      ? item.filemoonUrl
      : null
  const udropUrl =
    typeof item.udropUrl === 'string' && /^https?:\/\//i.test(item.udropUrl)
      ? item.udropUrl
      : null

  const rawCandidates = [
    item.imgbbThumbUrl,
    item.filemoonThumbUrl,
    item.imgbbUrl,
    item.pixvidUrl,
    item.sourceImageUrl,
  ].filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
  const candidates = rawCandidates.flatMap((url) => {
    const proxied = toProxyUrl(url)
    return proxied ? [url, proxied] : [url]
  })
  const [index, setIndex] = useState(0)
  const current = candidates[index] || null

  if (filemoonUrl) {
    return (
      <iframe
        src={filemoonUrl}
        title={item.pageTitle || 'Trashed video'}
        className="w-full h-full object-cover pointer-events-none"
        frameBorder="0"
        scrolling="no"
      />
    )
  }

  if (udropUrl) {
    return (
      <video
        src={udropUrl}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    )
  }

  if (!current) {
    if (isVideoItem) {
      return (
        <div className="flex flex-col items-center gap-2 text-base-content/65">
          <Film className="w-10 h-10 text-primary-400" />
          <span className="text-xs">Video item</span>
        </div>
      )
    }
    return <Trash2 className="w-10 h-10 text-base-content/55" />
  }

  return (
    <img
      src={current}
      alt={item.pageTitle || 'Trashed image'}
      className="w-full h-full object-contain"
      onError={() => {
        setIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev))
      }}
    />
  )
}

function formatFieldLabel(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

function formatFieldValue(key, value) {
  if (value === undefined || value === null || value === '') return 'N/A'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'N/A'

  if (
    key === 'deletedAt' ||
    key === 'internalAddedTimestamp' ||
    key === 'creationDate' ||
    key === 'ProfileDateTime'
  ) {
    const dt = new Date(value)
    if (!Number.isNaN(dt.getTime())) return dt.toLocaleString()
  }

  if (key === 'fileSize' && Number.isFinite(Number(value))) {
    const bytes = Number(value)
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function TrashLightbox({ item, items, currentIndex, onClose, onNavigate }) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('noobs')

  useEffect(() => {
    setIsLoading(true)
  }, [item?.id])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && currentIndex < items.length - 1) onNavigate(currentIndex + 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, items.length, onClose, onNavigate])

  const noobFields = [
    'pageTitle',
    'deletedAt',
    'internalAddedTimestamp',
    'description',
    'tags',
    'sourcePageUrl',
    'sourceImageUrl',
    'imgbbUrl',
    'pixvidUrl',
    'filemoonUrl',
    'udropUrl',
  ]

  const allMetadataFields = Object.keys(item || {}).filter((key) => key !== 'id')
  const nerdFields = allMetadataFields.filter((field) => !noobFields.includes(field))

  const isUrlField = (key) => key.toLowerCase().endsWith('url')
  const filemoonUrl =
    typeof item?.filemoonUrl === 'string' && /^https?:\/\//i.test(item.filemoonUrl)
      ? item.filemoonUrl
      : null
  const udropUrl =
    typeof item?.udropUrl === 'string' && /^https?:\/\//i.test(item.udropUrl)
      ? item.udropUrl
      : null
  const imageUrl =
    item?.imgbbUrl || item?.imgbbThumbUrl || item?.pixvidUrl || item?.sourceImageUrl || null

  const renderMetadataField = (key, index) => {
    const rawValue = item?.[key]
    const displayValue = formatFieldValue(key, rawValue)

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return null
    }

    return (
      <div key={key}>
        <div className="text-xs font-semibold text-base-content/65 mb-1 flex items-center gap-2">
          {key === 'tags' ? <Tag className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
          {`${index + 1}. ${formatFieldLabel(key)}`}
        </div>

        {key === 'tags' && Array.isArray(rawValue) && rawValue.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rawValue.map((tag) => (
              <span
                key={`${key}-${tag}`}
                className="px-3 py-1 rounded-full bg-error/20 text-error text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : isUrlField(key) && typeof rawValue === 'string' ? (
          <div className="bg-base-200/60 rounded p-2">
            <a
              href={rawValue}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-2 text-error hover:text-error break-all text-sm"
            >
              <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{rawValue}</span>
            </a>
          </div>
        ) : (
          <div className="bg-base-200/60 rounded p-2">
            <p className="text-base-content text-sm break-all font-mono">{displayValue}</p>
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
          className="absolute top-3 right-3 sm:top-6 sm:right-6 p-2 sm:p-3 glass rounded-full hover:bg-base-content/20 transition-all duration-300 z-10"
        >
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {currentIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(currentIndex - 1)
            }}
            className="absolute left-2 sm:left-6 p-2 sm:p-4 glass rounded-full hover:bg-base-content/20 transition-all duration-300 hover:-translate-x-1"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {currentIndex < items.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(currentIndex + 1)
            }}
            className="absolute right-2 sm:right-6 p-2 sm:p-4 glass rounded-full hover:bg-base-content/20 transition-all duration-300 hover:translate-x-1"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        <div
          className="relative max-w-full max-h-full animate-scale-in w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-error" />
            </div>
          )}

          {filemoonUrl ? (
            <iframe
              src={filemoonUrl}
              title={item.pageTitle || 'Trashed video'}
              className="w-full max-w-5xl aspect-video rounded-[var(--radius-box)] shadow-2xl"
              frameBorder="0"
              scrolling="no"
              onLoad={() => setIsLoading(false)}
            />
          ) : udropUrl ? (
            <video
              src={udropUrl}
              controls
              className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
              onLoadedMetadata={() => setIsLoading(false)}
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={item.pageTitle || 'Trashed image'}
              className={`max-w-full max-h-[55vh] sm:max-h-[70vh] lg:max-h-[85vh] object-contain rounded-[var(--radius-box)] shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
            />
          ) : (
            <div className="w-72 h-72 rounded-[var(--radius-box)] bg-base-100/80 flex flex-col items-center justify-center gap-3">
              <Film className="w-12 h-12 text-error" />
              <p className="text-base-content/75">Preview unavailable</p>
            </div>
          )}
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 glass rounded-full text-sm">
          {currentIndex + 1} / {items.length}
        </div>
      </div>

      <div className="w-full lg:w-[400px] max-h-[50vh] lg:max-h-none bg-base-100/95 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-base-content/15 overflow-y-auto flex flex-col">
        <div className="p-6 flex-1">
          <div className="flex gap-2 mb-6 border-b border-base-content/15 pb-4">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setActiveTab('noobs')
              }}
              className={`px-4 py-2 font-semibold transition-all rounded-[var(--radius-box)] ${
                activeTab === 'noobs'
                  ? 'bg-error/20 text-error'
                  : 'text-base-content/65 hover:text-base-content hover:bg-base-content/5'
              }`}
            >
              For Noobs 👶
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setActiveTab('nerds')
              }}
              className={`px-4 py-2 font-semibold transition-all rounded-[var(--radius-box)] ${
                activeTab === 'nerds'
                  ? 'bg-error/20 text-error'
                  : 'text-base-content/65 hover:text-base-content hover:bg-base-content/5'
              }`}
            >
              For Nerds 🤓
            </button>
          </div>

          <div className="space-y-4">
            {(activeTab === 'noobs' ? noobFields : nerdFields)
              .map((field, index) => renderMetadataField(field, index))
              .filter(Boolean)}
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-20 animate-fade-in">
      <div className="w-24 h-24 mx-auto rounded-[var(--radius-box)] bg-gradient-to-br from-red-500/20 to-red-700/20 flex items-center justify-center mb-8 animate-float">
        <Trash2 className="w-12 h-12 text-error" />
      </div>
      <h3 className="text-2xl font-bold mb-3">Trash is Empty</h3>
      <p className="text-base-content/65 max-w-md mx-auto">Deleted items from the extension will appear here.</p>
    </div>
  )
}

export default function TrashPage() {
  const { status } = useSession()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
      return
    }
    if (status === 'authenticated') {
      loadTrash()
    }
  }, [status])

  const loadTrash = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/trash', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load trash')
      }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (error) {
      setLoadError(error.message || 'Failed to load trash')
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = items.filter((item) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const haystack = [
      item.pageTitle,
      item.description,
      item.sourcePageUrl,
      ...(item.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })

  const handleItemClick = (item, index) => {
    setSelectedItem(item)
    setSelectedIndex(index)
  }

  const handleCloseLightbox = () => {
    setSelectedItem(null)
    setSelectedIndex(-1)
  }

  const handleNavigate = (index) => {
    setSelectedItem(filteredItems[index])
    setSelectedIndex(index)
  }

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="trash" />
        <div className="pt-24 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="trash" />
        <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">
                  <span className="text-error">Trash</span>
                </h1>
                <p className="text-base-content/65">
                  {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} in trash
                </p>
              </div>
              {items.length > 0 && (
                <div className="relative group w-full md:w-80">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/55" />
                  <input
                    type="text"
                    placeholder="Search trash..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-11 pr-4 py-3 bg-base-200/60 border border-base-content/10 rounded-[var(--radius-box)] text-sm focus:outline-none focus:border-red-500/50 w-full"
                  />
                </div>
              )}
            </div>

            {loadError ? (
              <div className="glass rounded-[var(--radius-box)] p-8 text-error text-center">
                <p className="font-medium">{loadError}</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredItems.map((item, index) => {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item, index)}
                      className="glass rounded-[var(--radius-box)] overflow-hidden text-left transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-red-500/10"
                    >
                      <div className="h-48 bg-base-100 relative overflow-hidden flex items-center justify-center">
                        <TrashThumbnail item={item} />
                      </div>
                      <div className="p-4">
                        <p className="text-sm font-semibold truncate">{item.pageTitle || 'Untitled'}</p>
                        <div className="mt-2 text-xs text-base-content/65 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : 'Unknown deletion time'}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {selectedItem && (
        <TrashLightbox
          item={selectedItem}
          items={filteredItems}
          currentIndex={selectedIndex}
          onClose={handleCloseLightbox}
          onNavigate={handleNavigate}
        />
      )}

      <style jsx global>{`
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

