import './globals.css'
import Providers from './providers'

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
    <html lang="en" className="dark">
      <body className="bg-dark-950 text-white antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
