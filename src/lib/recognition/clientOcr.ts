/**
 * Client-side OCR extraction and spatial line grouping.
 *
 * Implements the deterministic extraction logic verified in B3
 * (docs/label-recognition/local-model/B3-camino-rapido-ocr.md)
 * on top of browser-native PP-OCR (ppu-paddle-ocr/web).
 */

import { gtinCheckDigitOk } from './barcodeText';
import { normalizeSkuOnRegister } from '../../utils/skuNormalize';

export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrItem {
  text: string;
  box: OcrBox;
  confidence: number;
}

export interface ExtractedOcrFields {
  sku: string | null;
  upc: string | null;
  gtin: string | null;
  model: string | null;
  size: string | null;
  color: string | null;
  gw_kg: number | null;
  serial: string | null;
}

const KNOWN_MODELS = [
  'RENEGADE S1 FRAMEKIT',
  'RENEGADE S1',
  'RENEGADE S2',
  'RENEGADE A1 LTD',
  'RENEGADE A1',
  'RENEGADE',
  'FAULTLINE 29',
  'FAULTLINE',
  'LASER 1.6',
  'CODA S1 FEMME',
  'CODA S1',
  'CODA S2',
  'CODA',
  'DXT A1',
  'DXT',
  'SEQUEL S3',
  'SEQUEL',
  'EARTH CRUISER 3',
  'EARTH CRUISER',
  'KOMODO',
];

const KNOWN_COLORS = [
  'CHARCOAL',
  'BLACK',
  'GLOSS BLACK',
  'ANO DEEP BLUE',
  'DEEP BLUE',
  'MISTY GREEN',
  'MONTEREY GREY',
  'COPPER TONE',
  'MIDNIGHT BLUE',
  'PEARL WHITE',
  'DESERT STORM',
  'GALAXY GREY',
];

function cleanVal(v?: string | null): string | null {
  if (!v) return null;
  let s = v.replace(/^[:.\s|\-"'\\]+/, '').trim();
  // Strip trailing punctuation, but preserve inch symbol when preceded by a digit (e.g. 16" or 8")
  if (/\d["']$/.test(s)) {
    s = s.replace(/[:.\s|\-\\]+$/, '').trim();
  } else {
    s = s.replace(/[:.\s|\-"'\\]+$/, '').trim();
  }
  return s.length > 0 ? s : null;
}

function extractInlineOrFollow(ln: OcrItem[], j: number, token: string): string | null {
  const currentText = ln[j].text;
  const match = new RegExp(`^.*?\\b${token}\\b[:.\\s]*(.*)$`, 'i').exec(currentText);
  const inlineAfter = match && match[1] ? match[1].trim() : '';
  const subsequent = ln
    .slice(j + 1)
    .map((x) => x.text)
    .join(' ')
    .trim();
  const combined = [inlineAfter, subsequent].filter(Boolean).join(' ');
  return cleanVal(combined);
}

/**
 * Extract structured fields from OCR lines using spatial proximity and domain anchors.
 * Exact logic proven in B3 (bench_b3_fast_path.py).
 */
export function extractFieldsFromOcrLines(lines: OcrItem[][]): ExtractedOcrFields {
  const lineStrings = lines.map((ln) => ln.map((item) => item.text.trim()).join(' | '));
  const fullText = lineStrings.join('\n');

  // 1. SKU: Check for standard bike SKU (\d{2}-\d{4}[A-Z]{0,2}) or bulk parts (e.g. PP1202JC)
  let skuVal: string | null = null;
  const mSku = /\b(\d{2})[-.\s]?(\d{4})[-.\s]?([A-Z]{0,2})\b/i.exec(fullText);
  if (mSku) {
    const raw = `${mSku[1]}-${mSku[2]}${mSku[3] ?? ''}`.toUpperCase();
    skuVal = normalizeSkuOnRegister(raw);
  } else {
    const mPart = /\b([A-Z]{2}\d{4}[A-Z]{2})\b/i.exec(fullText);
    if (mPart) {
      skuVal = mPart[1].toUpperCase();
    }
  }

  // 2. UPC / GTIN with mod-10 check digit
  let upcVal: string | null = null;
  let gtinVal: string | null = null;
  const digitsMatches = fullText.match(/\b\d{12,14}\b/g) || [];
  for (const d of digitsMatches) {
    if (d.length === 12 && gtinCheckDigitOk(d)) {
      if (!upcVal) upcVal = d;
    } else if (d.length === 14 && gtinCheckDigitOk(d)) {
      if (!gtinVal) gtinVal = d;
      if (d.startsWith('00') && !upcVal && gtinCheckDigitOk(d.slice(2))) {
        upcVal = d.slice(2);
      }
    }
  }

  // 3. Model
  let modelVal: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      if (/\bMODEL\b/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, 'MODEL');
        if (c) {
          modelVal = c;
          break;
        }
        // Look on the immediately following line
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !/\b(SIZE|COLOR|QTY|PO|ITEM|SERIAL|G\.?W)\b/i.test(c2)) {
            modelVal = c2;
            break;
          }
        }
      }
    }
    if (modelVal) break;
  }

  if (!modelVal) {
    const upper = fullText.toUpperCase();
    for (const known of KNOWN_MODELS) {
      if (upper.includes(known)) {
        modelVal = known;
        break;
      }
    }
  }

  // 4. Size
  let sizeVal: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      if (/\bSIZE\b/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, 'SIZE');
        if (c) {
          sizeVal = c;
          break;
        }
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !/\b(MODEL|COLOR|QTY|PO|ITEM|SERIAL|G\.?W)\b/i.test(c2)) {
            sizeVal = c2;
            break;
          }
        }
      }
    }
    if (sizeVal) break;
  }

  if (!sizeVal) {
    const mSz = /\b(700C\s*[×xX]\s*\d+cm|700Cx\d+"?|8"[×*x]\s*16"?|\d+\s*cm|\d+")\b/i.exec(
      fullText
    );
    if (mSz) {
      sizeVal = mSz[1].replace(/\s+/g, ' ');
    }
  }

  // 5. Color
  let colorVal: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      if (/\bCOLOR\b/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, 'COLOR');
        if (c) {
          colorVal = c;
          break;
        }
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !/\b(MODEL|SIZE|QTY|PO|ITEM|SERIAL|G\.?W)\b/i.test(c2)) {
            colorVal = c2;
            break;
          }
        }
      }
    }
    if (colorVal) break;
  }

  if (!colorVal) {
    const upper = fullText.toUpperCase();
    for (const knownCol of KNOWN_COLORS) {
      if (upper.includes(knownCol)) {
        colorVal = knownCol;
        break;
      }
    }
  }

  // 6. G.W. (Gross Weight)
  let gwVal: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lnStr = lines[i].map((x) => x.text).join(' ');
    if (/\bG\.?W\.?\b/i.test(lnStr)) {
      const mGw = /(\d+(?:\.\d+)?)\s*KGS?/i.exec(lnStr);
      if (mGw) {
        gwVal = parseFloat(mGw[1]);
        break;
      }
      for (const off of [1, -1, 2]) {
        if (i + off >= 0 && i + off < lines.length) {
          const candStr = lines[i + off].map((x) => x.text).join(' ');
          const mGw2 = /(\d+(?:\.\d+)?)\s*KGS?/i.exec(candStr);
          if (mGw2) {
            gwVal = parseFloat(mGw2[1]);
            break;
          }
        }
      }
      if (gwVal != null) break;
    }
  }

  // Fallback for G.W. if not labeled directly
  if (gwVal == null) {
    const mAny = /(?<!N\.W\.[:\s])(\d+(?:\.\d+)?)\s*KGS?\b/i.exec(fullText);
    if (mAny) {
      gwVal = parseFloat(mAny[1]);
    }
  }

  // 7. Serial / Frame No
  let serialVal: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lnStr = lines[i].map((x) => x.text).join(' ');
    const mSer = /\b(?:SERIAL|FRAME)\s*(?:NO\.?)?\s*[:.]?\s*([A-Z0-9]{8,12})\b/i.exec(lnStr);
    if (mSer) {
      serialVal = mSer[1].toUpperCase();
      break;
    }
    if (/\b(?:SERIAL|FRAME)\s*NO\b/i.test(lnStr)) {
      for (const off of [1, -1]) {
        if (i + off >= 0 && i + off < lines.length) {
          for (const item of lines[i + off]) {
            const candidate = item.text.trim().toUpperCase();
            if (/^[A-Z0-9]{8,12}$/.test(candidate)) {
              serialVal = candidate;
              break;
            }
          }
        }
        if (serialVal) break;
      }
      if (serialVal) break;
    }
  }

  return {
    sku: skuVal,
    upc: upcVal,
    gtin: gtinVal,
    model: modelVal,
    size: sizeVal,
    color: colorVal,
    gw_kg: gwVal,
    serial: serialVal,
  };
}

interface RawPaddleItem {
  text?: string;
  box?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  confidence?: number;
}

interface RawPaddleResult {
  text?: string;
  lines?: RawPaddleItem[][];
}

interface PaddleServiceLike {
  initialize: () => Promise<void>;
  recognize: (canvas: HTMLCanvasElement) => Promise<RawPaddleResult>;
}

let ocrServiceInstance: PaddleServiceLike | null = null;
let ocrServicePromise: Promise<PaddleServiceLike> | null = null;

/**
 * Lazily initialize the browser PaddleOCR PP-OCRv6 service.
 */
async function getOcrService(): Promise<PaddleServiceLike> {
  if (ocrServiceInstance) return ocrServiceInstance;
  if (!ocrServicePromise) {
    ocrServicePromise = (async () => {
      const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
      const service = new PaddleOcrService({
        debugging: { debug: false, verbose: false },
      });
      await service.initialize();
      ocrServiceInstance = service;
      return service;
    })();
  }
  return ocrServicePromise;
}

/**
 * Execute client-side OCR on an image Blob using ppu-paddle-ocr/web.
 * Returns grouped lines and structured extracted fields.
 */
export async function runClientOcr(image: Blob): Promise<{
  lines: OcrItem[][];
  fullText: string;
  extracted: ExtractedOcrFields;
  elapsedMs: number;
}> {
  const t0 = performance.now();

  // Create an image bitmap / canvas for ppu-paddle-ocr
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('OffscreenCanvas 2D context not available');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const service = await getOcrService();
  const rawResult = await service.recognize(canvas as unknown as HTMLCanvasElement);

  const rawLines: RawPaddleItem[][] = rawResult.lines || [];
  const lines: OcrItem[][] = rawLines.map((ln) =>
    ln.map((item) => ({
      text: item.text ?? '',
      box: {
        x: item.box?.x ?? 0,
        y: item.box?.y ?? 0,
        width: item.box?.width ?? 0,
        height: item.box?.height ?? 0,
      },
      confidence: item.confidence ?? 0,
    }))
  );

  const fullText = rawResult.text || lines.map((l) => l.map((i) => i.text).join(' ')).join('\n');
  const extracted = extractFieldsFromOcrLines(lines);
  const elapsedMs = performance.now() - t0;

  return {
    lines,
    fullText,
    extracted,
    elapsedMs,
  };
}
