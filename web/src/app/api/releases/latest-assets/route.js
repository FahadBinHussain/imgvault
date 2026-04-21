const GITHUB_OWNER = 'FahadBinHussain'
const GITHUB_REPO = 'imgvault'

const pickAssetByExtension = (assets, extension) =>
  assets.find(
    (asset) =>
      typeof asset?.name === 'string' &&
      typeof asset?.browser_download_url === 'string' &&
      asset.name.toLowerCase().endsWith(extension)
  )?.browser_download_url || ''

export async function GET() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'imgvault-web',
        },
        cache: 'no-store',
      }
    )

    if (!response.ok) {
      return Response.json(
        { error: `Failed to fetch latest release (${response.status})` },
        { status: response.status }
      )
    }

    const release = await response.json()
    const assets = Array.isArray(release?.assets) ? release.assets : []

    const zip = pickAssetByExtension(assets, '.zip')
    const crx = pickAssetByExtension(assets, '.crx')
    const nativeHost =
      assets.find(
        (asset) =>
          typeof asset?.name === 'string' &&
          typeof asset?.browser_download_url === 'string' &&
          asset.name.toLowerCase().endsWith('.exe') &&
          asset.name.toLowerCase().includes('native')
      )?.browser_download_url || pickAssetByExtension(assets, '.exe')

    if (!zip || !crx || !nativeHost) {
      return Response.json(
        { error: 'Latest release is missing one or more required assets (zip/crx/exe).' },
        { status: 500 }
      )
    }

    return Response.json({
      releaseName: release?.name || release?.tag_name || '',
      releaseTag: release?.tag_name || '',
      releaseUrl: release?.html_url || '',
      assets: {
        zip,
        crx,
        nativeHost,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Unexpected error while loading release assets.' },
      { status: 500 }
    )
  }
}
