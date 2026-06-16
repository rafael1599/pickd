/**
 * Builds the 6×4" ship / info label PDF (the printable counterpart of the
 * on-screen LivePrintPreview) and returns its blob URL.
 *
 * Page A is the customer + order info, auto-sized to the largest font that fits
 * the 6×4 label; when there is more than one pallet, each pallet also gets a
 * Page B with a big "PALLET i of N". Black & white only.
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

  for (let i = 0; i < pallets; i++) {
    // ── PAGE A: COMPANY INFO ──
    if (i > 0) doc.addPage([6, 4], 'landscape');

    const margin = 0.2;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;

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
          const wrapped = doc.splitTextToSize(line, maxWidth);
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
        const wrapped = doc.splitTextToSize(line, maxWidth);
        doc.text(wrapped, margin, yPos);
        yPos += wrapped.length * (fontSize * PT_TO_IN * LINE_HEIGHT);
      }
    }

    const msgFontSize = fontSize * 0.7;
    doc.setFontSize(msgFontSize);
    const msgWrapped = doc.splitTextToSize(thankYouMsg.toUpperCase(), maxWidth);
    doc.text(msgWrapped, margin, yPos);

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
    }
  }

  return doc.output('bloburl') as unknown as string;
}
