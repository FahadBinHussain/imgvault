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
  AlertTriangle,
  Undo2,
  CheckCircle2,
  XCircle,
  Info,
  ListChecks,
  Check,
  X,
} from 'lucide-react'
import { Modal } from 'imgvault-ui'
import AppNavbar from '../components/AppNavbar'
import TrashLightbox from '../components/TrashLightbox'
import { getPreferredImageProviderLink } from '@/lib/image-provider-links'

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
    getPreferredImageProviderLink(item, 'imgbb', 'url'),
    item.imgbbUrl,
    item.pixvidUrl,
    item.sourceImageUrl,
    getPreferredImageProviderLink(item, 'imgbb', 'thumbnailUrl'),
    item.imgbbThumbUrl,
    item.filemoonThumbUrl,
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

const TOAST_DURATIONS = { info: 0, success: 3000, error: 4000 }

export default function TrashPage() {
  const { status } = useSession()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [toast, setToast] = useState(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [showBulkRestoreConfirm, setShowBulkRestoreConfirm] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
      return
    }
    if (status === 'authenticated') {
      loadTrash()
    }
  }, [status])

  useEffect(() => {
    if (!toast || !toast.duration) return undefined
    const timer = setTimeout(() => setToast(null), toast.duration)
    return () => clearTimeout(timer)
  }, [toast])

  // Escape exits selection mode (the lightbox owns Escape while it is open)
  useEffect(() => {
    if (!selectionMode || selectedItem) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectionMode(false)
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectionMode, selectedItem])

  const showToast = (message, type = 'success') => {
    setToast({ id: Date.now(), message, type, duration: TOAST_DURATIONS[type] ?? 3000 })
  }

  const loadTrash = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/trash', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load trash')
      }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (error) {
      setLoadError(error.message || 'Failed to load trash')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const postTrashAction = async (payload) => {
    const res = await fetch('/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || `Trash action failed (${res.status})`)
    }
    return data
  }

  const handleRestore = async () => {
    if (!selectedItem) return
    setIsProcessing(true)
    setShowRestoreConfirm(false)
    try {
      showToast('Restoring item...', 'info')
      await postTrashAction({ action: 'restore', id: selectedItem.id })
      showToast('Item restored successfully!', 'success')
      handleCloseLightbox()
      await loadTrash({ silent: true })
    } catch (error) {
      showToast(error.message || 'Failed to restore', 'error')
      await loadTrash({ silent: true })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteForever = async () => {
    if (!selectedItem) return
    setIsProcessing(true)
    setShowDeleteConfirm(false)
    try {
      showToast('Permanently deleting from trash and hosts where possible...', 'info')
      await postTrashAction({ action: 'delete', id: selectedItem.id })
      showToast('Item permanently deleted!', 'success')
      handleCloseLightbox()
      await loadTrash({ silent: true })
    } catch (error) {
      showToast(error.message || 'Failed to delete', 'error')
      await loadTrash({ silent: true })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleEmptyTrash = async () => {
    setIsProcessing(true)
    setShowEmptyConfirm(false)
    handleCloseLightbox()
    try {
      showToast('Emptying trash...', 'info')
      const result = await postTrashAction({ action: 'empty' })
      const deleted = Number(result?.deleted) || 0
      showToast(`Trash emptied — ${deleted} item${deleted !== 1 ? 's' : ''} deleted.`, 'success')
      await loadTrash({ silent: true })
    } catch (error) {
      showToast(error.message || 'Failed to empty trash', 'error')
      await loadTrash({ silent: true })
    } finally {
      setIsProcessing(false)
    }
  }

  const splitSettled = (results, ids) => {
    const failed = []
    let okCount = 0
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') okCount += 1
      else failed.push({ id: ids[index], message: result.reason?.message || 'request failed' })
    })
    return { okCount, failed }
  }

  const handleBulkRestore = async () => {
    if (isProcessing) return
    const ids = [...selectedIds]
    if (!ids.length) return

    setIsProcessing(true)
    setShowBulkRestoreConfirm(false)
    try {
      showToast(`Restoring ${ids.length} item${ids.length === 1 ? '' : 's'}...`, 'info')
      const results = await Promise.allSettled(ids.map((id) => postTrashAction({ action: 'restore', id })))
      const { okCount, failed } = splitSettled(results, ids)
      if (failed.length > 0) {
        setSelectedIds(new Set(failed.map((entry) => entry.id)))
        showToast(`${okCount} restored, ${failed.length} failed: ${failed[0].message.slice(0, 120)}`, 'error')
      } else {
        setSelectedIds(new Set())
        setSelectionMode(false)
        showToast(`${ids.length} item${ids.length === 1 ? '' : 's'} restored`, 'success')
      }
      await loadTrash({ silent: true })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkDeleteForever = async () => {
    if (isProcessing) return
    const ids = [...selectedIds]
    if (!ids.length) return

    setIsProcessing(true)
    setShowBulkDeleteConfirm(false)
    try {
      showToast(`Permanently deleting ${ids.length} item${ids.length === 1 ? '' : 's'} from trash and hosts where possible...`, 'info')
      const results = await Promise.allSettled(ids.map((id) => postTrashAction({ action: 'delete', id })))
      const { okCount, failed } = splitSettled(results, ids)
      if (failed.length > 0) {
        setSelectedIds(new Set(failed.map((entry) => entry.id)))
        showToast(`${okCount} permanently deleted, ${failed.length} failed: ${failed[0].message.slice(0, 120)}`, 'error')
      } else {
        setSelectedIds(new Set())
        setSelectionMode(false)
        showToast(`${ids.length} item${ids.length === 1 ? '' : 's'} permanently deleted`, 'success')
      }
      await loadTrash({ silent: true })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSaveCreationDate = async (inputValue) => {
    if (!selectedItem) return false
    const parsed = new Date(inputValue)
    if (Number.isNaN(parsed.getTime())) {
      showToast('Invalid date value', 'error')
      return false
    }
    setIsProcessing(true)
    try {
      const iso = parsed.toISOString()
      const res = await fetch('/api/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedItem.id, updates: { creationDate: iso } }),
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update creation date')
      }
      const id = selectedItem.id
      setSelectedItem((prev) => (prev?.id === id ? { ...prev, creationDate: iso } : prev))
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, creationDate: iso } : it)))
      showToast('Creation date updated', 'success')
      return true
    } catch (error) {
      showToast(error.message || 'Failed to update creation date', 'error')
      return false
    } finally {
      setIsProcessing(false)
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

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleItemClick = (item, index) => {
    if (selectionMode) {
      toggleSelect(item.id)
      return
    }
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
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMode((prev) => !prev)
                      setSelectedIds(new Set())
                    }}
                    disabled={isProcessing}
                    title={selectionMode ? 'Exit selection' : 'Select items'}
                    className={`group inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border px-4 py-3 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${selectionMode ? 'border-red-500/50 bg-red-500/20 text-error' : 'border-white/15 bg-white/5 text-base-content hover:bg-white/10'}`}
                  >
                    {selectionMode ? (
                      <X className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                    ) : (
                      <ListChecks className="w-4 h-4 transition-transform duration-300 group-hover:scale-110" />
                    )}
                    <span>{selectionMode ? 'Cancel' : 'Select'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmptyConfirm(true)}
                    disabled={isProcessing}
                    className="group inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-error transition-all duration-200 hover:bg-red-500/20 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
                    <span>Empty Trash</span>
                  </button>
                  <div className="relative group w-full sm:w-72 md:w-80">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/55 transition-transform duration-300 group-hover:scale-110" />
                    <input
                      type="text"
                      placeholder="Search trash..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 pr-4 py-3 bg-base-200 border border-base-300 rounded-[var(--radius-box)] text-sm focus:outline-none focus:border-red-500 w-full"
                    />
                  </div>
                </div>
              )}
            </div>

            {!loadError && items.length > 0 && (
              <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/40 rounded-[var(--radius-box)] backdrop-blur-sm flex items-start gap-3 animate-fade-in">
                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-warning animate-pulse" />
                <div className="text-sm">
                  <p className="font-medium text-warning">Trash keeps saved host URLs</p>
                  <p className="text-base-content/80 mt-1">
                    Saved host URLs are kept so restore and retry still work. Permanent delete removes the vault row
                    and attempts host cleanup when a provider delete URL exists.
                  </p>
                </div>
              </div>
            )}

            {/* Bulk Actions Bar - shown in selection mode */}
            {selectionMode && !loadError && filteredItems.length > 0 && (
              <div className="mb-8 p-4 rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/15 backdrop-blur-sm animate-fade-in">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-base-content">{selectedIds.size} selected</span>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set(filteredItems.map((it) => it.id)))}
                      className="rounded-[var(--radius-box)] bg-white/10 px-3 py-1.5 text-sm text-base-content transition-all duration-200 hover:bg-white/20"
                    >
                      Select All ({filteredItems.length})
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="rounded-[var(--radius-box)] bg-white/10 px-3 py-1.5 text-sm text-base-content transition-all duration-200 hover:bg-white/20"
                      >
                        Deselect All
                      </button>
                    )}
                  </div>
                  {selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowBulkRestoreConfirm(true)}
                        disabled={isProcessing}
                        className="group inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-green-500/40 bg-green-500/20 px-4 py-2 text-sm font-semibold text-green-400 transition-all duration-200 hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Undo2 className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                        Restore Selected
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowBulkDeleteConfirm(true)}
                        disabled={isProcessing}
                        className="group inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-semibold text-error transition-all duration-200 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                        Delete Permanently
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      className={`glass rounded-[var(--radius-box)] overflow-hidden text-left transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-red-500/10 ${selectedIds.has(item.id) ? 'ring-2 ring-red-400/80' : ''}`}
                    >
                      <div className="h-48 bg-base-100 relative overflow-hidden flex items-center justify-center">
                        <TrashThumbnail item={item} />
                        {selectionMode && (
                          <div className="absolute right-3 top-3 z-20">
                            <span className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-box)] border-2 backdrop-blur-sm transition-all duration-200 ${selectedIds.has(item.id) ? 'scale-110 border-red-400 bg-error text-error-content' : 'border-white/70 bg-black/40 text-transparent'}`}>
                              <Check className="w-4 h-4" />
                            </span>
                          </div>
                        )}
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
          onRestore={() => setShowRestoreConfirm(true)}
          onDeleteForever={() => setShowDeleteConfirm(true)}
          onSaveCreationDate={handleSaveCreationDate}
          isProcessing={isProcessing}
        />
      )}

      {/* Restore Confirmation Modal */}
      <Modal isOpen={showRestoreConfirm} onClose={() => setShowRestoreConfirm(false)}>
        <div className="text-center space-y-6">
          <div className="flex items-center justify-center mb-4">
            <Undo2 size={48} className="animate-scale-in" style={{ color: 'var(--color-success)', opacity: 0.7 }} />
          </div>

          <h3 className="text-2xl font-bold text-success">Restore Image?</h3>

          <p className="text-base-content/80 text-lg leading-relaxed">
            This will restore the image back to your gallery.
            <br />
            <span className="font-semibold text-success">You can access it normally again.</span>
          </p>

          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowRestoreConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300 text-base-content font-medium hover:bg-base-300 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              onClick={handleRestore}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden bg-success text-success-content border border-success/40 transform transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
          <div className="flex items-center justify-center mb-4">
            <AlertTriangle size={48} className="animate-pulse" style={{ color: 'var(--color-error)', opacity: 0.7 }} />
          </div>

          <h3 className="text-2xl font-bold text-error">Permanently Delete?</h3>

          <div className="text-left bg-red-500/10 border border-red-500/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete the item from:
            </p>
            <ul className="list-disc list-inside text-base-content/80 space-y-1 ml-2">
              {selectedItem?.imgbbUrl && <li>ImgBB hosting</li>}
              {selectedItem?.pixvidUrl && !selectedItem?.filemoonUrl && !selectedItem?.udropUrl && (
                <li>Pixvid hosting</li>
              )}
              {selectedItem?.filemoonUrl && (
                <li className="text-warning">⚠️ Filemoon video (must be manually deleted from dashboard)</li>
              )}
              {selectedItem?.udropUrl && (
                <li className="text-warning">⚠️ UDrop video (must be manually deleted from dashboard)</li>
              )}
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
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300 text-base-content font-medium hover:bg-base-300 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              onClick={handleDeleteForever}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden bg-error text-error-content border border-error/40 transform transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
          <div className="flex items-center justify-center mb-4">
            <Undo2 size={48} className="animate-scale-in" style={{ color: 'var(--color-success)', opacity: 0.7 }} />
          </div>

          <h3 className="text-2xl font-bold text-success">
            Restore {selectedIds.size} Item{selectedIds.size === 1 ? '' : 's'}?
          </h3>

          <p className="text-base-content/80 text-lg leading-relaxed">
            This will restore {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} back to your gallery.
            <br />
            <span className="font-semibold text-success">They will be removed from trash.</span>
          </p>

          <div className="flex gap-4 justify-center pt-4">
            <button
              onClick={() => setShowBulkRestoreConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300 text-base-content font-medium hover:bg-base-300 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              onClick={handleBulkRestore}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden bg-success text-success-content border border-green-500/40 transform transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isProcessing && <div className="absolute inset-0 bg-success-content animate-ping opacity-10" />}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
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

      {/* Bulk Permanent Delete Confirmation Modal */}
      <Modal isOpen={showBulkDeleteConfirm} onClose={() => !isProcessing && setShowBulkDeleteConfirm(false)}>
        <div className="text-center space-y-6">
          <div className="flex items-center justify-center mb-4">
            <Trash2 size={48} className="animate-pulse" style={{ color: 'var(--color-error)', opacity: 0.7 }} />
          </div>

          <h3 className="text-2xl font-bold text-error">
            Permanently Delete {selectedIds.size} Item{selectedIds.size === 1 ? '' : 's'}?
          </h3>

          <div className="text-left bg-red-500/10 border border-red-500/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete{' '}
              <span className="font-bold text-error">
                {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}
              </span>{' '}
              from:
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
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300 text-base-content font-medium hover:bg-base-300 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              onClick={handleBulkDeleteForever}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden bg-error text-error-content border border-red-500/40 transform transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isProcessing && <div className="absolute inset-0 bg-error-content animate-ping opacity-10" />}
              <div className="relative flex items-center gap-2 font-bold text-lg">
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
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
      <Modal isOpen={showEmptyConfirm} onClose={() => setShowEmptyConfirm(false)}>
        <div className="text-center space-y-6">
          <div className="flex items-center justify-center mb-4">
            <Trash2 size={48} className="animate-pulse" style={{ color: 'var(--color-error)', opacity: 0.7 }} />
          </div>

          <h3 className="text-2xl font-bold text-error">Empty Entire Trash?</h3>

          <div className="text-left bg-red-500/10 border border-red-500/30 rounded-[var(--radius-box)] p-4 space-y-2">
            <p className="text-base-content/80 leading-relaxed">
              This will permanently delete{' '}
              <span className="font-bold text-error">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>{' '}
              from:
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
              onClick={() => setShowEmptyConfirm(false)}
              disabled={isProcessing}
              className="px-6 py-3 rounded-[var(--radius-box)] bg-base-200 border border-base-300 text-base-content font-medium hover:bg-base-300 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              onClick={handleEmptyTrash}
              disabled={isProcessing}
              className="group relative px-8 py-3 rounded-[var(--radius-box)] overflow-hidden bg-error text-error-content border border-error/40 transform transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
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

      {/* Toast */}
      {toast && (
        <div
          key={toast.id}
          className="fixed bottom-5 right-5 z-[300] max-w-sm animate-fade-in"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex items-start gap-3 rounded-[var(--radius-box)] border px-4 py-3 shadow-2xl backdrop-blur-md ${
              toast.type === 'error'
                ? 'border-red-500/50 bg-red-500/15 text-red-500'
                : toast.type === 'info'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-500'
                  : 'border-green-500/50 bg-green-500/15 text-green-500'
            }`}
          >
            <span className="mt-0.5 shrink-0 animate-bounce">
              {toast.type === 'error' ? (
                <XCircle className="w-5 h-5" />
              ) : toast.type === 'info' ? (
                <Info className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </span>
            <p className="text-sm font-medium leading-snug">{toast.message}</p>
          </div>
        </div>
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
