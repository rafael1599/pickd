/**
 * Every photo PickD keeps goes through here: compress once, show the local
 * thumbnail at once, upload once to the `upload-photo` edge function. The
 * target says where it lands in R2 — a SKU's catalogue photo, a gallery photo
 * (pallets, projects) or a FedEx return label. Always `functions.invoke`, never
 * a raw fetch: the client refreshes the JWT, a raw fetch does not (CLAUDE.md).
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type PhotoTarget =
  | { kind: 'sku'; sku: string }
  | { kind: 'gallery'; photoId: string }
  | { kind: 'return'; trackingNumber: string };

const targetBody = (target: PhotoTarget): Record<string, unknown> => {
  switch (target.kind) {
    case 'sku':
      return { sku: target.sku };
    case 'gallery':
      return { gallery: true, photoId: target.photoId };
    case 'return':
      return { returns: true, trackingNumber: target.trackingNumber };
  }
};

/** An expired session forces the re-login that fixes it instead of a toast forever. */
async function invokeUploadPhoto(
  method: 'POST' | 'DELETE',
  body: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('upload-photo', { method, body });
  if (!error) return data;
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    if (response.status === 401) window.dispatchEvent(new CustomEvent('auth-error-401'));
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `upload-photo ${method} failed (${response.status})`);
  }
  throw error;
}

/**
 * Resizes an ImageBitmap to fit within maxSide, renders to WebP at given quality,
 * and returns the base64 string (no data: prefix).
 */
function bitmapToBase64(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<string> {
  const { width, height } = bitmap;
  let targetWidth = width;
  let targetHeight = height;

  if (width > maxSide || height > maxSide) {
    if (width >= height) {
      targetWidth = maxSide;
      targetHeight = Math.round((height / width) * maxSide);
    } else {
      targetHeight = maxSide;
      targetWidth = Math.round((width / height) * maxSide);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Canvas toBlob returned null'));
        b.arrayBuffer().then((arrayBuffer) => {
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          resolve(btoa(binary));
        });
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Compresses an image file: returns full-size (max 1200px, 80% quality)
 * and thumbnail (max 200px, 70% quality) as base64 strings.
 */
export async function compressImage(file: File): Promise<{ image: string; thumbnail: string }> {
  const bitmap = await createImageBitmap(file);

  const [image, thumbnail] = await Promise.all([
    bitmapToBase64(bitmap, 1200, 0.8),
    bitmapToBase64(bitmap, 200, 0.7),
  ]);

  bitmap.close();
  return { image, thumbnail };
}

/**
 * Converts a base64 string to a blob URL for instant local preview.
 */
export function base64ToBlobUrl(base64: string, mime = 'image/webp'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * Compresses `file`, hands the caller the local thumbnail before the network
 * starts (`onThumbnailReady`), and uploads it to `target`.
 */
export async function uploadImage(
  target: PhotoTarget,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<{ url: string; thumbnailUrl?: string }> {
  const { image, thumbnail } = await compressImage(file);
  onThumbnailReady?.(base64ToBlobUrl(thumbnail));
  const data = (await invokeUploadPhoto('POST', { ...targetBody(target), image, thumbnail })) as {
    url?: string;
    thumbnailUrl?: string;
  } | null;
  if (!data?.url) throw new Error('upload-photo returned no URL');
  return { url: data.url, thumbnailUrl: data.thumbnailUrl };
}

export async function deleteImage(target: PhotoTarget): Promise<void> {
  await invokeUploadPhoto('DELETE', targetBody(target));
}

/**
 * A SKU photo always lands on the same object key, so its URL must carry a
 * version or a re-shot photo keeps showing the old one from cache. The edge
 * function stamps `?v=`; this only covers a response from a build that didn't.
 */
export function withPhotoVersion(url: string): string {
  return url.includes('?') ? url : `${url}?v=${Date.now()}`;
}

/** A SKU's catalogue photo; returns its versioned public URL. */
export async function uploadPhoto(
  sku: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<string> {
  return withPhotoVersion((await uploadImage({ kind: 'sku', sku }, file, onThumbnailReady)).url);
}

export const deletePhoto = (sku: string) => deleteImage({ kind: 'sku', sku });

/**
 * An extra photo of the SKU (`sku_photos`) becomes its cover: the function
 * copies it onto `photos/{sku}.webp`, so every thumbnail derived from
 * `image_url` keeps working, and keeps the previous cover as an extra photo.
 */
export async function makeCoverPhoto(sku: string, photoId: string): Promise<string> {
  const data = (await invokeUploadPhoto('POST', { cover: true, sku, photoId })) as {
    url?: string;
  } | null;
  if (!data?.url) throw new Error('upload-photo returned no URL');
  return data.url;
}

/**
 * Before a sold S/D's SKU is reused: a copy of its cover under a key of its
 * own, because the next bike's photo overwrites photos/{sku}.webp. Null when
 * the SKU has no cover of its own.
 */
export async function archiveCoverPhoto(sku: string): Promise<string | null> {
  const data = (await invokeUploadPhoto('POST', { archive: true, sku })) as {
    url?: string | null;
  } | null;
  return data?.url ?? null;
}

export const uploadGalleryPhoto = async (
  photoId: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<{ url: string; thumbnailUrl: string }> => {
  const { url, thumbnailUrl } = await uploadImage(
    { kind: 'gallery', photoId },
    file,
    onThumbnailReady
  );
  return { url, thumbnailUrl: thumbnailUrl ?? url };
};

export const deleteGalleryPhoto = (photoId: string) => deleteImage({ kind: 'gallery', photoId });

/** A FedEx return's label photo, at photos/returns/{trackingNumber}.webp. */
export async function uploadReturnLabelPhoto(
  trackingNumber: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<string> {
  return (await uploadImage({ kind: 'return', trackingNumber }, file, onThumbnailReady)).url;
}
