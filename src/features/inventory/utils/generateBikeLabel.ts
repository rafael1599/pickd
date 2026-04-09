import { parseBikeName } from './parseBikeName';

export interface LabelItem {
  sku: string;
  item_name: string | null;
  short_code: string;
  public_token: string;
  extra?: string | null;
  prefix?: string | null;
  layout?: 'standard' | 'vertical';
  upc?: string | null;
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
    const baseUrl = typeof window !== 'undefined'
      ? (import.meta.env.VITE_APP_URL || window.location.origin)
      : 'https://roman-app.vercel.app';
    const qrPayload = `${baseUrl}/tag/${item.short_code}/${item.public_token}?sku=${encodeURIComponent(item.sku)}`;
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

    // Header zone: name limited to left ~55% to not overlap QR + detail line
    const detailFontSize = 10;
    const nameMaxW = (W - M * 2) * 0.55;
    const headerZoneH = 0.95;

    // Dynamic name font: as large as fits in left zone, max 2 lines
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

    // ── VERTICAL LAYOUT: portrait 4×6" (same content as standard, rotated) ──
    if (item.layout === 'vertical') {
      const VW = 4; // portrait width
      const VH = 6; // portrait height
      const vM = 0.2;
      const vNameMaxW = (VW - vM * 2) * 0.95;
      const vHeaderZoneH = 1.2;

      // Dynamic name font for vertical
      let vNameFont = 40;
      while (vNameFont > 10) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(vNameFont);
        const wrapped = doc.splitTextToSize(nameText, vNameMaxW);
        const textH = wrapped.length * vNameFont * PT_TO_IN * 1.1;
        if (wrapped.length <= 2 && textH <= vHeaderZoneH - detailFontSize * PT_TO_IN * 1.5) break;
        vNameFont -= 1;
      }

      // QR and SKU zone
      const vMainTop = vM + vHeaderZoneH;
      const vMainH = VH - vMainTop - vM;
      const vQrSize = Math.min((VW - vM * 2) * 0.6, vMainH * 0.5);
      const vSkuMaxW = VW - vM * 2;
      let vSkuFont = 72;
      while (vSkuFont > 14) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(vSkuFont);
        if (doc.getTextWidth(item.sku) <= vSkuMaxW && vSkuFont * PT_TO_IN <= vMainH * 0.3) break;
        vSkuFont -= 1;
      }

      for (let copy = 0; copy < 2; copy++) {
        if (!isFirstPage) doc.addPage([VW, VH], 'portrait');
        else { doc.deletePage(1); doc.addPage([VW, VH], 'portrait'); }
        isFirstPage = false;

        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, VW, VH, 'F');
        doc.setTextColor(0, 0, 0);

        const cx = VW / 2; // center X
        const maxContentW = VW - vM * 2;
        let vy = vM;

        // Prefix (S/D) — centered
        if (item.prefix?.trim()) {
          const pSize = Math.min(vNameFont * 1.25, 50);
          doc.setFont('helvetica', 'bolditalic');
          doc.setFontSize(pSize);
          doc.text(item.prefix.trim(), cx, vy + pSize * PT_TO_IN, { align: 'center' });
          vy += pSize * PT_TO_IN * 1.15;
        }

        // Name — split into highlighted (first 2 words) and rest
        const nameWords = nameText.split(/\s+/);
        const highlightText = nameWords.slice(0, 2).join(' ');
        const restText = nameWords.slice(2).join(' ');
        const smallFont = Math.round(vNameFont * 0.9);

        // Dynamic sizing: shrink highlight if it overflows
        doc.setFont('helvetica', 'bold');
        let hlFont = vNameFont;
        while (hlFont > 10) {
          doc.setFontSize(hlFont);
          if (doc.getTextWidth(highlightText) + 0.3 <= maxContentW) break;
          hlFont -= 1;
        }

        // Highlighted words (black bg, white text, centered)
        doc.setFontSize(hlFont);
        const hlW = doc.getTextWidth(highlightText);
        const hlH = hlFont * PT_TO_IN;
        const hlPadX = 0.15;
        const hlPadY = 0.06;
        const hlBoxW = hlW + hlPadX * 2;
        const hlBoxX = cx - hlBoxW / 2;
        doc.setFillColor(0, 0, 0);
        doc.rect(hlBoxX, vy, hlBoxW, hlH + hlPadY * 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(highlightText, cx, vy + hlH * 0.85 + hlPadY, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        vy += hlH + hlPadY * 2 + 0.1;

        // Rest of name (smaller, centered, wraps if needed)
        if (restText) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(smallFont);
          const restWrapped = doc.splitTextToSize(restText, maxContentW) as string[];
          for (const line of restWrapped) {
            doc.text(line, cx, vy + smallFont * PT_TO_IN, { align: 'center' });
            vy += smallFont * PT_TO_IN * 1.15;
          }
        }

        // Detail (smaller, centered)
        if (detailText) {
          vy += 0.05;
          doc.setFont('helvetica', 'normal');
          const dtFont = Math.round(smallFont * 0.6);
          doc.setFontSize(dtFont);
          const dtWrapped = doc.splitTextToSize(detailText, maxContentW) as string[];
          for (const line of dtWrapped) {
            doc.text(line, cx, vy + dtFont * PT_TO_IN, { align: 'center' });
            vy += dtFont * PT_TO_IN * 1.2;
          }
        }

        // Separator
        vy += 0.08;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.015);
        doc.line(vM, vy, VW - vM, vy);
        vy += 0.15;

        // SKU (black bg, centered) — dynamic size
        if (item.sku.trim()) {
          doc.setFont('helvetica', 'bold');
          let skF = vSkuFont;
          while (skF > 14) {
            doc.setFontSize(skF);
            if (doc.getTextWidth(item.sku) + 0.3 <= maxContentW) break;
            skF -= 1;
          }
          doc.setFontSize(skF);
          const skuW = doc.getTextWidth(item.sku);
          const skuH = skF * PT_TO_IN;
          const skuBoxW = skuW + 0.3;
          const skuBoxX = cx - skuBoxW / 2;
          doc.setFillColor(0, 0, 0);
          doc.rect(skuBoxX, vy, skuBoxW, skuH + 0.15, 'F');
          doc.setTextColor(255, 255, 255);
          doc.text(item.sku, cx, vy + skuH * 0.85 + 0.05, { align: 'center' });
          doc.setTextColor(0, 0, 0);
          vy += skuH + 0.25;
        }

        // Extra (centered)
        if (item.extra?.trim()) {
          const exFont = Math.round(smallFont * 0.5);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(exFont);
          const exWrapped = doc.splitTextToSize(item.extra.trim(), maxContentW) as string[];
          for (const line of exWrapped) {
            doc.text(line, cx, vy + exFont * PT_TO_IN, { align: 'center' });
            vy += exFont * PT_TO_IN * 1.2;
          }
        }

        // Extra fields (UPC, Serial, Made In, P/O) — centered
        {
          const efLines: string[] = [];
          if (item.upc?.trim()) efLines.push(`UPC: ${item.upc.trim()}`);
          if (item.serial_number?.trim()) efLines.push(`SERIAL: ${item.serial_number.trim()}`);
          if (item.made_in?.trim()) efLines.push(`MADE IN: ${item.made_in.trim()}`);
          if (item.po_number?.trim()) efLines.push(`P/O: ${item.po_number.trim()}`);
          if (efLines.length > 0) {
            const efFontSize = Math.round(vSkuFont * 0.4);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(efFontSize);
            doc.setTextColor(0, 0, 0);
            vy += 0.05;
            for (const line of efLines) {
              doc.text(line, cx, vy + efFontSize * PT_TO_IN, { align: 'center' });
              vy += efFontSize * PT_TO_IN * 1.3;
            }
          }
        }

        // QR (centered, fills remaining space at bottom)
        const remainingH = VH - vy - vM;
        const actualQrSize = Math.min(vQrSize, Math.max(0.8, remainingH - 0.1));
        doc.addImage(qrDataUrl, 'PNG', cx - actualQrSize / 2, VH - vM - actualQrSize, actualQrSize, actualQrSize);
      }
      continue;
    }

    // ── STANDARD LAYOUT: 6×4" ──
    for (let copy = 0; copy < 2; copy++) {
      if (!isFirstPage) doc.addPage([W, H], 'landscape');
      isFirstPage = false;

      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, W, H, 'F');
      doc.setTextColor(0, 0, 0);

      // ── Prefix (e.g. "S/D") — bold italic, 1.25× name size, top-left ──
      let ny = M;
      const hasPrefix = !!item.prefix?.trim();
      if (hasPrefix) {
        const prefixSize = Math.min(nameFontSize * 1.25, 60);
        doc.setFont('helvetica', 'bolditalic');
        doc.setFontSize(prefixSize);
        doc.text(item.prefix!.trim(), M, ny + prefixSize * PT_TO_IN);
        const prefixW = doc.getTextWidth(item.prefix!.trim()) + 0.25;

        // Name goes to the right of prefix
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(nameFontSize);
        const nameMaxWWithPrefix = nameMaxW - prefixW;
        const nameWrapped = doc.splitTextToSize(nameText, nameMaxWWithPrefix) as string[];
        let nameY = ny + nameFontSize * PT_TO_IN;
        for (let i = 0; i < Math.min(nameWrapped.length, 2); i++) {
          doc.text(nameWrapped[i], M + prefixW, nameY);
          nameY += nameFontSize * PT_TO_IN * 1.1;
        }
        ny = Math.max(ny + prefixSize * PT_TO_IN * 1.1, nameY);
      } else {
        // ── Name only (dynamic size, full width, up to 2 lines) ──
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(nameFontSize);
        const nameWrapped = doc.splitTextToSize(nameText, nameMaxW) as string[];
        ny += nameFontSize * PT_TO_IN;
        for (let i = 0; i < Math.min(nameWrapped.length, 2); i++) {
          doc.text(nameWrapped[i], M, ny);
          ny += nameFontSize * PT_TO_IN * 1.1;
        }
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

      // ── Extra fields (UPC, Serial, Made In, P/O) below SKU block ──
      {
        const efLines: string[] = [];
        if (item.upc?.trim()) efLines.push(`UPC: ${item.upc.trim()}`);
        if (item.serial_number?.trim()) efLines.push(`SERIAL: ${item.serial_number.trim()}`);
        if (item.made_in?.trim()) efLines.push(`MADE IN: ${item.made_in.trim()}`);
        if (item.po_number?.trim()) efLines.push(`P/O: ${item.po_number.trim()}`);
        if (efLines.length > 0) {
          const efFontSize = Math.round(skuFontSize * 0.4);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(efFontSize);
          doc.setTextColor(0, 0, 0);
          let efY = groupTopY + groupH + efFontSize * PT_TO_IN * 0.3;
          for (const line of efLines) {
            efY += efFontSize * PT_TO_IN;
            doc.text(line, M + skuBgPadX, efY);
            efY += efFontSize * PT_TO_IN * 0.3;
          }
        }
      }

      // ── QR (fills right side of main zone) ──
      const qrY = mainTop + (mainH - qrSize) / 2;
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
