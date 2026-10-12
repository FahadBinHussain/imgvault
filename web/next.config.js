const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['imgvault-ui', 'imgvault-scene-viewer'],
  webpack: (config) => {
    config.resolve.alias['@shared'] = path.resolve(__dirname, '../packages/shared')
    return config
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
