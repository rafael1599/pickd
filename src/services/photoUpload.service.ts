import { supabase } from '../lib/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-photo`;

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
 * Compresses the file and uploads it to the upload-photo edge function.
 * Calls onThumbnailReady with a local blob URL as soon as the thumbnail
 * is generated (before the network upload starts).
 * Returns the public URL of the uploaded photo.
 */
export async function uploadPhoto(
  sku: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<string> {
  const { image, thumbnail } = await compressImage(file);

  // Optimistic: give the caller a local thumbnail immediately
  if (onThumbnailReady) {
    onThumbnailReady(base64ToBlobUrl(thumbnail));
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sku, image, thumbnail }),
  });

  if (!response.ok) {
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Upload failed with status ${response.status}`);
  }

  const result: { url: string } = await response.json();
  return result.url;
}

/**
 * Compresses and uploads a gallery photo via the upload-photo edge function.
 * Calls onThumbnailReady with a local blob URL as soon as the thumbnail
 * is generated (before the network upload starts).
 * Returns both the full-size and thumbnail public URLs.
 */
export async function uploadGalleryPhoto(
  photoId: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<{ url: string; thumbnailUrl: string }> {
  const { image, thumbnail } = await compressImage(file);

  if (onThumbnailReady) {
    onThumbnailReady(base64ToBlobUrl(thumbnail));
  }

  const { data, error } = await supabase.functions.invoke('upload-photo', {
    body: { gallery: true, photoId, image, thumbnail },
  });

  if (error) throw error;
  return data as { url: string; thumbnailUrl: string };
}

/**
 * Deletes a gallery photo via the upload-photo edge function.
 */
export async function deleteGalleryPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('upload-photo', {
    method: 'DELETE',
    body: { gallery: true, photoId },
  });

  if (error) throw error;
}

/**
 * Deletes a photo for the given SKU via the upload-photo edge function.
 */
export async function deletePhoto(sku: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(FUNCTION_URL, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ sku }),
  });

  if (!response.ok) {
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Delete failed with status ${response.status}`);
  }
}
