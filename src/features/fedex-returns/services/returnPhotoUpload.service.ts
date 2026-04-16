import { supabase } from '../../../lib/supabase';
import { compressImage, base64ToBlobUrl } from '../../../services/photoUpload.service';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-photo`;

/**
 * Compresses and uploads a FedEx return label photo to the upload-photo edge function.
 * Stored at photos/returns/{trackingNumber}.webp on R2.
 * Calls onThumbnailReady with a local blob URL as soon as the thumbnail is generated.
 * Returns the public URL of the uploaded photo.
 */
export async function uploadReturnLabelPhoto(
  trackingNumber: string,
  file: File,
  onThumbnailReady?: (blobUrl: string) => void
): Promise<string> {
  const { image, thumbnail } = await compressImage(file);

  if (onThumbnailReady) {
    onThumbnailReady(base64ToBlobUrl(thumbnail));
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ returns: true, trackingNumber, image, thumbnail }),
  });

  if (!response.ok) {
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Upload failed with status ${response.status}`);
  }

  const result: { url: string } = await response.json();
  return result.url;
}

/**
 * Deletes a FedEx return label photo from R2 via the upload-photo edge function.
 */
export async function deleteReturnLabelPhoto(trackingNumber: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(FUNCTION_URL, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ returns: true, trackingNumber }),
  });

  if (!response.ok) {
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Delete failed with status ${response.status}`);
  }
}
