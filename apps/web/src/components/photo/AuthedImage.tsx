import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Props {
  photoId: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * Fetches the photo bytes through /api/photos/:id/serve with the bearer token
 * (set by axios interceptor), then renders a blob URL. <img> tags can't carry
 * a custom Authorization header, so we hydrate via fetch and pass an object
 * URL instead.
 */
export function AuthedImage({ photoId, alt, className, loading }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setError(false);
      setSrc(null);
      try {
        const res = await api.get(`/photos/${photoId}/serve`, { responseType: 'blob' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-xs text-muted-foreground ${className ?? ''}`}
      >
        ⚠
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse bg-muted ${className ?? ''}`} />;
  }
  return <img src={src} alt={alt} className={className} loading={loading} />;
}
