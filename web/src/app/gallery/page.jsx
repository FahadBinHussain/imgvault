'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { 
  Image, 
  Search, 
  Grid, 
  List, 
  ExternalLink,
  Calendar,
  Tag,
  Loader2,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react'

// Skeleton Loader Component with Shimmer
function SkeletonCard({ viewMode }) {
  return (
    <div className={`glass rounded-2xl overflow-hidden ${viewMode === 'list' ? 'flex' : ''}`} style={{ minHeight: viewMode === 'list' ? 'auto' : '200px' }}>
      <div className={`${viewMode === 'list' ? 'w-32 h-28' : 'h-full min-h-[200px]'} relative overflow-hidden bg-dark-800/50`}>
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
      </div>
      {viewMode === 'list' && (
        <div className="p-4 space-y-3 flex-1">
          <div className="relative overflow-hidden rounded h-4 bg-dark-700/50">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
          </div>
          <div className="relative overflow-hidden rounded h-3 bg-dark-700/50 w-1/2">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ backgroundSize: '200% 100%' }} />
          </div>
        </div>
      )}
    </div>
  )
}

// Navbar Component
function Navbar() {
  const { data: session } = useSession()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/25 animate-glow">
            <Image className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold">
            Img<span className="gradient-text">Vault</span>
          </span>
        </a>
        
        <div className="flex items-center gap-6">
          <a href="/" className="text-dark-300 hover:text-white transition-all duration-300 text-sm font-medium relative group">
            Home
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary-500 transition-all duration-300 group-hover:w-full" />
          </a>
          <a href="/gallery" className="text-white text-sm font-medium relative group">
            Gallery
            <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-primary-500" />
          </a>
          <a href="/settings" className="text-dark-300 hover:text-white transition-all duration-300 p-2 rounded-lg hover:bg-white/5">
            <Settings className="w-5 h-5" />
          </a>
          {session?.user?.image && (
            <img 
              src={session.user.image} 
              alt="Profile" 
              className="w-8 h-8 rounded-full ring-2 ring-primary-500/50 ring-offset-2 ring-offset-dark-950"
            />
          )}
        </div>
      </div>
    </nav>
  )
}

// Empty State Component
function EmptyState({ hasConfig }) {
  if (!hasConfig) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mb-8 animate-float">
          <Settings className="w-12 h-12 text-primary-400" />
        </div>
        <h3 className="text-2xl font-bold mb-3 gradient-text">Configure Firebase First</h3>
        <p className="text-dark-400 mb-8 max-w-md mx-auto">Set up your Firebase config to start viewing your images</p>
        <a 
          href="/settings" 
          className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all duration-300 hover:-translate-y-1"
        >
          <Settings className="w-5 h-5" />
          Go to Settings
        </a>
      </div>
    )
  }

  return (
    <div className="text-center py-20 animate-fade-in">
      <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mb-8 animate-float">
        <Sparkles className="w-12 h-12 text-primary-400" />
      </div>
      <h3 className="text-2xl font-bold mb-3">No Images Yet</h3>
      <p className="text-dark-400 mb-8 max-w-md mx-auto">Start saving images from the Chrome extension to see them here</p>
      <a 
        href="https://github.com/FahadBinHussain/ImgVault" 
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-8 py-4 glass rounded-2xl font-semibold hover:bg-white/10 transition-all duration-300 hover:-translate-y-1 gradient-border"
      >
        <ExternalLink className="w-5 h-5" />
        Get the Extension
      </a>
    </div>
  )
}

// Lightbox Modal Component
function Lightbox({ image, images, currentIndex, onClose, onNavigate }) {
  const [isLoading, setIsLoading] = useState(true)
  const [direction, setDirection] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex])

  const handlePrev = () => {
    if (currentIndex > 0) {
      setDirection(-1)
      onNavigate(currentIndex - 1)
      setIsLoading(true)
    }
  }

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      setDirection(1)
      onNavigate(currentIndex + 1)
      setIsLoading(true)
    }
  }

  const imageUrl = image.imgbbUrl || image.imgbbThumbUrl || image.pixvidUrl || image.sourceImageUrl

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-fade-in"
      onClick={onClose}
    >
      {/* Close button */}
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-3 glass rounded-full hover:bg-white/20 transition-all duration-300 z-10"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Navigation buttons */}
      {currentIndex > 0 && (
        <button 
          onClick={(e) => { e.stopPropagation(); handlePrev() }}
          className="absolute left-6 p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:-translate-x-1"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      
      {currentIndex < images.length - 1 && (
        <button 
          onClick={(e) => { e.stopPropagation(); handleNext() }}
          className="absolute right-6 p-4 glass rounded-full hover:bg-white/20 transition-all duration-300 hover:translate-x-1"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Image container */}
      <div 
        className="relative max-w-5xl max-h-[85vh] mx-20 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
          </div>
        )}
        <img
          src={imageUrl}
          alt={image.pageTitle || 'Image'}
          className={`max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setIsLoading(false)}
        />
        
        {/* Image info */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent rounded-b-2xl">
          <h3 className="text-lg font-semibold mb-2">{image.pageTitle || 'Untitled'}</h3>
          <div className="flex items-center gap-4 text-sm text-dark-300">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>
                {image.internalAddedTimestamp
                  ? new Date(image.internalAddedTimestamp).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : 'Unknown date'}
              </span>
            </div>
            {image.sourcePageUrl && (
              <a 
                href={image.sourcePageUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 hover:text-primary-400 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Source
              </a>
            )}
          </div>
          {image.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {image.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 rounded-full bg-white/10 text-xs font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Counter */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 glass rounded-full text-sm">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  )
}

// Image Card Component
function ImageCard({ image, index, viewMode, onClick, className = '' }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  
  const imageUrl = image.imgbbUrl || image.pixvidUrl || image.sourceImageUrl || image.imgbbThumbUrl

  return (
    <div 
      className={`group relative glass rounded-2xl overflow-hidden cursor-pointer transition-all duration-500 hover:-translate-y-2 hover:shadow-xl hover:shadow-primary-500/10 ${viewMode === 'list' ? 'flex' : ''} ${className}`}
      style={{ 
        animationDelay: `${index * 50}ms`,
        animation: 'fadeInUp 0.6s ease-out forwards',
        opacity: 0
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {/* Image Container */}
      <div
        className={`${viewMode === 'list' ? 'w-40 h-28 flex-shrink-0' : 'h-auto'} bg-dark-900 relative overflow-hidden`}
        style={viewMode !== 'list' && !isLoaded ? { minHeight: '220px' } : undefined}
      >
        {imageUrl ? (
          <>
            {!isLoaded && (
              <div className="absolute inset-0 bg-dark-800/70">
                <div
                  className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  style={{ backgroundSize: '200% 100%' }}
                />
              </div>
            )}
            <img
              src={imageUrl}
              alt={image.pageTitle || 'Saved image'}
              className={`block w-full ${viewMode === 'list' ? 'h-full object-contain' : 'h-auto object-contain'} transition-all duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center">
            <Image className="w-12 h-12 text-dark-500" />
          </div>
        )}
        
        {/* Hover overlay */}
        <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
        </div>

        {/* Gradient border effect */}
        <div className={`absolute inset-0 rounded-2xl transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
          style={{
            background: 'linear-gradient(135deg, rgba(92, 124, 250, 0.3), transparent, rgba(92, 124, 250, 0.1))',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Content - Only show in list mode */}
      {viewMode === 'list' && (
        <div className="p-4 space-y-3 flex-1 flex flex-col justify-center">
          <h3 className="text-sm font-semibold truncate transition-colors duration-300 group-hover:text-primary-400" title={image.pageTitle || 'Untitled'}>
            {image.pageTitle || 'Untitled'}
          </h3>
          <div className="flex items-center gap-2 text-xs text-dark-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {image.internalAddedTimestamp
                ? new Date(image.internalAddedTimestamp).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })
                : 'Unknown date'}
            </span>
          </div>
          {image.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {image.tags.slice(0, 3).map((tag) => (
                <span
                  key={`${image.id}-${tag}`}
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

// Group images by date helper
function groupImagesByDate(images) {
  const groups = {}
  
  images.forEach((img) => {
    const date = img.internalAddedTimestamp 
      ? new Date(img.internalAddedTimestamp).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      : 'Unknown Date'
    
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(img)
  })
  
  return Object.entries(groups).map(([date, imgs]) => ({
    date,
    images: imgs
  }))
}

// Date Header Component
function DateHeader({ date }) {
  return (
    <div className="col-span-full py-4 flex items-center gap-4">
      <div className="flex-shrink-0 w-16 text-right">
        <span className="text-sm font-semibold text-primary-400">
          {date.split(' ')[1]?.replace(',', '') || ''}
        </span>
        <div className="text-xs text-dark-400">
          {date.split(' ')[0]}
        </div>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
    </div>
  )
}

// Main Gallery Component
export default function GalleryPage() {
  const { data: session, status } = useSession()
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasConfig, setHasConfig] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/')
    }
    
    if (status === 'authenticated') {
      checkConfig()
    }
  }, [status])

  const checkConfig = async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      const configured = !!data.config
      setHasConfig(configured)

      if (!configured) {
        setImages([])
        return
      }

      const imagesRes = await fetch('/api/images', { cache: 'no-store' })
      const imagesData = await imagesRes.json()

      if (!imagesRes.ok) {
        throw new Error(imagesData.error || 'Failed to load images')
      }

      setImages(Array.isArray(imagesData.images) ? imagesData.images : [])
    } catch (error) {
      console.error('Failed to check config:', error)
      setLoadError(error.message || 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }

  const filteredImages = images.filter((img) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true

    const haystack = [
      img.pageTitle,
      img.description,
      img.sourcePageUrl,
      ...(img.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(q)
  })

  const handleImageClick = useCallback((image, index) => {
    setSelectedImage(image)
    setSelectedIndex(index)
  }, [])

  const handleCloseLightbox = useCallback(() => {
    setSelectedImage(null)
    setSelectedIndex(-1)
  }, [])

  const handleNavigate = useCallback((index) => {
    setSelectedImage(filteredImages[index])
    setSelectedIndex(index)
  }, [filteredImages])

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen bg-dark-950">
        <Navbar />
        <section className="pt-28 pb-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <div className="h-10 bg-dark-800/50 rounded-xl w-48 mb-3 animate-pulse" />
              <div className="h-5 bg-dark-800/50 rounded w-64 animate-pulse" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <SkeletonCard key={i} viewMode="grid" />
              ))}
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <>
      <main className="min-h-screen bg-dark-950">
        <Navbar />
        
        <section className="pt-28 pb-12 px-6">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
              <div className="animate-fade-in">
                <h1 className="text-4xl font-bold mb-2">
                  <span className="gradient-text">Gallery</span>
                </h1>
                <p className="text-dark-400">
                  {images.length > 0 
                    ? `${images.length} image${images.length > 1 ? 's' : ''} saved`
                    : 'Your saved images from across the web'}
                </p>
              </div>
            
              {images.length > 0 && (
                <div className="flex items-center gap-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
                  {/* Search */}
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 transition-colors group-focus-within:text-primary-400" />
                    <input
                      type="text"
                      placeholder="Search images..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 pr-4 py-3 bg-dark-800/50 border border-white/5 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 focus:bg-dark-800 w-64 transition-all duration-300 focus:w-80 focus:shadow-lg focus:shadow-primary-500/10"
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-dark-400" />
                      </button>
                    )}
                  </div>
                  
                  {/* View toggle */}
                  <div className="flex items-center gap-1 glass rounded-xl p-1.5">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2.5 rounded-lg transition-all duration-300 ${viewMode === 'grid' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white hover:bg-white/5'}`}
                    >
                      <Grid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2.5 rounded-lg transition-all duration-300 ${viewMode === 'list' ? 'bg-primary-500/20 text-primary-400 shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white hover:bg-white/5'}`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Content */}
            {loadError ? (
              <div className="glass rounded-2xl p-8 text-red-400 text-center animate-fade-in">
                <p className="font-medium">{loadError}</p>
              </div>
            ) : filteredImages.length === 0 ? (
              <EmptyState hasConfig={hasConfig} />
            ) : viewMode === 'grid' ? (
              /* Google Photos style with date headers */
              <div className="space-y-8">
                {groupImagesByDate(filteredImages).map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                      {group.images.map((img) => {
                        const globalIndex = filteredImages.findIndex(i => i.id === img.id)
                        return (
                          <ImageCard 
                            key={img.id}
                            image={img}
                            index={globalIndex}
                            viewMode={viewMode}
                            onClick={() => handleImageClick(img, globalIndex)}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* List Layout */
              <div className="space-y-8">
                {groupImagesByDate(filteredImages).map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="text-lg font-semibold text-primary-400">{group.date}</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-primary-500/30 to-transparent" />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {group.images.map((img) => {
                        const globalIndex = filteredImages.findIndex(i => i.id === img.id)
                        return (
                          <ImageCard 
                            key={img.id}
                            image={img}
                            index={globalIndex}
                            viewMode={viewMode}
                            onClick={() => handleImageClick(img, globalIndex)}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Lightbox */}
      {selectedImage && (
        <Lightbox
          image={selectedImage}
          images={filteredImages}
          currentIndex={selectedIndex}
          onClose={handleCloseLightbox}
          onNavigate={handleNavigate}
        />
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