'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'

const STORAGE_KEY = 'imgvault-theme'

const THEMES = [
	'light',
	'dark',
	'cupcake',
	'bumblebee',
	'emerald',
	'corporate',
	'synthwave',
	'retro',
	'cyberpunk',
	'valentine',
	'halloween',
	'garden',
	'forest',
	'aqua',
	'lofi',
	'pastel',
	'fantasy',
	'wireframe',
	'black',
	'luxury',
	'dracula',
	'cmyk',
	'autumn',
	'business',
	'acid',
	'lemonade',
	'night',
	'coffee',
	'winter',
	'dim',
	'nord',
	'sunset',
	'caramellatte',
	'abyss',
	'silk',
]

function formatThemeName(themeName) {
	return themeName
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase())
}

function getSystemTheme() {
	if (typeof window === 'undefined') return 'dark'
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function ThemeSwitcher({ className = '' }) {
	const rootRef = useRef(null)
	const [open, setOpen] = useState(false)
	const [theme, setTheme] = useState('dark')

	const applyTheme = (nextTheme, { persist = true } = {}) => {
		if (!nextTheme) return

		document.documentElement.setAttribute('data-theme', nextTheme)
		if (persist) {
			localStorage.setItem(STORAGE_KEY, nextTheme)
		}
		setTheme(nextTheme)
		setOpen(false)
	}

	useEffect(() => {
		const savedTheme = localStorage.getItem(STORAGE_KEY)
		const currentTheme =
			savedTheme ||
			document.documentElement.getAttribute('data-theme') ||
			getSystemTheme()

		applyTheme(currentTheme, { persist: Boolean(savedTheme) })
	}, [])

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

		const handleSystemThemeChange = () => {
			if (localStorage.getItem(STORAGE_KEY)) {
				return
			}

			applyTheme(mediaQuery.matches ? 'dark' : 'light', { persist: false })
		}

		mediaQuery.addEventListener('change', handleSystemThemeChange)

		return () => {
			mediaQuery.removeEventListener('change', handleSystemThemeChange)
		}
	}, [])

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

	return (
		<div ref={rootRef} className={`relative ${className}`}>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-dark-300 hover:text-white hover:bg-white/5 transition-colors"
				aria-haspopup="menu"
				aria-expanded={open}
				title="Theme settings"
			>
				<Palette className="w-4 h-4" />
			</button>

			{open && (
				<div
					className="fixed left-2 right-2 top-14 rounded-xl border border-white/20 bg-base-100 shadow-2xl p-2 z-[9999] overflow-hidden sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-56 sm:max-w-none"
					style={{
						backgroundColor: 'var(--color-base-100)',
						opacity: 1,
					}}
				>
					<div className="px-2 py-2 mb-1 border-b border-white/10">
						<p className="text-xs text-dark-400">Current theme</p>
						<p className="text-sm font-medium">{formatThemeName(theme)}</p>
					</div>

					<div className="max-h-64 overflow-y-auto pr-1 space-y-0.5">
						{THEMES.map((themeName) => {
							const isActive = themeName === theme
							return (
								<button
									key={themeName}
									type="button"
									onClick={() => applyTheme(themeName)}
									className={`w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
										isActive
											? 'bg-primary-500/20 text-primary-300'
											: 'text-dark-300 hover:text-white hover:bg-white/5'
									}`}
								>
									<span>{formatThemeName(themeName)}</span>
									{isActive && <Check className="w-4 h-4" />}
								</button>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}
