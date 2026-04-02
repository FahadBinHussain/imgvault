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
            className="group relative w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl font-semibold text-lg overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/25 hover:-translate-y-0.5"
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
            className="w-full sm:w-auto px-8 py-4 glass rounded-2xl font-semibold text-lg hover:bg-base-content/10 transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Eye className="w-5 h-5" />
            See in Action
          </a>
        </div>

        {/* Floating UI mockup */}
        <div className="relative max-w-4xl mx-auto">
          <div className="glass rounded-3xl p-2 glow-effect animate-float-slow">
            <div className="bg-base-100/80 rounded-2xl p-6 md:p-8">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-3 h-3 rounded-full bg-error/80"></div>
                <div className="w-3 h-3 rounded-full bg-warning/80"></div>
                <div className="w-3 h-3 rounded-full bg-success/80"></div>
                <div className="flex-1 text-center">
                  <div className="inline-block glass rounded-lg px-4 py-1 text-xs text-base-content/65">ImgVault Gallery</div>
                </div>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {mockGalleryImages.map((imageUrl, i) => (
                  <div 
                    key={i} 
                    className="aspect-square rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 border border-base-content/10 hover:border-primary-500/30 transition-all duration-300 hover:scale-105 cursor-pointer group"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <img
                      src={imageUrl}
                      alt={`Sample gallery image ${i + 1}`}
                      className="w-full h-full object-cover rounded-xl"
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
              className="group glass rounded-2xl p-6 sm:p-8 hover-lift gradient-border"
            >
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6`}>
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
                className={`text-left p-6 rounded-2xl transition-all duration-300 ${
                  activeTab === i 
                    ? 'glass border border-primary-500/30 shadow-lg shadow-primary-500/10' 
                    : 'hover:bg-base-content/5'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
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

          <div className="glass rounded-3xl p-2 glow-effect">
            <div className="bg-base-100/80 rounded-2xl p-6 aspect-video flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary-500/30 to-primary-700/30 flex items-center justify-center mb-4 animate-pulse-slow">
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
  const steps = [
    'Download or clone the repository',
    'Open Chrome and go to chrome://extensions/',
    'Enable Developer mode',
    'Click "Load unpacked" and select the dist folder'
  ]

  return (
    <section id="download" className="py-20 md:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="glass rounded-2xl sm:rounded-3xl p-5 sm:p-8 md:p-16 gradient-border relative overflow-hidden">
          <div className="hidden sm:block absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-[100px]"></div>
          <div className="hidden sm:block absolute bottom-0 left-0 w-80 h-80 bg-primary-600/10 rounded-full blur-[80px]"></div>
          
          <div className="relative z-10 grid lg:grid-cols-2 gap-8 sm:gap-12 items-center">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2 mb-6">
                <Download className="w-4 h-4 text-primary-400" />
                <span className="text-sm text-base-content/80">Get Started</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 break-words">
                Ready to <span className="gradient-text">Transform</span> Your Workflow?
              </h2>
              <p className="text-base sm:text-lg text-base-content/65 mb-8 leading-relaxed">
                Install ImgVault Next-Gen in seconds and start saving images like a pro.
              </p>

              <div className="flex flex-col gap-4 mb-8">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-4 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-primary-400">{i + 1}</span>
                    </div>
                    <p className="text-base-content/75 break-words">{step}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <a 
                  href="https://github.com/FahadBinHussain/ImgVault" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group w-full sm:w-auto px-6 sm:px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl font-semibold text-center transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/25 hover:-translate-y-0.5 flex items-center justify-center gap-2"
                >
                  <Github className="w-5 h-5" />
                  View on GitHub
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </a>
                <a 
                  href="https://github.com/FahadBinHussain/ImgVault/archive/refs/heads/main.zip"
                  className="w-full sm:w-auto px-6 sm:px-8 py-4 glass rounded-2xl font-semibold text-center hover:bg-base-content/10 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download ZIP
                </a>
              </div>
            </div>

            <div className="glass rounded-2xl p-4 sm:p-6 bg-base-200/70 min-w-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-error/80"></div>
                <div className="w-3 h-3 rounded-full bg-warning/80"></div>
                <div className="w-3 h-3 rounded-full bg-success/80"></div>
              </div>
              <pre className="text-xs sm:text-sm text-base-content/75 font-mono overflow-x-auto max-w-full">
                <code>{`# Clone the repository
git clone https://github.com/FahadBinHussain/ImgVault.git

# Navigate to extension
cd nextgen-extension

# Install dependencies
pnpm install

# Build for production
pnpm build

# Load dist/ folder in Chrome`}</code>
              </pre>
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
            <span className="font-semibold">ImgVault Next-Gen</span>
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
