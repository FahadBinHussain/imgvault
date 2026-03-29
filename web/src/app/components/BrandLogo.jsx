export default function BrandLogo({ size = 40, className = '', href = '/' }) {
  const logo = (
    <div
      className={`rounded-xl bg-contain bg-center bg-no-repeat shadow-lg shadow-primary-500/25 ${className}`.trim()}
      style={{ width: size, height: size, backgroundImage: "url('/api/brand/icon?size=48')" }}
      aria-hidden="true"
    />
  )

  if (!href) {
    return logo
  }

  return (
    <a href={href} aria-label="ImgVault Home">
      {logo}
    </a>
  )
}
