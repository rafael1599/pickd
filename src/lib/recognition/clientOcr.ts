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
 * Merges two vertically aligned character fragments from horizontally split digit bounding boxes.
 * For example, top loop '6' over vertical bar '1' forms '8'.
 * Top curve 'C' over bottom curve '9' forms '9'.
 */
export function mergeSlicePair(top: string, bottom: string): string | null {
  const t = top.toUpperCase();
  const b = bottom.toUpperCase();
  // 6 or o or 0 or C over 1 or I or L or 0 -> 8
  if (
    (t === '6' || t === 'O' || t === '0' || t === 'C') &&
    (b === '1' || b === 'I' || b === 'L' || b === 'O' || b === '0')
  ) {
    return '8';
  }
  // C or o or 0 over 9 -> 9
  if ((t === 'C' || t === 'O' || t === '0' || t === '(') && (b === '9' || b === 'P' || b === '7')) {
    return '9';
  }
  // 1 over 1 -> 1
  if ((t === '1' || t === 'I') && (b === '1' || b === 'I')) {
    return '1';
  }
  // 7 over 1 -> 7
  if (t === '7' && (b === '1' || b === 'I')) {
    return '7';
  }
  // Exact digit match or single digit with noise
  if (/^\d$/.test(t) && !/^\d$/.test(b)) return t;
  if (/^\d$/.test(b) && !/^\d$/.test(t)) return b;
  if (/^\d$/.test(t) && /^\d$/.test(b) && t === b) return t;
  return null;
}

/**
 * Multi-line SKU reconstruction (A3d).
 *
 * When OCR breaks a SKU across multiple vertically adjacent lines (e.g. the black box on
 * Jamis cartons where detector horizontally splits digits into top/bottom halves, or
 * separates department prefix, digits, and color suffix into separate lines), this function
 * stitches them together following strict canonical pattern DD-NNNN[CCC].
 *
 * Strict constraint: Never invent a digit. The concatenated/merged candidate must match
 * the canonical SKU pattern.
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

    const dept = mDept[1];
    const rest1 = mDept[2].trim();

    // 1. Direct concatenation of consecutive lines (window up to 3 lines)
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

    // 2. Horizontally sliced / fragmented OCR line reconstruction
    // e.g. Line i: '03-396 C', Line i+1: '1 9.', Line i+2: '-GY'
    if (i + 1 < lineTexts.length) {
      const l2 = lineTexts[i + 1];

      const mRestDigits = /^(\d{1,4})(.*)$/.exec(rest1);
      if (mRestDigits) {
        const fullDigitsLead = mRestDigits[1];
        const afterLead = mRestDigits[2].trim();

        if (fullDigitsLead.length >= 2) {
          const base2 = fullDigitsLead.slice(0, 2);
          const rem1 = fullDigitsLead.slice(2) + (afterLead ? ' ' + afterLead : '');
          const topTokens = rem1.split(/\s+/).filter(Boolean);
          const bottomTokens = l2
            .replace(/[^\w\s]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);

          if (topTokens.length >= 2 && bottomTokens.length >= 2) {
            const d1 = mergeSlicePair(topTokens[0], bottomTokens[0]);
            const d2 = mergeSlicePair(topTokens[1], bottomTokens[1]);

            if (d1 && d2) {
              const fourDigits = `${base2}${d1}${d2}`;
              let suffix: string | null = null;
              const mSuffixL2 = /[-.\s]?([A-Z]{1,3})\b/i.exec(l2.replace(/[\d.\s]/g, ''));
              if (mSuffixL2 && mSuffixL2[1]) {
                suffix = mSuffixL2[1].toUpperCase();
              } else if (i + 2 < lineTexts.length) {
                const l3 = lineTexts[i + 2];
                const mSuffixL3 = /[-.\s]?([A-Z]{1,3})\b/i.exec(l3);
                if (mSuffixL3 && mSuffixL3[1]) {
                  suffix = mSuffixL3[1].toUpperCase();
                }
              }

              if (fourDigits.length === 4) {
                const candidate = `${dept}-${fourDigits}${suffix ?? ''}`;
                return normalizeSkuOnRegister(candidate);
              }
            }
          }
        }
      }
    }

    // 3. Fallback: Digit tokens combination across adjacent lines with OCR confusion tolerance (6 <-> 8)
    if (i + 1 < lineTexts.length) {
      const combinedTokensText = lineTexts.slice(i, Math.min(lineTexts.length, i + 3)).join(' ');
      const mNear = /\b(\d{2})[-.\s]+(?:[^\n]*?)(\d{2})([68])([0-9])\s*[-.\s]?([A-Z]{1,3})\b/i.exec(
        combinedTokensText
      );
      if (mNear) {
        const dDept = mNear[1];
        const prefix2 = mNear[2];
        const d3 = mNear[3] === '6' ? '8' : mNear[3];
        const d4 = mNear[4];
        const color = mNear[5].toUpperCase();
        return normalizeSkuOnRegister(`${dDept}-${prefix2}${d3}${d4}${color}`);
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
 * Execute client-side OCR on an image Blob using ppu-paddle-ocr/web.
 * Returns spatially grouped lines and structured extracted fields.
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

  // Flatten raw detection boxes and apply B3's geometric spatial clustering
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
