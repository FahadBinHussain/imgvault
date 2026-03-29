'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { Image, Settings, Save, Loader2, Check, AlertCircle } from 'lucide-react'
import UserAvatar from '../components/UserAvatar'
import ThemeSwitcher from '../components/ThemeSwitcher'

function Navbar() {
  const { data: session } = useSession()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass py-4">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/25">
            <Image className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold">
            Img<span className="gradient-text">Vault</span>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <a href="/" className="text-dark-300 hover:text-white transition-colors text-sm font-medium">Home</a>
          <a href="/gallery" className="text-dark-300 hover:text-white transition-colors text-sm font-medium">Gallery</a>
          <ThemeSwitcher />
          <a href="/settings" className="text-white">
            <Settings className="w-5 h-5" />
          </a>
          {session?.user && (
            <UserAvatar
              user={session.user}
              className="w-8 h-8 rounded-full"
              alt="Profile"
              title={session.user?.name || session.user?.email || 'Profile'}
            />
          )}
        </div>
      </div>
    </nav>
  )
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
        const normalizedConfig = JSON.stringify(data.config, null, 2)
        setConfigText(normalizedConfig)
        setParsedConfig(data.config)
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
        body: JSON.stringify({ firebaseConfig: parsedConfig })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      setSuccess('Configuration saved successfully!')
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
        <Navbar />
        <div className="pt-24 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </main>
    )
  }

  return (
  <main className="min-h-screen theme-surface">
      <Navbar />

      <section className="pt-24 pb-12 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Settings</h1>
            <p className="text-dark-400">Configure your Firebase connection</p>
          </div>

          <form onSubmit={handleSubmit} className="glass rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Firebase Configuration</h2>
              <button
                type="button"
                onClick={handlePaste}
                className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
              >
                Paste from clipboard
              </button>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-200">Firebase Config JSON</label>
              <textarea
                value={configText}
                onChange={(e) => handleConfigChange(e.target.value)}
                placeholder='{"apiKey":"...","authDomain":"..."}'
                className="mt-1 w-full min-h-[260px] rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Paste the full Firebase config JSON. It will be parsed automatically.
              </p>
            </div>

            {parseError ? (
              <div className="mt-6 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {parseError}
              </div>
            ) : null}

            {error ? (
              <div className="mt-6 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="mt-6 flex items-center gap-2 text-green-400 text-sm">
                <Check className="w-4 h-4" />
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="mt-8 w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save Configuration
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
