/**
 * Download a gallery photo as a local file.
 *
 * Fetches through a cache-busted CORS request so the browser's cached
 * no-CORS entry from the live preview doesn't poison the download. See
 * skill `image-cors-cache-bust` for the full diagnosis.
 */

import type { GalleryPhoto } from '../../../schemas/galleryPhoto';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100) || 'photo';
}

export async function downloadPhoto(photo: GalleryPhoto): Promise<void> {
  const sep = photo.url.includes('?') ? '&' : '?';
  const bustUrl = `${photo.url}${sep}_dl=${Date.now()}`;
  const res = await fetch(bustUrl, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'reload',
  });
  if (!res.ok) throw new Error(`Photo fetch ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  // Prefer the original filename if present; else fall back to an id-based
  // name. Preserve the mime extension from the blob when possible.
  const extFromMime = blob.type?.split('/')[1]?.replace(/;.*$/, '');
  const baseName = photo.filename
    ? sanitizeFilename(photo.filename)
    : `pickd-photo-${photo.id.slice(0, 8)}`;
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(baseName);
  const filename = hasExt ? baseName : `${baseName}.${extFromMime || 'webp'}`;

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}

/** Download several photos sequentially with a small gap so the browser
 *  accepts all of them (some browsers squash rapid-fire download() calls). */
export async function downloadPhotos(photos: GalleryPhoto[]): Promise<void> {
  for (const photo of photos) {
    try {
      await downloadPhoto(photo);
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.error('Photo download failed:', photo.id, err);
    }
  }
}
