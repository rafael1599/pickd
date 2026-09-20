/**
 * Client-side OCR extraction and spatial line grouping.
 *
 * Implements the deterministic extraction logic verified in B3
 * (docs/label-recognition/local-model/B3-camino-rapido-ocr.md)
 * on top of browser-native PP-OCR (ppu-paddle-ocr/web).
 *
 * Features:
 * - A3b-perf: Module-level persistent singleton session for PaddleOcrService/ONNX Runtime
 *   with warmup capability to eliminate cold-start latency.
 * - A3b-precision: Geometric spatial line clustering (port of B3's group_lines), noise-tolerant
 *   anchor extraction, catalog model matching, and strict G.W./N.W. separation.
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

export const KNOWN_MODELS = [
  'RENEGADE S1 FRAMEKIT',
  'RENEGADE S1',
  'RENEGADE S2',
  'RENEGADE A1 LTD',
  'RENEGADE A1',
  'RENEGADE',
  'CITIZEN 2 STEP-THRU',
  'CITIZEN 2 S/T',
  'CITIZEN 2',
  'CITIZEN',
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

export const KNOWN_COLORS = [
  'CHARCOAL',
  'BLACK',
  'GLOSS BLACK',
  'ANO DEEP BLUE',
  'DEEP BLUE',
  'MISTY GREEN',
  'MONTEREY GREY',
  'STORM GREY',
  'COPPER TONE',
  'MIDNIGHT BLUE',
  'PEARL WHITE',
  'DESERT STORM',
  'GALAXY GREY',
];

/**
 * Section headers and field delimiters commonly found on cartons.
 * Includes common OCR misreadings (e.g. FCAOLOR for COLOR, RTEM for ITEM).
 */
export const SECTION_HEADER_REGEX =
  /\b(?:MODEL|MODL|MDL|SIZE|SZ|SZE|COLOR|COLOUR|COLR|CLR|FCAOLOR|C[AO]{1,2}LOR|Q'?TY|QUANTITY|PCS|G\.?W\.?|N\.?W\.?|GROSS|NET|ITEM|RTEM|C\/NO|SERIAL|FRAME|P\.?O\.?)\b/i;

export function cleanVal(v?: string | null): string | null {
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

/**
 * Matches known catalog models against text, including prefix matching for OCR typos
 * (e.g. 'FAULTLINE 20K' -> 'FAULTLINE 29').
 */
export function matchKnownModel(text: string): string | null {
  const upper = text.toUpperCase();

  // Common OCR misreadings of 29 / 29" as 20K / 20 / 29K
  if (/FAULTLINE\s*(?:20K?|29["'\sK]?)/i.test(upper)) {
    return 'FAULTLINE 29';
  }

  // Common OCR misreadings of Citizen 2 Step-Thru (e.g. 'N2S] STEP-THRU')
  if (/(?:CITIZEN|N2S\]?|N\s*2\s*S)\s*(?:2\s*)?(?:STEP[-\s]*THRU|S\/T)/i.test(upper)) {
    return 'CITIZEN 2 STEP-THRU';
  }

  for (const known of KNOWN_MODELS) {
    if (upper.includes(known)) {
      return known;
    }
  }
  // Word-level prefix check for distinctive model families
  for (const known of KNOWN_MODELS) {
    const firstWord = known.split(/\s+/)[0];
    if (firstWord.length >= 5 && upper.includes(firstWord)) {
      if (firstWord === 'FAULTLINE') {
        return 'FAULTLINE 29';
      }
      return known;
    }
  }
  return null;
}

/**
 * Matches known catalog colors against text.
 */
export function matchKnownColor(text: string): string | null {
  const upper = text.toUpperCase();
  for (const known of KNOWN_COLORS) {
    if (upper.includes(known)) {
      return known;
    }
  }
  return null;
}

/**
 * Groups OCR bounding boxes into horizontal lines based on vertical overlap.
 * Exact spatial clustering algorithm verified in B3 (group_lines).
 */
export function groupLinesBySpatialProximity(items: OcrItem[]): OcrItem[][] {
  if (items.length === 0) return [];

  const valid = items.filter((it) => it.text.trim().length > 0 && it.box.height > 0);
  if (valid.length === 0) return [];

  const mapped = valid.map((it) => {
    const y0 = it.box.y;
    const y1 = it.box.y + it.box.height;
    const cy = (y0 + y1) / 2;
    return { y0, y1, cy, item: it };
  });

  mapped.sort((a, b) => a.cy - b.cy);

  interface LineGroup {
    y0: number;
    y1: number;
    items: Array<{ x0: number; item: OcrItem }>;
  }

  const lines: LineGroup[] = [];

  for (const entry of mapped) {
    const { y0, y1, cy, item } = entry;
    const x0 = item.box.x;
    let placed = false;

    for (const ln of lines) {
      const h = Math.max(ln.y1 - ln.y0, y1 - y0);
      const tol = h * 0.35;
      if (cy >= ln.y0 - tol && cy <= ln.y1 + tol) {
        ln.items.push({ x0, item });
        ln.y0 = Math.min(ln.y0, y0);
        ln.y1 = Math.max(ln.y1, y1);
        placed = true;
        break;
      }
    }

    if (!placed) {
      lines.push({
        y0,
        y1,
        items: [{ x0, item }],
      });
    }
  }

  // Sort lines from top to bottom
  lines.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

  // Sort items within each line left to right
  return lines.map((ln) => ln.items.sort((a, b) => a.x0 - b.x0).map((x) => x.item));
}

export function extractInlineOrFollow(
  ln: OcrItem[],
  j: number,
  tokenPattern: RegExp | string
): string | null {
  const currentText = ln[j].text;
  const regex =
    typeof tokenPattern === 'string'
      ? new RegExp(`^.*?\\b${tokenPattern}\\b[:.\\s]*(.*)$`, 'i')
      : tokenPattern;
  const match = regex.exec(currentText);
  let inlineAfter = match && match[1] ? match[1].trim() : '';

  // If inline text contains another section header, cut off before it
  const inlineCutMatch = SECTION_HEADER_REGEX.exec(inlineAfter);
  if (inlineCutMatch && inlineCutMatch.index !== undefined && inlineCutMatch.index > 0) {
    inlineAfter = inlineAfter.slice(0, inlineCutMatch.index).trim();
  }

  const subsequent: string[] = [];
  for (let k = j + 1; k < ln.length; k++) {
    const txt = ln[k].text.trim();
    if (SECTION_HEADER_REGEX.test(txt)) {
      break;
    }
    subsequent.push(txt);
  }

  const combined = [inlineAfter, ...subsequent].filter(Boolean).join(' ');
  return cleanVal(combined);
}

/**
 * Multi-line SKU reconstruction (A3d / A3f).
 *
 * When OCR breaks a SKU across multiple vertically adjacent lines (e.g.
 * separates department prefix, digits, and color suffix into separate lines), this function
 * stitches them together following strict canonical pattern DD-NNNN[CCC].
 *
 * Strict constraint (A3f): Never invent or substitute digits. The concatenated candidate must match
 * the canonical SKU pattern directly without transforming any character.
 */
export function reconstructMultiLineSku(
  input: OcrItem[][] | string[] | string,
  fallbackFullText?: string
): string | null {
  let lineTexts: string[] = [];
  if (typeof input === 'string') {
    lineTexts = input
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } else if (Array.isArray(input)) {
    if (input.length === 0) {
      if (fallbackFullText) {
        lineTexts = fallbackFullText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      } else {
        return null;
      }
    } else if (typeof input[0] === 'string') {
      lineTexts = (input as string[]).map((l) => l.trim()).filter(Boolean);
    } else {
      lineTexts = (input as OcrItem[][])
        .map((ln) =>
          ln
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join(' ')
        )
        .filter((l) => l.length > 0);
    }
  }

  if (lineTexts.length === 0 && fallbackFullText) {
    lineTexts = fallbackFullText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  if (lineTexts.length < 2) return null;

  for (let i = 0; i < lineTexts.length; i++) {
    const l1 = lineTexts[i];

    // Check if line i contains a department prefix: e.g. '03-', '03 ', '06-', etc.
    const mDept = /\b(\d{2})[-\s.]+(.*)$/.exec(l1);
    if (!mDept) continue;

    // Direct concatenation of consecutive lines (window up to 3 lines)
    for (let w = 1; w <= 3 && i + w < lineTexts.length; w++) {
      const windowLines = lineTexts.slice(i, i + w + 1);
      const combined = windowLines.join(' ');
      const cleaned = combined
        .replace(/(\d)\s+(\d)/g, '$1$2')
        .replace(/(\d)\s*[-.]\s*([A-Z])/i, '$1-$2')
        .replace(/\s*-\s*/g, '-');

      const mDirect = /\b(\d{2})[-.\s]?(\d{4})[-.\s]?([A-Z]{1,3})\b/i.exec(cleaned);
      if (mDirect) {
        return normalizeSkuOnRegister(`${mDirect[1]}-${mDirect[2]}${mDirect[3]}`);
      }
    }
  }

  return null;
}

/**
 * Extract structured fields from OCR lines using spatial proximity and domain anchors.
 * Enhanced in A3b-precision to tolerate noise, section delimiters, and OCR character errors.
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

  // A3d: When SKU is fragmented across adjacent lines, attempt multi-line reconstruction
  if (!skuVal) {
    skuVal = reconstructMultiLineSku(lines, fullText);
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
      if (/\b(?:MODEL|MODL|MDL)\b/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, /\b(?:MODEL|MODL|MDL)\b[:.\s]*(.*)$/i);
        if (c && !SECTION_HEADER_REGEX.test(c)) {
          modelVal = matchKnownModel(c) ?? c;
          break;
        }
        // Look on the immediately following line
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !SECTION_HEADER_REGEX.test(c2)) {
            modelVal = matchKnownModel(c2) ?? c2;
            break;
          }
        }
      }
    }
    if (modelVal) break;
  }

  if (!modelVal) {
    modelVal = matchKnownModel(fullText);
  }

  // 4. Size
  let sizeVal: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      if (/\b(?:SIZE|SZ|SZE)\b/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, /\b(?:SIZE|SZ|SZE)\b[:.\s]*(.*)$/i);
        if (c && !SECTION_HEADER_REGEX.test(c)) {
          sizeVal = c;
          break;
        }
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !SECTION_HEADER_REGEX.test(c2)) {
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
      if (/(?:\b(?:COLOR|COLOUR|COLR|CLR)\b|FCAOLOR|C[AO]{1,2}LOR)/i.test(ln[j].text)) {
        const c = extractInlineOrFollow(
          ln,
          j,
          /(?:\b(?:COLOR|COLOUR|COLR|CLR)\b|FCAOLOR|C[AO]{1,2}LOR)[:.\s]*(.*)$/i
        );
        if (c && !SECTION_HEADER_REGEX.test(c)) {
          colorVal = matchKnownColor(c) ?? c;
          break;
        }
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !SECTION_HEADER_REGEX.test(c2)) {
            colorVal = matchKnownColor(c2) ?? c2;
            break;
          }
        }
      }
    }
    if (colorVal) break;
  }

  if (!colorVal) {
    colorVal = matchKnownColor(fullText);
  }

  // 6. G.W. (Gross Weight) - STRICTLY EXCLUDE N.W. / NET WEIGHT
  let gwVal: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lnStr = lines[i].map((x) => x.text).join(' ');
    if (/\bG\.?W\.?\b/i.test(lnStr)) {
      // 1) Same line match
      const mGw = /(\d+(?:\.\d+)?)\s*KGS?/i.exec(lnStr);
      if (mGw) {
        gwVal = parseFloat(mGw[1]);
        break;
      }
      // 2) Adjacent lines: search +1, +2, then -1; strictly reject lines marked with N.W. or NET
      for (const off of [1, 2, -1]) {
        if (i + off >= 0 && i + off < lines.length) {
          const candStr = lines[i + off].map((x) => x.text).join(' ');
          if (/\bN\.?W\.?\b/i.test(candStr) || /\bNET\b/i.test(candStr)) {
            continue;
          }
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

  // Fallback for G.W. if not labeled directly, avoiding any N.W. lines
  if (gwVal == null) {
    for (const ln of lines) {
      const lnStr = ln.map((x) => x.text).join(' ');
      if (/\bN\.?W\.?\b/i.test(lnStr) || /\bNET\b/i.test(lnStr)) continue;
      const mAny = /(\d+(?:\.\d+)?)\s*KGS?\b/i.exec(lnStr);
      if (mAny) {
        gwVal = parseFloat(mAny[1]);
        break;
      }
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

export interface RawPaddleItem {
  text?: string;
  box?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  confidence?: number;
}

export interface RawPaddleResult {
  text?: string;
  lines?: RawPaddleItem[][];
}

interface PaddleServiceLike {
  initialize: () => Promise<void>;
  recognize: (canvas: HTMLCanvasElement) => Promise<RawPaddleResult>;
}

export const WASM_PARTS = [
  '/assets/ort-wasm-simd-threaded.jsep.part1.wasm',
  '/assets/ort-wasm-simd-threaded.jsep.part2.wasm',
];

export const WASM_CACHE_NAME = 'pickd-ort-wasm-v1';
export const WASM_CACHE_KEY = '/assets/ort-wasm-simd-threaded.jsep.wasm';

/**
 * Loads the onnxruntime-web WASM binary by fetching split chunks in parallel,
 * reconstructing the contiguous ArrayBuffer, and caching it via Cache API
 * to avoid redundant downloads across app visits.
 */
export async function loadReconstructedWasmBinary(): Promise<ArrayBuffer> {
  // 1. Try Cache API first
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(WASM_CACHE_NAME);
      const cached = await cache.match(WASM_CACHE_KEY);
      if (cached) {
        const buf = await cached.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          return buf;
        }
      }
    } catch (e) {
      console.warn('[clientOcr] Cache API match warning:', e);
    }
  }

  // 2. Fetch all parts in parallel
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const responses = await Promise.all(
    WASM_PARTS.map((part) => fetch(new URL(part, origin || 'http://localhost').href))
  );

  for (const resp of responses) {
    if (!resp.ok) {
      throw new Error(`Failed to fetch WASM chunk ${resp.url}: ${resp.status} ${resp.statusText}`);
    }
  }

  const buffers = await Promise.all(responses.map((resp) => resp.arrayBuffer()));
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    combined.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  const finalBuffer = combined.buffer;

  // 3. Cache reconstructed buffer for future visits
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(WASM_CACHE_NAME);
      await cache.put(
        WASM_CACHE_KEY,
        new Response(finalBuffer.slice(0), {
          headers: {
            'Content-Type': 'application/wasm',
            'Content-Length': String(totalLength),
          },
        })
      );
    } catch (e) {
      console.warn('[clientOcr] Cache API put warning:', e);
    }
  }

  return finalBuffer;
}

// Module-level persistent singleton session (A3b-perf)
let ocrServiceInstance: PaddleServiceLike | null = null;
let ocrServicePromise: Promise<PaddleServiceLike> | null = null;
let isWarmedUp = false;

export function isOcrServiceReady(): boolean {
  return ocrServiceInstance !== null;
}

/**
 * Lazily initialize and return the browser PaddleOCR PP-OCRv6 service singleton.
 * Persists across calls within the page lifetime.
 */
export async function getOcrService(): Promise<PaddleServiceLike> {
  if (ocrServiceInstance) return ocrServiceInstance;
  if (!ocrServicePromise) {
    ocrServicePromise = (async () => {
      try {
        const wasmBinary = await loadReconstructedWasmBinary();
        const ort = await import('onnxruntime-web');
        ort.env.wasm.wasmBinary = wasmBinary;
      } catch (err) {
        console.warn('[clientOcr] Could not pre-load WASM binary chunks:', err);
      }

      const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
      const service = new PaddleOcrService({
        debugging: { debug: false, verbose: false },
      });
      await service.initialize();
      ocrServiceInstance = service;
      return service;
    })().catch((err) => {
      ocrServicePromise = null;
      throw err;
    });
  }
  return ocrServicePromise;
}

/**
 * Proactively warm up the OCR service and ONNX Runtime execution pipeline
 * in the background (called on page mount).
 */
export async function warmupOcrService(): Promise<void> {
  if (isWarmedUp && ocrServiceInstance) return;
  try {
    const service = await getOcrService();
    if (typeof OffscreenCanvas !== 'undefined') {
      const dummyCanvas = new OffscreenCanvas(32, 32);
      const ctx = dummyCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 32, 32);
        await service.recognize(dummyCanvas as unknown as HTMLCanvasElement);
      }
    }
    isWarmedUp = true;
  } catch (err) {
    console.warn('[clientOcr] Warmup warning:', err);
  }
}

/**
 * Evaluates domain anchors for label recognition orientation detection (A3g).
 * Returns the count/weight of recognizable domain anchors present in extracted fields or full text.
 * Anchors checked:
 * - Canonical SKU (3 pts)
 * - UPC or GTIN with verified check digit (3 pts)
 * - Known catalog model or color (1 pt each)
 * - Exact keyword tokens in text: JAMIS, COLOR, UPC, QTY, G.W. (or GW), PORT (1 pt each)
 */
export function countOcrAnchors(extracted: ExtractedOcrFields, fullText: string): number {
  let count = 0;
  if (extracted.sku) count += 3;
  if (extracted.upc || extracted.gtin) count += 3;
  if (extracted.model) count += 1;
  if (extracted.color) count += 1;

  const upper = fullText.toUpperCase();
  if (/\bJAMIS\b/.test(upper)) count += 1;
  if (/\bCOLOR\b/.test(upper)) count += 1;
  if (/\bUPC\b/.test(upper)) count += 1;
  if (/\bQTY\b/.test(upper)) count += 1;
  if (/\b(?:G\.?\s*W\.?|GW)\b|G\.W\./.test(upper)) count += 1;
  if (/\bPORT\b/.test(upper)) count += 1;

  return count;
}

/**
 * Creates an OffscreenCanvas (or HTMLCanvasElement in non-worker DOM) rendered with
 * the requested clockwise rotation (0, 90, or 270 degrees).
 */
export function createRotatedCanvas(
  bitmap: ImageBitmap,
  rotation: 0 | 90 | 270
): OffscreenCanvas | HTMLCanvasElement {
  const isTransposed = rotation === 90 || rotation === 270;
  const w = isTransposed ? bitmap.height : bitmap.width;
  const h = isTransposed ? bitmap.width : bitmap.height;

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else if (typeof document !== 'undefined' && document.createElement) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  } else {
    throw new Error('Canvas not available in this environment');
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  ctx.save();
  if (rotation === 90) {
    ctx.translate(w, 0);
    ctx.rotate((90 * Math.PI) / 180);
  } else if (rotation === 270) {
    ctx.translate(0, h);
    ctx.rotate((270 * Math.PI) / 180);
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return canvas;
}

export interface OcrAttemptLog {
  rotation: number;
  elapsedMs: number;
  anchorsFound: number;
}

export interface ClientOcrResult {
  lines: OcrItem[][];
  fullText: string;
  extracted: ExtractedOcrFields;
  elapsedMs: number;
  rotationUsed?: number;
  attempts?: OcrAttemptLog[];
}

export interface RunClientOcrOptions {
  /** Optional custom pass for testing rotation cascade without browser GPU/WASM */
  recognizePass?: (rotation: 0 | 90 | 270) => Promise<RawPaddleResult>;
}

/**
 * Execute client-side OCR on an image Blob using ppu-paddle-ocr/web.
 *
 * Implements an on-demand rotation cascade (A3g):
 * 1. Runs at 0° (standard upright orientation).
 * 2. If NO recognizable anchors are found, retries rotated 90°.
 * 3. If 90° still has no anchors, retries 270°.
 * 4. Selects the candidate with the highest number of anchors.
 *
 * Fast path: when 0° has anchors, it returns immediately with zero retry overhead (~300-400ms).
 */
export async function runClientOcr(
  image: Blob,
  options?: RunClientOcrOptions
): Promise<ClientOcrResult> {
  const t0 = performance.now();

  let bitmap: ImageBitmap | null = null;
  if (!options?.recognizePass) {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  }

  try {
    const service = options?.recognizePass ? null : await getOcrService();

    const executePass = async (rotation: 0 | 90 | 270) => {
      const tPass0 = performance.now();
      let rawResult: RawPaddleResult;

      if (options?.recognizePass) {
        rawResult = await options.recognizePass(rotation);
      } else {
        if (!bitmap || !service) throw new Error('OCR service or bitmap unavailable');
        const canvas = createRotatedCanvas(bitmap, rotation);
        rawResult = await service.recognize(canvas as unknown as HTMLCanvasElement);
      }

      const allItems: OcrItem[] = [];
      if (rawResult.lines) {
        for (const ln of rawResult.lines) {
          for (const item of ln) {
            allItems.push({
              text: item.text ?? '',
              box: {
                x: item.box?.x ?? 0,
                y: item.box?.y ?? 0,
                width: item.box?.width ?? 0,
                height: item.box?.height ?? 0,
              },
              confidence: item.confidence ?? 0,
            });
          }
        }
      }

      const lines = groupLinesBySpatialProximity(allItems);
      const fullText =
        rawResult.text || lines.map((l) => l.map((i) => i.text).join(' ')).join('\n');
      const extracted = extractFieldsFromOcrLines(lines);
      const anchorsFound = countOcrAnchors(extracted, fullText);
      const elapsedMs = performance.now() - tPass0;

      return {
        rotation,
        lines,
        fullText,
        extracted,
        anchorsFound,
        elapsedMs,
      };
    };

    const attempts: OcrAttemptLog[] = [];
    const candidates: Array<Awaited<ReturnType<typeof executePass>>> = [];

    // 1. Always run 0 degrees first
    const pass0 = await executePass(0);
    attempts.push({ rotation: 0, elapsedMs: pass0.elapsedMs, anchorsFound: pass0.anchorsFound });
    candidates.push(pass0);

    // Fast-path: if recognizable anchors are found at 0°, return immediately without retries
    if (pass0.anchorsFound > 0) {
      return {
        lines: pass0.lines,
        fullText: pass0.fullText,
        extracted: pass0.extracted,
        elapsedMs: performance.now() - t0,
        rotationUsed: 0,
        attempts,
      };
    }

    // 2. Cascade retry: try 90 degrees
    const pass90 = await executePass(90);
    attempts.push({ rotation: 90, elapsedMs: pass90.elapsedMs, anchorsFound: pass90.anchorsFound });
    candidates.push(pass90);

    // 3. If 90 degrees still has NO anchors, try 270 degrees
    if (pass90.anchorsFound === 0) {
      const pass270 = await executePass(270);
      attempts.push({
        rotation: 270,
        elapsedMs: pass270.elapsedMs,
        anchorsFound: pass270.anchorsFound,
      });
      candidates.push(pass270);
    }

    // Pick candidate with the highest number of anchors
    let best = candidates[0];
    for (const c of candidates) {
      if (c.anchorsFound > best.anchorsFound) {
        best = c;
      }
    }

    return {
      lines: best.lines,
      fullText: best.fullText,
      extracted: best.extracted,
      elapsedMs: performance.now() - t0,
      rotationUsed: best.rotation,
      attempts,
    };
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
}
