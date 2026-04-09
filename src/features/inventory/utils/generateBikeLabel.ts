import { parseBikeName } from './parseBikeName';

export interface LabelItem {
  sku: string;
  item_name: string | null;
  short_code: string;
}

/**
 * State transition rules for asset_tags lifecycle.
 * Enforced in application code, not DB constraints.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  printed: ['in_stock'],
  in_stock: ['allocated', 'lost'],
  allocated: ['picked', 'in_stock'],
  picked: ['shipped'],
  shipped: [],
  lost: [],
};

/**
 * Generates a multi-page 4×6" landscape PDF with bike labels.
 * Each unit gets 2 identical pages (for both ends of the box).
 * QR encodes: {short_code}|{sku} (immutable data only).
 */
export async function generateBikeLabels(items: LabelItem[]): Promise<string> {
  const [{ default: jsPDF }, QRCode] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [6, 4] });
  let isFirstPage = true;

  for (const item of items) {
    const parsed = parseBikeName(item.item_name);
    const qrPayload = `${item.short_code}|${item.sku}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    // Each unit = 2 identical pages
    for (let copy = 0; copy < 2; copy++) {
      if (!isFirstPage) doc.addPage([6, 4], 'landscape');
      isFirstPage = false;

      // Background
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 6, 4, 'F');

      // Brand header
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text('JAMIS BICYCLES', 0.4, 0.45);

      // Accent line under brand
      doc.setDrawColor(16, 185, 129); // emerald
      doc.setLineWidth(0.02);
      doc.line(0.4, 0.55, 2.5, 0.55);

      // Model name (large)
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(20, 20, 20);
      const modelText = parsed.model || parsed.raw;
      doc.text(modelText, 0.4, 0.95);

      // Details
      doc.setFontSize(13);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      let detailY = 1.35;

      if (parsed.size) {
        doc.text(`SIZE: ${parsed.size}`, 0.4, detailY);
        detailY += 0.3;
      }
      if (parsed.color) {
        doc.text(`COLOR: ${parsed.color}`, 0.4, detailY);
        detailY += 0.3;
      }
      if (parsed.year) {
        doc.text(`YEAR: ${parsed.year}`, 0.4, detailY);
      }

      // QR code (right side, ~1.5" square)
      doc.addImage(qrDataUrl, 'PNG', 4.1, 0.5, 1.5, 1.5);

      // Divider line
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.01);
      doc.line(0.4, 2.8, 5.6, 2.8);

      // Footer: SKU left, short_code right
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(20, 20, 20);
      doc.text(item.sku, 0.4, 3.3);

      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(item.short_code, 4.1, 3.3);

      // Small copy indicator
      doc.setFontSize(7);
      doc.setTextColor(180, 180, 180);
      doc.text(copy === 0 ? 'SIDE A' : 'SIDE B', 5.2, 3.7);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
