'use client'

import { useEffect, useMemo, useState } from 'react'
import { Palette } from 'lucide-react'

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

export default function ThemeSwitcher({ className = '' }) {
	const [theme, setTheme] = useState('dark')

	const selectStyle = useMemo(
		() => ({
			backgroundColor: 'var(--color-base-200)',
			color: 'var(--color-base-content)',
			borderColor: 'color-mix(in oklab, var(--color-base-content) 24%, transparent)',
		}),
		[],
	)

	const optionStyle = useMemo(
		() => ({
			backgroundColor: 'var(--color-base-200)',
			color: 'var(--color-base-content)',
		}),
		[],
	)

	const applyTheme = (nextTheme) => {
		if (!nextTheme) return

		document.documentElement.setAttribute('data-theme', nextTheme)
		localStorage.setItem(STORAGE_KEY, nextTheme)
		setTheme(nextTheme)
	}

	useEffect(() => {
		const currentTheme =
			localStorage.getItem(STORAGE_KEY) ||
			document.documentElement.getAttribute('data-theme') ||
			'dark'

		applyTheme(currentTheme)
	}, [])

	return (
		<label className={`relative flex items-center ${className}`}>
			<Palette className="pointer-events-none absolute left-2 z-10 w-4 h-4 opacity-70" />
			<select
				value={theme}
				onChange={(event) => applyTheme(event.target.value)}
				className="w-40 pl-8 pr-2 py-1.5 rounded-lg border text-xs"
				style={selectStyle}
				aria-label="Select theme"
				title="Select theme"
			>
				{THEMES.map((themeName) => (
					<option key={themeName} value={themeName} style={optionStyle}>
						{formatThemeName(themeName)}
					</option>
				))}
			</select>
		</label>
	)
}
