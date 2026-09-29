/**
 * Leer cada etiqueta por separado (idea-238, 29 sep 2026): la pieza 1
 * (`labelLocator.ts`) encuentra y endereza las etiquetas de la foto, y el OCR
 * lee cada recorte a escala nativa en vez de la foto entera reducida. Si un
 * recorte no da SKU se relee a media escala: en fotos muy de cerca la franja
 * negra del SKU es tan grande que el detector la parte en trozos ("03-39" /
 * "9" / "8" / "2-BL") y a la mitad la ve como una línea. En el banco
 * (`label-bench/banco-dcv`): 0,54 → 0,88 de etiquetas leídas, 0 verdes falsos.
 *
 * Devuelve `null` si no puede decodificar la foto (sin `createImageBitmap` u
 * `OffscreenCanvas`) o no encuentra ninguna etiqueta: el llamador vuelve a leer
 * la foto entera como antes.
 */
import { locateLabels, rectifyLabel, type Quad } from './labelLocator';
import { decodeRgba, rgbaToJpeg } from './rgbaImage';
import {
  runClientOcr,
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  type ExtractedOcrFields,
  type OcrBox,
  type OcrItem,
} from './clientOcr';

export interface LabelCropRead {
  quad: Quad;
  /** Caja envolvente de la etiqueta en la foto. */
  bbox: OcrBox;
  /** Renglones del OCR en coordenadas del recorte enderezado. */
  lines: OcrItem[][];
  /** Los mismos fragmentos llevados a la foto (su caja envolvente). */
  itemsInPhoto: OcrItem[];
  width: number;
  height: number;
  extracted: ExtractedOcrFields;
  /** 'full' o 'half': de qué lectura salió el SKU. */
  pass: 'full' | 'half';
  ocrMs: number;
}

export interface LabelCropsResult {
  crops: LabelCropRead[];
  imageDimensions: { width: number; height: number };
  locateMs: number;
}

function scaleItems(items: OcrItem[], f: number): OcrItem[] {
  return items.map((i) => ({
    ...i,
    box: { x: i.box.x * f, y: i.box.y * f, width: i.box.width * f, height: i.box.height * f },
  }));
}

function bounds(pts: [number, number][]): OcrBox {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...xs) - x),
    height: Math.round(Math.max(...ys) - y),
  };
}

export async function readLabelCrops(blob: Blob): Promise<LabelCropsResult | null> {
  const img = await decodeRgba(blob);
  if (!img) return null;
  const t0 = performance.now();
  const quads = locateLabels(img);
  const locateMs = performance.now() - t0;
  if (quads.length === 0) return null;

  const crops: LabelCropRead[] = [];
  for (const quad of quads) {
    const r = rectifyLabel(img, quad);
    const { width, height } = r.image;
    const tOcr = performance.now();
    const full = await runClientOcr(await rgbaToJpeg(r.image));
    let items = full.lines.flat();
    let extracted = extractFieldsFromOcrLines(groupLinesBySpatialProximity(items), {
      width,
      height,
    });
    let pass: 'full' | 'half' = 'full';
    if (!extracted.sku) {
      const half = await runClientOcr(await rgbaToJpeg(r.image, 0.5));
      const halfItems = scaleItems(half.lines.flat(), 2);
      const halfExtracted = extractFieldsFromOcrLines(groupLinesBySpatialProximity(halfItems), {
        width,
        height,
      });
      if (halfExtracted.sku) {
        items = halfItems;
        extracted = halfExtracted;
        pass = 'half';
      }
    }
    const ocrMs = performance.now() - tOcr;
    if (items.length === 0) continue;
    const itemsInPhoto = items.map((i) => ({
      ...i,
      box: bounds([
        r.toPhoto(i.box.x, i.box.y),
        r.toPhoto(i.box.x + i.box.width, i.box.y),
        r.toPhoto(i.box.x + i.box.width, i.box.y + i.box.height),
        r.toPhoto(i.box.x, i.box.y + i.box.height),
      ]),
    }));
    crops.push({
      quad,
      bbox: bounds(quad),
      lines: groupLinesBySpatialProximity(items),
      itemsInPhoto,
      width,
      height,
      extracted,
      pass,
      ocrMs,
    });
  }
  if (crops.length === 0) return null;
  return { crops, imageDimensions: { width: img.width, height: img.height }, locateMs };
}
