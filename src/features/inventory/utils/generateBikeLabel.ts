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
  /** When false, print a codeless label: no QR and no barcode, with the text
   *  enlarged + spread to fill the whole label. Defaults to true (codes on). */
  withCodes?: boolean;
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  printed: ['in_stock'],
  in_stock: ['allocated', 'lost'],
  allocated: ['picked', 'in_stock'],
  picked: ['shipped'],
  shipped: [],
  lost: [],
};

const PT_TO_IN = 1 / 72;
// Line-height multiple used for both measuring and drawing stacked text.
const LINE = 1.18;
// Secondary text (detail/color, extras, extra fields) stays within 10% of the
// primary size — the whole label is rendered inside a single 10% size band so no
// letter is more than 10% larger/smaller than any other. Primary = `base`,
// secondary = SECONDARY * base (exactly the 10% floor the spec allows).
const SECONDARY = 0.9;

// Code 128 barcode block (drawn under the SKU when codes are on). Fixed height —
// it's a graphic, not text, so it's outside the 10% size band.
const BARCODE_H = 0.4;
const BARCODE_TOP = 0.05;
const BARCODE_BOT = 0.08;

type FitLine = {
  text: string;
  style: 'bold' | 'normal' | 'bolditalic';
  /** 1 = primary size, SECONDARY = the within-10% smaller size. */
  weight: number;
  /** Max wrapped lines this entry may occupy before the base must shrink. */
  maxLines: number;
};

/**
 * 4×6" bike/part label. Every piece of text is rendered within a single 10% size
 * band, stacked, with the base font chosen as large as fits.
 *
 * Two print modes (per item, via `withCodes`):
 *  - codes on (default): QR (opens the tag page) on the side/bottom, plus a
 *    Code 128 barcode of the SKU right under the SKU box.
 *  - codes off: no QR, no barcode — the text grows and spreads to fill the label.
 */
export async function generateBikeLabels(items: LabelItem[]): Promise<string> {
  const [{ default: jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);

  const W = 6;
  const H = 4;
  const M = 0.2;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [W, H] });
  let isFirstPage = true;

  // Largest "primary" font (pt) such that every line fits `boxW` (wrapping within
  // its own maxLines) and the whole stack fits `boxH`. `fixedExtra` accounts for
  // separators / box / barcode that don't scale with the font. Closes over `doc`.
  const fitUniformBase = (
    lines: FitLine[],
    boxW: number,
    boxH: number,
    fixedExtra: number,
    maxBase: number,
    minBase = 7
  ): number => {
    for (let base = maxBase; base >= minBase; base -= 0.5) {
      let total = fixedExtra;
      let ok = true;
      for (const ln of lines) {
        const fs = base * ln.weight;
        doc.setFont('helvetica', ln.style);
        doc.setFontSize(fs);
        const wrapped = doc.splitTextToSize(ln.text, boxW) as string[];
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
  };

  // Natural stack height (at line-height LINE) for the chosen base.
  const stackHeight = (
    lines: FitLine[],
    boxW: number,
    base: number,
    fixedExtra: number
  ): number => {
    let h = fixedExtra;
    for (const ln of lines) {
      const fs = base * ln.weight;
      doc.setFont('helvetica', ln.style);
      doc.setFontSize(fs);
      h +=
        (doc.splitTextToSize(ln.text, boxW) as string[]).slice(0, ln.maxLines).length *
        fs *
        PT_TO_IN *
        LINE;
    }
    return h;
  };

  // Draw a Code 128 of `data` as vector bars (crisp, no canvas). Black on white.
  const drawBarcode = (data: string, x: number, y: number, w: number, h: number): void => {
    const bin = code128Pattern(data);
    const mw = w / bin.length;
    doc.setFillColor(0, 0, 0);
    let i = 0;
    while (i < bin.length) {
      if (bin[i] === '1') {
        let j = i;
        while (j < bin.length && bin[j] === '1') j++;
        doc.rect(x + i * mw, y, (j - i) * mw, h, 'F');
        i = j;
      } else {
        i++;
      }
    }
  };

  for (const item of items) {
    const parsed = parseBikeName(item.item_name);
    const withCodes = item.withCodes !== false;
    const hasSku = !!item.sku.trim();
    const drawBC = withCodes && hasSku;

    let qrDataUrl: string | null = null;
    if (withCodes) {
      const baseUrl =
        typeof window !== 'undefined'
          ? import.meta.env.VITE_APP_URL || window.location.origin
          : 'https://roman-app.vercel.app';
      // QR carries only the SKU (/s/<sku>) — the shortest possible payload, so
      // the printed code stays sparse and easy to scan. The public page resolves
      // SKU-level info; the Code 128 below also encodes the SKU.
      const qrPayload = `${baseUrl}/s/${encodeURIComponent(item.sku)}`;
      qrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: 'L',
      });
    }

    // Full item name (model + details combined for display).
    const nameText = (parsed.model || parsed.raw || item.sku).trim();

    // Detail: "SIZE 15 · Sandstorm · YEAR 2026". The literal word "COLOR" is NOT
    // printed — the color value stands on its own. Color: explicit field (parts)
    // wins; else the name-parsed color (bikes).
    const labelColor = item.color?.trim() || parsed.color;
    const detailParts: string[] = [];
    if (parsed.size) detailParts.push(`SIZE ${parsed.size}`);
    if (labelColor) detailParts.push(labelColor);
    if (parsed.year) detailParts.push(`YEAR ${parsed.year}`);
    const detailText = detailParts.join('  ·  ');

    const prefix = item.prefix?.trim() || null;
    const extra = item.extra?.trim() || null;

    // Extra fields (UPC, Serial, Made In, P/O) — one line each.
    const efLines: string[] = [];
    if (item.upc?.trim()) efLines.push(`UPC: ${item.upc.trim()}`);
    if (item.serial_number?.trim()) efLines.push(`SERIAL: ${item.serial_number.trim()}`);
    if (item.made_in?.trim()) efLines.push(`MADE IN: ${item.made_in.trim()}`);
    if (item.po_number?.trim()) efLines.push(`P/O: ${item.po_number.trim()}`);

    // Build the stack of text lines once; both layouts reuse it.
    const buildLines = (nameMaxLines: number): FitLine[] => {
      const lines: FitLine[] = [];
      if (prefix) lines.push({ text: prefix, style: 'bolditalic', weight: 1, maxLines: 1 });
      lines.push({ text: nameText, style: 'bold', weight: 1, maxLines: nameMaxLines });
      if (detailText)
        lines.push({ text: detailText, style: 'normal', weight: SECONDARY, maxLines: 2 });
      if (hasSku) lines.push({ text: item.sku, style: 'bold', weight: 1, maxLines: 1 });
      if (extra) lines.push({ text: extra, style: 'bold', weight: SECONDARY, maxLines: 1 });
      for (const ef of efLines)
        lines.push({ text: ef, style: 'normal', weight: SECONDARY, maxLines: 1 });
      return lines;
    };

    // Geometry shared by SKU box + separator (doesn't scale with the font).
    const SKU_PAD_Y = 0.06;
    const SKU_PAD_X = 0.1;
    const SEP_H = 0.16;
    const bcBlock = drawBC ? BARCODE_TOP + BARCODE_H + BARCODE_BOT : 0;
    // Codeless labels reclaim the QR/barcode space and grow much larger.
    const MAX_BASE = withCodes ? 46 : 120;

    // ── VERTICAL LAYOUT: portrait 4×6" (stacked, centered; QR at the bottom) ──
    if (item.layout === 'vertical') {
      const VW = 4;
      const VH = 6;
      const vM = 0.2;
      const vTextW = VW - vM * 2;
      const vQrSize = withCodes ? Math.min(2.0, (VW - vM * 2) * 0.7) : 0;
      const vTextH = withCodes ? VH - vM * 2 - vQrSize - 0.2 : VH - vM * 2;

      const vLines = buildLines(2);
      const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12 + bcBlock;
      const vBase = fitUniformBase(vLines, vTextW, vTextH, fixedExtra, MAX_BASE);
      const vPrimary = vBase;
      const vSecondary = vBase * SECONDARY;
      const natH = stackHeight(vLines, vTextW, vBase, fixedExtra);
      const stretch = withCodes ? 1 : Math.min(Math.max(vTextH / natH, 1), 1.7);
      const LE = LINE * stretch;

      for (let copy = 0; copy < 2; copy++) {
        if (!isFirstPage) doc.addPage([VW, VH], 'portrait');
        else {
          doc.deletePage(1);
          doc.addPage([VW, VH], 'portrait');
        }
        isFirstPage = false;

        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, VW, VH, 'F');
        doc.setTextColor(0, 0, 0);

        const cx = VW / 2;
        let vy = vM + Math.max(0, (vTextH - natH * stretch) / 2);

        // Prefix (centered)
        if (prefix) {
          doc.setFont('helvetica', 'bolditalic');
          doc.setFontSize(vPrimary);
          doc.text(prefix, cx, vy + vPrimary * PT_TO_IN, { align: 'center' });
          vy += vPrimary * PT_TO_IN * LE;
        }

        // Name (centered, up to 2 lines)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(vPrimary);
        for (const line of (doc.splitTextToSize(nameText, vTextW) as string[]).slice(0, 2)) {
          doc.text(line, cx, vy + vPrimary * PT_TO_IN, { align: 'center' });
          vy += vPrimary * PT_TO_IN * LE;
        }

        // Detail / color (centered)
        if (detailText) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(vSecondary);
          for (const line of (doc.splitTextToSize(detailText, vTextW) as string[]).slice(0, 2)) {
            doc.text(line, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
            vy += vSecondary * PT_TO_IN * LE;
          }
        }

        // Separator
        vy += 0.05 * stretch;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.015);
        doc.line(vM, vy, VW - vM, vy);
        vy += SEP_H * stretch;

        // SKU (centered, in its selected-text box, same primary size)
        if (hasSku) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(vPrimary);
          const w = doc.getTextWidth(item.sku);
          const h = vPrimary * PT_TO_IN;
          const boxW = w + SKU_PAD_X * 2;
          doc.setFillColor(0, 0, 0);
          doc.rect(cx - boxW / 2, vy, boxW, h + SKU_PAD_Y * 2, 'F');
          doc.setTextColor(255, 255, 255);
          doc.text(item.sku, cx, vy + SKU_PAD_Y + h * 0.8, { align: 'center' });
          doc.setTextColor(0, 0, 0);
          vy += h + SKU_PAD_Y * 2 + 0.08 * stretch;
        }

        // Barcode (centered, under the SKU) — codes on only
        if (drawBC) {
          const bcW = Math.min(vTextW, 3.2);
          vy += BARCODE_TOP;
          drawBarcode(item.sku, cx - bcW / 2, vy, bcW, BARCODE_H);
          vy += BARCODE_H + BARCODE_BOT;
        }

        // Extra (centered)
        if (extra) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(vSecondary);
          doc.text(extra, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
          vy += vSecondary * PT_TO_IN * LE;
        }

        // Extra fields (centered)
        if (efLines.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(vSecondary);
          for (const line of efLines) {
            doc.text(line, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
            vy += vSecondary * PT_TO_IN * LE;
          }
        }

        // QR (centered, fills the bottom) — codes on only
        if (withCodes && qrDataUrl) {
          const actualQr = Math.min(vQrSize, Math.max(0.8, VH - vy - vM - 0.05));
          doc.addImage(qrDataUrl, 'PNG', cx - actualQr / 2, VH - vM - actualQr, actualQr, actualQr);
        }
      }
      continue;
    }

    // ── STANDARD LAYOUT: 6×4" landscape (text stack left; QR right when on) ──
    const qrSize = 1.9;
    const qrX = W - M - qrSize;
    const textW = withCodes ? qrX - M - 0.2 : W - M * 2;

    const lines = buildLines(2);
    const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12 + bcBlock;
    const base = fitUniformBase(lines, textW, H - M * 2, fixedExtra, MAX_BASE);
    const primary = base;
    const secondary = base * SECONDARY;
    const natH = stackHeight(lines, textW, base, fixedExtra);
    const stretch = withCodes ? 1 : Math.min(Math.max((H - M * 2) / natH, 1), 1.7);
    const LE = LINE * stretch;
    const startY = M + Math.max(0, (H - M * 2 - natH * stretch) / 2);

    for (let copy = 0; copy < 2; copy++) {
      if (!isFirstPage) doc.addPage([W, H], 'landscape');
      isFirstPage = false;

      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, W, H, 'F');
      doc.setTextColor(0, 0, 0);

      let y = startY;

      // Prefix
      if (prefix) {
        doc.setFont('helvetica', 'bolditalic');
        doc.setFontSize(primary);
        doc.text(prefix, M, y + primary * PT_TO_IN);
        y += primary * PT_TO_IN * LE;
      }

      // Name (up to 2 lines)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(primary);
      for (const line of (doc.splitTextToSize(nameText, textW) as string[]).slice(0, 2)) {
        doc.text(line, M, y + primary * PT_TO_IN);
        y += primary * PT_TO_IN * LE;
      }

      // Detail / color
      if (detailText) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(secondary);
        for (const line of (doc.splitTextToSize(detailText, textW) as string[]).slice(0, 2)) {
          doc.text(line, M, y + secondary * PT_TO_IN);
          y += secondary * PT_TO_IN * LE;
        }
      }

      // Separator
      y += 0.05 * stretch;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.015);
      doc.line(M, y, M + textW, y);
      y += SEP_H * stretch;

      // SKU (primary size, in its selected-text box)
      if (hasSku) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(primary);
        const w = doc.getTextWidth(item.sku);
        const h = primary * PT_TO_IN;
        doc.setFillColor(0, 0, 0);
        doc.rect(M - 0.02, y, w + SKU_PAD_X * 2 + 0.04, h + SKU_PAD_Y * 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(item.sku, M + SKU_PAD_X, y + SKU_PAD_Y + h * 0.8);
        doc.setTextColor(0, 0, 0);
        y += h + SKU_PAD_Y * 2 + 0.06 * stretch;
      }

      // Barcode (under the SKU, full text-column width) — codes on only
      if (drawBC) {
        y += BARCODE_TOP;
        drawBarcode(item.sku, M, y, textW, BARCODE_H);
        y += BARCODE_H + BARCODE_BOT;
      }

      // Extra
      if (extra) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(secondary);
        doc.text(extra, M, y + secondary * PT_TO_IN);
        y += secondary * PT_TO_IN * LE;
      }

      // Extra fields
      if (efLines.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(secondary);
        for (const line of efLines) {
          doc.text(line, M, y + secondary * PT_TO_IN);
          y += secondary * PT_TO_IN * LE;
        }
      }

      // QR (right side, vertically centered) — codes on only
      if (withCodes && qrDataUrl) {
        const qrY = (H - qrSize) / 2;
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
      }
    }
  }

  return doc.output('bloburl') as unknown as string;
}
