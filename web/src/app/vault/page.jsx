'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import {
  EyeOff,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  LockKeyhole,
  RotateCcw,
  Search,
  UnlockKeyhole,
  Video,
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'

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

function getKind(item) {
  if (item?.isLink) return 'link'
  if (item?.isVideo || String(item?.fileType || '').startsWith('video/')) return 'video'
  return 'image'
}

function getPreviewUrl(item) {
  return (
    item?.linkPreviewImageUrl ||
    item?.imgbbThumbUrl ||
    item?.imgbbUrl ||
    item?.pixvidUrl ||
    item?.sourceImageUrl ||
    ''
  )
}

function getVideoUrl(item) {
  return item?.udropDirectUrl || item?.filemoonDirectUrl || item?.udropWatchUrl || item?.filemoonWatchUrl || ''
}

function VaultItemCard({ item, restoringId, onRestore }) {
  const kind = getKind(item)
  const previewUrl = getPreviewUrl(item)
  const videoUrl = getVideoUrl(item)

  return (
    <article className="group overflow-hidden rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
      <div className="relative flex h-56 items-center justify-center overflow-hidden bg-base-200">
        {kind === 'video' && videoUrl ? (
          <video src={videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : previewUrl ? (
          <img src={previewUrl} alt={item.pageTitle || 'Vault item'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-base-content/55">
            {kind === 'link' ? <Link2 className="h-10 w-10" /> : kind === 'video' ? <Video className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
            <span className="text-xs uppercase tracking-[0.2em]">{kind}</span>
          </div>
        )}

        <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-base-content/15 bg-base-100/95 px-2.5 py-1 text-xs font-semibold text-base-content shadow-sm">
          {kind === 'link' ? <Link2 className="h-3.5 w-3.5" /> : kind === 'video' ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {kind}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <h2 className="line-clamp-2 text-base font-bold text-base-content">
          {item.pageTitle || item.fileName || 'Untitled vault item'}
        </h2>
        <p className="line-clamp-2 text-sm text-base-content/65">
          {item.description || item.sourcePageUrl || item.linkUrl || 'Hidden from the normal gallery'}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-base-content/55">
            {item.vaultedAt ? new Date(item.vaultedAt).toLocaleString() : 'Vaulted item'}
          </span>
          <button
            type="button"
            onClick={() => onRestore(item)}
            disabled={restoringId === item.id}
            className="inline-flex items-center gap-2 rounded-[var(--radius-box)] bg-primary px-3 py-2 text-sm font-semibold text-primary-content transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {restoringId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Restore
          </button>
        </div>
      </div>
    </article>
  )
}

export default function VaultPage() {
  const { status } = useSession()
  const [configLoading, setConfigLoading] = useState(true)
  const [vaultConfig, setVaultConfig] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [authError, setAuthError] = useState('')
  const [vaultItems, setVaultItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [restoringId, setRestoringId] = useState('')

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

  const lockVault = () => {
    sessionStorage.removeItem(VAULT_SESSION_KEY)
    setUnlocked(false)
    setVaultItems([])
    setPasscode('')
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
    <main className="min-h-screen theme-surface">
      <AppNavbar mode="dashboard" activeRoute="vault" />
      <section className="px-4 pb-10 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-primary">
                <EyeOff className="h-3.5 w-3.5" />
                Secret Vault
              </div>
              <h1 className="text-3xl font-black text-base-content sm:text-4xl">
                Hidden media, same library
              </h1>
              <p className="mt-2 max-w-2xl text-base-content/65">
                Vaulted items are removed from the normal gallery and only appear here after unlock.
              </p>
            </div>

            {unlocked && (
              <button
                type="button"
                onClick={lockVault}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-100 px-4 py-3 text-sm font-semibold text-base-content transition-colors hover:bg-base-200"
              >
                <LockKeyhole className="h-4 w-4" />
                Lock Vault
              </button>
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
              <div className="mb-6 flex flex-col gap-3 rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-box)] bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold text-base-content">
                      {vaultItems.length} hidden item{vaultItems.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-sm text-base-content/60">Restore any item to send it back to Gallery.</p>
                  </div>
                </div>

                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/45" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search vault..."
                    className="w-full rounded-[var(--radius-box)] border border-base-content/10 bg-base-200 py-3 pl-11 pr-4 text-sm text-base-content outline-none transition-colors focus:border-primary"
                  />
                </div>
              </div>

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
                <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-12 text-center shadow-sm">
                  <EyeOff className="mx-auto mb-4 h-12 w-12 text-base-content/45" />
                  <h2 className="text-xl font-bold text-base-content">No vault items found</h2>
                  <p className="mt-2 text-base-content/60">
                    Move an item from the gallery detail modal to hide it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredItems.map((item) => (
                    <VaultItemCard
                      key={item.id}
                      item={item}
                      restoringId={restoringId}
                      onRestore={restoreItem}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}
