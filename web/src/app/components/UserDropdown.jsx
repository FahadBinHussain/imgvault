'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { ChevronDown, Images, Link2, LogOut } from 'lucide-react'
import UserAvatar from './UserAvatar'

export default function UserDropdown({
  user,
  className = '',
  avatarClassName = 'w-8 h-8 rounded-full',
  callbackUrl = '/',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  if (!user) {
    return null
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-[var(--radius-box)] px-1.5 py-1 hover:bg-base-content/5 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.name || user?.email || 'Account menu'}
      >
        <UserAvatar
          user={user}
          className={avatarClassName}
          alt="Profile"
          title={user?.name || user?.email || 'Profile'}
        />
        <ChevronDown className={`w-4 h-4 text-base-content/75 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-52 rounded-[var(--radius-box)] border border-base-content/25 shadow-2xl p-2 z-[9999] overflow-hidden backdrop-blur-none isolate"
          style={{
            backgroundColor: 'var(--color-base-100)',
            opacity: 1,
          }}
        >
          <div className="px-2 py-2 border-b border-base-content/15 mb-1">
            <p className="text-sm font-medium truncate">{user?.name || 'ImgVault User'}</p>
            {user?.email && <p className="text-xs text-base-content/65 truncate">{user.email}</p>}
          </div>

          <a
            href="/gallery"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-[var(--radius-box)] text-sm text-base-content/75 hover:text-base-content hover:bg-base-content/5 transition-colors"
          >
            <Images className="w-4 h-4" />
            Gallery
          </a>

          <a
            href="/links"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-[var(--radius-box)] text-sm text-base-content/75 hover:text-base-content hover:bg-base-content/5 transition-colors"
          >
            <Link2 className="w-4 h-4" />
            Shared Links
          </a>

          <button
            onClick={() => signOut({ callbackUrl })}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-[var(--radius-box)] text-sm text-base-content/75 hover:text-base-content hover:bg-base-content/5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
