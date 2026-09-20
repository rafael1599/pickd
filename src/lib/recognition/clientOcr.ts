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
  upcConflict?: { direct: string; fromGtin: string } | null;
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
  /\b(?:MODEL|MODL|MDL|SIZE|SZ|SZE|SHZE|S1ZE|COLOR|COLOUR|COLR|CLR|FCAOLOR|C[AO]{1,2}LOR|Q'?TY|QUANTITY|PCS|G\.?W\.?|N\.?W\.?|M\.?W\.?|GROSS|NET|ITEM|RTEM|C\/NO|SERIAL|FRAME|P\.?O\.?)\b/i;

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
 * Groups OCR bounding boxes into horizontal lines based on vertical overlap and proximity.
 * Prevents vertical cluster growth (avalanche effect) by measuring deviation against
 * individual line item averages rather than cumulative cluster bounds.
 */
export function groupLinesBySpatialProximity(items: OcrItem[]): OcrItem[][] {
  if (items.length === 0) return [];

  const valid = items.filter((it) => it.text.trim().length > 0 && it.box.height > 0);
  if (valid.length === 0) return [];

  // Sort by Y first, then X
  const sorted = [...valid].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  interface LineGroup {
    items: OcrItem[];
    avgY: number;
    avgHeight: number;
    minY: number;
    maxY: number;
  }

  const lines: LineGroup[] = [];

  for (const item of sorted) {
    const itemH = item.box.height;
    const itemCy = item.box.y + itemH / 2;
    const itemY0 = item.box.y;
    const itemY1 = item.box.y + itemH;

    let bestLine: LineGroup | null = null;
    let minDiff = Infinity;

    for (const ln of lines) {
      const yDiff = Math.abs(itemCy - ln.avgY);
      const allowedDiff = ln.avgHeight * 0.5;

      // Vertical overlap between item and current line extent
      const overlap = Math.max(0, Math.min(itemY1, ln.maxY) - Math.max(itemY0, ln.minY));
      const minOverlapRequired = Math.min(itemH, ln.avgHeight) * 0.35;

      if (yDiff <= allowedDiff || overlap >= minOverlapRequired) {
        if (yDiff < minDiff) {
          minDiff = yDiff;
          bestLine = ln;
        }
      }
    }

    if (bestLine) {
      bestLine.items.push(item);
      const n = bestLine.items.length;
      bestLine.avgY = (bestLine.avgY * (n - 1) + itemCy) / n;
      bestLine.avgHeight = (bestLine.avgHeight * (n - 1) + itemH) / n;
      bestLine.minY = Math.min(bestLine.minY, itemY0);
      bestLine.maxY = Math.max(bestLine.maxY, itemY1);
    } else {
      lines.push({
        items: [item],
        avgY: itemCy,
        avgHeight: itemH,
        minY: itemY0,
        maxY: itemY1,
      });
    }
  }

  // Sort lines from top to bottom by their vertical center
  lines.sort((a, b) => a.avgY - b.avgY);

  // Sort items within each line strictly left to right
  return lines.map((ln) => ln.items.sort((a, b) => a.box.x - b.box.x));
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
 * Normalizes OCR digit characters in a string, mapping common OCR confusions:
 * B -> 8, C/D/O/Q -> 0, I/L/| -> 1, Z -> 2, S -> 5, G -> 6.
 */
export function normalizeOcrDigits(str: string): string {
  return str
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .replace(/[OQDC]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/B/g, '8');
}

/**
 * Validates whether a candidate string can represent a UPC or GTIN (BUG B).
 * Requirements:
 * 1. Must EXCLUDE canonical SKU pattern (^\d{2}-?\d{4}[A-Z]{0,2}$).
 * 2. Must require 12 digits (UPC-A) or 13/14 digits (EAN-13 / GTIN-14) after normalization.
 */
export function isValidUpcCandidate(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  // Exclude canonical bike SKU pattern (e.g. 07-3743-PK, 07-3743PK, 03-3989GY)
  if (/^\d{2}-?\d{4}[A-Z]{0,2}$/i.test(trimmed.replace(/\s+/g, ''))) {
    return false;
  }
  const normalized = normalizeOcrDigits(trimmed);
  return /^\d{12}$/.test(normalized) || /^\d{13,14}$/.test(normalized);
}

/**
 * Detects if a text string or line corresponds to Net Weight (N.W. / N. W. / M.W. / M. W. / NET WEIGHT).
 * Strict Rule 4.2 / R5: Any candidate originating from a line with N.W., M.W. or NET is strictly rejected.
 */
export function isNetWeightLine(text: string): boolean {
  return (
    /\b(?:[NM]\s*\.?\s*W|NET(?:\s*WT|\s*WEIGHT)?)\b/i.test(text) ||
    /\b(?:N\.W|M\.W|N\. W|M\. W)\b/i.test(text) ||
    /\b(?:N|M)\s*\.?\s*W\s*[:.]?/i.test(text)
  );
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
 * Parses and validates size candidates from carton labels.
 * Tolerates noisy anchors (SIZE, SHZE, S1ZE) and recognizes inch patterns (e.g. 17", 8" * 16").
 * Returns null if the value cannot be cleanly isolated without inventing.
 */
export function parseSizeCandidate(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = cleanVal(trimmed) ?? trimmed;
  const withoutAnchor = cleaned.replace(/^(?:SIZE|SZ|SZE|SHZE|S1ZE)[:.\s-]*/i, '').trim();
  const target = withoutAnchor || cleaned;
  if (SECTION_HEADER_REGEX.test(target)) return null;

  // 1. Dual dimension in inches: e.g. '8" * 16"', '8" x 16"'
  const mDual = /^(\d+(?:\.\d+)?"\s*[*x×]\s*\d+(?:\.\d+)?")$/i.exec(target);
  if (mDual) {
    return cleanVal(mDual[1].replace(/\s+/g, ' '));
  }

  // 2. Standard wheel + frame size combinations:
  // e.g. '700C x 54cm', '700C x 54 cm', '700Cx16"', '700C × 58cm'
  const mWheelFrame = /^(700C\s*[×xX]\s*\d+\s*(?:cm|"|mm)|700C[xX]\d+"?)$/i.exec(target);
  if (mWheelFrame) {
    return cleanVal(mWheelFrame[1].replace(/\s+/g, ' '));
  }

  // 3. Wheel size (700C or noisy 700G/7006) followed by frame size in inches: e.g. '700G 17"'
  const mWheelInch = /\b700[CG0-9]?\s*[:.\s-]*\b(\d{1,2}(?:\.\d+)?")(?!\w)/i.exec(target);
  if (mWheelInch) {
    return mWheelInch[1];
  }

  // 4. Standalone inches with optional whitespace: e.g. '17"', '16.5"'
  const mInchExact = /^\s*(\d{1,2}(?:\.\d+)?")(?!\w)\s*$/i.exec(target);
  if (mInchExact) {
    return mInchExact[1];
  }

  // 5. Inches pattern found anywhere as an isolated token: e.g. 'SHZE: ... 17"'
  const mAnyInch = /\b(\d{1,2}(?:\.\d+)?")(?!\w)/i.exec(target);
  if (mAnyInch) {
    return mAnyInch[1];
  }

  // 6. Centimeter frame size: e.g. '54cm', '54 cm'
  const mCm = /^\s*(\d{1,2}(?:\.\d+)?\s*cm)\b/i.exec(target);
  if (mCm) {
    return cleanVal(mCm[1]);
  }

  // 7. Standalone 2-digit frame size number without quotes: e.g. '16', '54'
  const mNum = /^\s*(\d{1,2})\s*$/i.exec(target);
  if (mNum) {
    return mNum[1];
  }

  // 8. Standard alpha frame sizes:
  if (/^(?:XXS|XS|S|M|L|XL|XXL|SM|MD|LG)$/i.test(target)) {
    return target.toUpperCase();
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

  // 2. UPC / GTIN with mod-10 check digit & conflict arbiter (R10 Section 4 Case B, BUG B)
  let directUpcRaw: string | null = null;
  let gtinVal: string | null = null;

  const findUpcCandidate = (text: string): string | null => {
    const tokens = text.match(/[A-Za-z0-9-]{10,16}/g) || [];
    for (const tok of tokens) {
      if (isValidUpcCandidate(tok)) {
        return tok;
      }
    }
    return null;
  };

  // Check lines for explicit UPC or GTIN labels
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      const txt = ln[j].text;
      if (/\bUPC\b/i.test(txt) && !directUpcRaw) {
        const c = extractInlineOrFollow(ln, j, /\bUPC\b[:.\s]*(.*)$/i);
        if (c && !SECTION_HEADER_REGEX.test(c)) {
          const cand = findUpcCandidate(c);
          if (cand) directUpcRaw = cand;
        }
        if (!directUpcRaw && i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          if (c2 && !SECTION_HEADER_REGEX.test(c2)) {
            const cand2 = findUpcCandidate(c2);
            if (cand2) directUpcRaw = cand2;
          }
        }
      }
      if (/\bGTIN\b/i.test(txt) && !gtinVal) {
        const c = extractInlineOrFollow(ln, j, /\bGTIN\b[:.\s]*(.*)$/i);
        if (c && !SECTION_HEADER_REGEX.test(c)) {
          const m14 = /\b(\d{14})\b/.exec(c);
          if (m14) gtinVal = m14[1];
        } else if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const m14 = /\b(\d{14})\b/.exec(nextText);
          if (m14) gtinVal = m14[1];
        }
      }
    }
  }

  // Scan full text for 12-14 digit sequences
  const digitsMatches = fullText.match(/\b\d{12,14}\b/g) || [];
  for (const d of digitsMatches) {
    if (d.length === 12 && !directUpcRaw && gtinCheckDigitOk(d) && isValidUpcCandidate(d)) {
      directUpcRaw = d;
    } else if (d.length === 14 && !gtinVal && gtinCheckDigitOk(d)) {
      gtinVal = d;
    }
  }

  // Derive UPC from GTIN if present (14 digits starting with 00 or last 12 digits)
  let gtinDerivedUpc: string | null = null;
  if (gtinVal) {
    if (gtinVal.startsWith('00') && gtinCheckDigitOk(gtinVal.slice(2))) {
      gtinDerivedUpc = gtinVal.slice(2);
    } else if (gtinVal.length === 14 && gtinCheckDigitOk(gtinVal.slice(-12))) {
      gtinDerivedUpc = gtinVal.slice(-12);
    }
  }

  let upcVal: string | null = null;
  let upcConflict: { direct: string; fromGtin: string } | null = null;

  if (directUpcRaw && gtinDerivedUpc) {
    const directDigits = normalizeOcrDigits(directUpcRaw);
    if (directDigits === gtinDerivedUpc) {
      upcVal = gtinDerivedUpc;
    } else {
      // Discrepancy! Under R10 Section 4 Case B, never silently resolve by checksum alone.
      upcConflict = { direct: directUpcRaw, fromGtin: gtinDerivedUpc };
      upcVal = `CONFLICTO: UPC directo (${directUpcRaw}) ≠ GTIN (${gtinDerivedUpc})`;
    }
  } else if (gtinDerivedUpc) {
    upcVal = gtinDerivedUpc;
  } else if (directUpcRaw) {
    const directDigits = normalizeOcrDigits(directUpcRaw);
    upcVal = /^\d{12}$/.test(directDigits) ? directDigits : directUpcRaw;
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

  // 4. Size (tolerates noisy anchors SIZE, SHZE, S1ZE and isolates clean inch or metric dimensions)
  let sizeVal: string | null = null;
  const SIZE_ANCHOR_REGEX = /\b(?:SIZE|SZ|SZE|SHZE|S1ZE)\b/i;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (let j = 0; j < ln.length; j++) {
      if (SIZE_ANCHOR_REGEX.test(ln[j].text)) {
        const c = extractInlineOrFollow(ln, j, /(?:\b(?:SIZE|SZ|SZE|SHZE|S1ZE)\b)[:.\s]*(.*)$/i);
        const parsed = parseSizeCandidate(c);
        if (parsed) {
          sizeVal = parsed;
          break;
        }
        if (i + 1 < lines.length) {
          const nextText = lines[i + 1].map((x) => x.text).join(' ');
          const c2 = cleanVal(nextText);
          const parsed2 = parseSizeCandidate(c2);
          if (parsed2) {
            sizeVal = parsed2;
            break;
          }
        }
      }
    }
    if (sizeVal) break;
  }

  if (!sizeVal) {
    const mSz =
      /\b(700C\s*[×xX]\s*\d+\s*(?:cm|")|700Cx\d+"?|8"[×*x]\s*16"?|\d+\s*cm|\d+")(?!\w)/i.exec(
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

  // 6. G.W. (Gross Weight) - STRICTLY EXCLUDE N.W. / M.W. / NET WEIGHT (Rule 4.2 / R5, BUG A)
  // Priority 1: NUNCA tomar como G.W. un valor cuya línea de origen contenga N.W. / N. W. / M.W. / M. W. / NET.
  //             Si el único candidato viene de una línea N.W./M.W., el resultado es gw_kg = null.
  // Priority 2: Tolerar ruido del ancla en la MISMA línea: reconocer 'G.W.' o 'G.W:' sin punto final,
  //             seguido de separador ruidoso (':', '1', '.', espacio) y unidad ruidosa ('KG','KO','KQ','K0','Kn').
  //             Pero NO recortar dígitos para forzar un número: de 'G.W.113 KO' NO se debe
  //             deducir 13 quitando un '1'. Si el número no se puede aislar sin transformar
  //             caracteres, gw_kg = null.
  let gwVal: number | null = null;
  const GW_ANCHOR_REGEX = /(?:\b(?:G\s*\.?\s*W|GROSS(?:\s*WT|\s*WEIGHT)?)\b[:.]?|G\.W\.?[:.]?)/i;

  for (let i = 0; i < lines.length; i++) {
    const lnStr = lines[i].map((x) => x.text).join(' ');
    // If the line containing G.W. is actually an N.W./M.W. line without G.W. anchor, skip
    if (isNetWeightLine(lnStr) && !GW_ANCHOR_REGEX.test(lnStr)) {
      continue;
    }
    const mAnchor = GW_ANCHOR_REGEX.exec(lnStr);
    if (mAnchor) {
      const after = lnStr.slice(mAnchor.index + mAnchor[0].length);
      // If the line also has an N.W. / M.W. segment (e.g. tabular 'G.W.: 7 KGS N.W.: 5 KGS'), cut off before it
      const mNet = /\b(?:[NM]\s*\.?\s*W|NET(?:\s*WT|\s*WEIGHT)?)\b/i.exec(after);
      const gwSegment = mNet ? after.slice(0, mNet.index) : after;

      // Match isolated 1-2 digit number (plausible carton weight < 100 kg) with noisy separator and unit (including Kn).
      // Strictly does NOT match 3+ digits like '113 KO' (never trims digits).
      const mWeight = /(?:^|[:.\s-])(?:1\s+)?\b(\d{1,2}(?:\.\d+)?)\s*(?:KGS?|KO|KQ|K0|KN)\b/i.exec(
        gwSegment
      );
      if (mWeight) {
        gwVal = parseFloat(mWeight[1]);
        break;
      }

      // 2) Subsequent lines: check +1, +2 (forward only, NEVER previous line -1)
      // Strictly reject any line marked with N.W. / N. W. / M.W. / M. W. / NET
      for (const off of [1, 2]) {
        if (i + off < lines.length) {
          const candStr = lines[i + off].map((x) => x.text).join(' ');
          if (isNetWeightLine(candStr)) {
            continue;
          }
          const mFollow = /^\s*[:.\s-]*\b(\d{1,2}(?:\.\d+)?)\s*(?:KGS?|KO|KQ|K0|KN)\b/i.exec(
            candStr
          );
          if (mFollow) {
            gwVal = parseFloat(mFollow[1]);
            break;
          }
        }
      }
      if (gwVal != null) break;
    }
  }

  // Fallback for G.W. if not labeled directly, ONLY if line is NOT an N.W./M.W. line
  // and has a plausible 1-2 digit carton weight with explicit KG/KN unit.
  if (gwVal == null) {
    for (const ln of lines) {
      const lnStr = ln.map((x) => x.text).join(' ');
      if (isNetWeightLine(lnStr)) continue;
      // Must not match if line is clearly some other known section header
      if (SECTION_HEADER_REGEX.test(lnStr) && !GW_ANCHOR_REGEX.test(lnStr)) continue;
      const mAny = /\b(\d{1,2}(?:\.\d+)?)\s*(?:KGS?|KN)\b/i.exec(lnStr);
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
    upcConflict,
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

export interface WasmLoadProfile {
  wasmFetchOrReadMs: number;
  wasmSource: 'cache' | 'network';
  wasmReassembleMs: number;
}

export const OCR_MODEL_ASSETS = {
  detection: '/models/PP-OCRv6_tiny_det.ort',
  recognition: '/models/PP-OCRv6_tiny_rec.ort',
  charactersDictionary: '/models/ppocrv6_tiny_dict.txt',
} as const;

export const OCR_MODELS_CACHE_NAME = 'pickd-ocr-models-v1';

export interface OcrModelsLoadProfile {
  modelsFetchOrReadMs: number;
  modelsSource: 'cache' | 'network';
}

export interface OcrModelBuffers {
  detection: ArrayBuffer;
  recognition: ArrayBuffer;
  charactersDictionary: ArrayBuffer;
}

export interface OcrServiceInitProfile {
  totalInitMs: number;
  wasmFetchOrReadMs: number;
  wasmSource: 'cache' | 'network';
  wasmReassembleMs: number;
  ortInitMs: number;
  modelsLoadMs: number;
  modelsSource?: 'cache' | 'network';
}

let lastWasmLoadProfile: WasmLoadProfile | null = null;
let lastModelsLoadProfile: OcrModelsLoadProfile | null = null;
let lastOcrInitProfile: OcrServiceInitProfile | null = null;

export function getLastWasmLoadProfile(): WasmLoadProfile | null {
  return lastWasmLoadProfile;
}

export function getLastModelsLoadProfile(): OcrModelsLoadProfile | null {
  return lastModelsLoadProfile;
}

export function getLastOcrInitProfile(): OcrServiceInitProfile | null {
  return lastOcrInitProfile;
}

async function loadSingleModelBuffer(
  cache: Cache | null,
  path: string
): Promise<{ buffer: ArrayBuffer; source: 'cache' | 'network' }> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = new URL(path, origin || 'http://localhost').href;

  if (cache) {
    try {
      const cached = await cache.match(path);
      if (cached) {
        const buf = await cached.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          return { buffer: buf, source: 'cache' };
        }
      }
    } catch (e) {
      console.warn(`[clientOcr] Cache match warning for ${path}:`, e);
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch OCR model ${url}: ${resp.status} ${resp.statusText}`);
  }
  const buf = await resp.arrayBuffer();

  if (cache) {
    try {
      await cache.put(
        path,
        new Response(buf.slice(0), {
          headers: {
            'Content-Type': path.endsWith('.txt') ? 'text/plain' : 'application/octet-stream',
            'Content-Length': String(buf.byteLength),
          },
        })
      );
    } catch (e) {
      console.warn(`[clientOcr] Cache put warning for ${path}:`, e);
    }
  }

  return { buffer: buf, source: 'network' };
}

/**
 * Loads PP-OCRv6 model binaries and character dictionary from self-hosted assets
 * on the PickD Cloudflare Pages origin with persistent Cache API caching.
 * Eliminates external third-party dependencies (huggingface.co).
 */
export async function loadOcrModelBuffers(): Promise<{
  buffers: OcrModelBuffers;
  profile: OcrModelsLoadProfile;
}> {
  const t0 = performance.now();
  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(OCR_MODELS_CACHE_NAME);
    } catch (e) {
      console.warn('[clientOcr] Cache open warning for OCR models:', e);
    }
  }

  const [det, rec, dict] = await Promise.all([
    loadSingleModelBuffer(cache, OCR_MODEL_ASSETS.detection),
    loadSingleModelBuffer(cache, OCR_MODEL_ASSETS.recognition),
    loadSingleModelBuffer(cache, OCR_MODEL_ASSETS.charactersDictionary),
  ]);

  const modelsFetchOrReadMs = performance.now() - t0;
  const modelsSource: 'cache' | 'network' =
    det.source === 'cache' && rec.source === 'cache' && dict.source === 'cache'
      ? 'cache'
      : 'network';

  const profile: OcrModelsLoadProfile = {
    modelsFetchOrReadMs,
    modelsSource,
  };
  lastModelsLoadProfile = profile;

  return {
    buffers: {
      detection: det.buffer,
      recognition: rec.buffer,
      charactersDictionary: dict.buffer,
    },
    profile,
  };
}

/**
 * Loads the onnxruntime-web WASM binary by fetching split chunks in parallel,
 * reconstructing the contiguous ArrayBuffer, and caching it via Cache API
 * to avoid redundant downloads across app visits.
 */
export async function loadReconstructedWasmBinary(): Promise<ArrayBuffer> {
  // 1. Try Cache API first
  if (typeof caches !== 'undefined') {
    try {
      const tCache0 = performance.now();
      const cache = await caches.open(WASM_CACHE_NAME);
      const cached = await cache.match(WASM_CACHE_KEY);
      if (cached) {
        const buf = await cached.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          lastWasmLoadProfile = {
            wasmFetchOrReadMs: performance.now() - tCache0,
            wasmSource: 'cache',
            wasmReassembleMs: 0,
          };
          return buf;
        }
      }
    } catch (e) {
      console.warn('[clientOcr] Cache API match warning:', e);
    }
  }

  // 2. Fetch all parts in parallel
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const tFetch0 = performance.now();
  const responses = await Promise.all(
    WASM_PARTS.map((part) => fetch(new URL(part, origin || 'http://localhost').href))
  );

  for (const resp of responses) {
    if (!resp.ok) {
      throw new Error(`Failed to fetch WASM chunk ${resp.url}: ${resp.status} ${resp.statusText}`);
    }
  }
  const wasmFetchOrReadMs = performance.now() - tFetch0;

  const tReassemble0 = performance.now();
  const buffers = await Promise.all(responses.map((resp) => resp.arrayBuffer()));
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    combined.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  const finalBuffer = combined.buffer;
  const wasmReassembleMs = performance.now() - tReassemble0;

  lastWasmLoadProfile = {
    wasmFetchOrReadMs,
    wasmSource: 'network',
    wasmReassembleMs,
  };

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
      const tInit0 = performance.now();
      let wasmFetchOrReadMs = 0;
      let wasmSource: 'cache' | 'network' = 'network';
      let wasmReassembleMs = 0;
      let ortInitMs = 0;

      try {
        const wasmBinary = await loadReconstructedWasmBinary();
        if (lastWasmLoadProfile) {
          wasmFetchOrReadMs = lastWasmLoadProfile.wasmFetchOrReadMs;
          wasmSource = lastWasmLoadProfile.wasmSource;
          wasmReassembleMs = lastWasmLoadProfile.wasmReassembleMs;
        }
        const tOrt0 = performance.now();
        const ort = await import('onnxruntime-web');
        ort.env.wasm.wasmBinary = wasmBinary;
        ortInitMs = performance.now() - tOrt0;
      } catch (err) {
        console.warn('[clientOcr] Could not pre-load WASM binary chunks:', err);
      }

      const tModel0 = performance.now();
      const modelRes = await loadOcrModelBuffers();
      const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
      const service = new PaddleOcrService({
        model: {
          detection: modelRes.buffers.detection,
          recognition: modelRes.buffers.recognition,
          charactersDictionary: modelRes.buffers.charactersDictionary,
        },
        debugging: { debug: false, verbose: false },
      });
      await service.initialize();
      const modelsLoadMs = performance.now() - tModel0;

      const totalInitMs = performance.now() - tInit0;
      lastOcrInitProfile = {
        totalInitMs,
        wasmFetchOrReadMs,
        wasmSource,
        wasmReassembleMs,
        ortInitMs,
        modelsLoadMs,
        modelsSource: modelRes.profile.modelsSource,
      };

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
    let dummyCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      dummyCanvas = new OffscreenCanvas(32, 32);
    } else if (typeof document !== 'undefined' && document.createElement) {
      dummyCanvas = document.createElement('canvas');
      dummyCanvas.width = 32;
      dummyCanvas.height = 32;
    }
    if (dummyCanvas) {
      const ctx = dummyCanvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
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
  if (extracted.upc) {
    if (extracted.upcConflict || extracted.upc.startsWith('CONFLICTO')) {
      count += 2; // Conflict still provides strong orientation signal
    } else {
      count += 3;
    }
  } else if (extracted.gtin) {
    count += 3;
  }
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

/**
 * Maps a bounding box from unrotated image coordinates to rotated canvas coordinates.
 */
export function mapBoxToRotation(
  box: OcrBox,
  rotation: 0 | 90 | 270,
  imageWidth: number,
  imageHeight: number
): OcrBox {
  if (rotation === 90) {
    return {
      x: imageHeight - (box.y + box.height),
      y: box.x,
      width: box.height,
      height: box.width,
    };
  }
  if (rotation === 270) {
    return {
      x: box.y,
      y: imageWidth - (box.x + box.width),
      width: box.height,
      height: box.width,
    };
  }
  return { ...box };
}

export interface OcrAttemptLog {
  rotation: number;
  elapsedMs: number;
  anchorsFound: number;
  canvasPrepMs?: number;
  recognizeMs?: number;
  groupingMs?: number;
  extractionMs?: number;
}

export interface ClientOcrResult {
  lines: OcrItem[][];
  fullText: string;
  extracted: ExtractedOcrFields;
  elapsedMs: number;
  rotationUsed?: number;
  attempts?: OcrAttemptLog[];
  imageDimensions?: {
    width: number;
    height: number;
  };
  profile?: {
    imageDecodeMs: number;
    serviceInitMs: number;
    serviceInitDetails?: OcrServiceInitProfile;
  };
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
 * 3. If 90° produces anchors, cuts cascade early (never runs 270°).
 * 4. Only if 90° also has 0 anchors, retries 270°.
 *
 * Fast path: when 0° has anchors, it returns immediately with zero retry overhead (~300-400ms).
 */
export async function runClientOcr(
  image: Blob,
  options?: RunClientOcrOptions
): Promise<ClientOcrResult> {
  const t0 = performance.now();

  let bitmap: ImageBitmap | null = null;
  let imageDecodeMs = 0;
  let imageDimensions: { width: number; height: number } | undefined = undefined;
  if (!options?.recognizePass) {
    const tDecode0 = performance.now();
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
    imageDecodeMs = performance.now() - tDecode0;
    imageDimensions = { width: bitmap.width, height: bitmap.height };
  }

  let serviceInitMs = 0;
  try {
    const tService0 = performance.now();
    const service = options?.recognizePass ? null : await getOcrService();
    serviceInitMs = performance.now() - tService0;

    const executePass = async (rotation: 0 | 90 | 270) => {
      const tPass0 = performance.now();
      let rawResult: RawPaddleResult;
      let canvasPrepMs = 0;
      let recognizeMs = 0;

      if (options?.recognizePass) {
        const tRec0 = performance.now();
        rawResult = await options.recognizePass(rotation);
        recognizeMs = performance.now() - tRec0;
      } else {
        if (!bitmap || !service) throw new Error('OCR service or bitmap unavailable');
        const tCanvas0 = performance.now();
        const canvas = createRotatedCanvas(bitmap, rotation);
        canvasPrepMs = performance.now() - tCanvas0;

        const tRec0 = performance.now();
        rawResult = await service.recognize(canvas as unknown as HTMLCanvasElement);
        recognizeMs = performance.now() - tRec0;
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

      // Reorder items by Y coordinate before spatial line grouping (BUG 1)
      allItems.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

      const tGroup0 = performance.now();
      const lines = groupLinesBySpatialProximity(allItems);
      const groupingMs = performance.now() - tGroup0;

      const tExtract0 = performance.now();
      const fullText =
        rawResult.text || lines.map((l) => l.map((i) => i.text).join(' ')).join('\n');
      const extracted = extractFieldsFromOcrLines(lines);
      const extractionMs = performance.now() - tExtract0;

      const anchorsFound = countOcrAnchors(extracted, fullText);
      const elapsedMs = performance.now() - tPass0;

      return {
        rotation,
        lines,
        fullText,
        extracted,
        anchorsFound,
        elapsedMs,
        canvasPrepMs,
        recognizeMs,
        groupingMs,
        extractionMs,
      };
    };

    const attempts: OcrAttemptLog[] = [];

    // 1. Always run 0 degrees first
    const pass0 = await executePass(0);
    attempts.push({
      rotation: 0,
      elapsedMs: pass0.elapsedMs,
      anchorsFound: pass0.anchorsFound,
      canvasPrepMs: pass0.canvasPrepMs,
      recognizeMs: pass0.recognizeMs,
      groupingMs: pass0.groupingMs,
      extractionMs: pass0.extractionMs,
    });

    // Fast-path: if recognizable anchors are found at 0°, return immediately without retries
    if (pass0.anchorsFound > 0) {
      return {
        lines: pass0.lines,
        fullText: pass0.fullText,
        extracted: pass0.extracted,
        elapsedMs: performance.now() - t0,
        rotationUsed: 0,
        attempts,
        imageDimensions,
        profile: {
          imageDecodeMs,
          serviceInitMs,
          serviceInitDetails: lastOcrInitProfile ?? undefined,
        },
      };
    }

    // 2. Cascade retry: try 90 degrees
    const pass90 = await executePass(90);
    attempts.push({
      rotation: 90,
      elapsedMs: pass90.elapsedMs,
      anchorsFound: pass90.anchorsFound,
      canvasPrepMs: pass90.canvasPrepMs,
      recognizeMs: pass90.recognizeMs,
      groupingMs: pass90.groupingMs,
      extractionMs: pass90.extractionMs,
    });

    // Cut cascade early: if 90° produces anchors, STOP immediately! Never run 270°!
    if (pass90.anchorsFound > 0) {
      return {
        lines: pass90.lines,
        fullText: pass90.fullText,
        extracted: pass90.extracted,
        elapsedMs: performance.now() - t0,
        rotationUsed: 90,
        attempts,
        imageDimensions,
        profile: {
          imageDecodeMs,
          serviceInitMs,
          serviceInitDetails: lastOcrInitProfile ?? undefined,
        },
      };
    }

    // 3. Cascade retry: only try 270 degrees if both 0° and 90° had NO anchors
    const pass270 = await executePass(270);
    attempts.push({
      rotation: 270,
      elapsedMs: pass270.elapsedMs,
      anchorsFound: pass270.anchorsFound,
      canvasPrepMs: pass270.canvasPrepMs,
      recognizeMs: pass270.recognizeMs,
      groupingMs: pass270.groupingMs,
      extractionMs: pass270.extractionMs,
    });

    const candidates = [pass0, pass90, pass270];
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
      imageDimensions,
      profile: {
        imageDecodeMs,
        serviceInitMs,
        serviceInitDetails: lastOcrInitProfile ?? undefined,
      },
    };
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
}
