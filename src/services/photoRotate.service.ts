/**
 * Girar una foto 90° desde el visor y guardarla así para todos (Rafael, 6 oct
 * 2026: «quiero poder girar la imagen manualmente con un botón en todos los
 * lados donde se usa el visor de imagen»; guardada en R2, sin tabla).
 *
 * Se baja la foto pública, se gira en un lienzo y se vuelve a subir a **la
 * misma llave** con `upload-photo` (foto y miniatura), así queda derecha en
 * todas partes a la vez. La URL nueva lleva `?v=` y `replace_photo_url` la pone
 * donde estaba la vieja: sin versión, la caché de quien ya la vio seguiría
 * enseñándola torcida (01-0357, 1 oct 2026).
 *
 * Sólo fotos propias: `photos/gallery/<id>.webp` (pallets, proyectos, fotos de
 * SKU múltiples) y `photos/<sku>.webp`. Las de catálogo (`catalog/…`) las
 * comparten muchos SKUs y no se giran.
 */
import { supabase } from '../lib/supabase';
import { setPhotoOverride } from '../lib/photoOverrides';
import { uploadImage, type PhotoTarget } from './photoUpload.service';

const GALLERY = /\/photos\/gallery\/(?:thumbs\/)?([0-9a-f-]{36})\.webp$/i;
const SKU = /\/photos\/(?:thumbs\/)?([^/]+)\.webp$/i;

/** Dónde vive la foto en R2, o `null` si no es una que se pueda girar. */
export function rotateTarget(url: string): PhotoTarget | null {
  const base = url.split('?')[0];
  if (!/^https:\/\//.test(base)) return null;
  const g = GALLERY.exec(base);
  if (g) return { kind: 'gallery', photoId: g[1].toLowerCase() };
  if (/\/photos\/(gallery|returns)\//.test(base)) return null;
  const s = SKU.exec(base);
  if (s) return { kind: 'sku', sku: decodeURIComponent(s[1]) };
  return null;
}

export const canRotatePhoto = (url: string) => rotateTarget(url) != null;

/** La foto girada 90° (horario con `turns` = 1), como archivo para subir. */
async function rotated(url: string, turns: 1 | -1): Promise<File> {
  // La URL sin versión y con una marca propia: nunca la copia vieja de la caché.
  const res = await fetch(`${url.split('?')[0]}?rotate=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo bajar la foto (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Sin lienzo');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.92));
  if (!blob) throw new Error('No se pudo codificar la foto');
  return new File([blob], 'rotated.webp', { type: 'image/webp' });
}

/** Gira la foto, la guarda para todos y devuelve su URL nueva. */
export async function rotatePhoto(url: string, turns: 1 | -1 = 1): Promise<string> {
  const target = rotateTarget(url);
  if (!target) throw new Error('Esta foto no se puede girar');
  const file = await rotated(url, turns);
  const uploaded = await uploadImage(target, file);
  const base = url.split('?')[0];
  const fresh = uploaded.url.includes('?') ? uploaded.url.split('?')[1] : `v=${Date.now()}`;
  const next = `${base}?${fresh}`;
  const { error } = await (
    supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>
  )('replace_photo_url', { p_old: url, p_new: next });
  if (error) throw new Error(error.message);
  setPhotoOverride(url, next);
  return next;
}
