const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias['@shared'] = path.resolve(__dirname, 'src/shared')
    return config
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
