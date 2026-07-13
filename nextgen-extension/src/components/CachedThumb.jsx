import { useThumbUrl } from '../hooks/useThumbUrl';

export function CachedImg({ thumbKey, src, alt, className, loading, onLoad, onError }) {
  const cachedSrc = useThumbUrl(thumbKey, src);
  return (
    <img
      src={cachedSrc}
      alt={alt}
      className={className}
      loading={loading}
      onLoad={onLoad}
      onError={onError}
    />
  );
}

export function CachedVideo({ thumbKey, src, poster, className, muted, playsInline, preload, onLoadedMetadata, onCanPlayThrough, onError }) {
  const cachedPoster = useThumbUrl(poster ? thumbKey : null, poster);
  return (
    <video
      src={src}
      poster={cachedPoster || undefined}
      className={className}
      muted={muted}
      playsInline={playsInline}
      preload={preload}
      onLoadedMetadata={onLoadedMetadata}
      onCanPlayThrough={onCanPlayThrough}
      onError={onError}
    />
  );
}
