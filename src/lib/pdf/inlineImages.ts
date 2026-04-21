/**
 * Pre-fetch image URLs → same-origin JPEG data URLs for @react-pdf/renderer.
 *
 * Two problems this solves at once:
 *  1. CORS cache-bust. The live preview renders <img> without crossOrigin,
 *     so the browser cache holds responses lacking ACAO. A cache-busted
 *     fetch (?_pdf=<ts> + cache: 'reload') forces a fresh request; R2
 *     echoes back Access-Control-Allow-Origin because Origin is now sent.
 *  2. Format normalisation. react-pdf can't decode WebP (throws
 *     "Base64 image invalid format: webp"). Everything gets transcoded
 *     through a browser canvas into JPEG.
 *
 * See skill `image-cors-cache-bust` for the full diagnostic rundown.
 */

async function blobToJpegDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
          return;
        }
        // Solid white underlay so JPEG (no alpha) doesn't paint transparent
        // pixels as black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

export async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const sep = url.includes('?') ? '&' : '?';
    const bustUrl = `${url}${sep}_pdf=${Date.now()}`;
    const res = await fetch(bustUrl, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'reload',
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToJpegDataUrl(blob);
  } catch {
    return null;
  }
}

/**
 * Build a `oldUrl → dataUrl` map. Failed fetches are skipped; callers
 * should fall back to the original URL in that case.
 */
export async function buildInlineMap(urls: string[]): Promise<Map<string, string>> {
  const uniqueUrls = [...new Set(urls.filter((u) => u && !u.startsWith('data:')))];
  const urlMap = new Map<string, string>();
  await Promise.all(
    uniqueUrls.map(async (url) => {
      const dataUrl = await urlToDataUrl(url);
      if (dataUrl) urlMap.set(url, dataUrl);
    })
  );
  return urlMap;
}

export function applyInlineMap<T extends string>(urls: T[], map: Map<string, string>): string[] {
  return urls.map((url) => map.get(url) ?? url);
}
