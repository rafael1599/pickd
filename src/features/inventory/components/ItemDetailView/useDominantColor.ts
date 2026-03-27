import { useEffect, useMemo, useState } from 'react';
import { FastAverageColor } from 'fast-average-color';

const FALLBACK = 'rgb(200,200,200)';

export function useDominantColor(imageUrl: string | null) {
  const [color, setColor] = useState<string>(FALLBACK);
  const resolvedUrl = useMemo(() => imageUrl || null, [imageUrl]);

  useEffect(() => {
    if (!resolvedUrl) return;

    const fac = new FastAverageColor();

    fac
      .getColorAsync(resolvedUrl, { algorithm: 'dominant', crossOrigin: 'anonymous' })
      .then((result) => setColor(result.rgb))
      .catch(() => setColor(FALLBACK));

    return () => fac.destroy();
  }, [resolvedUrl]);

  return resolvedUrl ? color : FALLBACK;
}
