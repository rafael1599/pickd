/**
 * De un Blob a píxeles RGBA y de vuelta, para el localizador de etiquetas
 * (`labelLocator.ts`), que trabaja sobre píxeles sin canvas. Devuelve `null`
 * donde no hay `createImageBitmap` u `OffscreenCanvas` (Safari < 16.4, tests).
 */
import type { Rgba } from './labelLocator';

export async function decodeRgba(blob: Blob): Promise<Rgba | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
    return null;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/** JPEG del recorte; `scale` < 1 lo reduce (la relectura a media escala). */
export async function rgbaToJpeg(img: Rgba, scale = 1): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0
  );
  if (scale === 1) return c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  const s = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
