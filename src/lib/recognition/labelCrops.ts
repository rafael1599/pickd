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
import { locateLabels, rectifyLabel, rotate180, type Quad } from './labelLocator';
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
  /**
   * Las 4 esquinas de la etiqueta en la foto, en el orden en que se lee derecha
   * (arriba-izq., arriba-der., abajo-der., abajo-izq.): con ellas cualquiera la
   * endereza con una homografía, sin volver a buscarla (el 3D de Ship).
   */
  corners: [number, number][];
  /** Caja envolvente de la etiqueta en la foto. */
  bbox: OcrBox;
  /** Renglones del OCR en el marco en que el texto se lee derecho (girado 180° si pass = rot180). */
  lines: OcrItem[][];
  /** Los mismos fragmentos llevados a la foto (su caja envolvente). */
  itemsInPhoto: OcrItem[];
  width: number;
  height: number;
  extracted: ExtractedOcrFields;
  /** De qué lectura salió el SKU: entera, a media escala o girada 180° (etiqueta boca abajo). */
  pass: 'full' | 'half' | 'rot180';
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
    /** Fragmentos en el marco del recorte (para llevarlos a la foto). */
    let items = full.lines.flat();
    /** Los mismos, en el marco en que el texto se lee derecho (para extraer campos). */
    let readItems = items;
    let extracted = extractFieldsFromOcrLines(groupLinesBySpatialProximity(items), {
      width,
      height,
    });
    let pass: 'full' | 'half' | 'rot180' = 'full';
    if (!extracted.sku) {
      const half = await runClientOcr(await rgbaToJpeg(r.image, 0.5));
      const halfItems = scaleItems(half.lines.flat(), 2);
      const halfExtracted = extractFieldsFromOcrLines(groupLinesBySpatialProximity(halfItems), {
        width,
        height,
      });
      if (halfExtracted.sku) {
        items = halfItems;
        readItems = halfItems;
        extracted = halfExtracted;
        pass = 'half';
      }
    }
    if (!extracted.sku) {
      // La orientación por plantilla falla sobre todo en la etiqueta nueva (franjas de lado a
      // lado, texto centrado): boca abajo el OCR no lee nada. Girada, sí.
      const rot = await runClientOcr(await rgbaToJpeg(rotate180(r.image)));
      const rotItems = rot.lines.flat().map((i) => ({
        ...i,
        box: {
          x: width - i.box.x - i.box.width,
          y: height - i.box.y - i.box.height,
          width: i.box.width,
          height: i.box.height,
        },
      }));
      const rotExtracted = extractFieldsFromOcrLines(
        groupLinesBySpatialProximity(rot.lines.flat()),
        {
          width,
          height,
        }
      );
      if (rotExtracted.sku) {
        items = rotItems;
        readItems = rot.lines.flat();
        extracted = rotExtracted;
        pass = 'rot180';
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
    const W = r.image.width,
      H = r.image.height;
    const up = [r.toPhoto(0, 0), r.toPhoto(W, 0), r.toPhoto(W, H), r.toPhoto(0, H)];
    // leída girada 180°: lo derecho es la etiqueta al revés de como quedó el recorte
    const corners = (pass === 'rot180' ? [up[2], up[3], up[0], up[1]] : up).map(
      ([x, y]) => [Math.round(x), Math.round(y)] as [number, number]
    );
    crops.push({
      quad: r.quad,
      corners,
      bbox: bounds(r.quad),
      lines: groupLinesBySpatialProximity(readItems),
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
