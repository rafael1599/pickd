/**
 * El pallet entero, fuera del hilo principal: la sombra de Double Check.
 *
 * Corre `recognizeMultiBoxClient` con la configuración de `ENGINE_CONFIG` —sin
 * catálogo, que necesita la sesión de Supabase y aquí no existe— y, si se le
 * pide, devuelve también la copia reducida de la foto (`r2000/`) para no
 * decodificarla en el hilo de la pantalla. Lo lanza y lo mata
 * `readPalletInBackground.ts`; nadie más habla con él.
 */
import * as ort from 'onnxruntime-web';
import { recognizeMultiBoxClient } from './recognizeMultiBoxClient';
import { ENGINE_CONFIG } from './engineConfig';

ort.env.wasm.numThreads = ENGINE_CONFIG.wasmThreads;

/** La foto con su lado largo en `maxSide`, JPEG como la original. */
async function reduceImage(file: Blob, maxSide: number): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, file, reduceTo } = e.data as { id: number; file: File; reduceTo?: number };
  try {
    const result = await recognizeMultiBoxClient(file, file.name, {
      catalog: ENGINE_CONFIG.catalog,
      minItemsPerBox: ENGINE_CONFIG.minItemsPerBox,
    });
    let reduced: Blob | null = null;
    if (reduceTo) reduced = await reduceImage(file, reduceTo).catch(() => null);
    self.postMessage({ id, success: true, result, reduced });
  } catch (err: unknown) {
    self.postMessage({
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
