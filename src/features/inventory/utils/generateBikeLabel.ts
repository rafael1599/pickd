import { parseBikeName } from './parseBikeName';
import { encodeTagToken } from '../../../utils/tagToken';

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
 * band — there is no dominant huge SKU and no tiny detail line. The label content
 * is stacked and the base font is chosen as large as fits, so the SKU, the model
 * name and the rest read at (near) the same size.
 *
 * Standard layout (6×4" landscape):
 * ┌──────────────────────────────────────┐
 * │ Faultline A1                ┌───────┐ │ Name (primary)
 * │ Frame 29" x MD/17           │       │ │ wraps to 2 lines
 * │ Sandstorm                   │  QR   │ │ Detail/color (−10%)
 * │ ──────────────────          │       │ │
 * │ ▰▰▰▰▰▰▰▰                     └───────┘ │ SKU (primary, in its
 * │ ▰ 00-0000 ▰                           │ selected-text box)
 * └──────────────────────────────────────┘
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
  // separators / box padding that don't scale with the font. Closes over `doc`.
  const fitUniformBase = (
    lines: FitLine[],
    boxW: number,
    boxH: number,
    fixedExtra: number,
    maxBase = 46,
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

  for (const item of items) {
    const parsed = parseBikeName(item.item_name);
    const baseUrl =
      typeof window !== 'undefined'
        ? import.meta.env.VITE_APP_URL || window.location.origin
        : 'https://roman-app.vercel.app';
    // QR payload: the public_token UUID is sent as a compact base64url token
    // (22 chars vs 36) to keep the printed QR sparser/easier to scan. The /tag
    // route + the in-app scanner still see the same short_code and ?sku.
    const qrPayload = `${baseUrl}/tag/${item.short_code}/${encodeTagToken(item.public_token)}?sku=${encodeURIComponent(item.sku)}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'L',
    });

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
      if (item.sku.trim()) lines.push({ text: item.sku, style: 'bold', weight: 1, maxLines: 1 });
      if (extra) lines.push({ text: extra, style: 'bold', weight: SECONDARY, maxLines: 1 });
      for (const ef of efLines)
        lines.push({ text: ef, style: 'normal', weight: SECONDARY, maxLines: 1 });
      return lines;
    };

    // Geometry shared by SKU box + separator (doesn't scale with the font).
    const SKU_PAD_Y = 0.06;
    const SKU_PAD_X = 0.1;
    const SEP_H = 0.16;

    // ── VERTICAL LAYOUT: portrait 4×6" (stacked, centered, QR at the bottom) ──
    if (item.layout === 'vertical') {
      const VW = 4;
      const VH = 6;
      const vM = 0.2;
      const vTextW = VW - vM * 2;
      const vQrSize = Math.min(2.0, (VW - vM * 2) * 0.7);
      const vTextH = VH - vM * 2 - vQrSize - 0.2; // leave room for QR + gap

      const vLines = buildLines(2);
      const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12;
      const vBase = fitUniformBase(vLines, vTextW, vTextH, fixedExtra);
      const vPrimary = vBase;
      const vSecondary = vBase * SECONDARY;

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
        let vy = vM;

        // Prefix (centered)
        if (prefix) {
          doc.setFont('helvetica', 'bolditalic');
          doc.setFontSize(vPrimary);
          doc.text(prefix, cx, vy + vPrimary * PT_TO_IN, { align: 'center' });
          vy += vPrimary * PT_TO_IN * LINE;
        }

        // Name (centered, up to 2 lines)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(vPrimary);
        for (const line of (doc.splitTextToSize(nameText, vTextW) as string[]).slice(0, 2)) {
          doc.text(line, cx, vy + vPrimary * PT_TO_IN, { align: 'center' });
          vy += vPrimary * PT_TO_IN * LINE;
        }

        // Detail / color (centered)
        if (detailText) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(vSecondary);
          for (const line of (doc.splitTextToSize(detailText, vTextW) as string[]).slice(0, 2)) {
            doc.text(line, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
            vy += vSecondary * PT_TO_IN * LINE;
          }
        }

        // Separator
        vy += 0.05;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.015);
        doc.line(vM, vy, VW - vM, vy);
        vy += SEP_H;

        // SKU (centered, in its selected-text box, same primary size)
        if (item.sku.trim()) {
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
          vy += h + SKU_PAD_Y * 2 + 0.08;
        }

        // Extra (centered)
        if (extra) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(vSecondary);
          doc.text(extra, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
          vy += vSecondary * PT_TO_IN * LINE;
        }

        // Extra fields (centered)
        if (efLines.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(vSecondary);
          for (const line of efLines) {
            doc.text(line, cx, vy + vSecondary * PT_TO_IN, { align: 'center' });
            vy += vSecondary * PT_TO_IN * LINE;
          }
        }

        // QR (centered, fills the bottom)
        const actualQr = Math.min(vQrSize, Math.max(0.8, VH - vy - vM - 0.05));
        doc.addImage(qrDataUrl, 'PNG', cx - actualQr / 2, VH - vM - actualQr, actualQr, actualQr);
      }
      continue;
    }

    // ── STANDARD LAYOUT: 6×4" landscape (text stack left, QR right) ──
    const qrSize = 1.9;
    const qrX = W - M - qrSize;
    const textW = qrX - M - 0.2; // left column for the stacked text

    const lines = buildLines(2);
    const fixedExtra = SEP_H + SKU_PAD_Y * 2 + 0.12;
    const base = fitUniformBase(lines, textW, H - M * 2, fixedExtra);
    const primary = base;
    const secondary = base * SECONDARY;

    // Total stack height, so the text column can be vertically centered.
    let stackH = fixedExtra;
    for (const ln of lines) {
      const fs = base * ln.weight;
      doc.setFont('helvetica', ln.style);
      doc.setFontSize(fs);
      const wrapped = (doc.splitTextToSize(ln.text, textW) as string[]).slice(0, ln.maxLines);
      stackH += wrapped.length * fs * PT_TO_IN * LINE;
    }
    const startY = M + Math.max(0, (H - M * 2 - stackH) / 2);

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
        y += primary * PT_TO_IN * LINE;
      }

      // Name (up to 2 lines)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(primary);
      for (const line of (doc.splitTextToSize(nameText, textW) as string[]).slice(0, 2)) {
        doc.text(line, M, y + primary * PT_TO_IN);
        y += primary * PT_TO_IN * LINE;
      }

      // Detail / color
      if (detailText) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(secondary);
        for (const line of (doc.splitTextToSize(detailText, textW) as string[]).slice(0, 2)) {
          doc.text(line, M, y + secondary * PT_TO_IN);
          y += secondary * PT_TO_IN * LINE;
        }
      }

      // Separator
      y += 0.05;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.015);
      doc.line(M, y, M + textW, y);
      y += SEP_H;

      // SKU (primary size, in its selected-text box)
      if (item.sku.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(primary);
        const w = doc.getTextWidth(item.sku);
        const h = primary * PT_TO_IN;
        doc.setFillColor(0, 0, 0);
        doc.rect(M - 0.02, y, w + SKU_PAD_X * 2 + 0.04, h + SKU_PAD_Y * 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(item.sku, M + SKU_PAD_X, y + SKU_PAD_Y + h * 0.8);
        doc.setTextColor(0, 0, 0);
        y += h + SKU_PAD_Y * 2 + 0.06;
      }

      // Extra
      if (extra) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(secondary);
        doc.text(extra, M, y + secondary * PT_TO_IN);
        y += secondary * PT_TO_IN * LINE;
      }

      // Extra fields
      if (efLines.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(secondary);
        for (const line of efLines) {
          doc.text(line, M, y + secondary * PT_TO_IN);
          y += secondary * PT_TO_IN * LINE;
        }
      }

      // QR (right side, vertically centered)
      const qrY = (H - qrSize) / 2;
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
