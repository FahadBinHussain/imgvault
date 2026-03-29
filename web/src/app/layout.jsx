import './globals.css'
import Providers from './providers'
import Script from 'next/script'

export const metadata = {
  title: 'ImgVault Next-Gen | Save Images with Context',
  description: 'Next-generation Chrome extension for saving images with context preservation and advanced duplicate detection. Modern, fast, and beautiful.',
  keywords: 'chrome extension, image saver, image vault, duplicate detection, pixvid, imgbb',
  authors: [{ name: 'ImgVault Team' }],
  openGraph: {
    title: 'ImgVault Next-Gen',
    description: 'Save images with context and advanced duplicate detection',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <Script id="imgvault-theme-init" strategy="beforeInteractive">
          {`(() => {
  try {
    const savedTheme = localStorage.getItem('imgvault-theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
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
