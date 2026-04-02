'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import GalleryLightbox from '@/app/components/GalleryLightbox'

async function readJsonSafely(res) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

export default function SharedImagePage({ params }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

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

        setImage(data.image || null)
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

  if (loading) {
    return (
      <main className="min-h-screen theme-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </main>
    )
  }

  if (error || !image) {
    return (
      <main className="min-h-screen theme-surface flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <p className="text-error font-medium">{error || 'Shared image not found'}</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="min-h-screen theme-surface" />
      <GalleryLightbox
        image={image}
        images={[image]}
        currentIndex={0}
        onClose={() => router.push('/')}
        onNavigate={() => {}}
        redactedFields={['imgbbDeleteUrl', 'pixvidDeleteUrl']}
      />
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
