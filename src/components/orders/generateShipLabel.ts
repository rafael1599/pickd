/**
 * Builds the 6×4" ship / info label PDF (the printable counterpart of the
 * on-screen LivePrintPreview) and returns its blob URL.
 *
 * Page A is the customer + order info, auto-sized to the largest font that fits
 * the 6×4 label; when there is more than one pallet, each pallet also gets a
 * Page B with a big "PALLET i of N". Black & white only.
 *
 * Rafael, 29 sep 2026: the carrier's logo, in black and white, top right of
 * every label (`TRANSPORT_LOGOS_BW`); and one **last label, everything turned
 * 90° to the right** — the order number big across the whole height of the
 * label, the bike shop smaller, «N PALLETS», and the carrier's logo big. Read
 * with the head tilted, it is the side a forklift driver sees.
 *
 * Extracted from OrdersScreen so the layout is unit-testable; the screen keeps
 * the order-saving flow and just calls this with the form data.
 */
function unitsLines(bikes: number, parts: number): string[] {
  const lines: string[] = [];
  if (bikes > 0) lines.push(`BIKES: ${bikes}`);
  if (parts > 0) lines.push(`PARTS: ${parts}`);
  if (lines.length === 0) lines.push('UNITS: 0');
  return lines;
}

import type { LabelLogo } from './labelLogo';

export interface ShipLabelData {
  customerName: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  orderNumber: string | null;
  pallets: number;
  bikeCount: number;
  partCount: number;
  weightLbs: number;
  loadNumber: string | null;
  /** `transport_company`: names the carrier on the side label when it has no logo. */
  carrier?: string | null;
  /** The carrier's black-and-white logo (`loadLabelLogo`), or null for none. */
  logo?: LabelLogo | null;
  /** The last, sideways label. On unless a caller turns it off. */
  sideLabel?: boolean;
}

/** Top-right logo box on every label, in inches. */
const LOGO_MAX_W = 1.7;
const LOGO_MAX_H = 0.62;

/** The largest w × h with the image's proportion that fits the box. */
function fitBox(imgW: number, imgH: number, maxW: number, maxH: number) {
  const k = Math.min(maxW / imgW, maxH / imgH);
  return { w: imgW * k, h: imgH * k };
}

export async function generateShipLabel(data: ShipLabelData): Promise<string> {
  const { default: jsPDF } = await import('jspdf');

  // 6×4" landscape — matches the Zebra label printer, no scaling needed.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [6, 4] });

  const pageWidth = 6;
  const pageHeight = 4;
  const PT_TO_IN = 1 / 72;
  const LINE_HEIGHT = 1.1;
  const customerNameName = (data.customerName || 'GENERIC CUSTOMER').toUpperCase();
  const street = (data.street || '').toUpperCase();
  const cityStateZip = `${(data.city || '').toUpperCase()}, ${(data.state || '').toUpperCase()} ${data.zip || ''}`;
  const pallets = data.pallets;
  const logo = data.logo ?? null;
  const logoBox = logo ? fitBox(logo.width, logo.height, LOGO_MAX_W, LOGO_MAX_H) : null;
  /** The logo, top right. Everything written beside it keeps clear of it. */
  const drawLogo = () => {
    if (!logo || !logoBox) return;
    doc.addImage(logo.dataUrl, 'PNG', pageWidth - 0.2 - logoBox.w, 0.2, logoBox.w, logoBox.h);
  };

  for (let i = 0; i < pallets; i++) {
    // ── PAGE A: COMPANY INFO ──
    if (i > 0) doc.addPage([6, 4], 'landscape');

    const margin = 0.2;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    // A line whose top falls beside the logo wraps narrower, so they never touch.
    const bandBottom = logoBox ? margin + logoBox.h + 0.06 : -Infinity;
    const narrowWidth = logoBox ? maxWidth - logoBox.w - 0.15 : maxWidth;
    const widthAt = (lineTop: number) => (lineTop < bandBottom ? narrowWidth : maxWidth);

    const contentLines: string[] = [];
    contentLines.push(customerNameName);
    if (street) contentLines.push(street);
    if (data.city) contentLines.push(cityStateZip);
    contentLines.push(''); // spacer
    contentLines.push(`ORDER #: ${data.orderNumber || 'N/A'}`);
    contentLines.push(`PALLETS: ${pallets}`);
    contentLines.push(...unitsLines(data.bikeCount, data.partCount));
    contentLines.push(`LOAD: ${data.loadNumber || 'N/A'}`);
    contentLines.push(`WEIGHT: ${data.weightLbs > 0 ? `${data.weightLbs} LBS` : 'N/A'}`);
    contentLines.push(''); // spacer
    const thankYouMsg =
      'Please count your shipment carefully that there are no damages due to shipping. Jamis Bicycles thanks you for your order.';

    // Dynamic font sizing: largest font that fits all content.
    let fontSize = 100;
    const minFontSize = 12;
    let fits = false;

    doc.setFont('helvetica', 'bold');

    while (fontSize >= minFontSize && !fits) {
      doc.setFontSize(fontSize);
      doc.setLineHeightFactor(LINE_HEIGHT);

      let totalHeight = margin;

      for (const line of contentLines) {
        if (line === '') {
          totalHeight += fontSize * PT_TO_IN * 0.3;
        } else {
          const wrapped = doc.splitTextToSize(line, widthAt(totalHeight));
          totalHeight += wrapped.length * (fontSize * PT_TO_IN * LINE_HEIGHT);
        }
      }

      const msgFontSize = fontSize * 0.7;
      doc.setFontSize(msgFontSize);
      const msgWrapped = doc.splitTextToSize(thankYouMsg.toUpperCase(), maxWidth);
      totalHeight += msgWrapped.length * (msgFontSize * PT_TO_IN * LINE_HEIGHT);

      if (totalHeight <= maxHeight) {
        fits = true;
      } else {
        fontSize -= 1;
      }
    }

    // Render with the calculated font size.
    let yPos = margin + fontSize * PT_TO_IN;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setLineHeightFactor(LINE_HEIGHT);

    for (const line of contentLines) {
      if (line === '') {
        yPos += fontSize * PT_TO_IN * 0.3;
      } else {
        const wrapped = doc.splitTextToSize(line, widthAt(yPos - fontSize * PT_TO_IN));
        doc.text(wrapped, margin, yPos);
        yPos += wrapped.length * (fontSize * PT_TO_IN * LINE_HEIGHT);
      }
    }

    const msgFontSize = fontSize * 0.7;
    doc.setFontSize(msgFontSize);
    const msgWrapped = doc.splitTextToSize(thankYouMsg.toUpperCase(), maxWidth);
    doc.text(msgWrapped, margin, yPos);
    drawLogo();

    // ── PAGE B: PALLET NUMBER (only when more than one pallet) ──
    if (pallets > 1) {
      doc.addPage([6, 4], 'landscape');
      doc.setFont('helvetica', 'bold');

      doc.setFontSize(48);
      const labelText = 'PALLET';
      const labelWidth = doc.getTextWidth(labelText);
      doc.text(labelText, (pageWidth - labelWidth) / 2, pageHeight / 2 - 0.4);

      doc.setFontSize(80);
      const textNum = `${i + 1} of ${pallets}`;
      const textWidth = doc.getTextWidth(textNum);
      doc.text(textNum, (pageWidth - textWidth) / 2, pageHeight / 2 + 0.8);
      drawLogo();
    }
  }

  if (data.sideLabel !== false) drawSideLabel(doc, data, customerNameName, pageWidth, pageHeight);

  return doc.output('bloburl') as unknown as string;
}

type Doc = InstanceType<typeof import('jspdf').jsPDF>;

/**
 * The last label, turned 90° to the right: read with the head tilted, it goes
 * from the right edge of the page to the left — the order number big along
 * the whole height, the bike shop, «N PALLETS», and the carrier's logo big in
 * what is left. Text turned clockwise (`angle: -90`) runs downwards with the
 * tops of its letters to the right, so each column's baseline sits at its
 * left and the next column starts left of it.
 */
function drawSideLabel(
  doc: Doc,
  data: ShipLabelData,
  customerName: string,
  pageWidth: number,
  pageHeight: number
) {
  const PT_TO_IN = 1 / 72;
  const CAP = 0.72; // Helvetica Bold cap height, per point
  const DESC = 0.22; // room below the baseline for a comma or a J
  const margin = 0.2;
  const length = pageHeight - margin * 2;

  doc.addPage([6, 4], 'landscape');
  doc.setFont('helvetica', 'bold');
  let cursor = pageWidth - margin;

  /** One sideways line, as big as it fits along the height, up to `maxPt`. */
  const column = (text: string, maxPt: number, gap: number) => {
    doc.setFontSize(100);
    const at100 = doc.getTextWidth(text);
    const size = Math.max(10, Math.min(maxPt, (100 * length) / Math.max(at100, 0.01)));
    doc.setFontSize(size);
    const w = doc.getTextWidth(text);
    const baseline = cursor - size * CAP * PT_TO_IN;
    doc.text(text, baseline, margin + (length - w) / 2, { angle: -90 });
    cursor = baseline - size * DESC * PT_TO_IN - gap;
  };

  // The order number takes the whole height; its letters are never taller
  // than half the label is wide, so the rest still has room.
  column(data.orderNumber || 'N/A', (pageWidth * 0.42) / (CAP * PT_TO_IN), 0.2);
  column(customerName, 40, 0.18);
  column(`${data.pallets} ${data.pallets === 1 ? 'PALLET' : 'PALLETS'}`, 54, 0.22);

  const band = cursor - margin;
  if (band <= 0.3) return;
  const logo = data.logo ?? null;
  if (logo) {
    // Turned, the logo's width runs along the label's height.
    const box = fitBox(logo.height, logo.width, band, length);
    doc.addImage(
      logo.rotatedDataUrl,
      'PNG',
      margin + (band - box.w) / 2,
      margin + (length - box.h) / 2,
      box.w,
      box.h
    );
  } else if (data.carrier) {
    column(data.carrier.toUpperCase(), (band * 0.9) / ((CAP + DESC) * PT_TO_IN), 0);
  }
}
