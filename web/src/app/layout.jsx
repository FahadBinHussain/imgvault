import './globals.css'
import Providers from './providers'
import Script from 'next/script'

export const metadata = {
  title: 'ImgVault',
  description: 'Next-generation Chrome extension for saving images with context preservation and advanced duplicate detection. Modern, fast, and beautiful.',
  keywords: 'chrome extension, image saver, image vault, duplicate detection, pixvid, imgbb',
  authors: [{ name: 'ImgVault Team' }],
  icons: {
    icon: '/api/brand/icon?size=48&v=3',
    shortcut: '/api/brand/icon?size=16&v=3',
    apple: '/api/brand/icon?size=128&v=3',
  },
  openGraph: {
    title: 'ImgVault',
    description: 'Save images with context and advanced duplicate detection',
    type: 'website',
    images: ['/api/brand/icon?size=128&v=3'],
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="imgvault-theme-init" strategy="beforeInteractive">
          {`(() => {
  try {
    const savedTheme = localStorage.getItem('imgvault-theme');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', savedTheme || systemTheme);
  } catch (_) {}
})();`}
        </Script>
      </head>
      <body className="min-h-screen theme-surface antialiased" suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
