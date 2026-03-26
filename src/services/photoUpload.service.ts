import { supabase } from '../lib/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-photo`;

/**
 * Compresses an image file: resizes to max 1200px longest side,
 * converts to WebP at 80% quality, returns base64 string (no data: prefix).
 */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const maxSide = 1200;
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
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob returned null'));
      },
      'image/webp',
      0.8
    );
  });

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**
 * Compresses the file and uploads it to the upload-photo edge function.
 * Returns the public URL of the uploaded photo.
 */
export async function uploadPhoto(sku: string, file: File): Promise<string> {
  const image = await compressImage(file);

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
    body: JSON.stringify({ sku, image }),
  });

  if (!response.ok) {
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Upload failed with status ${response.status}`);
  }

  const result: { url: string } = await response.json();
  return result.url;
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
