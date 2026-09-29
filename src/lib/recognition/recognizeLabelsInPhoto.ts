/**
 * Todas las etiquetas de una foto, no sólo una (lote por fotos, Rafael, 29 sep
 * 2026: «tengo bikes que tienen varias etiquetas con diferente información y
 * quiero todo que se considere para llenar todos los campos»).
 *
 * Una caja puede llevar la etiqueta de producto, la del número de serie y a
 * veces otra con peso o medidas. Se lee la foto entera como siempre, y además
 * cada etiqueta que encuentra la pieza 1 (`labelLocator.ts`), enderezada y a
 * escala nativa. Quien construye la tarjeta junta los campos de todas
 * (`mergeDrafts`): lo que coincide queda firme, lo que difiere se ofrece.
 *
 * Sin `OffscreenCanvas` o sin etiquetas encontradas, `labels` va vacío y queda
 * la lectura de la foto entera, como antes.
 */
import { locateLabels, rectifyLabel } from './labelLocator';
import { decodeRgba, rgbaToJpeg } from './rgbaImage';
import { recognizeLabelClient, type ClientRecognitionResult } from './recognizeLabelClient';

export interface PhotoLabelsResult {
  /** La foto entera, leída como una sola etiqueta (lo de siempre). */
  whole: ClientRecognitionResult;
  /** Cada etiqueta encontrada, enderezada y leída por separado. */
  labels: ClientRecognitionResult[];
}

/** Más etiquetas que esto en una foto del lote es un pallet, no una caja: basta con las primeras. */
const MAX_LABELS = 6;

export async function recognizeLabelsInPhoto(
  file: Blob,
  name?: string
): Promise<PhotoLabelsResult> {
  const whole = await recognizeLabelClient(file, name);
  const labels: ClientRecognitionResult[] = [];
  try {
    const img = await decodeRgba(file);
    if (img) {
      for (const quad of locateLabels(img).slice(0, MAX_LABELS)) {
        const crop = await rgbaToJpeg(rectifyLabel(img, quad).image);
        labels.push(await recognizeLabelClient(crop, name));
      }
    }
  } catch (e) {
    // La foto entera ya está leída: una etiqueta que no se pudo recortar no la invalida.
    console.warn('[recognizeLabelsInPhoto] labels skipped:', e);
  }
  return { whole, labels };
}
