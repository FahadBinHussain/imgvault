'use client'

import { useEffect, useMemo, useState } from 'react'

function getInitials(nameOrEmail) {
  if (!nameOrEmail || typeof nameOrEmail !== 'string') {
    return 'U'
  }

  const cleaned = nameOrEmail.trim()
  if (!cleaned) {
    return 'U'
  }

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return cleaned.slice(0, 2).toUpperCase()
}

export default function UserAvatar({
  user,
  className = 'w-8 h-8 rounded-full',
  alt = 'Profile image',
  title,
}) {
  const [imageFailed, setImageFailed] = useState(false)

  const imageSrc = useMemo(() => {
    const candidate = user?.image || user?.picture || user?.avatar_url

    if (typeof candidate !== 'string') {
      return ''
    }

    return candidate.trim()
  }, [user?.image, user?.picture, user?.avatar_url])

  useEffect(() => {
    setImageFailed(false)
  }, [imageSrc])

  const initials = useMemo(() => {
    return getInitials(user?.name || user?.email)
  }, [user?.name, user?.email])

  if (imageSrc && !imageFailed) {
    return (
      <img
        src={imageSrc}
        alt={alt}
        title={title}
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={alt}
      title={title}
      className={`${className} inline-flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-500 text-base-content text-xs font-semibold select-none`}
    >
      {initials}
    </div>
  )
}
