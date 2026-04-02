'use client'

import { useEffect, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { Github, Images, Link2, LogIn, Menu, Settings, Trash2, X } from 'lucide-react'
import ThemeSwitcher from './ThemeSwitcher'
import UserDropdown from './UserDropdown'
import BrandLogo from './BrandLogo'

export default function AppNavbar({ mode = 'dashboard', activeRoute }) {
  const { data: session } = useSession()
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (mode !== 'landing') {
      return
    }

    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [mode])

  if (mode === 'landing') {
    return (
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'glass py-3' : 'py-6'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" className="w-10 h-10" />
            <span className="text-lg sm:text-xl font-bold">
              Img<span className="gradient-text">Vault</span>
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-4 xl:gap-8">
            <a href="#features" className="text-base-content/75 hover:text-base-content transition-colors text-sm font-medium">Features</a>
            <a href="#demo" className="text-base-content/75 hover:text-base-content transition-colors text-sm font-medium">Demo</a>
            <a href="#download" className="text-base-content/75 hover:text-base-content transition-colors text-sm font-medium">Download</a>
            <ThemeSwitcher />
            <a href="https://github.com/FahadBinHussain/ImgVault" target="_blank" rel="noopener noreferrer" className="text-base-content/75 hover:text-base-content transition-colors">
              <Github className="w-5 h-5" />
            </a>
            {session ? (
              <UserDropdown user={session.user} avatarClassName="w-8 h-8 rounded-full" />
            ) : (
              <button
                onClick={() => signIn('google')}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-500 rounded-[var(--radius-box)] font-semibold text-sm hover:shadow-lg hover:shadow-primary-500/25 transition-all"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
            )}
          </div>

          <div className="lg:hidden flex items-center gap-1.5 sm:gap-2">
            <ThemeSwitcher />
            {session ? (
              <UserDropdown user={session.user} avatarClassName="w-8 h-8 rounded-full" />
            ) : (
              <button
                onClick={() => signIn('google')}
                className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-box)] bg-base-content/10 hover:bg-base-content/20 border border-base-content/20 transition-colors"
                title="Sign In"
              >
                <LogIn className="w-4 h-4" />
              </button>
            )}
            <button className="text-base-content p-1" onClick={() => setMobileMenuOpen((open) => !open)}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden glass mt-3 mx-4 sm:mx-6 rounded-[var(--radius-box)] p-4 sm:p-6 flex flex-col gap-4">
            <a href="#features" className="text-base-content/75 hover:text-base-content transition-colors font-medium" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a href="#demo" className="text-base-content/75 hover:text-base-content transition-colors font-medium" onClick={() => setMobileMenuOpen(false)}>Demo</a>
            <a href="#download" className="text-base-content/75 hover:text-base-content transition-colors font-medium" onClick={() => setMobileMenuOpen(false)}>Download</a>
          </div>
        )}
      </nav>
    )
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandLogo href="/" className="w-10 h-10" />
          <span className="text-lg sm:text-xl font-bold hidden sm:inline">
            Img<span className="gradient-text">Vault</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeSwitcher className="shrink-0" />
          <a
            href="/gallery"
            className={`transition-colors p-2 rounded-[var(--radius-box)] ${activeRoute === 'gallery' ? 'text-base-content' : 'text-base-content/75 hover:text-base-content hover:bg-base-content/5'}`}
            title="Gallery"
          >
            <Images className="w-5 h-5" />
          </a>
          <a
            href="/links"
            className={`transition-colors p-2 rounded-[var(--radius-box)] ${activeRoute === 'links' ? 'text-base-content' : 'text-base-content/75 hover:text-base-content hover:bg-base-content/5'}`}
            title="Shared Links"
          >
            <Link2 className="w-5 h-5" />
          </a>
          <a
            href="/settings"
            className={`transition-colors p-2 rounded-[var(--radius-box)] ${activeRoute === 'settings' ? 'text-base-content' : 'text-base-content/75 hover:text-base-content hover:bg-base-content/5'}`}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </a>
          <a
            href="/trash"
            className={`transition-colors p-2 rounded-[var(--radius-box)] ${activeRoute === 'trash' ? 'text-base-content' : 'text-base-content/75 hover:text-base-content hover:bg-base-content/5'}`}
            title="Trash"
          >
            <Trash2 className="w-5 h-5" />
          </a>
          {session?.user ? (
            <UserDropdown
              user={session.user}
              avatarClassName="w-8 h-8 rounded-full ring-2 ring-primary-500/50 ring-offset-2 ring-offset-dark-950"
            />
          ) : (
            <button
              onClick={() => signIn('google')}
              className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-box)] bg-base-content/10 hover:bg-base-content/20 border border-base-content/20 transition-colors"
              title="Sign In"
            >
              <LogIn className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
