'use client'

import { useEffect, useState } from 'react'
import { Loader2, Film, Calendar, FileText, Fingerprint, Hash, Undo2, Trash2, AlertTriangle } from 'lucide-react'
import { MediaDetailModal } from 'imgvault-ui'
import { getPreferredImageProviderLink } from '@/lib/image-provider-links'
import {
  getOverviewEntries,
  getTechnicalMetadataEntries,
} from '@shared/mediaFieldRegistry.js'

/**
 * Thin web wrapper over the shared MediaDetailModal (same pattern as
 * GalleryLightbox), with the trash action buttons in the modal's `actions`
 * slot — mirrors the extension's TrashPage modal: Restore + Delete Forever,
 * editable creation date on the Technical tab, "Item Still Hosted" footer.
 */
export default function TrashLightbox({
  item,
  items,
  currentIndex,
  onClose,
  onNavigate,
  onRestore,
  onDeleteForever,
  onSaveCreationDate,
  isProcessing = false,
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('noobs')
  const [editingCreationDate, setEditingCreationDate] = useState(false)
  const [editedCreationDate, setEditedCreationDate] = useState('')

  useEffect(() => {
    setIsLoading(true)
    setEditingCreationDate(false)
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

  if (!item) return null

  const overviewEntries = getOverviewEntries(item, { extraKeys: ['deletedAt'] })

  const technicalEntries = getTechnicalMetadataEntries(item)
  if (item.creationDate) {
    technicalEntries.unshift(['creationDate', item.creationDate])
  }

  const filemoonUrl =
    typeof item.filemoonUrl === 'string' && /^https?:\/\//i.test(item.filemoonUrl)
      ? item.filemoonUrl
      : null
  const udropUrl =
    typeof item.udropUrl === 'string' && /^https?:\/\//i.test(item.udropUrl)
      ? item.udropUrl
      : null
  const imageUrl =
    getPreferredImageProviderLink(item, 'imgbb', 'url') ||
    item.sourceImageUrl ||
    item.imgbbThumbUrl ||
    null

  const startEditingCreationDate = () => {
    const value = item.creationDate ? new Date(item.creationDate) : new Date()
    if (Number.isNaN(value.getTime())) return
    const tzAdjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    setEditedCreationDate(tzAdjusted.toISOString().slice(0, 16))
    setEditingCreationDate(true)
  }

  const handleSaveCreationDate = async () => {
    const saved = await onSaveCreationDate?.(editedCreationDate)
    if (saved) setEditingCreationDate(false)
  }

  const renderTechnicalField = ([key, value], index) => {
    if (key === 'creationDate') {
      return (
        <div key={key}>
          <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
            <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
            <Calendar className="w-3.5 h-3.5" />
            Creation Date
            {!editingCreationDate && (
              <button
                onClick={startEditingCreationDate}
                className="ml-auto text-sky-500 hover:text-sky-300 text-xs px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 transition-colors"
                title="Edit"
              >
                Edit
              </button>
            )}
          </div>
          {editingCreationDate ? (
            <div className="bg-base-200 rounded p-2 space-y-2">
              <input
                type="datetime-local"
                value={editedCreationDate}
                onChange={(e) => setEditedCreationDate(e.target.value)}
                className="w-full bg-base-100 text-base-content font-mono text-sm px-2 py-1 rounded border border-base-300 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCreationDate}
                  disabled={isProcessing}
                  className="px-3 py-1 text-xs rounded bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingCreationDate(false)}
                  disabled={isProcessing}
                  className="px-3 py-1 text-xs rounded bg-base-300 text-base-content hover:bg-base-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="g-field">
              <p className="text-base-content font-mono text-sm">
                {value ? new Date(value).toLocaleString() : 'N/A'}
              </p>
            </div>
          )}
        </div>
      )
    }

    return (
      <div key={key}>
        <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
          {key === 'sha256' ? (
            <Fingerprint className="w-3.5 h-3.5" />
          ) : key === 'pHash' || key === 'aHash' || key === 'dHash' ? (
            <Hash className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
          {key === 'sha256' ? 'SHA-256' : key}
        </div>
        <div className="g-field">
          <p className="text-base-content font-mono text-sm break-all">
            {value === null || value === undefined || value === ''
              ? 'N/A'
              : typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
          </p>
        </div>
      </div>
    )
  }

  const renderMedia = () => (
    <div
      className="relative w-full max-w-full max-h-full animate-scale-in flex items-center justify-center"
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
          className="w-full max-w-5xl h-auto min-h-[200px] rounded-[var(--radius-box)] shadow-2xl"
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
        <div className="w-72 h-72 rounded-[var(--radius-box)] bg-base-200 flex flex-col items-center justify-center gap-3">
          <Film className="w-12 h-12 text-error" />
          <p className="text-base-content/75">Preview unavailable</p>
        </div>
      )}
    </div>
  )

  const actions = (
    <>
      <button
        onClick={() => onRestore?.()}
        disabled={isProcessing}
        className="g-action g-action-prim group"
        style={{ height: 32, padding: '0 14px' }}
      >
        <Undo2 className="transition-transform duration-300 group-hover:-rotate-12" style={{ width: 13, height: 13 }} />
        <span>Restore</span>
      </button>
      <button
        onClick={() => onDeleteForever?.()}
        disabled={isProcessing}
        className="g-action g-action-danger group"
        style={{ height: 32, padding: '0 14px' }}
      >
        <Trash2 className="transition-transform duration-300 group-hover:rotate-12" style={{ width: 13, height: 13 }} />
        <span>Delete Forever</span>
      </button>
    </>
  )

  const overviewFooter = (
    <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/40 rounded-[var(--radius-box)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-warning mt-0.5 flex-shrink-0 animate-pulse" size={18} />
        <div className="text-sm">
          <p className="font-medium text-warning">Item Still Hosted</p>
          <p className="text-base-content/80 mt-1">
            This item remains accessible via its URLs. Use &quot;Delete Forever&quot; to remove it from all hosts.
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <MediaDetailModal
      isOpen={Boolean(item)}
      onClose={onClose}
      item={item}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      isLink={Boolean(item.isLink)}
      overviewEntries={overviewEntries}
      technicalEntries={technicalEntries}
      onPrevious={currentIndex > 0 ? () => onNavigate(currentIndex - 1) : undefined}
      onNext={currentIndex < items.length - 1 ? () => onNavigate(currentIndex + 1) : undefined}
      canGoPrevious={currentIndex > 0}
      canGoNext={currentIndex < items.length - 1}
      renderMedia={renderMedia}
      actions={actions}
      renderTechnicalField={renderTechnicalField}
      overviewFooter={overviewFooter}
      technicalEmptyText="No extra technical fields on this document."
    />
  )
}
