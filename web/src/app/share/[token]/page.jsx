'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, Link2, Loader2, Play, Share2 } from 'lucide-react'
import GalleryLightbox from '@/app/components/GalleryLightbox'
import { getPreferredImageProviderLink } from '@/lib/image-provider-links'
import { getMediaItemKind } from '@shared/mediaFieldRegistry.js'

async function readJsonSafely(res) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function toProxyMediaUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (!/^https?:\/\//i.test(url)) return url
  return `/api/media?url=${encodeURIComponent(url)}`
}

function getPreferredImageUrl(item) {
  return (
    getPreferredImageProviderLink(item, 'imgbb', 'url') ||
    getPreferredImageProviderLink(item, 'pixvid', 'url') ||
    item?.sourceImageUrl ||
    item?.imgbbThumbUrl ||
    ''
  )
}

function getVideoPosterUrl(item) {
  return (
    item?.videoThumbnailUrl ||
    item?.linkPreviewImageUrl ||
    getPreferredImageProviderLink(item, 'imgbb', 'thumbnailUrl') ||
    item?.imgbbThumbUrl ||
    getPreferredImageUrl(item)
  )
}

function getPreviewUrl(item) {
  const kind = getMediaItemKind(item)

  if (kind === 'link') {
    return toProxyMediaUrl(item?.linkPreviewImageUrl || getPreferredImageUrl(item))
  }

  if (kind === 'video') {
    return toProxyMediaUrl(getVideoPosterUrl(item))
  }

  return getPreferredImageUrl(item)
}

function getItemTitle(item) {
  return item?.pageTitle || item?.fileName || item?.linkUrl || item?.sourcePageUrl || 'Untitled'
}

function getItemMeta(item) {
  const kind = getMediaItemKind(item)
  if (kind === 'link') return item?.linkUrl || item?.sourcePageUrl || 'Saved link'
  if (kind === 'video') return 'Saved video'
  return item?.sourcePageUrl || 'Saved image'
}

function formatFilterLabel(filter) {
  if (filter === 'image') return 'Images only'
  if (filter === 'video') return 'Videos only'
  if (filter === 'link') return 'Links only'
  return 'All media'
}

function EmptyPreview({ kind }) {
  if (kind === 'video') {
    return (
      <div className="grid h-full w-full place-items-center bg-base-200/70">
        <Play className="h-10 w-10 text-base-content/45" />
      </div>
    )
  }

  if (kind === 'link') {
    return (
      <div className="grid h-full w-full place-items-center bg-base-200/70">
        <Link2 className="h-10 w-10 text-base-content/45" />
      </div>
    )
  }

  return (
    <div className="grid h-full w-full place-items-center bg-base-200/70">
      <ImageIcon className="h-10 w-10 text-base-content/45" />
    </div>
  )
}

function SharedMediaCard({ item, index, onOpen }) {
  const kind = getMediaItemKind(item)
  const previewUrl = getPreviewUrl(item)

  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className="group overflow-hidden rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/80 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary-500/35 hover:shadow-xl hover:shadow-primary-500/10"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-base-200">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={getItemTitle(item)}
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
            loading={index < 8 ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <EmptyPreview kind={kind} />
        )}

        {kind === 'video' && (
          <div className="absolute inset-0 grid place-items-center bg-black/10">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </div>
        )}

        <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          {kind}
        </span>
      </div>

      <div className="p-4">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-base-content">
          {getItemTitle(item)}
        </p>
        <p className="mt-2 line-clamp-1 text-xs text-base-content/55">
          {getItemMeta(item)}
        </p>
      </div>
    </button>
  )
}

function SharedAlbum({ share, onOpen }) {
  const items = Array.isArray(share?.items) ? share.items : []
  const counts = useMemo(() => items.reduce((acc, item) => {
    const kind = getMediaItemKind(item)
    if (kind === 'image' || kind === 'video' || kind === 'link') {
      acc[kind] += 1
    }
    return acc
  }, { image: 0, video: 0, link: 0 }), [items])

  return (
    <main className="min-h-screen theme-surface px-4 py-8 sm:px-6 sm:py-10">
      <section className="mx-auto max-w-7xl">
        <div className="mb-8 rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/80 p-5 shadow-sm sm:p-7">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary-500/25 bg-primary-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-primary-300">
            <Share2 className="h-3.5 w-3.5" />
            Shared gallery
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold leading-tight text-base-content sm:text-5xl">
                {share?.title || 'Shared album'}
              </h1>
              <p className="mt-3 text-sm text-base-content/65 sm:text-base">
                {items.length} item{items.length === 1 ? '' : 's'} · {counts.image} images · {counts.video} videos · {counts.link} links
              </p>
            </div>
            <div className="inline-flex w-fit rounded-full border border-base-content/10 bg-base-200/70 px-4 py-2 text-sm font-semibold text-base-content/75">
              {formatFilterLabel(share?.filter)}
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/80 p-8 text-center text-base-content/65">
            This share link has no visible items.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item, index) => (
              <SharedMediaCard
                key={item?.id || `${share?.scope || 'share'}-${index}`}
                item={item}
                index={index}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default function SharedImagePage({ params }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [share, setShare] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  useEffect(() => {
    const loadSharedImage = async () => {
      setLoading(true)
      setError('')

      try {
        const res = await fetch(`/api/share/${resolvedParams.token}`, { cache: 'no-store' })
        const data = await readJsonSafely(res)

        if (!res.ok) {
          throw new Error(data.error || 'Failed to load shared image')
        }

        setShare(data.share || {
          shareVersion: 1,
          shareType: 'item',
          title: data.image?.pageTitle || 'Shared item',
          itemCount: data.image ? 1 : 0,
          items: data.image ? [data.image] : [],
        })
      } catch (err) {
        setError(err.message || 'Failed to load shared image')
      } finally {
        setLoading(false)
      }
    }

    if (resolvedParams?.token) {
      loadSharedImage()
    }
  }, [resolvedParams?.token])

  const items = Array.isArray(share?.items) ? share.items : []
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null
  const isSingleShare = share?.shareType !== 'album' && items.length === 1

  if (loading) {
    return (
      <main className="min-h-screen theme-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </main>
    )
  }

  if (error || !share) {
    return (
      <main className="min-h-screen theme-surface flex items-center justify-center px-4">
        <div className="glass rounded-[var(--radius-box)] p-8 text-center max-w-md">
          <p className="text-error font-medium">{error || 'Shared image not found'}</p>
        </div>
      </main>
    )
  }

  if (isSingleShare) {
    return (
      <>
        <main className="min-h-screen theme-surface" />
        <GalleryLightbox
          image={items[0]}
          images={items}
          currentIndex={0}
          onClose={() => router.push('/')}
          onNavigate={() => {}}
          redactedFields={['imgbbDeleteUrl', 'pixvidDeleteUrl']}
        />
      </>
    )
  }

  return (
    <>
      <SharedAlbum share={share} onOpen={setSelectedIndex} />
      {selectedItem && (
        <GalleryLightbox
          image={selectedItem}
          images={items}
          currentIndex={selectedIndex}
          onClose={() => setSelectedIndex(-1)}
          onNavigate={setSelectedIndex}
          redactedFields={['imgbbDeleteUrl', 'pixvidDeleteUrl']}
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
