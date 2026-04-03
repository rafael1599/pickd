import { useEffect, useMemo, useState } from 'react';
import { FastAverageColor } from 'fast-average-color';

const FALLBACK = 'rgb(200,200,200)';
const R2_ORIGIN = 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev';
const isDev = import.meta.env.DEV;

/**
 * In dev, rewrite R2 URLs to Vite's local proxy to avoid CORS issues
 * (R2's pub-*.r2.dev domain doesn't honor CORS rules).
 * In prod, use the URL as-is with crossOrigin='anonymous'.
 */
function proxyUrl(url: string): string {
  if (isDev && url.startsWith(R2_ORIGIN)) {
    return url.replace(R2_ORIGIN, '/r2-proxy');
  }
  return url;
}

export function useDominantColor(imageUrl: string | null) {
  const [color, setColor] = useState<string>(FALLBACK);
  const resolvedUrl = useMemo(() => imageUrl || null, [imageUrl]);

  useEffect(() => {
    if (!resolvedUrl) return;

    let cancelled = false;
    const fac = new FastAverageColor();
    const fetchUrl = proxyUrl(resolvedUrl);

    fac
      .getColorAsync(fetchUrl, { algorithm: 'dominant', crossOrigin: 'anonymous' })
      .then((result) => { if (!cancelled) setColor(result.rgb); })
      .catch(() => { /* CORS or canvas error — use fallback silently */ });

    return () => {
      cancelled = true;
      fac.destroy();
    };
  }, [resolvedUrl]);

  return resolvedUrl ? color : FALLBACK;
}
