import { parseBikeName } from './parseBikeName';

export interface LabelItem {
  sku: string;
  item_name: string | null;
  short_code: string;
  extra?: string | null;
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  printed: ['in_stock'],
  in_stock: ['allocated', 'lost'],
  allocated: ['picked', 'in_stock'],
  picked: ['shipped'],
  shipped: [],
  lost: [],
};

/**
 * 4×6" landscape bike label. SKU and QR dominate.
 *
 * Layout:
 * ┌────────────────────────────────────────┐
 * │ JAMIS  ·  FAULTLINE A1 V2             │ Header row (compact)
 * │ SIZE 15 · COLOR GLOSS BLACK · YEAR 26 │ Detail row (compact)
 * │════════════════════════════════════════│
 * │                         ┌────────────┐│
 * │     03-4614BK           │            ││ Main zone:
 * │                         │     QR     ││ SKU huge left
 * │                         │            ││ QR huge right
 * │                         └────────────┘│
 * └────────────────────────────────────────┘
 */
export async function generateBikeLabels(items: LabelItem[]): Promise<string> {
  const [{ default: jsPDF }, QRCode] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const W = 6;
  const H = 4;
  const M = 0.2;
  const PT_TO_IN = 1 / 72;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [W, H] });
  let isFirstPage = true;

  for (const item of items) {
    const parsed = parseBikeName(item.item_name);
    const qrPayload = `${item.short_code}|${item.sku}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    // Full item name (model + details combined for display)
    const nameText = (parsed.model || parsed.raw || item.sku).trim();

    // Detail: "SIZE 15 · COLOR GLOSS BLACK · YEAR 2026"
    const detailParts: string[] = [];
    if (parsed.size) detailParts.push(`SIZE ${parsed.size}`);
    if (parsed.color) detailParts.push(`COLOR ${parsed.color}`);
    if (parsed.year) detailParts.push(`YEAR ${parsed.year}`);
    const detailText = detailParts.join('  ·  ');

    // Header zone: name (dynamic, fills full width) + detail line
    const detailFontSize = 10;
    const nameMaxW = W - M * 2;
    const headerZoneH = 0.95;

    // Dynamic name font: as large as fits in header width, max 2 lines
    let nameFontSize = 48;
    while (nameFontSize > 10) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(nameFontSize);
      const wrapped = doc.splitTextToSize(nameText, nameMaxW);
      const textH = wrapped.length * nameFontSize * PT_TO_IN * 1.1;
      if (wrapped.length <= 2 && textH <= headerZoneH - detailFontSize * PT_TO_IN * 1.5) break;
      nameFontSize -= 1;
    }

    // Main zone: everything below header
    const mainTop = M + headerZoneH;
    const mainH = H - mainTop - M;
    // QR: square, fills main zone height
    const qrSize = mainH - 0.1;
    const qrX = W - M - qrSize;

    // SKU: fills left side of main zone, dynamic font
    const skuMaxW = qrX - M - 0.2;
    let skuFontSize = 90;
    while (skuFontSize > 16) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(skuFontSize);
      if (doc.getTextWidth(item.sku) <= skuMaxW && skuFontSize * PT_TO_IN <= mainH * 0.6) break;
      skuFontSize -= 1;
    }

    for (let copy = 0; copy < 2; copy++) {
      if (!isFirstPage) doc.addPage([W, H], 'landscape');
      isFirstPage = false;

      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, W, H, 'F');
      doc.setTextColor(0, 0, 0);

      // ── Name (dynamic size, full width, up to 2 lines) ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(nameFontSize);
      const nameWrapped = doc.splitTextToSize(nameText, nameMaxW) as string[];
      let ny = M + nameFontSize * PT_TO_IN;
      for (let i = 0; i < Math.min(nameWrapped.length, 2); i++) {
        doc.text(nameWrapped[i], M, ny);
        ny += nameFontSize * PT_TO_IN * 1.1;
      }

      // ── Detail row: SIZE · COLOR · YEAR ──
      if (detailText) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(detailFontSize);
        doc.text(detailText, M, ny + 0.02);
      }

      // ── Separator ──
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.015);
      doc.line(M, mainTop - 0.05, W - M, mainTop - 0.05);

      // ── SKU (white on black) + extra text below ──
      const hasExtra = !!item.extra?.trim();
      const extraFontSize = Math.round(skuFontSize * 0.4);
      const extraH = hasExtra ? extraFontSize * PT_TO_IN * 1.3 : 0;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(skuFontSize);
      const skuTextH = skuFontSize * PT_TO_IN;
      const skuBgPadX = 0.15;
      const skuBgPadY = 0.1;

      // Vertically center SKU + extra as a group
      const groupH = skuTextH + skuBgPadY * 2 + extraH;
      const groupTopY = mainTop + (mainH - groupH) / 2;

      if (item.sku.trim()) {
        const skuTextW = doc.getTextWidth(item.sku);
        doc.setFillColor(0, 0, 0);
        doc.rect(
          M - 0.05,
          groupTopY,
          skuTextW + skuBgPadX * 2 + 0.05,
          skuTextH + skuBgPadY * 2,
          'F',
        );
        doc.setTextColor(255, 255, 255);
        doc.text(item.sku, M + skuBgPadX, groupTopY + skuBgPadY + skuTextH * 0.8);
        doc.setTextColor(0, 0, 0);
      }

      if (hasExtra) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(extraFontSize);
        const extraY = groupTopY + skuTextH + skuBgPadY * 2 + extraFontSize * PT_TO_IN * 0.3;
        doc.text(item.extra!.trim(), M + skuBgPadX, extraY + extraFontSize * PT_TO_IN);
      }

      // ── QR (fills right side of main zone) ──
      const qrY = mainTop + (mainH - qrSize) / 2;
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
