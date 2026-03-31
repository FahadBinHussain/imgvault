'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { Save, Loader2, Check, AlertCircle, KeyRound, Cloud, ImageIcon, Folder } from 'lucide-react'
import AppNavbar from '../components/AppNavbar'

const defaultSettings = {
  pixvidApiKey: '',
  imgbbApiKey: '',
  filemoonApiKey: '',
  udropKey1: '',
  udropKey2: '',
  defaultGallerySource: 'imgbb',
  downloadFolder: 'C:\\Users\\Admin\\Videos',
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

      if (data?.config) {
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

    if (!parsedConfig) {
      setSaving(false)
      setError('Please enter a valid Firebase config JSON object')
      return
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseConfig: parsedConfig,
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
    } catch {
      setError('Clipboard does not contain valid JSON')
    }
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
            <p className="text-dark-400">Configure your web dashboard like the extension</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="glass rounded-2xl p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <KeyRound className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">API Keys</h2>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-dark-100 mb-2">Pixvid API Key</label>
                  <input
                    type="password"
                    value={settings.pixvidApiKey}
                    onChange={(e) => updateSetting('pixvidApiKey', e.target.value)}
                    placeholder="Enter your Pixvid API key"
                    className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-dark-100 mb-2">ImgBB API Key</label>
                  <input
                    type="password"
                    value={settings.imgbbApiKey}
                    onChange={(e) => updateSetting('imgbbApiKey', e.target.value)}
                    placeholder="Enter your ImgBB API key"
                    className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-dark-100 mb-2">Filemoon API Key</label>
                  <input
                    type="password"
                    value={settings.filemoonApiKey}
                    onChange={(e) => updateSetting('filemoonApiKey', e.target.value)}
                    placeholder="Enter your Filemoon API key"
                    className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-dark-100 mb-2">UDrop API Key 1</label>
                    <input
                      type="password"
                      value={settings.udropKey1}
                      onChange={(e) => updateSetting('udropKey1', e.target.value)}
                      placeholder="Enter UDrop API Key 1"
                      className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-100 mb-2">UDrop API Key 2</label>
                    <input
                      type="password"
                      value={settings.udropKey2}
                      onChange={(e) => updateSetting('udropKey2', e.target.value)}
                      placeholder="Enter UDrop API Key 2"
                      className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl p-5 sm:p-8">
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <Cloud className="w-5 h-5 text-primary-400" />
                  <h2 className="text-xl font-semibold">Firebase Configuration</h2>
                </div>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Paste from clipboard
                </button>
              </div>

              <label className="text-sm font-medium text-dark-100">Firebase Config JSON</label>
              <textarea
                value={configText}
                onChange={(e) => handleConfigChange(e.target.value)}
                placeholder='{"apiKey":"...","authDomain":"..."}'
                className="mt-2 w-full min-h-[220px] sm:min-h-[260px] rounded-xl border border-base-content/15 bg-base-100/70 p-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
              <p className="mt-2 text-xs text-dark-400">
                Paste the full Firebase config JSON. It will be parsed automatically.
              </p>
            </div>

            <div className="glass rounded-2xl p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <ImageIcon className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">Gallery Preferences</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-100 mb-2">Default Image Source</label>
                <select
                  value={settings.defaultGallerySource}
                  onChange={(e) => updateSetting('defaultGallerySource', e.target.value)}
                  className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                >
                  <option value="imgbb">ImgBB (Original Quality)</option>
                  <option value="pixvid">Pixvid (Compressed Quality)</option>
                </select>
              </div>
            </div>

            <div className="glass rounded-2xl p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <Folder className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold">Video Download Folder</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-100 mb-2">Download Folder</label>
                <input
                  type="text"
                  value={settings.downloadFolder}
                  onChange={(e) => updateSetting('downloadFolder', e.target.value)}
                  placeholder="C:\Users\Admin\Videos"
                  className="w-full rounded-xl border border-base-content/15 bg-base-100/70 px-4 py-3 text-sm text-base-content placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
                <p className="mt-2 text-xs text-dark-400">
                  Stored for parity with the extension settings page.
                </p>
              </div>
            </div>

            {parseError ? (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {parseError}
              </div>
            ) : null}

            {error ? (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <Check className="w-4 h-4" />
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50"
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
