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

    const modelText = parsed.model || parsed.raw || '';

    // Detail: "SIZE 15 · COLOR GLOSS BLACK · YEAR 2026"
    const detailParts: string[] = [];
    if (parsed.size) detailParts.push(`SIZE ${parsed.size}`);
    if (parsed.color) detailParts.push(`COLOR ${parsed.color}`);
    if (parsed.year) detailParts.push(`YEAR ${parsed.year}`);
    const detailText = detailParts.join('  ·  ');

    // Header zone: JAMIS/BIKES + model name (2 lines) + detail
    const detailFontSize = 10;
    // Model font: as large as fits in ~55% of header width, 2 lines max
    const modelMaxW = (W - M * 2) * 0.55;
    let modelFontSize = 22;
    while (modelFontSize > 10) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(modelFontSize);
      const wrapped = doc.splitTextToSize(modelText, modelMaxW);
      if (wrapped.length <= 2) break;
      modelFontSize -= 1;
    }
    // JAMIS/BIKES same size as model
    const brandFontSize = modelFontSize;
    const headerZoneH = 0.95;

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

      // ── JAMIS / BIKES (italic, stacked, same size as model) ──
      let hy = M;
      doc.setFont('helvetica', 'bolditalic');
      doc.setFontSize(brandFontSize);
      doc.text('JAMIS', M, hy + brandFontSize * PT_TO_IN);
      hy += brandFontSize * PT_TO_IN * 1.05;
      doc.text('BIKES', M, hy + brandFontSize * PT_TO_IN);
      const brandBottomY = hy + brandFontSize * PT_TO_IN * 1.1;

      // ── Model name (bold, up to 2 lines, right of brand with gap) ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(brandFontSize);
      const brandBlockW = Math.max(doc.getTextWidth('JAMIS'), doc.getTextWidth('BIKES'));
      const modelX = M + brandBlockW + 0.3; // gap between brand and model
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(modelFontSize);
      const modelWrapped = doc.splitTextToSize(modelText, modelMaxW) as string[];
      const modelStartY = M + modelFontSize * PT_TO_IN;
      for (let i = 0; i < Math.min(modelWrapped.length, 2); i++) {
        doc.text(modelWrapped[i], modelX, modelStartY + i * modelFontSize * PT_TO_IN * 1.15);
      }

      // ── Detail row: SIZE · COLOR · YEAR ──
      if (detailText) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(detailFontSize);
        const detailY = Math.max(brandBottomY, modelStartY + Math.min(modelWrapped.length, 2) * modelFontSize * PT_TO_IN * 1.15) + 0.05;
        doc.text(detailText, M, detailY + detailFontSize * PT_TO_IN);
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
