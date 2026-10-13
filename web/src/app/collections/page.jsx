'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Edit2,
  FolderOpen,
  Info,
  Loader2,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Modal } from 'imgvault-ui'
import AppNavbar from '../components/AppNavbar'
import { getStrictImageProviderLink } from '@/lib/image-provider-links'
import { DEFAULT_IMAGE_SOURCE } from '@/lib/providerCatalog'

const TOAST_DURATIONS = { info: 0, success: 3000, error: 4000 }

function getGalleryImageUrl(image, preferredProvider = DEFAULT_IMAGE_SOURCE) {
  return (
    getStrictImageProviderLink(image, preferredProvider, 'url') ||
    getStrictImageProviderLink(image, preferredProvider, 'thumbnailUrl') ||
    image?.sourceImageUrl ||
    ''
  )
}

function toProxyMediaUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (!/^https?:\/\//i.test(url)) return url
  return `/api/media?url=${encodeURIComponent(url)}`
}

function formatCreatedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

function sortByName(list) {
  return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

export default function CollectionsPage() {
  const { status } = useSession()
  const [collections, setCollections] = useState([])
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type, duration: TOAST_DURATIONS[type] ?? 3000 })
  }, [])

  useEffect(() => {
    if (!toast || !toast.duration) return undefined
    const timer = setTimeout(() => setToast(null), toast.duration)
    return () => clearTimeout(timer)
  }, [toast])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    try {
      const [collectionsRes, imagesRes] = await Promise.all([
        fetch('/api/collections', { cache: 'no-store' }),
        fetch('/api/images', { cache: 'no-store' }),
      ])

      const collectionsData = await collectionsRes.json().catch(() => ({}))
      const imagesData = await imagesRes.json().catch(() => ({}))

      if (!collectionsRes.ok) {
        throw new Error(collectionsData.error || 'Failed to load collections')
      }
      if (!imagesRes.ok) {
        throw new Error(imagesData.error || 'Failed to load images')
      }

      setCollections(Array.isArray(collectionsData.collections) ? collectionsData.collections : [])
      setImages(Array.isArray(imagesData.images) ? imagesData.images : [])
    } catch (error) {
      console.error('Failed to load collections:', error)
      setLoadError(error.message || 'Failed to load collections')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
    }

    if (status === 'authenticated') {
      loadData()
    }
  }, [status, loadData])

  // counts + previews are computed from the live gallery list, exactly like the
  // extension's CollectionsPage — imageCount stays a stored cache, never the UI truth
  const collectionRows = useMemo(() => {
    return collections.map((collection) => {
      const items = images.filter((image) => image?.collectionId === collection.id)
      const previews = items
        .map((item) => getGalleryImageUrl(item))
        .filter(Boolean)
        .slice(0, 6)

      return { ...collection, itemCount: items.length, previews }
    })
  }, [collections, images])

  const openCreate = (event) => {
    event?.stopPropagation?.()
    setNewName('')
    setNewDescription('')
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      showToast('Collection name is required', 'error')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newDescription.trim() }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create collection')
      }

      setCollections((prev) => sortByName([...prev, data.collection]))
      window.dispatchEvent(new Event('imgvault:collections-changed'))
      setCreateOpen(false)
      setNewName('')
      setNewDescription('')
      showToast('Collection created', 'success')
    } catch (error) {
      showToast(error.message || 'Failed to create collection', 'error')
    } finally {
      setCreating(false)
    }
  }

  const startRename = (collection, event) => {
    event?.stopPropagation?.()
    setEditingId(collection.id)
    setEditName(collection.name)
    setEditDescription(collection.description || '')
  }

  const handleSaveEdit = async () => {
    const name = editName.trim()
    if (!name) {
      showToast('Collection name is required', 'error')
      return
    }

    setSavingEdit(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          updates: { name, description: editDescription.trim() },
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update collection')
      }

      setCollections((prev) => sortByName(prev.map((c) => (c.id === editingId ? { ...c, ...data.collection } : c))))
      setEditingId(null)
      showToast('Collection updated', 'success')
    } catch (error) {
      showToast(error.message || 'Failed to update collection', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete collection')
      }

      const unassigned = Number(data.unassigned) || 0
      setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      window.dispatchEvent(new Event('imgvault:collections-changed'))
      setDeleteTarget(null)
      showToast(
        unassigned > 0
          ? `Collection deleted — ${unassigned} item${unassigned === 1 ? '' : 's'} unassigned`
          : 'Collection deleted',
        'success'
      )
    } catch (error) {
      showToast(error.message || 'Failed to delete collection', 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <>
        <main className="min-h-screen theme-surface">
          <AppNavbar mode="dashboard" activeRoute="collections" />
          <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
            <div className="max-w-7xl mx-auto">
              <div className="mb-8">
                <div className="h-10 bg-base-200/60 rounded-[var(--radius-box)] w-48 mb-3 animate-pulse" />
                <div className="h-5 bg-base-200/60 rounded w-64 animate-pulse" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-56 bg-base-200/60 rounded-[var(--radius-box)] animate-pulse" />
                ))}
              </div>
            </div>
          </section>
        </main>
      </>
    )
  }

  return (
    <>
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="collections" />

        <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 animate-fade-in">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-box)] bg-primary-500/15 text-primary-300">
                  <FolderOpen className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-3xl sm:text-4xl font-bold mb-1">
                    <span className="gradient-text">Collections</span>
                  </h1>
                  <p className="text-base-content/65">Organize your gallery into groups</p>
                </div>
              </div>

              <button
                type="button"
                onClick={openCreate}
                className="group inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border border-primary-500/25 bg-primary-500/10 px-4 py-3 text-sm font-semibold text-primary-200 transition-all duration-300 hover:bg-primary-500/20"
              >
                <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                New Collection
              </button>
            </div>

            {loadError && (
              <div className="mb-6 rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400 animate-fade-in" role="alert">
                {loadError}
              </div>
            )}

            {collectionRows.length === 0 && !loadError ? (
              <div className="flex flex-col items-center justify-center rounded-[var(--radius-box)] border border-dashed border-base-content/15 bg-base-200/40 px-6 py-20 text-center animate-fade-in">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-base-200 text-base-content/50">
                  <FolderOpen className="h-8 w-8" />
                </div>
                <h2 className="mb-1 text-lg font-semibold">No collections yet</h2>
                <p className="mb-6 max-w-sm text-sm text-base-content/60">
                  Create a collection to group items in your gallery. Items can be assigned from any item&apos;s detail view.
                </p>
                <button
                  type="button"
                  onClick={openCreate}
                  className="group inline-flex items-center gap-2 rounded-[var(--radius-box)] bg-primary-500 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-primary-600"
                >
                  <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                  Create your first collection
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {collectionRows.map((collection, index) => (
                  <div
                    key={collection.id}
                    className="group flex flex-col rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/60 p-5 transition-all duration-300 hover:border-primary-500/40 hover:bg-base-200/90 animate-fade-in"
                    style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                  >
                    {editingId === collection.id ? (
                      <div className="flex flex-1 flex-col gap-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Collection name"
                          className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary-500/50 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-3 py-2 text-sm text-base-content focus:border-primary-500/50 focus:outline-none"
                        />
                        <div className="mt-auto flex gap-2">
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-box)] bg-green-500/20 px-3 py-2 text-sm font-semibold text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
                          >
                            {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-3 py-2 text-sm font-semibold text-base-content/70 transition-colors hover:bg-base-content/5"
                          >
                            <X className="h-4 w-4" />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-box)] bg-primary-500/15 text-primary-300 transition-transform duration-300 group-hover:scale-110">
                              <FolderOpen className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <h2 className="truncate text-base font-semibold" title={collection.name}>
                                {collection.name}
                              </h2>
                              <p className="text-xs text-base-content/55">
                                {collection.itemCount} image{collection.itemCount === 1 ? '' : 's'}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={(event) => startRename(collection, event)}
                              title="Rename collection"
                              className="rounded-[var(--radius-box)] p-2 text-base-content/55 transition-all duration-300 hover:bg-base-content/10 hover:text-base-content"
                            >
                              <Edit2 className="h-4 w-4 transition-transform duration-300 hover:rotate-12" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setDeleteTarget(collection)
                              }}
                              title="Delete collection"
                              className="rounded-[var(--radius-box)] p-2 text-base-content/55 transition-all duration-300 hover:bg-red-500/15 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
                            </button>
                          </div>
                        </div>

                        {collection.description && (
                          <p className="mb-3 line-clamp-2 text-sm text-base-content/65">{collection.description}</p>
                        )}

                        {collection.previews.length > 0 && (
                          <div className="mb-4 grid grid-cols-3 gap-1.5">
                            {collection.previews.map((url, previewIndex) => (
                              <div key={`${collection.id}-preview-${previewIndex}`} className="aspect-square overflow-hidden rounded-lg bg-base-300">
                                <img src={toProxyMediaUrl(url)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-auto flex items-center justify-between gap-3">
                          <span className="text-xs text-base-content/45">
                            {formatCreatedAt(collection.createdAt) ? `Created ${formatCreatedAt(collection.createdAt)}` : ''}
                          </span>
                          <Link
                            href={`/gallery/${collection.id}`}
                            className="inline-flex items-center gap-1.5 rounded-[var(--radius-box)] bg-base-content/5 px-3 py-2 text-xs font-semibold text-base-content/80 transition-all duration-300 hover:bg-base-content/10 hover:text-base-content"
                          >
                            View Collection
                            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                          </Link>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New Collection">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-base-content/60" htmlFor="iv-new-collection-name">
              Name
            </label>
            <input
              id="iv-new-collection-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-3 py-2.5 text-sm text-base-content focus:border-primary-500/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-base-content/60" htmlFor="iv-new-collection-description">
              Description (optional)
            </label>
            <input
              id="iv-new-collection-description"
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What is this collection for?"
              className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-3 py-2.5 text-sm text-base-content focus:border-primary-500/50 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-2.5 text-sm font-semibold text-base-content/75 transition-colors hover:bg-base-content/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-[var(--radius-box)] bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Collection"
      >
        <div className="space-y-4">
          <p className="text-sm text-base-content/75">
            Delete <span className="font-semibold text-base-content">{deleteTarget?.name}</span>? The images in this
            collection will NOT be deleted — they lose the collection assignment and stay in the gallery.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-2.5 text-sm font-semibold text-base-content/75 transition-colors hover:bg-base-content/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-[var(--radius-box)] bg-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Collection
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
            className={`flex items-start gap-3 rounded-[var(--radius-box)] border px-4 py-3 shadow-2xl backdrop-blur-md ${toast.type === 'error' ? 'border-red-500/50 bg-red-500/15 text-red-500' : toast.type === 'info' ? 'border-sky-500/50 bg-sky-500/15 text-sky-500' : 'border-green-500/50 bg-green-500/15 text-green-500'}`}
          >
            <span className="mt-0.5 shrink-0 animate-bounce">
              {toast.type === 'error' ? <XCircle className="h-5 w-5" /> : toast.type === 'info' ? <Info className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
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

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
      `}</style>
    </>
  )
}
