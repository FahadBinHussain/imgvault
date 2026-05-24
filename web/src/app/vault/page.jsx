'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import {
  EyeOff,
  FileText,
  Grid,
  Image as ImageIcon,
  KeyRound,
  List,
  Loader2,
  LockKeyhole,
  Search,
  Tag,
  UnlockKeyhole,
  X,
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'
import GalleryLightbox from '../components/GalleryLightbox'
import { getPreferredImageProviderLink } from '@/lib/image-provider-links'
import { getPreferredVideoProviderLink } from '@/lib/video-provider-links'
import {
  getMediaItemKind,
  isTruthyFlag,
} from '@shared/mediaFieldRegistry.js'

const VAULT_CONFIG_KEY = 'secretVaultConfig'
const VAULT_SESSION_KEY = 'imgvault-vault-unlocked'

async function readJsonSafely(res) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function makeSalt() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

async function hashVaultPasscode(passcode, salt) {
  const data = new TextEncoder().encode(`${salt}:${passcode}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

function getLocalVaultConfig() {
  try {
    const raw = localStorage.getItem(VAULT_CONFIG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveLocalVaultConfig(config) {
  try {
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Backend config is the source of truth; local storage only speeds up unlock.
  }
}

function getPreferredImageUrl(image, preferredProvider = 'imgbb') {
  return getPreferredImageProviderLink(image, preferredProvider, 'url') || image?.sourceImageUrl || image?.imgbbThumbUrl || ''
}

function getItemKind(item) {
  return getMediaItemKind(item)
}

function getPreferredVideoWatchUrl(item, preferredVideoSource = 'filemoon') {
  return getPreferredVideoProviderLink(item, preferredVideoSource, 'watchUrl')
}

function getPreferredVideoDirectUrl(item, preferredVideoSource = 'filemoon') {
  return getPreferredVideoProviderLink(item, preferredVideoSource, 'directUrl')
}

function getLinkPreviewImage(item, preferredProvider = 'imgbb') {
  return (
    item?.linkPreviewImageUrl ||
    getPreferredImageUrl(item, preferredProvider) ||
    getPreferredImageProviderLink(item, preferredProvider, 'thumbnailUrl') ||
    item?.sourceImageUrl ||
    ''
  )
}

function toProxyMediaUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (!/^https?:\/\//i.test(url)) return url
  return `/api/media?url=${encodeURIComponent(url)}`
}

function VaultGalleryCard({ item, index, viewMode, onClick, preferredProvider = 'imgbb', preferredVideoSource = 'filemoon' }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const kind = getItemKind(item)
  const imageUrl = getPreferredImageUrl(item, preferredProvider)
  const videoWatchUrl = getPreferredVideoWatchUrl(item, preferredVideoSource)
  const videoDirectUrl = getPreferredVideoDirectUrl(item, preferredVideoSource)
  const linkPreviewImage = toProxyMediaUrl(getLinkPreviewImage(item, preferredProvider))

  return (
    <div
      className={`group relative glass rounded-[var(--radius-box)] overflow-hidden cursor-pointer transition-all duration-500 hover:-translate-y-2 hover:shadow-xl hover:shadow-primary-500/10 ${viewMode === 'list' ? 'flex' : ''}`}
      style={{
        animationDelay: `${index * 50}ms`,
        animation: 'fadeInUp 0.6s ease-out forwards',
        opacity: 0,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div
        className={`${viewMode === 'list' ? 'w-28 h-24 sm:w-40 sm:h-28 flex-shrink-0' : 'h-auto'} bg-base-100 relative overflow-hidden`}
        style={viewMode !== 'list' && !isLoaded ? { minHeight: '220px' } : undefined}
      >
        {kind === 'link' ? (
          linkPreviewImage ? (
            <img
              src={linkPreviewImage}
              alt={item.pageTitle || 'Saved link'}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-contain' : 'h-auto object-contain'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center">
              <FileText className="w-12 h-12 text-base-content/55" />
            </div>
          )
        ) : kind === 'video' ? (
          videoDirectUrl ? (
            <video
              src={videoDirectUrl}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-cover' : 'h-auto object-cover'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              muted
              playsInline
              preload="metadata"
              onLoadedData={() => setIsLoaded(true)}
            />
          ) : videoWatchUrl ? (
            <iframe
              src={videoWatchUrl}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-cover' : 'h-auto object-cover'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              frameBorder="0"
              scrolling="no"
              onLoad={() => setIsLoaded(true)}
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={item.pageTitle || 'Saved video'}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-cover' : 'h-auto object-cover'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center">
              <FileText className="w-12 h-12 text-base-content/55" />
            </div>
          )
        ) : imageUrl ? (
          <>
            {!isLoaded && (
              <div className="absolute inset-0 bg-base-200/70">
                <div
                  className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  style={{ backgroundSize: '200% 100%' }}
                />
              </div>
            )}
            <img
              src={imageUrl}
              alt={item.pageTitle || 'Saved image'}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-contain' : 'h-auto object-contain'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center">
            <ImageIcon className="w-12 h-12 text-base-content/55" />
          </div>
        )}

        {kind === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/45 rounded-full p-3">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`} />

        <div
          className={`absolute inset-0 rounded-[var(--radius-box)] transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
          style={{
            background: 'linear-gradient(135deg, rgba(92, 124, 250, 0.3), transparent, rgba(92, 124, 250, 0.1))',
            pointerEvents: 'none',
          }}
        />
      </div>

      {viewMode === 'list' && (
        <div className="p-4 space-y-3 flex-1 flex flex-col justify-center">
          <h3 className="text-sm font-semibold truncate transition-colors duration-300 group-hover:text-primary-400" title={item.pageTitle || 'Untitled'}>
            {item.pageTitle || item.fileName || item.linkUrl || 'Untitled'}
          </h3>
          <div className="flex items-center gap-2 text-xs text-base-content/65">
            <EyeOff className="w-3.5 h-3.5" />
            <span>
              {item.vaultedAt
                ? new Date(item.vaultedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Vaulted item'}
            </span>
          </div>
          {item.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.slice(0, 3).map((tag) => (
                <span
                  key={`${item.id}-${tag}`}
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

function groupVaultItemsByDate(items) {
  const groups = {}

  items.forEach((item) => {
    const rawDate = item.vaultedAt || item.internalAddedTimestamp
    const date = rawDate
      ? new Date(rawDate).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'Unknown Date'

    if (!groups[date]) groups[date] = []
    groups[date].push(item)
  })

  return Object.entries(groups).map(([date, itemsForDate]) => ({
    date,
    items: itemsForDate,
  }))
}

export default function VaultPage() {
  const { status } = useSession()
  const [configLoading, setConfigLoading] = useState(true)
  const [vaultConfig, setVaultConfig] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [authError, setAuthError] = useState('')
  const [vaultItems, setVaultItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [restoringId, setRestoringId] = useState('')
  const [preferredProvider, setPreferredProvider] = useState('imgbb')
  const [preferredVideoSource, setPreferredVideoSource] = useState('filemoon')
  const [firebaseProjectId, setFirebaseProjectId] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
    }
  }, [status])

  useEffect(() => {
    if (status !== 'authenticated') return

    let cancelled = false

    const loadVaultConfig = async () => {
      setConfigLoading(true)
      setAuthError('')

      const localConfig = getLocalVaultConfig()
      let remoteConfig = null

      try {
        const res = await fetch('/api/vault/config', { cache: 'no-store' })
        const data = await readJsonSafely(res)
        if (res.ok) remoteConfig = data.config || null
      } catch {
        remoteConfig = null
      }

      try {
        const configRes = await fetch('/api/config', { cache: 'no-store' })
        const configData = await readJsonSafely(configRes)
        if (configRes.ok) {
          setFirebaseProjectId(configData?.config?.projectId || '')
          setPreferredProvider(configData?.settings?.defaultGallerySource === 'pixvid' ? 'pixvid' : 'imgbb')
          setPreferredVideoSource(configData?.settings?.defaultVideoSource === 'udrop' ? 'udrop' : 'filemoon')
        }
      } catch {
        // Gallery preferences are nice-to-have here; the vault can still render with defaults.
      }

      const config = remoteConfig || localConfig || null

      if (remoteConfig && localConfig?.passHash !== remoteConfig.passHash) {
        saveLocalVaultConfig(remoteConfig)
      } else if (!remoteConfig && localConfig) {
        try {
          await fetch('/api/vault/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: localConfig }),
          })
        } catch {
          // Local-only config still works on this device.
        }
      }

      if (cancelled) return
      setVaultConfig(config)

      if (config) {
        try {
          const session = JSON.parse(sessionStorage.getItem(VAULT_SESSION_KEY) || '{}')
          setUnlocked(session?.passHash === config.passHash)
        } catch {
          setUnlocked(false)
        }
      }

      setConfigLoading(false)
    }

    loadVaultConfig()

    return () => {
      cancelled = true
    }
  }, [status])

  const loadVaultItems = useCallback(async () => {
    if (!unlocked) return

    setLoadingItems(true)
    setMessage('')

    try {
      const res = await fetch('/api/vault', { cache: 'no-store' })
      const data = await readJsonSafely(res)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load vault items')
      }

      setVaultItems(Array.isArray(data.items) ? data.items : [])
    } catch (error) {
      setMessage(error?.message || 'Failed to load vault items')
      setVaultItems([])
    } finally {
      setLoadingItems(false)
    }
  }, [unlocked])

  useEffect(() => {
    loadVaultItems()
  }, [loadVaultItems])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return vaultItems

    return vaultItems.filter((item) => {
      const haystack = [
        item.pageTitle,
        item.description,
        item.fileName,
        item.sourcePageUrl,
        item.linkUrl,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [searchQuery, vaultItems])

  const counts = filteredItems.reduce((acc, item) => {
    const kind = getItemKind(item)
    acc.total += 1
    acc[kind] += 1
    return acc
  }, { total: 0, image: 0, video: 0, link: 0 })

  const groupedItems = useMemo(() => groupVaultItemsByDate(filteredItems), [filteredItems])

  const handleItemClick = useCallback((item, index) => {
    setMessage('')
    setSelectedItem(item)
    setSelectedIndex(index)
  }, [])

  const handleCloseLightbox = useCallback(() => {
    setMessage('')
    setSelectedItem(null)
    setSelectedIndex(-1)
  }, [])

  const handleNavigate = useCallback((index) => {
    setMessage('')
    setSelectedItem(filteredItems[index])
    setSelectedIndex(index)
  }, [filteredItems])

  const handleSaveItemEdits = useCallback(async (itemId, updates) => {
    const res = await fetch('/api/images', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: itemId, updates }),
    })

    const data = await readJsonSafely(res)

    if (!res.ok) {
      throw new Error(data?.error || 'Failed to save metadata changes')
    }

    const updatedItem = data?.image || { id: itemId, ...updates }

    setVaultItems((prevItems) =>
      prevItems.map((item) => (item.id === itemId ? { ...item, ...updatedItem } : item))
    )

    setSelectedItem((prevSelected) =>
      prevSelected?.id === itemId ? { ...prevSelected, ...updatedItem } : prevSelected
    )
  }, [])

  const createVault = async (event) => {
    event.preventDefault()
    setAuthError('')
    setMessage('')

    if (passcode.length < 4) {
      setAuthError('Use at least 4 characters.')
      return
    }

    if (passcode !== confirmPasscode) {
      setAuthError('Passcodes do not match.')
      return
    }

    const salt = makeSalt()
    const passHash = await hashVaultPasscode(passcode, salt)
    const config = {
      salt,
      passHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'hidden',
    }

    saveLocalVaultConfig(config)

    try {
      const res = await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await readJsonSafely(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to sync vault config')
    } catch (error) {
      setMessage(error?.message || 'Vault created locally, but backend sync failed.')
    }

    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }))
    setVaultConfig(config)
    setUnlocked(true)
    setPasscode('')
    setConfirmPasscode('')
  }

  const unlockVault = async (event) => {
    event.preventDefault()
    setAuthError('')
    setMessage('')

    if (!vaultConfig) return

    const passHash = await hashVaultPasscode(passcode, vaultConfig.salt)
    if (passHash !== vaultConfig.passHash) {
      setAuthError('Wrong passcode.')
      return
    }

    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }))
    setUnlocked(true)
    setPasscode('')
  }

  const closeChangePasswordModal = () => {
    if (changingPassword) return
    setShowChangePassword(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setChangePasswordError('')
  }

  const changeVaultPassword = async (event) => {
    event.preventDefault()
    setChangePasswordError('')
    setMessage('')

    if (!vaultConfig || changingPassword) return

    const currentHash = await hashVaultPasscode(currentPassword, vaultConfig.salt)
    if (currentHash !== vaultConfig.passHash) {
      setChangePasswordError('Current password is wrong.')
      return
    }

    if (newPassword.length < 4) {
      setChangePasswordError('Use at least 4 characters.')
      return
    }

    if (newPassword !== confirmNewPassword) {
      setChangePasswordError('New passwords do not match.')
      return
    }

    setChangingPassword(true)
    try {
      const salt = makeSalt()
      const passHash = await hashVaultPasscode(newPassword, salt)
      const updatedAt = new Date().toISOString()
      const config = {
        ...vaultConfig,
        salt,
        passHash,
        mode: vaultConfig.mode || 'hidden',
        updatedAt,
        passcodeUpdatedAt: updatedAt,
      }

      const res = await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await readJsonSafely(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to change vault password')

      saveLocalVaultConfig(config)
      sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }))
      setVaultConfig(config)
      setShowChangePassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setMessage('Vault password changed.')
    } catch (error) {
      setChangePasswordError(error?.message || 'Failed to change password. Check your database settings and try again.')
    } finally {
      setChangingPassword(false)
    }
  }

  const lockVault = () => {
    sessionStorage.removeItem(VAULT_SESSION_KEY)
    setUnlocked(false)
    setVaultItems([])
    setPasscode('')
    closeChangePasswordModal()
  }

  const restoreItem = async (item) => {
    if (!item?.id || restoringId) return

    setRestoringId(item.id)
    setMessage('')

    try {
      const res = await fetch('/api/vault', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'restore' }),
      })
      const data = await readJsonSafely(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to restore vault item')

      setVaultItems((prev) => prev.filter((entry) => entry.id !== item.id))
      setSelectedItem(null)
      setSelectedIndex(-1)
      setMessage('Restored to Gallery.')
    } catch (error) {
      setMessage(error?.message || 'Failed to restore vault item')
    } finally {
      setRestoringId('')
    }
  }

  if (status === 'loading' || configLoading) {
    return (
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="vault" />
        <div className="flex min-h-[60vh] items-center justify-center pt-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </main>
    )
  }

  return (
    <>
    <main className="min-h-screen theme-surface">
      <AppNavbar mode="dashboard" activeRoute="vault" />
      <section className="px-4 pb-10 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
            <div className="animate-fade-in">
              <h1 className="text-3xl sm:text-4xl font-bold mb-2">
                <span className="gradient-text">Secret Vault</span>
              </h1>
              <p className="text-base-content/65">
                {unlocked && counts.total > 0
                  ? `${counts.total} hidden · ${counts.image} images · ${counts.video} videos · ${counts.link} links`
                  : 'Hidden media with the same gallery experience'}
              </p>
              {unlocked && vaultItems.length > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-300">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary-400" />
                  Viewing from {preferredProvider === 'pixvid' ? 'Pixvid' : 'ImgBB'}
                </div>
              )}
            </div>

            {unlocked && (
              <div className="w-full md:w-auto flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
                {vaultItems.length > 0 && (
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/55 transition-colors group-focus-within:text-primary-400" />
                    <input
                      type="text"
                      placeholder="Search vault..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-11 pr-10 py-3 bg-base-200/60 border border-base-content/10 rounded-[var(--radius-box)] text-sm focus:outline-none focus:border-primary-500/50 focus:bg-base-200 w-full sm:w-64 transition-all duration-300 sm:focus:w-80 focus:shadow-lg focus:shadow-primary-500/10"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-base-content/10 transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-base-content/65" />
                      </button>
                    )}
                  </div>
                )}

                {vaultItems.length > 0 && (
                  <div className="flex items-center gap-1 glass rounded-[var(--radius-box)] p-1.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`p-2.5 rounded-[var(--radius-box)] transition-all duration-300 ${viewMode === 'grid' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-base-content/65 hover:text-base-content hover:bg-base-content/5'}`}
                      title="Grid view"
                    >
                      <Grid className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`p-2.5 rounded-[var(--radius-box)] transition-all duration-300 ${viewMode === 'list' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-base-content/65 hover:text-base-content hover:bg-base-content/5'}`}
                      title="List view"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowChangePassword(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-3 text-sm font-semibold text-base-content transition-colors hover:bg-base-200"
                >
                  <KeyRound className="h-4 w-4" />
                  Change Password
                </button>

                <button
                  type="button"
                  onClick={lockVault}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-3 text-sm font-semibold text-base-content transition-colors hover:bg-base-200"
                >
                  <LockKeyhole className="h-4 w-4" />
                  Lock Vault
                </button>
              </div>
            )}
          </div>

          {!unlocked ? (
            <div className="mx-auto max-w-md rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-6 shadow-xl">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-box)] bg-primary/10 text-primary">
                  {vaultConfig ? <UnlockKeyhole className="h-6 w-6" /> : <LockKeyhole className="h-6 w-6" />}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-base-content">
                    {vaultConfig ? 'Unlock Secret Vault' : 'Create Secret Vault'}
                  </h2>
                  <p className="text-sm text-base-content/60">
                    {vaultConfig ? 'Use the same passcode you created in the extension or web.' : 'Create a passcode for this Neon-backed vault.'}
                  </p>
                </div>
              </div>

              <form onSubmit={vaultConfig ? unlockVault : createVault} className="space-y-4">
                <input
                  type="password"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  placeholder={vaultConfig ? 'Vault passcode' : 'Create passcode'}
                  className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-4 py-3 text-base-content outline-none transition-colors focus:border-primary"
                  autoFocus
                />
                {!vaultConfig && (
                  <input
                    type="password"
                    value={confirmPasscode}
                    onChange={(event) => setConfirmPasscode(event.target.value)}
                    placeholder="Confirm passcode"
                    className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-4 py-3 text-base-content outline-none transition-colors focus:border-primary"
                  />
                )}

                {authError && (
                  <div className="rounded-[var(--radius-box)] border border-error/30 bg-error/10 p-3 text-sm text-error">
                    {authError}
                  </div>
                )}
                {message && (
                  <div className="rounded-[var(--radius-box)] border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-box)] bg-primary px-4 py-3 font-bold text-primary-content transition-colors hover:bg-primary/90"
                >
                  {vaultConfig ? <UnlockKeyhole className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                  {vaultConfig ? 'Unlock Vault' : 'Create Vault'}
                </button>
              </form>
            </div>
          ) : (
            <>
              {message && (
                <div className="mb-6 rounded-[var(--radius-box)] border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
                  {message}
                </div>
              )}

              {loadingItems ? (
                <div className="flex min-h-[35vh] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="glass rounded-[var(--radius-box)] p-12 text-center animate-fade-in">
                  <EyeOff className="mx-auto mb-4 h-12 w-12 text-base-content/45" />
                  <h2 className="text-xl font-bold text-base-content">No vault items found</h2>
                  <p className="mt-2 text-base-content/60">
                    Move an item from the gallery detail modal to hide it here.
                  </p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="space-y-8">
                  {groupedItems.map((group) => (
                    <div key={group.date}>
                      <div className="flex items-center gap-4 mb-4">
                        <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                        {group.items.map((item) => {
                          const globalIndex = filteredItems.findIndex((entry) => entry.id === item.id)
                          return (
                            <VaultGalleryCard
                              key={item.id}
                              item={item}
                              index={globalIndex}
                              viewMode={viewMode}
                              preferredProvider={preferredProvider}
                              preferredVideoSource={preferredVideoSource}
                              onClick={() => handleItemClick(item, globalIndex)}
                            />
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-8">
                  {groupedItems.map((group) => (
                    <div key={group.date}>
                      <div className="flex items-center gap-4 mb-4">
                        <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {group.items.map((item) => {
                          const globalIndex = filteredItems.findIndex((entry) => entry.id === item.id)
                          return (
                            <VaultGalleryCard
                              key={item.id}
                              item={item}
                              index={globalIndex}
                              viewMode={viewMode}
                              preferredProvider={preferredProvider}
                              preferredVideoSource={preferredVideoSource}
                              onClick={() => handleItemClick(item, globalIndex)}
                            />
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>

    {selectedItem && (
      <GalleryLightbox
        image={selectedItem}
        images={filteredItems}
        currentIndex={selectedIndex}
        onClose={handleCloseLightbox}
        onNavigate={handleNavigate}
        onSaveEdits={handleSaveItemEdits}
        onRestoreFromVault={restoreItem}
        isRestoringFromVault={restoringId === selectedItem.id}
        shareStatus={message}
        preferredProvider={preferredProvider}
        preferredVideoSource={preferredVideoSource}
        firebaseProjectId={firebaseProjectId}
      />
    )}

    {showChangePassword && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          onClick={closeChangePasswordModal}
          aria-label="Close change password modal"
        />
        <form
          onSubmit={changeVaultPassword}
          className="relative z-10 w-full max-w-md rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-6 shadow-2xl"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-base-content">Change Vault Password</h2>
              <p className="mt-1 text-sm text-base-content/60">
                This updates the same vault unlock password used by the extension and web app.
              </p>
            </div>
            <button
              type="button"
              onClick={closeChangePasswordModal}
              disabled={changingPassword}
              className="rounded-[var(--radius-box)] p-2 text-base-content/60 transition-colors hover:bg-base-content/10 hover:text-base-content disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-4 py-3 text-base-content outline-none transition-colors focus:border-primary"
              autoFocus
            />
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password"
              className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-4 py-3 text-base-content outline-none transition-colors focus:border-primary"
            />
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(event) => setConfirmNewPassword(event.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-200 px-4 py-3 text-base-content outline-none transition-colors focus:border-primary"
            />

            {changePasswordError && (
              <div className="rounded-[var(--radius-box)] border border-error/30 bg-error/10 p-3 text-sm text-error">
                {changePasswordError}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeChangePasswordModal}
                disabled={changingPassword}
                className="rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-3 text-sm font-semibold text-base-content transition-colors hover:bg-base-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={changingPassword}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] bg-primary px-4 py-3 text-sm font-bold text-primary-content transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {changingPassword ? 'Saving...' : 'Change Password'}
              </button>
            </div>
          </div>
        </form>
      </div>
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

      .animate-fade-in {
        animation: fade-in 0.5s ease-out forwards;
      }
    `}</style>
    </>
  )
}
