'use client'

import { useState, useEffect } from 'react'
import { 
  Shield, 
  Zap, 
  Search, 
  Cloud, 
  Image, 
  Tag, 
  Sparkles, 
  ChevronRight, 
  Download,
  Github,
  Eye,
  Layers,
  Lock,
  Cpu,
  ArrowRight,
  Check,
  Star
} from 'lucide-react'
import AppNavbar from './components/AppNavbar'
import BrandLogo from './components/BrandLogo'

function HeroSection() {
  const mockGalleryImages = [
    'https://picsum.photos/id/1015/400/400',
    'https://picsum.photos/id/1011/400/400',
    'https://picsum.photos/id/1043/400/400',
    'https://picsum.photos/id/1002/400/400',
    'https://picsum.photos/id/1003/400/400',
    'https://picsum.photos/id/1025/400/400',
    'https://picsum.photos/id/1021/400/400',
    'https://picsum.photos/id/1035/400/400',
  ]

  return (
  <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-32 sm:pt-28 md:pt-24">
      {/* Background effects */}
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30"></div>
      <div className="hidden sm:block absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-[128px] animate-pulse-slow"></div>
      <div className="hidden sm:block absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary-600/15 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2 mb-8 animate-float">
          <Sparkles className="w-4 h-4 text-primary-400" />
          <span className="text-sm text-base-content/80">Next-Gen Image Management</span>
        </div>

  <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight">
          Save Images <br />
          <span className="gradient-text">With Context</span>
        </h1>

  <p className="text-base sm:text-lg md:text-xl text-base-content/65 max-w-2xl mx-auto mb-10 sm:mb-12 leading-relaxed">
          A modern Chrome extension that captures images with their full context, 
          detects duplicates intelligently, and organizes everything beautifully.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <a 
            href="#download" 
            className="group relative w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-[var(--radius-box)] font-semibold text-lg overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/25 hover:-translate-y-0.5"
          >
            <span className="relative z-10 flex w-full items-center justify-center gap-2">
              <Download className="w-5 h-5" />
              Install Extension
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-primary-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </a>
          
          <a 
            href="#demo" 
            className="w-full sm:w-auto px-8 py-4 glass rounded-[var(--radius-box)] font-semibold text-lg hover:bg-base-content/10 transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Eye className="w-5 h-5" />
            See in Action
          </a>
        </div>

        {/* Floating UI mockup */}
        <div className="relative max-w-4xl mx-auto">
          <div className="glass rounded-[var(--radius-box)] p-2 glow-effect animate-float-slow">
            <div className="bg-base-100/80 rounded-[var(--radius-box)] p-6 md:p-8">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-3 h-3 rounded-full bg-error/80"></div>
                <div className="w-3 h-3 rounded-full bg-warning/80"></div>
                <div className="w-3 h-3 rounded-full bg-success/80"></div>
                <div className="flex-1 text-center">
                  <div className="inline-block glass rounded-[var(--radius-box)] px-4 py-1 text-xs text-base-content/65">ImgVault Gallery</div>
                </div>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {mockGalleryImages.map((imageUrl, i) => (
                  <div 
                    key={i} 
                    className="aspect-square rounded-[var(--radius-box)] bg-gradient-to-br from-primary-500/20 to-primary-700/20 border border-base-content/10 hover:border-primary-500/30 transition-all duration-300 hover:scale-105 cursor-pointer group"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <img
                      src={imageUrl}
                      alt={`Sample gallery image ${i + 1}`}
                      className="w-full h-full object-cover rounded-[var(--radius-box)]"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FeaturesSection() {
  const features = [
    {
      icon: Zap,
      title: 'Perceptual Hashing',
      description: 'Advanced duplicate detection using perceptual hashing algorithms. Never save the same image twice.',
      color: 'from-yellow-500/20 to-orange-500/20',
      iconColor: 'text-warning'
    },
    {
      icon: Cloud,
      title: 'Dual Cloud Upload',
      description: 'Automatically upload to both Pixvid and ImgBB for redundancy and easy sharing.',
      color: 'from-blue-500/20 to-cyan-500/20',
      iconColor: 'text-info'
    },
    {
      icon: Search,
      title: 'Smart Gallery',
      description: 'Beautiful gallery with instant search, tags, and descriptions for perfect organization.',
      color: 'from-purple-500/20 to-pink-500/20',
      iconColor: 'text-purple-400'
    },
    {
      icon: Shield,
      title: 'Context Preservation',
      description: 'Captures full page metadata, URL, and context with every saved image.',
      color: 'from-green-500/20 to-emerald-500/20',
      iconColor: 'text-success'
    },
    {
      icon: Cpu,
      title: 'React + Vite Powered',
      description: 'Built with modern tech stack for lightning-fast performance and smooth UI.',
      color: 'from-red-500/20 to-rose-500/20',
      iconColor: 'text-error'
    },
    {
      icon: Lock,
      title: 'Privacy First',
      description: 'Your data stays with you. Firebase-powered with full control over your images.',
      color: 'from-indigo-500/20 to-violet-500/20',
      iconColor: 'text-indigo-400'
    }
  ]

  return (
    <section id="features" className="py-20 md:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2 mb-6">
            <Layers className="w-4 h-4 text-primary-400" />
            <span className="text-sm text-base-content/80">Powerful Features</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Built for <span className="gradient-text">Power Users</span>
          </h2>
          <p className="text-lg text-base-content/65 max-w-2xl mx-auto">
            Everything you need to capture, organize, and manage images like a pro.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <div 
              key={i}
              className="group glass rounded-[var(--radius-box)] p-6 sm:p-8 hover-lift gradient-border"
            >
              <div className={`w-14 h-14 rounded-[var(--radius-box)] bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6`}>
                <feature.icon className={`w-7 h-7 ${feature.iconColor}`} />
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-base-content/65 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DemoSection() {
  const [activeTab, setActiveTab] = useState(0)
  
  const tabs = [
    {
      title: 'Right-Click Save',
      description: 'Simply right-click any image on the web and save it instantly with full context.',
      icon: Image
    },
    {
      title: 'Gallery View',
      description: 'Browse all your saved images in a beautiful, searchable gallery interface.',
      icon: Layers
    },
    {
      title: 'Smart Tags',
      description: 'Add tags and descriptions to organize your images perfectly.',
      icon: Tag
    }
  ]

  return (
    <section id="demo" className="py-20 md:py-32 relative">
      <div className="hidden md:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/10 rounded-full blur-[150px]"></div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2 mb-6">
            <Eye className="w-4 h-4 text-primary-400" />
            <span className="text-sm text-base-content/80">See It In Action</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Simple Yet <span className="gradient-text">Powerful</span>
          </h2>
          <p className="text-lg text-base-content/65 max-w-2xl mx-auto">
            Three ways to manage your images effortlessly.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-4">
            {tabs.map((tab, i) => (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`text-left p-6 rounded-[var(--radius-box)] transition-all duration-300 ${
                  activeTab === i 
                    ? 'glass border border-primary-500/30 shadow-lg shadow-primary-500/10' 
                    : 'hover:bg-base-content/5'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-[var(--radius-box)] flex items-center justify-center shrink-0 ${
                    activeTab === i 
                      ? 'bg-primary-500/20 text-primary-400' 
                      : 'bg-base-200 text-base-content/55'
                  }`}>
                    <tab.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">{tab.title}</h3>
                    <p className={`text-sm ${activeTab === i ? 'text-base-content/75' : 'text-base-content/55'}`}>
                      {tab.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="glass rounded-[var(--radius-box)] p-2 glow-effect">
            <div className="bg-base-100/80 rounded-[var(--radius-box)] p-6 aspect-video flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-[var(--radius-box)] bg-gradient-to-br from-primary-500/30 to-primary-700/30 flex items-center justify-center mb-4 animate-pulse-slow">
                  {(() => {
                    const Icon = tabs[activeTab].icon
                    return <Icon className="w-10 h-10 text-primary-400" />
                  })()}
                </div>
                <p className="text-base-content/65 text-sm">{tabs[activeTab].title}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DownloadSection() {
  const [latestRelease, setLatestRelease] = useState(null)
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [assetError, setAssetError] = useState('')

  const userSteps = [
    'Download the latest release below',
    'Open Chrome and go to chrome://extensions/',
    'Enable Developer mode',
    'Extract the ZIP and load the unpacked folder'
  ]

  useEffect(() => {
    let isActive = true

    const loadLatestAssets = async () => {
      try {
        setLoadingAssets(true)
        setAssetError('')

        const response = await fetch('/api/releases/latest-assets', {
          cache: 'no-store',
        })

        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load latest release assets')
        }

        if (isActive) {
          setLatestRelease(payload)
        }
      } catch (error) {
        if (isActive) {
          setAssetError(error?.message || 'Failed to load latest release assets')
          setLatestRelease(null)
        }
      } finally {
        if (isActive) {
          setLoadingAssets(false)
        }
      }
    }

    loadLatestAssets()

    return () => {
      isActive = false
    }
  }, [])

  const isReady = Boolean(
    latestRelease?.assets?.zip &&
    latestRelease?.assets?.crx &&
    latestRelease?.assets?.nativeHost
  )

  return (
    <section id="download" className="py-20 md:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="glass rounded-[var(--radius-box)] sm:rounded-[var(--radius-box)] p-5 sm:p-8 md:p-16 gradient-border relative overflow-hidden">
          <div className="hidden sm:block absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-[100px]"></div>
          <div className="hidden sm:block absolute bottom-0 left-0 w-80 h-80 bg-primary-600/10 rounded-full blur-[80px]"></div>
          
          <div className="relative z-10">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2 mb-6">
                <Download className="w-4 h-4 text-primary-400" />
                <span className="text-sm text-base-content/80">Install ImgVault</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 break-words">
                Ready to <span className="gradient-text">Start Saving</span>?
              </h2>
              <p className="text-base sm:text-lg text-base-content/65 mb-8 leading-relaxed">
                Use the release files if you just want to install it. Build from source only if you are developing ImgVault.
              </p>
            </div>

            <div className="mb-6 text-sm text-base-content/70">
                {loadingAssets ? 'Loading latest release assets...' : (latestRelease?.releaseTag ? `Latest release: ${latestRelease.releaseTag}` : 'Latest release ready')}
            </div>

            {assetError && (
              <div className="mb-6 rounded-[var(--radius-box)] border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                {assetError}
              </div>
            )}

            <div className="grid xl:grid-cols-[1.45fr_0.95fr] gap-6 xl:gap-8 items-start">
              <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/85 p-6 sm:p-8 shadow-sm">
                <div className="mb-6 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">For Users</p>
                    <p className="text-sm text-base-content/60">Fastest way to get started</p>
                  </div>
                  <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    Recommended
                  </div>
                </div>

                <div className="flex flex-col gap-4 mb-8">
                  {userSteps.map((step, i) => (
                    <div key={i} className="flex items-start gap-4 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-primary">{i + 1}</span>
                      </div>
                      <p className="text-base-content/75 break-words">{step}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-4 mb-4">
                  <a 
                    href={latestRelease?.releaseUrl || 'https://github.com/FahadBinHussain/imgvault/releases/latest'} 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group w-full sm:w-auto px-6 sm:px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-[var(--radius-box)] font-semibold text-center transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/25 hover:-translate-y-0.5 flex items-center justify-center gap-2"
                  >
                    <Github className="w-5 h-5" />
                    View Latest Release
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </a>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <a
                    href={isReady ? latestRelease.assets.zip : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!isReady}
                    className={`w-full px-4 py-4 rounded-[var(--radius-box)] font-semibold text-center transition-all duration-300 flex items-center justify-center gap-2 border border-base-content/15 bg-base-100 ${isReady ? 'hover:bg-base-content/5' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                  >
                    <Download className="w-4 h-4" />
                    Extension ZIP
                  </a>

                  <a
                    href={isReady ? latestRelease.assets.crx : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!isReady}
                    className={`w-full px-4 py-4 rounded-[var(--radius-box)] font-semibold text-center transition-all duration-300 flex items-center justify-center gap-2 border border-base-content/15 bg-base-100 ${isReady ? 'hover:bg-base-content/5' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                  >
                    <Download className="w-4 h-4" />
                    Extension CRX
                  </a>

                  <a
                    href={isReady ? latestRelease.assets.nativeHost : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!isReady}
                    className={`w-full px-4 py-4 rounded-[var(--radius-box)] font-semibold text-center transition-all duration-300 flex items-center justify-center gap-2 border border-base-content/15 bg-base-100 ${isReady ? 'hover:bg-base-content/5' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                  >
                    <Download className="w-4 h-4" />
                    Native Host EXE
                  </a>
                </div>
              </div>

              <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100/70 p-6 sm:p-7 min-w-0 overflow-hidden">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">For Developers</p>
                    <p className="text-sm text-base-content/60">Build from source</p>
                  </div>
                  <a
                    href="https://github.com/FahadBinHussain/imgvault"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Repository
                  </a>
                </div>

                <pre className="text-xs sm:text-sm text-base-content/75 font-mono overflow-x-auto max-w-full rounded-[var(--radius-box)] bg-base-200/60 p-4">
                  <code>{`git clone https://github.com/FahadBinHussain/imgvault.git
cd imgvault/nextgen-extension
pnpm install
pnpm build`}</code>
                </pre>

                <p className="mt-4 text-sm text-base-content/60">
                  After build, load the generated `dist` folder in Chrome.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="py-12 border-t border-base-content/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" className="w-8 h-8" />
            <span className="font-semibold">ImgVault</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-base-content/55">
            <a href="https://github.com/FahadBinHussain/ImgVault" target="_blank" rel="noopener noreferrer" className="hover:text-base-content transition-colors">GitHub</a>
            <a href="#features" className="hover:text-base-content transition-colors">Features</a>
            <a href="#download" className="hover:text-base-content transition-colors">Download</a>
          </div>

          <p className="text-sm text-base-content/45">
            Built with <span className="text-error">♥</span> by ImgVault Team
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <AppNavbar mode="landing" />
      <HeroSection />
      <FeaturesSection />
      <DemoSection />
      <DownloadSection />
      <Footer />
    </main>
  )
}

