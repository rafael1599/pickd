/**
 * Añadir o quitar una foto de `picking_lists.pallet_photos` en UNA sentencia
 * (`append_pallet_photo` / `remove_pallet_photo`, migración 20260925170448).
 *
 * Double Check leía el arreglo, le añadía la foto y lo reescribía. Con una
 * sola persona por orden la ventana era teórica; desde que el modo vista
 * también fotografía (ec612bb), dos personas pueden disparar sobre la misma
 * orden y la segunda escritura borraba la primera foto. La función concatena
 * en el servidor y no repite una URL que ya está (un reintento no duplica).
 */
import { supabase } from '../../../lib/supabase';
import { uploadImage } from '../../../services/photoUpload.service';

// Newer than the generated Supabase types: a narrow, locally typed wrapper
// instead of `any` (same idiom as labelBatch.service.ts).
type RpcResult<T> = { data: T | null; error: { message: string } | null };
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>
) => Promise<RpcResult<unknown>>;

const asUrls = (data: unknown): string[] =>
  Array.isArray(data) ? data.filter((u): u is string => typeof u === 'string') : [];

/** The row's photos after appending `url`. */
export async function appendPalletPhoto(listId: string, url: string): Promise<string[]> {
  const { data, error } = await callRpc('append_pallet_photo', { p_list_id: listId, p_url: url });
  if (error) throw new Error(error.message);
  return asUrls(data);
}

/**
 * One pallet photo, from the camera sheet to the order: the shared upload
 * (`uploadImage`, gallery path) and the one-statement append. Double Check,
 * Ship and the Picking Summary shoot through here. Returns the order's photos
 * after the append.
 *
 * `onPreview` gets the local thumbnail as soon as it exists. On localhost a
 * failed upload falls back to that blob so the UI works without R2; anywhere
 * else it throws.
 */
export async function uploadPalletPhotoFile(
  listId: string,
  file: File,
  opts: { photoId?: string; onPreview?: (thumbUrl: string) => void } = {}
): Promise<string[]> {
  const photoId = opts.photoId ?? crypto.randomUUID();
  let localThumb: string | null = null;
  let photoUrl: string;
  try {
    ({ url: photoUrl } = await uploadImage({ kind: 'gallery', photoId }, file, (thumb) => {
      localThumb = thumb;
      opts.onPreview?.(thumb);
    }));
  } catch (err) {
    if (window.location.hostname !== 'localhost' || !localThumb) throw err;
    console.warn('R2 upload failed in local — using blob URL fallback');
    photoUrl = localThumb;
  }
  return appendPalletPhoto(listId, photoUrl);
}

/** The row's photos after removing `url`. */
export async function removePalletPhoto(listId: string, url: string): Promise<string[]> {
  const { data, error } = await callRpc('remove_pallet_photo', { p_list_id: listId, p_url: url });
  if (error) throw new Error(error.message);
  return asUrls(data);
}
