/**
 * What a decoded barcode means on a Jamis box — pure, no image code.
 *
 * The barcode layer is the one source of the label reader that does not invent:
 * in the 15-photo bench (docs/label-recognition/02-investigacion.md §2) it gave
 * no wrong reading, while OCR turned a marker stroke into `03-4143BR`. This file
 * decides which decoded strings can be trusted on their own and which need a
 * second source.
 */
import { normalizeSkuOnRegister } from '../../utils/skuNormalize';

/** GS1 company prefix Jamis prints on every box UPC (01 §3). */
export const JAMIS_UPC_PREFIX = '845436';

/** Mod-10 check digit shared by UPC-A, EAN-13 and GTIN-14. */
export function gtinCheckDigitOk(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // Weights alternate 3,1 counting from the digit next to the check digit.
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * The 12-digit UPC-A inside a UPC-A, EAN-13 (`0` + UPC) or GTIN-14 (`00` + UPC)
 * reading, only when its check digit holds. `null` for anything else.
 */
export function toUpcA(text: string): string | null {
  const digits = text.trim();
  if (!gtinCheckDigitOk(digits)) return null;
  if (digits.length === 12) return digits;
  if (digits.length === 13 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 14 && digits.startsWith('00')) return digits.slice(2);
  return null;
}

/**
 * An AS400 stock number printed as a barcode (`03-4149BR`, `03-4000-BL`,
 * `033774BK`), in its canonical form. Code 39 carries no checksum, so this is a
 * CANDIDATE: macOS read `P1G3` where the QR on the same label said `P1493`.
 */
export function asStockNumber(text: string): string | null {
  const v = text.trim().toUpperCase();
  const m = /^(\d{2})[-\s]?(\d{4})[-\s]?([A-Z]{2,3})?$/.exec(v);
  if (!m) return null;
  return normalizeSkuOnRegister(`${m[1]}-${m[2]}${m[3] ?? ''}`);
}

/**
 * The QR on a Jamis factory label (type A):
 * `0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003`
 * → factory code, frame number, quantity, unit, carton, order, line.
 */
export interface JamisFactoryQr {
  factoryCode: string;
  frame: string | null;
  quantity: number | null;
  carton: string | null;
  order: string | null;
}

export function parseJamisFactoryQr(text: string): JamisFactoryQr | null {
  const parts = text.split(',').map((p) => p.trim());
  if (parts.length < 5 || !/^\d{2}\d{2}JC-[A-Z0-9]+-[A-Z0-9]+$/i.test(parts[0])) return null;
  const qty = Number(parts[2]);
  return {
    factoryCode: parts[0].toUpperCase(),
    frame: parts[1] || null,
    quantity: Number.isFinite(qty) && parts[2] !== '' ? qty : null,
    carton: parts[4] || null,
    order: parts[5] ? [parts[5], parts[6]].filter(Boolean).join('-') : null,
  };
}

export type BarcodeMeaning =
  /** Check digit verified: trustworthy on its own. */
  | { kind: 'upc'; upc: string }
  /** No checksum in the symbology: needs a second source before it is believed. */
  | { kind: 'stock-number'; sku: string }
  | { kind: 'factory-qr'; qr: JamisFactoryQr }
  | { kind: 'text'; text: string };

/** What one decoded string is, from its content and symbology. */
export function interpretBarcode(text: string, format: string): BarcodeMeaning {
  const upc = /^(UPCA|EAN13|Code128|ITF14|DataBar)/.test(format) ? toUpcA(text) : null;
  if (upc) return { kind: 'upc', upc };
  if (format.startsWith('QRCode')) {
    const qr = parseJamisFactoryQr(text);
    if (qr) return { kind: 'factory-qr', qr };
  }
  if (format.startsWith('Code39') || format.startsWith('Code128')) {
    const sku = asStockNumber(text);
    if (sku) return { kind: 'stock-number', sku };
  }
  return { kind: 'text', text };
}
