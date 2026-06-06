'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import {
  Save,
  Loader2,
  Check,
  AlertCircle,
  KeyRound,
  Cloud,
  ImageIcon,
  Folder,
  Eye,
  EyeOff,
  Clipboard,
  ClipboardPaste,
  Trash2,
} from 'lucide-react'
import AppNavbar from '../components/AppNavbar'
import { IMAGE_SOURCE_OPTIONS, VIDEO_SOURCE_OPTIONS } from '@/lib/providerCatalog'

const defaultSettings = {
  pixvidApiKey: '',
  imgbbApiKey: '',
  filemoonApiKey: '',
  udropKey1: '',
  udropKey2: '',
  defaultGallerySource: 'imgbb',
  defaultVideoSource: 'filemoon',
  downloadFolder: 'C:\\Users\\Admin\\Videos',
}

const firebaseConfigKeys = new Set([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'measurementId',
])

function hasFirebaseConfigFields(config) {
  return Boolean(
    config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Object.keys(config).some((key) => firebaseConfigKeys.has(key))
  )
}

function maskFirebaseValue(value) {
  if (value === null || value === undefined || value === '') return value
  if (Array.isArray(value)) return value.map(maskFirebaseValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, maskFirebaseValue(childValue)])
    )
  }
  return '••••••••'
}

function getMaskedFirebaseConfigText(value) {
  const text = String(value || '').trim()
  if (!text) return 'No Firebase config saved.'

  try {
    return JSON.stringify(maskFirebaseValue(JSON.parse(text)), null, 2)
  } catch {
    return text.replace(/(["']?[\w-]+["']?\s*:\s*["'])([^"']*)(["'])/g, (_match, prefix, rawValue, suffix) =>
      `${prefix}${rawValue ? '••••••••' : ''}${suffix}`
    )
  }
}

export default function SettingsPage() {
  const { status } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [configText, setConfigText] = useState('')
  const [parsedConfig, setParsedConfig] = useState(null)
  const [parseError, setParseError] = useState('')
  const [settings, setSettings] = useState(defaultSettings)
  const [showFirebaseConfig, setShowFirebaseConfig] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
      return
    }

    if (status === 'authenticated') {
      loadConfig()
    }
  }, [status])

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()

      if (hasFirebaseConfigFields(data?.config)) {
        setConfigText(JSON.stringify(data.config, null, 2))
        setParsedConfig(data.config)
      }

      if (data?.settings && typeof data.settings === 'object') {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
        }))
      }
    } catch (err) {
      console.error('Failed to load config:', err)
      setError('Failed to load existing configuration')
    } finally {
      setLoading(false)
    }
  }

  const handleConfigChange = (value) => {
    setConfigText(value)
    setSuccess('')
    setError('')

    if (!value.trim()) {
      setParsedConfig(null)
      setParseError('')
      return
    }

    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParsedConfig(null)
        setParseError('Config must be a JSON object')
        return
      }

      setParsedConfig(parsed)
      setParseError('')
    } catch {
      setParsedConfig(null)
      setParseError('Invalid JSON format')
    }
  }

  const updateSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
    setSuccess('')
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseConfig: parsedConfig || {},
          settings,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      setSuccess('Settings saved successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleConfigChange(text)
      setShowFirebaseConfig(true)
    } catch {
      setError('Clipboard does not contain valid JSON')
    }
  }

  const handleCopyFirebaseConfig = async () => {
    try {
      await navigator.clipboard.writeText(configText || '')
      setSuccess('Firebase config copied.')
      setTimeout(() => setSuccess(''), 2000)
    } catch {
      setError('Failed to copy Firebase config')
    }
  }

  const handleClearFirebaseConfig = () => {
    handleConfigChange('')
    setShowFirebaseConfig(false)
  }

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen theme-surface">
        <AppNavbar mode="dashboard" activeRoute="settings" />
        <div className="pt-24 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen theme-surface">
      <AppNavbar mode="dashboard" activeRoute="settings" />

      <section className="pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Settings</h1>
            <p className="text-base-content/65">Configure your web dashboard like the extension</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="glass rounded-[var(--radius-box)] p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <KeyRound className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">API Keys</h2>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-base-content/85 mb-2">Pixvid API Key</label>
                  <input
                    type="password"
                    value={settings.pixvidApiKey}
                    onChange={(e) => updateSetting('pixvidApiKey', e.target.value)}
                    placeholder="Enter your Pixvid API key"
                    className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-base-content/85 mb-2">ImgBB API Key</label>
                  <input
                    type="password"
                    value={settings.imgbbApiKey}
                    onChange={(e) => updateSetting('imgbbApiKey', e.target.value)}
                    placeholder="Enter your ImgBB API key"
                    className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-base-content/85 mb-2">Filemoon API Key</label>
                  <input
                    type="password"
                    value={settings.filemoonApiKey}
                    onChange={(e) => updateSetting('filemoonApiKey', e.target.value)}
                    placeholder="Enter your Filemoon API key"
                    className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-base-content/85 mb-2">UDrop API Key 1</label>
                    <input
                      type="password"
                      value={settings.udropKey1}
                      onChange={(e) => updateSetting('udropKey1', e.target.value)}
                      placeholder="Enter UDrop API Key 1"
                      className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-base-content/85 mb-2">UDrop API Key 2</label>
                    <input
                      type="password"
                      value={settings.udropKey2}
                      onChange={(e) => updateSetting('udropKey2', e.target.value)}
                      placeholder="Enter UDrop API Key 2"
                      className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="glass rounded-[var(--radius-box)] p-5 sm:p-8">
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <Cloud className="w-5 h-5 text-primary-400" />
                  <h2 className="text-xl font-semibold">Firebase Configuration</h2>
                </div>
              </div>

              <label className="text-sm font-medium text-base-content/85">Firebase Config JSON</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowFirebaseConfig((value) => !value)}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-content/5 px-3 py-2 text-xs font-semibold text-base-content/75 hover:bg-base-content/10 transition-colors"
                >
                  {showFirebaseConfig ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showFirebaseConfig ? 'Hide' : 'Reveal'}
                </button>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-content/5 px-3 py-2 text-xs font-semibold text-base-content/75 hover:bg-base-content/10 transition-colors"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste
                </button>
                <button
                  type="button"
                  onClick={handleCopyFirebaseConfig}
                  disabled={!configText}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-base-content/15 bg-base-content/5 px-3 py-2 text-xs font-semibold text-base-content/75 hover:bg-base-content/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={handleClearFirebaseConfig}
                  disabled={!configText}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-box)] border border-error/20 bg-error/10 px-3 py-2 text-xs font-semibold text-error hover:bg-error/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>
              {showFirebaseConfig ? (
                <textarea
                  value={configText}
                  onChange={(e) => handleConfigChange(e.target.value)}
                  placeholder='{"apiKey":"...","authDomain":"..."}'
                  className="mt-3 w-full min-h-[220px] sm:min-h-[260px] rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 p-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
              ) : (
                <pre className="mt-3 min-h-[220px] sm:min-h-[260px] whitespace-pre-wrap break-words select-none rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/50 p-3 text-sm text-base-content/70">{getMaskedFirebaseConfigText(configText)}</pre>
              )}
              <p className="mt-2 text-xs text-base-content/65">
                Hidden by default. Use Reveal only when you need to edit the full JSON.
              </p>
            </div>

            <div className="glass rounded-[var(--radius-box)] p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <ImageIcon className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">Gallery Preferences</h2>
              </div>

              <div className="space-y-5">
                <div>
                <label className="block text-sm font-medium text-base-content/85 mb-2">Default Image Source</label>
                <select
                  value={settings.defaultGallerySource}
                  onChange={(e) => updateSetting('defaultGallerySource', e.target.value)}
                  className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                >
                  {IMAGE_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

                <div>
                  <label className="block text-sm font-medium text-base-content/85 mb-2">Default Video Source</label>
                  <select
                    value={settings.defaultVideoSource}
                    onChange={(e) => updateSetting('defaultVideoSource', e.target.value)}
                    className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  >
                    {VIDEO_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="glass rounded-[var(--radius-box)] p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <Folder className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">Video Download Folder</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-base-content/85 mb-2">Download Folder</label>
                <input
                  type="text"
                  value={settings.downloadFolder}
                  onChange={(e) => updateSetting('downloadFolder', e.target.value)}
                  placeholder="C:\Users\Admin\Videos"
                  className="w-full rounded-[var(--radius-box)] border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
                <p className="mt-2 text-xs text-base-content/65">
                  Stored for parity with the extension settings page.
                </p>
              </div>
            </div>

            {parseError ? (
              <div className="flex items-center gap-2 text-error text-sm">
                <AlertCircle className="w-4 h-4" />
                {parseError}
              </div>
            ) : null}

            {error ? (
              <div className="flex items-center gap-2 text-error text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="flex items-center gap-2 text-success text-sm">
                <Check className="w-4 h-4" />
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-[var(--radius-box)] font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save Settings
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
