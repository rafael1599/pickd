/**
 * Every barcode in a photo, read on the device at full resolution — the first
 * layer of the label reader (docs/label-recognition/02-investigacion.md §3.1).
 *
 * Upgraded in A3h (R11):
 * - BarcodeDetector nativo (Shape Detection API / Google ML Kit) como canal primario (12-16 ms).
 * - zxing-wasm como fallback universal.
 * - Recorte dirigido por anclas de PP-OCRv6 con pre-proceso Lanczos 3x + CLAHE + Unsharp Masking.
 * - Medición de Varianza Laplaciana (LapVar) para diagnóstico óptico de desenfoque.
 * - Reporte explícito de motor ('barcode:native' vs 'barcode:zxing') y salvaguardas de acierto falso.
 */
import type { ReadInputBarcodeFormat, ReaderOptions, ReadResult } from 'zxing-wasm/reader';
import { computeLaplacianVariance, preprocessRoi } from './imageFilters';
import type { OcrItem } from './clientOcr';

export interface BarcodeRead {
  text: string;
  /** zxing format name: `EAN13`, `Code128`, `Code39`, `QRCode`… */
  format: string;
  /** Where it sits in the photo, in the photo's own pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** How many passes decoded it — more passes, more evidence. */
  hits: number;
  /** Which engine decoded this barcode: 'native' (Shape Detection API / ML Kit) vs 'zxing' (zxing-wasm). */
  engine?: 'native' | 'zxing';
}

export interface BarcodeCandidateDiagnostic {
  format: string;
  error: string;
  box: { x: number; y: number; width: number; height: number };
}

export type BarcodeReadArray = BarcodeRead[] & {
  diagnostics?: BarcodeCandidateDiagnostic[];
  laplacianVariance?: number;
  engineUsed?: 'native' | 'zxing' | 'both' | 'none';
};

export interface ReadBarcodesOptions {
  /** Empty or omitted: every readable format. */
  formats?: ReadInputBarcodeFormat[];
  /** Tile grids to add to the full-frame pass. `[]` skips tiling. */
  grids?: number[];
  /** Clockwise rotation angle: 0, 90, or 270 degrees. */
  rotation?: 0 | 90 | 270;
  /** When true, captures diagnostics of candidates failing checksum/format */
  captureDiagnostics?: boolean;
  /** Targeted regions to crop and process with Lanczos 3x + CLAHE + Unsharp Masking */
  targetedRois?: Array<{ x: number; y: number; width: number; height: number }>;
  /** When true, skips full-image and tile passes (only runs targeted ROIs) */
  skipFullPass?: boolean;
}

const DEFAULT_GRIDS = [2, 3];
const TILE_OVERLAP = 0.15;

let zxingReady: Promise<typeof import('zxing-wasm/reader')> | null = null;

/** Load zxing once, pointing it at the wasm bundled with the app. */
function loadZxing() {
  zxingReady ??= Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]).then(([zxing, wasm]) => {
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasm.default : prefix + path,
      },
    });
    return zxing;
  });
  return zxingReady;
}

/** Overlapping tile rectangles covering a `width`×`height` image in an n×n grid. Pure. */
export function tileRects(
  width: number,
  height: number,
  n: number,
  overlap = TILE_OVERLAP
): { x: number; y: number; width: number; height: number }[] {
  const tileW = width / n;
  const tileH = height / n;
  const padX = tileW * overlap;
  const padY = tileH * overlap;
  const rects = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x = Math.max(0, Math.floor(col * tileW - padX));
      const y = Math.max(0, Math.floor(row * tileH - padY));
      const right = Math.min(width, Math.ceil((col + 1) * tileW + padX));
      const bottom = Math.min(height, Math.ceil((row + 1) * tileH + padY));
      rects.push({ x, y, width: right - x, height: bottom - y });
    }
  }
  return rects;
}

/** Axis-aligned box of a zxing result, shifted by the tile's origin. */
function boxOf(result: ReadResult, dx: number, dy: number): BarcodeRead['box'] {
  const { topLeft, topRight, bottomLeft, bottomRight } = result.position;
  const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
  const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x + dx, y: y + dy, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Same symbol seen by several passes → one read with its hit count. Pure. */
export function mergeReads(reads: BarcodeRead[]): BarcodeRead[] {
  const byKey = new Map<string, BarcodeRead>();
  for (const read of reads) {
    const key = `${read.format}|${read.text}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.hits += read.hits;
      // Prefer native engine if any pass was native
      if (read.engine === 'native') seen.engine = 'native';
    } else {
      byKey.set(key, { ...read });
    }
  }
  return [...byKey.values()];
}

/** Merges overlapping or adjacent bounding boxes within a given pixel margin. */
export function mergeRois(
  rois: Array<{ x: number; y: number; width: number; height: number }>,
  margin = 35
): Array<{ x: number; y: number; width: number; height: number }> {
  const merged: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const r of rois) {
    let combined = false;
    for (const m of merged) {
      const overlapsX = r.x <= m.x + m.width + margin && r.x + r.width + margin >= m.x;
      const overlapsY = r.y <= m.y + m.height + margin && r.y + r.height + margin >= m.y;
      if (overlapsX && overlapsY) {
        const x1 = Math.min(r.x, m.x);
        const y1 = Math.min(r.y, m.y);
        const x2 = Math.max(r.x + r.width, m.x + m.width);
        const y2 = Math.max(r.y + r.height, m.y + m.height);
        m.x = x1;
        m.y = y1;
        m.width = x2 - x1;
        m.height = y2 - y1;
        combined = true;
        break;
      }
    }
    if (!combined) {
      merged.push({ ...r });
    }
  }

  return merged;
}

/**
 * Extracts candidate barcode ROI rectangles around OCR anchor boxes (R11 §2.4 / A3h).
 * Looks for UPC:, GTIN:, ITEM:, SKU:, numeric candidates and canonical SKU strings.
 */
export function getAnchorBarcodeRois(
  linesOrItems: OcrItem[][] | OcrItem[],
  imageWidth: number,
  imageHeight: number
): Array<{ x: number; y: number; width: number; height: number }> {
  const items: OcrItem[] = [];
  if (Array.isArray(linesOrItems)) {
    for (const entry of linesOrItems) {
      if (Array.isArray(entry)) {
        items.push(...entry);
      } else if (entry && typeof entry === 'object' && 'text' in entry) {
        items.push(entry);
      }
    }
  }

  const ANCHOR_PATTERN = /\b(?:UPC|GTIN|EAN|ITEM|SKU|PART|MODEL|P\/N|CODE|BARCODE)\b/i;
  const NUMERIC_12_14 = /\b\d{12,14}\b/;
  const CANONICAL_SKU = /\b\d{2}-?\d{4}[A-Z]{0,2}\b/i;

  const candidateBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;

    const isAnchor =
      ANCHOR_PATTERN.test(text) ||
      NUMERIC_12_14.test(text.replace(/\s+/g, '')) ||
      CANONICAL_SKU.test(text.replace(/\s+/g, ''));

    if (isAnchor) {
      const box = item.box;
      // Expand horizontally: 1D barcodes are typically 350-550 px wide at native res
      const roiW = Math.max(box.width * 2.2, 450);
      const roiX = Math.max(0, Math.floor(box.x + box.width / 2 - roiW / 2));
      const actualW = Math.min(imageWidth - roiX, Math.ceil(roiW));

      // Expand vertically: barcodes are above or below the text line (~120-140 px tall)
      const roiY = Math.max(0, Math.floor(box.y - 140));
      const roiBottom = Math.min(imageHeight, Math.ceil(box.y + box.height + 140));
      const actualH = roiBottom - roiY;

      if (actualW >= 40 && actualH >= 30) {
        candidateBoxes.push({ x: roiX, y: roiY, width: actualW, height: actualH });
      }
    }
  }

  return mergeRois(candidateBoxes, 35).slice(0, 5);
}

/**
 * Decode every barcode in `image`:
 * 1. Computes Laplacian Variance (LapVar) on native canvas.
 * 2. Native `BarcodeDetector` on hardware as primary channel (R11: 12-16 ms in Chrome Android).
 * 3. Fallback to `zxing-wasm` on full image + grids.
 * 4. Targeted OCR-guided ROIs with Lanczos 3x + CLAHE + Unsharp Masking (A3h / R11).
 */
export async function readBarcodes(
  image: Blob,
  {
    formats = [],
    grids = DEFAULT_GRIDS,
    rotation = 0,
    captureDiagnostics = false,
    targetedRois,
    skipFullPass = false,
  }: ReadBarcodesOptions = {}
): Promise<BarcodeReadArray> {
  const zxing = await loadZxing();
  // EXIF orientation applied here, so boxes match what the person sees.
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });

  const isTransposed = rotation === 90 || rotation === 270;
  const width = isTransposed ? bitmap.height : bitmap.width;
  const height = isTransposed ? bitmap.width : bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('This browser cannot read the photo (no 2D canvas).');
  }

  ctx.save();
  if (rotation === 90) {
    ctx.translate(width, 0);
    ctx.rotate((90 * Math.PI) / 180);
  } else if (rotation === 270) {
    ctx.translate(0, height);
    ctx.rotate((270 * Math.PI) / 180);
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();

  // 1. Calculate LapVar on canvas
  const fullPixels = ctx.getImageData(0, 0, width, height);
  const lapVar = computeLaplacianVariance(fullPixels);

  const reads: BarcodeRead[] = [];
  const diagnostics: BarcodeCandidateDiagnostic[] = [];

  const options: ReaderOptions = {
    formats,
    tryHarder: false,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 255,
    returnErrors: captureDiagnostics,
  };

  // 2. Pass A: Full-frame / tile passes (unless skipFullPass is requested)
  if (!skipFullPass) {
    // Primary channel: BarcodeDetector nativo en hardware (R11: 12-16 ms en Chrome Android)
    const nativeReads = await readWithNativeDetector(canvas, formats);
    if (nativeReads.length > 0) {
      reads.push(...nativeReads);
    }

    // Universal fallback: zxing-wasm (si native no leyó nada, o para grids adicionales)
    const passes = [{ x: 0, y: 0, width, height }];
    for (const n of grids) passes.push(...tileRects(width, height, n));

    for (const rect of passes) {
      const pixels = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
      for (const result of await zxing.readBarcodes(pixels, options)) {
        if (!result.isValid) {
          if (captureDiagnostics) {
            diagnostics.push({
              format: result.format,
              error: result.error,
              box: boxOf(result, rect.x, rect.y),
            });
          }
          continue;
        }
        reads.push({
          text: result.text,
          format: result.format,
          box: boxOf(result, rect.x, rect.y),
          hits: 1,
          engine: 'zxing',
        });
      }
    }
  }

  // 3. Pass B: Targeted OCR-guided ROIs with Lanczos 3x + CLAHE + Unsharp Masking
  if (targetedRois && targetedRois.length > 0) {
    for (const roi of targetedRois) {
      const rx = Math.max(0, Math.min(width - 1, roi.x));
      const ry = Math.max(0, Math.min(height - 1, roi.y));
      const rw = Math.max(1, Math.min(width - rx, roi.width));
      const rh = Math.max(1, Math.min(height - ry, roi.height));
      if (rw < 20 || rh < 10) continue;

      const roiPixels = ctx.getImageData(rx, ry, rw, rh);
      const { processed, scaleApplied } = preprocessRoi(roiPixels);

      // Try native detector on preprocessed crop
      let roiFoundNative = false;
      const nativeRoiReads = await readWithNativeDetector(processed, formats);
      if (nativeRoiReads.length > 0) {
        roiFoundNative = true;
        for (const nr of nativeRoiReads) {
          reads.push({
            text: nr.text,
            format: nr.format,
            box: {
              x: rx + nr.box.x / scaleApplied,
              y: ry + nr.box.y / scaleApplied,
              width: nr.box.width / scaleApplied,
              height: nr.box.height / scaleApplied,
            },
            hits: 1,
            engine: 'native',
          });
        }
      }

      // Fallback to zxing on preprocessed crop
      if (!roiFoundNative) {
        for (const result of await zxing.readBarcodes(processed, options)) {
          if (!result.isValid) {
            if (captureDiagnostics) {
              const b = boxOf(result, 0, 0);
              diagnostics.push({
                format: result.format,
                error: result.error,
                box: {
                  x: rx + b.x / scaleApplied,
                  y: ry + b.y / scaleApplied,
                  width: b.width / scaleApplied,
                  height: b.height / scaleApplied,
                },
              });
            }
            continue;
          }
          const b = boxOf(result, 0, 0);
          reads.push({
            text: result.text,
            format: result.format,
            box: {
              x: rx + b.x / scaleApplied,
              y: ry + b.y / scaleApplied,
              width: b.width / scaleApplied,
              height: b.height / scaleApplied,
            },
            hits: 1,
            engine: 'zxing',
          });
        }
      }
    }
  }

  bitmap.close();

  const merged = mergeReads(reads) as BarcodeReadArray;
  if (captureDiagnostics && diagnostics.length > 0) {
    merged.diagnostics = diagnostics;
  }
  merged.laplacianVariance = lapVar;

  const hasNative = reads.some((r) => r.engine === 'native');
  const hasZxing = reads.some((r) => r.engine === 'zxing');
  merged.engineUsed =
    hasNative && hasZxing ? 'both' : hasNative ? 'native' : hasZxing ? 'zxing' : 'none';

  return merged;
}

/** zxing format name → Shape Detection API name, for the formats both know. */
const NATIVE_FORMAT: Record<string, string> = {
  QRCode: 'qr_code',
  Code128: 'code_128',
  Code39: 'code_39',
  Code93: 'code_93',
  EAN13: 'ean_13',
  EAN8: 'ean_8',
  UPCA: 'upc_a',
  UPCE: 'upc_e',
  ITF: 'itf',
  PDF417: 'pdf417',
  DataMatrix: 'data_matrix',
  Aztec: 'aztec',
  Codabar: 'codabar',
};
const FROM_NATIVE = Object.fromEntries(Object.entries(NATIVE_FORMAT).map(([k, v]) => [v, k]));

interface NativeDetected {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
}

/** Chrome on Android ships a platform detector; runs in hardware in 12-16 ms. */
export async function readWithNativeDetector(
  source: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | ImageData,
  formats: ReadInputBarcodeFormat[] = []
): Promise<BarcodeRead[]> {
  const Detector = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => {
        detect(
          src: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | ImageData
        ): Promise<NativeDetected[]>;
      };
    }
  ).BarcodeDetector;
  if (!Detector) return [];
  try {
    const nativeFormats = formats.map((f) => NATIVE_FORMAT[f]).filter(Boolean);
    const detector = new Detector(nativeFormats.length ? { formats: nativeFormats } : undefined);

    let detectSource: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | ImageData = source;
    let needsClose = false;
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
      if (typeof createImageBitmap !== 'undefined') {
        try {
          detectSource = await createImageBitmap(source);
          needsClose = true;
        } catch {
          // Pass ImageData directly
        }
      }
    }

    const found = await detector.detect(detectSource);
    if (needsClose && 'close' in detectSource && typeof detectSource.close === 'function') {
      detectSource.close();
    }

    return found.map((d) => ({
      text: d.rawValue,
      format: FROM_NATIVE[d.format] ?? d.format,
      box: {
        x: d.boundingBox.x,
        y: d.boundingBox.y,
        width: d.boundingBox.width,
        height: d.boundingBox.height,
      },
      hits: 1,
      engine: 'native' as const,
    }));
  } catch {
    // The platform detector is optional evidence; zxing is the universal fallback
    return [];
  }
}
