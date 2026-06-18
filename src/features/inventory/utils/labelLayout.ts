import { parseBikeName } from './parseBikeName';
import { code128Pattern } from '../../../utils/code128';

export interface LabelItem {
  sku: string;
  item_name: string | null;
  short_code: string;
  public_token: string;
  extra?: string | null;
  prefix?: string | null;
  layout?: 'standard' | 'vertical';
  upc?: string | null;
  /** Explicit color (parts store it on sku_metadata.color; bikes derive it
   *  from the item name). When set, it wins over the name-parsed color. */
  color?: string | null;
  serial_number?: string | null;
  made_in?: string | null;
  po_number?: string | null;
  /** Print the QR (opens the SKU page). Defaults to true. */
  withQr?: boolean;
  /** Print the Code 128 barcode of the SKU under the SKU box. Defaults to true. */
  withBarcode?: boolean;
  /** Legacy single switch for both QR + barcode. `withQr`/`withBarcode` override
   *  it when set. With no QR the text grows + spreads to fill the whole label. */
  withCodes?: boolean;
}

export type FontStyle = 'normal' | 'bold' | 'bolditalic';

/**
 * Editable region of the label, used by the Label Studio preview to map a tap on
 * the canvas back to the field it edits. SKU-level fields (name/detail/upc) route
 * to Item Detail (inventory); per-tag fields (extra/serial/made_in/po) are label
 * data. `sku` is intentionally not editable (it's the identity).
 */
export type LabelField = 'name' | 'detail' | 'extra' | 'upc' | 'serial' | 'made_in' | 'po';

const EDITABLE_FIELDS: readonly LabelField[] = [
  'name',
  'detail',
  'extra',
  'upc',
  'serial',
  'made_in',
  'po',
];

/**
 * Text measurement, abstracted so the SAME layout math drives both renderers:
 * the print path passes a measurer backed by its jsPDF doc, and the preview
 * passes one backed by an offscreen jsPDF doc — so the on-screen preview is
 * geometrically identical to the printed PDF.
 */
export interface LabelTextMeasurer {
  /** Width (inches) of `text` at `sizePt` in `style`. */
  textWidth(text: string, sizePt: number, style: FontStyle): number;
  /** Wrap `text` to `maxWidthIn` inches at `sizePt`/`style` → lines. */
  splitText(text: string, maxWidthIn: number, sizePt: number, style: FontStyle): string[];
}

/** One drawing primitive in inch coordinates (label space, origin top-left). */
export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: 'black' | 'white' }
  /** Horizontal hairline from (x, y) of length w. */
  | { kind: 'line'; x: number; y: number; w: number; lineWidth: number }
  | {
      kind: 'text';
      text: string;
      x: number;
      y: number;
      sizePt: number;
      style: FontStyle;
      align: 'left' | 'center';
      color: 'black' | 'white';
      /** Which editable field this text belongs to (preview tap-to-edit). */
      field?: LabelField;
    }
  /** Code 128 of the SKU; `bars` is the module string ('1' = bar). */
  | { kind: 'barcode'; bars: string; x: number; y: number; w: number; h: number }
  /** Square QR placement; the renderer supplies the actual image. */
  | { kind: 'qr'; x: number; y: number; size: number };

/** Tappable bounding box (inches) for an editable field on the label. */
export interface LabelRegion {
  field: LabelField;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelFace {
  /** Page size in inches. */
  width: number;
  height: number;
  ops: DrawOp[];
  /** Tappable regions for the preview, one per editable field present. */
  regions: LabelRegion[];
  withQr: boolean;
  /** URL the QR should encode (null when withQr is false). */
  qrPayload: string | null;
}

const PT_TO_IN = 1 / 72;
// Line-height multiple used for both measuring and drawing stacked text.
const LINE = 1.18;
// Secondary text (detail/color, extras, extra fields) stays within 10% of the
// primary size — the whole label is one 10% size band, so no letter is more than
// 10% larger/smaller than any other. Primary = `base`, secondary = SECONDARY*base.
const SECONDARY = 0.9;

// Code 128 barcode block (drawn under the SKU). Fixed height — it's a graphic,
// not text, so it's outside the 10% size band. Tall enough to scan easily.
const BARCODE_H = 0.55;
const BARCODE_TOP = 0.05;
const BARCODE_BOT = 0.08;

// Geometry shared by the SKU box + separator (doesn't scale with the font).
const SKU_PAD_Y = 0.06;
const SKU_PAD_X = 0.1;
const SEP_H = 0.16;

type FitLine = {
  text: string;
  style: FontStyle;
  /** 1 = primary size, SECONDARY = the within-10% smaller size. */
  weight: number;
  /** Max wrapped lines this entry may occupy before the base must shrink. */
  maxLines: number;
};

/**
 * Largest "primary" font (pt) such that every line fits `boxW` (wrapping within
 * its own maxLines) and the whole stack fits `boxH`. `fixedExtra` accounts for
 * separators / box / barcode that don't scale with the font.
 */
function fitUniformBase(
  measure: LabelTextMeasurer,
  lines: FitLine[],
  boxW: number,
  boxH: number,
  fixedExtra: number,
  maxBase: number,
  minBase = 7
): number {
  for (let base = maxBase; base >= minBase; base -= 0.5) {
    let total = fixedExtra;
    let ok = true;
    for (const ln of lines) {
      const fs = base * ln.weight;
      const wrapped = measure.splitText(ln.text, boxW, fs, ln.style);
      if (wrapped.length > ln.maxLines) {
        ok = false;
        break;
      }
      total += wrapped.length * fs * PT_TO_IN * LINE;
      if (total > boxH) {
        ok = false;
        break;
      }
    }
    if (ok) return base;
  }
  return minBase;
}

/** Natural stack height (at line-height LINE) for the chosen base. */
function stackHeight(
  measure: LabelTextMeasurer,
  lines: FitLine[],
  boxW: number,
  base: number,
  fixedExtra: number
): number {
  let h = fixedExtra;
  for (const ln of lines) {
    const fs = base * ln.weight;
    h +=
      measure.splitText(ln.text, boxW, fs, ln.style).slice(0, ln.maxLines).length *
      fs *
      PT_TO_IN *
      LINE;
  }
  return h;
}

/**
 * Expand a Code 128 module string into solid black bar rects (merged runs).
 * Shared by both renderers so the bars are pixel-identical.
 */
export function barcodeRects(
  bars: string,
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number; w: number; h: number }[] {
  const mw = w / bars.length;
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let i = 0;
  while (i < bars.length) {
    if (bars[i] === '1') {
      let j = i;
      while (j < bars.length && bars[j] === '1') j++;
      rects.push({ x: x + i * mw, y, w: (j - i) * mw, h });
      i = j;
    } else {
      i++;
    }
  }
  return rects;
}

/** Build a measurer backed by a jsPDF-like doc (unit must be inches). */
export function createJsPdfMeasurer(doc: {
  setFont(family: string, style: string): void;
  setFontSize(size: number): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, maxWidth: number): string[];
}): LabelTextMeasurer {
  return {
    textWidth: (text, sizePt, style) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(sizePt);
      return doc.getTextWidth(text);
    },
    splitText: (text, maxWidthIn, sizePt, style) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(sizePt);
      return doc.splitTextToSize(text, maxWidthIn) as string[];
    },
  };
}

/**
 * Derive tappable regions (inches) from the tagged text ops — one union bbox per
 * editable field. Used by the preview to turn a tap on the canvas into an edit.
 */
function computeRegions(ops: DrawOp[], measure: LabelTextMeasurer): LabelRegion[] {
  const byField = new Map<LabelField, LabelRegion>();
  for (const op of ops) {
    if (op.kind !== 'text' || !op.field || !EDITABLE_FIELDS.includes(op.field)) continue;
    const w = measure.textWidth(op.text, op.sizePt, op.style);
    const ascent = op.sizePt * PT_TO_IN * 0.8;
    const descent = op.sizePt * PT_TO_IN * 0.25;
    const left = op.align === 'center' ? op.x - w / 2 : op.x;
    const top = op.y - ascent;
    const h = ascent + descent;
    const cur = byField.get(op.field);
    if (!cur) {
      byField.set(op.field, { field: op.field, x: left, y: top, w, h });
    } else {
      const x1 = Math.min(cur.x, left);
      const y1 = Math.min(cur.y, top);
      const x2 = Math.max(cur.x + cur.w, left + w);
      const y2 = Math.max(cur.y + cur.h, top + h);
      byField.set(op.field, { field: op.field, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
  }
  return [...byField.values()];
}

/**
 * Compute the full draw program for ONE label face (4×6" portrait or 6×4"
 * landscape). The print path renders this twice (two copies); the preview
 * renders it once. Identical math + measurer ⇒ identical geometry on both.
 */
export function computeLabelFace(
  item: LabelItem,
  measure: LabelTextMeasurer,
  baseUrl: string
): LabelFace {
  const parsed = parseBikeName(item.item_name);
  const hasSku = !!item.sku.trim();
  // QR and barcode are independent; `withCodes` is the legacy fallback for both.
  const withQr = item.withQr ?? item.withCodes ?? true;
  const withBarcode = (item.withBarcode ?? item.withCodes ?? true) && hasSku;

  // QR carries only the SKU (/s/<sku>) — the shortest payload, so the printed
  // code stays sparse and easy to scan.
  const qrPayload = withQr ? `${baseUrl}/s/${encodeURIComponent(item.sku)}` : null;

  // Full item name (model + details combined for display).
  const nameText = (parsed.model || parsed.raw || item.sku).trim();

  // Detail: "SIZE 15 · Sandstorm · YEAR 2026". The literal word "COLOR" is NOT
  // printed. Color: explicit field (parts) wins; else the name-parsed color.
  const labelColor = item.color?.trim() || parsed.color;
  const detailParts: string[] = [];
  if (parsed.size) detailParts.push(`SIZE ${parsed.size}`);
  if (labelColor) detailParts.push(labelColor);
  if (parsed.year) detailParts.push(`YEAR ${parsed.year}`);
  const detailText = detailParts.join('  ·  ');

  const prefix = item.prefix?.trim() || null;
  const extra = item.extra?.trim() || null;

  // Extra fields (UPC, Serial, Made In, P/O) — one line each, tagged by field.
  const efLines: { text: string; field: LabelField }[] = [];
  if (item.upc?.trim()) efLines.push({ text: `UPC: ${item.upc.trim()}`, field: 'upc' });
  if (item.serial_number?.trim())
    efLines.push({ text: `SERIAL: ${item.serial_number.trim()}`, field: 'serial' });
  if (item.made_in?.trim())
    efLines.push({ text: `MADE IN: ${item.made_in.trim()}`, field: 'made_in' });
  if (item.po_number?.trim()) efLines.push({ text: `P/O: ${item.po_number.trim()}`, field: 'po' });

  const buildLines = (nameMaxLines: number): FitLine[] => {
    const lines: FitLine[] = [];
    if (prefix) lines.push({ text: prefix, style: 'bolditalic', weight: 1, maxLines: 1 });
    lines.push({ text: nameText, style: 'bold', weight: 1, maxLines: nameMaxLines });
    if (detailText)
      lines.push({ text: detailText, style: 'normal', weight: SECONDARY, maxLines: 2 });
    if (hasSku) lines.push({ text: item.sku, style: 'bold', weight: 1, maxLines: 1 });
    if (extra) lines.push({ text: extra, style: 'bold', weight: SECONDARY, maxLines: 1 });
    for (const ef of efLines)
      lines.push({ text: ef.text, style: 'normal', weight: SECONDARY, maxLines: 1 });
    return lines;
  };

  const bcBlock = withBarcode ? BARCODE_TOP + BARCODE_H + BARCODE_BOT : 0;
  // Largest font we'll try. With no QR the text fills the whole label; with codes
  // on it can still grow well past the old cap and then spread to fill the height.
  const MAX_BASE = withQr ? 60 : 120;
  // Spread the stack to fill the label height in both modes (less when codes are
  // on, so the QR/barcode keep their room).
  const fillCap = withQr ? 1.4 : 1.7;
  const ops: DrawOp[] = [];

  // ── VERTICAL LAYOUT: portrait 4×6" (stacked, centered; QR at the bottom) ──
  if (item.layout === 'vertical') {
    const VW = 4;
    const VH = 6;
    const vM = 0.2;
    const vTextW = VW - vM * 2;
    const vQrSize = withQr ? Math.min(2.6, (VW - vM * 2) * 0.9) : 0;
    const vTextH = withQr ? VH - vM * 2 - vQrSize - 0.2 : VH - vM * 2;

    const vLines = buildLines(2);
    const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12 + bcBlock;
    const vBase = fitUniformBase(measure, vLines, vTextW, vTextH, fixedExtra, MAX_BASE);
    const vPrimary = vBase;
    const vSecondary = vBase * SECONDARY;
    const natH = stackHeight(measure, vLines, vTextW, vBase, fixedExtra);
    const stretch = Math.min(Math.max(vTextH / natH, 1), fillCap);
    const LE = LINE * stretch;

    ops.push({ kind: 'rect', x: 0, y: 0, w: VW, h: VH, fill: 'white' });
    const cx = VW / 2;
    let vy = vM + Math.max(0, (vTextH - natH * stretch) / 2);

    if (prefix) {
      ops.push({
        kind: 'text',
        text: prefix,
        x: cx,
        y: vy + vPrimary * PT_TO_IN,
        sizePt: vPrimary,
        style: 'bolditalic',
        align: 'center',
        color: 'black',
      });
      vy += vPrimary * PT_TO_IN * LE;
    }

    for (const line of measure.splitText(nameText, vTextW, vPrimary, 'bold').slice(0, 2)) {
      ops.push({
        kind: 'text',
        text: line,
        x: cx,
        y: vy + vPrimary * PT_TO_IN,
        sizePt: vPrimary,
        style: 'bold',
        align: 'center',
        color: 'black',
        field: 'name',
      });
      vy += vPrimary * PT_TO_IN * LE;
    }

    if (detailText) {
      for (const line of measure.splitText(detailText, vTextW, vSecondary, 'normal').slice(0, 2)) {
        ops.push({
          kind: 'text',
          text: line,
          x: cx,
          y: vy + vSecondary * PT_TO_IN,
          sizePt: vSecondary,
          style: 'normal',
          align: 'center',
          color: 'black',
          field: 'detail',
        });
        vy += vSecondary * PT_TO_IN * LE;
      }
    }

    vy += 0.05 * stretch;
    ops.push({ kind: 'line', x: vM, y: vy, w: VW - vM * 2, lineWidth: 0.015 });
    vy += SEP_H * stretch;

    if (hasSku) {
      const w = measure.textWidth(item.sku, vPrimary, 'bold');
      const h = vPrimary * PT_TO_IN;
      const boxW = w + SKU_PAD_X * 2;
      ops.push({
        kind: 'rect',
        x: cx - boxW / 2,
        y: vy,
        w: boxW,
        h: h + SKU_PAD_Y * 2,
        fill: 'black',
      });
      ops.push({
        kind: 'text',
        text: item.sku,
        x: cx,
        y: vy + SKU_PAD_Y + h * 0.8,
        sizePt: vPrimary,
        style: 'bold',
        align: 'center',
        color: 'white',
      });
      vy += h + SKU_PAD_Y * 2 + 0.08 * stretch;
    }

    if (withBarcode) {
      const bcW = Math.min(vTextW, 3.2);
      vy += BARCODE_TOP;
      ops.push({
        kind: 'barcode',
        bars: code128Pattern(item.sku),
        x: cx - bcW / 2,
        y: vy,
        w: bcW,
        h: BARCODE_H,
      });
      vy += BARCODE_H + BARCODE_BOT;
    }

    if (extra) {
      ops.push({
        kind: 'text',
        text: extra,
        x: cx,
        y: vy + vSecondary * PT_TO_IN,
        sizePt: vSecondary,
        style: 'bold',
        align: 'center',
        color: 'black',
        field: 'extra',
      });
      vy += vSecondary * PT_TO_IN * LE;
    }

    if (efLines.length) {
      for (const line of efLines) {
        ops.push({
          kind: 'text',
          text: line.text,
          x: cx,
          y: vy + vSecondary * PT_TO_IN,
          sizePt: vSecondary,
          style: 'normal',
          align: 'center',
          color: 'black',
          field: line.field,
        });
        vy += vSecondary * PT_TO_IN * LE;
      }
    }

    if (withQr) {
      const actualQr = Math.min(vQrSize, Math.max(0.8, VH - vy - vM - 0.05));
      ops.push({ kind: 'qr', x: cx - actualQr / 2, y: VH - vM - actualQr, size: actualQr });
    }

    return { width: VW, height: VH, ops, regions: computeRegions(ops, measure), withQr, qrPayload };
  }

  // ── STANDARD LAYOUT: 6×4" landscape (text stack left; QR right when on) ──
  const W = 6;
  const H = 4;
  const M = 0.2;
  const qrSize = 2.2;
  const qrX = W - M - qrSize;
  const textW = withQr ? qrX - M - 0.2 : W - M * 2;

  const lines = buildLines(2);
  const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12 + bcBlock;
  const base = fitUniformBase(measure, lines, textW, H - M * 2, fixedExtra, MAX_BASE);
  const primary = base;
  const secondary = base * SECONDARY;
  const natH = stackHeight(measure, lines, textW, base, fixedExtra);
  const stretch = Math.min(Math.max((H - M * 2) / natH, 1), fillCap);
  const LE = LINE * stretch;
  const startY = M + Math.max(0, (H - M * 2 - natH * stretch) / 2);

  ops.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: 'white' });
  let y = startY;

  if (prefix) {
    ops.push({
      kind: 'text',
      text: prefix,
      x: M,
      y: y + primary * PT_TO_IN,
      sizePt: primary,
      style: 'bolditalic',
      align: 'left',
      color: 'black',
    });
    y += primary * PT_TO_IN * LE;
  }

  for (const line of measure.splitText(nameText, textW, primary, 'bold').slice(0, 2)) {
    ops.push({
      kind: 'text',
      text: line,
      x: M,
      y: y + primary * PT_TO_IN,
      sizePt: primary,
      style: 'bold',
      align: 'left',
      color: 'black',
      field: 'name',
    });
    y += primary * PT_TO_IN * LE;
  }

  if (detailText) {
    for (const line of measure.splitText(detailText, textW, secondary, 'normal').slice(0, 2)) {
      ops.push({
        kind: 'text',
        text: line,
        x: M,
        y: y + secondary * PT_TO_IN,
        sizePt: secondary,
        style: 'normal',
        align: 'left',
        color: 'black',
        field: 'detail',
      });
      y += secondary * PT_TO_IN * LE;
    }
  }

  y += 0.05 * stretch;
  ops.push({ kind: 'line', x: M, y, w: textW, lineWidth: 0.015 });
  y += SEP_H * stretch;

  if (hasSku) {
    const w = measure.textWidth(item.sku, primary, 'bold');
    const h = primary * PT_TO_IN;
    ops.push({
      kind: 'rect',
      x: M - 0.02,
      y,
      w: w + SKU_PAD_X * 2 + 0.04,
      h: h + SKU_PAD_Y * 2,
      fill: 'black',
    });
    ops.push({
      kind: 'text',
      text: item.sku,
      x: M + SKU_PAD_X,
      y: y + SKU_PAD_Y + h * 0.8,
      sizePt: primary,
      style: 'bold',
      align: 'left',
      color: 'white',
    });
    y += h + SKU_PAD_Y * 2 + 0.06 * stretch;
  }

  if (withBarcode) {
    y += BARCODE_TOP;
    ops.push({ kind: 'barcode', bars: code128Pattern(item.sku), x: M, y, w: textW, h: BARCODE_H });
    y += BARCODE_H + BARCODE_BOT;
  }

  if (extra) {
    ops.push({
      kind: 'text',
      text: extra,
      x: M,
      y: y + secondary * PT_TO_IN,
      sizePt: secondary,
      style: 'bold',
      align: 'left',
      color: 'black',
      field: 'extra',
    });
    y += secondary * PT_TO_IN * LE;
  }

  if (efLines.length) {
    for (const line of efLines) {
      ops.push({
        kind: 'text',
        text: line.text,
        x: M,
        y: y + secondary * PT_TO_IN,
        sizePt: secondary,
        style: 'normal',
        align: 'left',
        color: 'black',
        field: line.field,
      });
      y += secondary * PT_TO_IN * LE;
    }
  }

  if (withQr) {
    const qrY = (H - qrSize) / 2;
    ops.push({ kind: 'qr', x: qrX, y: qrY, size: qrSize });
  }

  return { width: W, height: H, ops, regions: computeRegions(ops, measure), withQr, qrPayload };
}
