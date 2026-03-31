'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import {
  Loader2,
  Link2,
  Copy,
  ExternalLink,
  Trash2,
  Calendar,
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'

async function readJsonSafely(res) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function EmptyState() {
  return (
    <div className="text-center py-20 animate-fade-in">
      <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mb-8 animate-float">
        <Link2 className="w-12 h-12 text-primary-400" />
      </div>
      <h3 className="text-2xl font-bold mb-3">No Shared Links Yet</h3>
      <p className="text-dark-400 max-w-md mx-auto">
        Create a share link from the gallery modal and it will appear here.
      </p>
    </div>
  )
}

export default function LinksPage() {
  const { status } = useSession()
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [deletingToken, setDeletingToken] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
      return
    }

    if (status === 'authenticated') {
      loadLinks()
    }
  }, [status])

  const loadLinks = async () => {
    setLoading(true)
    setLoadError('')

    try {
      const res = await fetch('/api/share/list', { cache: 'no-store' })
      const data = await readJsonSafely(res)

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load links')
      }

      setLinks(Array.isArray(data.links) ? data.links : [])
    } catch (error) {
      setLoadError(error.message || 'Failed to load links')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async (url) => {
    try {
      const fullUrl = new URL(url, window.location.origin).toString()
      await navigator.clipboard.writeText(fullUrl)
      setActionMessage('Link copied to clipboard.')
    } catch {
      setActionMessage('Failed to copy link.')
    }
  }

  const deleteLink = async (token) => {
    const previousLinks = links

    try {
      setDeletingToken(token)
      setActionMessage('')
      setLinks((prev) => prev.filter((link) => link.token !== token))

      const res = await fetch(`/api/share/${token}/delete`, {
        method: 'DELETE',
      })
      const data = await readJsonSafely(res)

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete link')
      }

      setActionMessage('Link deleted.')
    } catch (error) {
      setLinks(previousLinks)
      setActionMessage(error.message || 'Failed to delete link.')
    } finally {
      setDeletingToken('')
    }
  }

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="links" />
        <div className="pt-24 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen theme-surface">
      <AppNavbar mode="dashboard" activeRoute="links" />
      <section className="pt-24 sm:pt-28 pb-10 sm:pb-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-3 mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold">
              <span className="gradient-text">Shared Links</span>
            </h1>
            <p className="text-dark-400">
              {links.length} link{links.length !== 1 ? 's' : ''} available
            </p>
          </div>

          {actionMessage && (
            <div className="glass rounded-2xl p-4 mb-6 text-sm text-primary-200">
              {actionMessage}
            </div>
          )}

          {loadError ? (
            <div className="glass rounded-2xl p-8 text-red-400 text-center">
              <p className="font-medium">{loadError}</p>
            </div>
          ) : links.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {links.map((link) => {
                const image = link.imageData || {}
                const imageUrl =
                  image.imgbbUrl || image.imgbbThumbUrl || image.pixvidUrl || image.sourceImageUrl || null

                return (
                  <div key={link.id} className="glass rounded-2xl overflow-hidden">
                    <div className="flex flex-col sm:flex-row">
                      <div className="w-full sm:w-48 h-48 bg-dark-900 flex items-center justify-center overflow-hidden">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={image.pageTitle || 'Shared image'}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Link2 className="w-10 h-10 text-dark-500" />
                        )}
                      </div>

                      <div className="flex-1 p-5">
                        <p className="text-lg font-semibold break-words leading-snug">
                          {image.pageTitle || 'Untitled'}
                        </p>
                        <div className="mt-2 text-xs text-dark-400 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {link.updatedAt ? new Date(link.updatedAt).toLocaleString() : 'Unknown time'}
                          </span>
                        </div>

                        <div className="mt-4 bg-dark-800/50 rounded-xl px-3 py-2 text-xs text-dark-300 break-all">
                          {new URL(link.url, 'https://placeholder.local').pathname}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => copyLink(link.url)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-500/15 text-primary-300 hover:bg-primary-500/25 transition-colors text-sm"
                          >
                            <Copy className="w-4 h-4" />
                            Copy
                          </button>

                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 text-dark-100 hover:bg-white/10 transition-colors text-sm"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open
                          </a>

                          <button
                            onClick={() => deleteLink(link.token)}
                            disabled={deletingToken === link.token}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors text-sm disabled:opacity-50"
                          >
                            {deletingToken === link.token ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
