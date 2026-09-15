/**
 * Every barcode in a photo, read on the device at full resolution — the first
 * layer of the label reader (docs/label-recognition/02-investigacion.md §3.1).
 *
 * Replaces the two old scanners (`useBarcodeScanner`, `useQRScanner`), which
 * shrank the photo to 1280 px and, on their zxing fallback, returned ONE code:
 * on the 15 label photos that read 15 barcodes where full resolution reads 26,
 * and adding tiles, 33. Tiles are what find the small Code 39 of a SKU next to
 * a big QR (the damaged face of 03-4149BR).
 *
 * zxing-wasm is free, runs offline and its wasm is served by our own origin —
 * no CDN, no per-scan cost.
 */
import type { ReadInputBarcodeFormat, ReaderOptions, ReadResult } from 'zxing-wasm/reader';

export interface BarcodeRead {
  text: string;
  /** zxing format name: `EAN13`, `Code128`, `Code39`, `QRCode`… */
  format: string;
  /** Where it sits in the photo, in the photo's own pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** How many passes decoded it — more passes, more evidence. */
  hits: number;
}

export interface ReadBarcodesOptions {
  /** Empty or omitted: every readable format. */
  formats?: ReadInputBarcodeFormat[];
  /** Tile grids to add to the full-frame pass. `[]` skips tiling. */
  grids?: number[];
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
    if (seen) seen.hits += read.hits;
    else byKey.set(key, { ...read });
  }
  return [...byKey.values()];
}

/**
 * Decode every barcode in `image`: the whole frame, then overlapping tiles, and
 * the platform's own `BarcodeDetector` when the browser has one. Results are
 * merged; a symbol read by more passes carries more `hits`.
 */
export async function readBarcodes(
  image: Blob,
  { formats = [], grids = DEFAULT_GRIDS }: ReadBarcodesOptions = {}
): Promise<BarcodeRead[]> {
  const zxing = await loadZxing();
  // EXIF orientation applied here, so boxes match what the person sees.
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('This browser cannot read the photo (no 2D canvas).');
  }
  ctx.drawImage(bitmap, 0, 0);

  const options: ReaderOptions = {
    formats,
    tryHarder: true,
    tryRotate: true,
    // White-on-black boxes (the SKU and model bars on factory labels).
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 255,
  };

  const reads: BarcodeRead[] = [];
  const passes = [{ x: 0, y: 0, width: bitmap.width, height: bitmap.height }];
  for (const n of grids) passes.push(...tileRects(bitmap.width, bitmap.height, n));

  for (const rect of passes) {
    const pixels = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    for (const result of await zxing.readBarcodes(pixels, options)) {
      if (!result.isValid) continue;
      reads.push({
        text: result.text,
        format: result.format,
        box: boxOf(result, rect.x, rect.y),
        hits: 1,
      });
    }
  }

  reads.push(...(await readWithNativeDetector(bitmap, formats)));
  bitmap.close();
  return mergeReads(reads);
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

/** Chrome on Android ships a platform detector; its reads join zxing's as extra evidence. */
async function readWithNativeDetector(
  bitmap: ImageBitmap,
  formats: ReadInputBarcodeFormat[]
): Promise<BarcodeRead[]> {
  const Detector = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => {
        detect(src: ImageBitmap): Promise<NativeDetected[]>;
      };
    }
  ).BarcodeDetector;
  if (!Detector) return [];
  try {
    const nativeFormats = formats.map((f) => NATIVE_FORMAT[f]).filter(Boolean);
    const detector = new Detector(nativeFormats.length ? { formats: nativeFormats } : undefined);
    const found = await detector.detect(bitmap);
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
    }));
  } catch {
    // The platform detector is optional evidence; zxing already ran.
    return [];
  }
}
