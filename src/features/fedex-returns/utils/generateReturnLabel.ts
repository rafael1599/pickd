/**
 * Generates a printable PDF with 2 identical return labels on a single Letter sheet.
 * User cuts the sheet in half and attaches each label to a different side of the box.
 *
 * Each label contains: tracking number (huge), QR code, CODE_128 barcode, received info.
 * Pure black on white, large fonts.
 */

export interface ReturnLabelData {
  trackingNumber: string;
  receivedAt: string | null;
  receivedByName: string | null;
  notes?: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export async function generateReturnLabel(data: ReturnLabelData): Promise<string> {
  const [{ default: jsPDF }, QRCode, { default: JsBarcode }] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
    import('jsbarcode'),
  ]);

  // Letter portrait: 8.5 x 11"
  const W = 8.5;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });

  // Generate QR code (high contrast, large)
  const qrDataUrl = await QRCode.toDataURL(data.trackingNumber, {
    width: 500,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  // Generate CODE_128 barcode on an off-screen canvas, convert to data URL
  const barcodeCanvas = document.createElement('canvas');
  JsBarcode(barcodeCanvas, data.trackingNumber, {
    format: 'CODE128',
    width: 3,
    height: 80,
    displayValue: false,
    margin: 0,
    background: '#FFFFFF',
    lineColor: '#000000',
  });
  const barcodeDataUrl = barcodeCanvas.toDataURL('image/png');

  // ── Draw one label at vertical offset yOffset ──
  const drawLabel = (yOffset: number) => {
    const labelH = 5.5; // half of Letter
    const pad = 0.4;

    // Huge tracking number (top)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(54);
    doc.setTextColor(0, 0, 0);
    doc.text(data.trackingNumber, W / 2, yOffset + pad + 0.6, { align: 'center' });

    // "FEDEX RETURN" label above tracking
    doc.setFontSize(18);
    doc.text('FEDEX RETURN', W / 2, yOffset + pad + 0.15, { align: 'center' });

    // Horizontal rule under header
    doc.setLineWidth(0.04);
    doc.line(pad, yOffset + pad + 0.9, W - pad, yOffset + pad + 0.9);

    // QR code — left, large
    const qrSize = 2.6;
    const qrX = pad + 0.1;
    const qrY = yOffset + pad + 1.1;
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // CODE_128 barcode — right of QR, stacked with label number
    const bcX = qrX + qrSize + 0.3;
    const bcY = qrY + 0.1;
    const bcW = W - bcX - pad;
    const bcH = 1.4;
    doc.addImage(barcodeDataUrl, 'PNG', bcX, bcY, bcW, bcH);

    // Tracking number again under barcode (readable)
    doc.setFontSize(28);
    doc.text(data.trackingNumber, bcX + bcW / 2, bcY + bcH + 0.4, { align: 'center' });

    // Info below barcode (right side, below tracking text)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    const infoY = bcY + bcH + 0.9;
    const receivedDate = formatDate(data.receivedAt);
    if (receivedDate) {
      doc.text(`RECEIVED: ${receivedDate}`, bcX, infoY);
    }
    if (data.receivedByName) {
      doc.text(`BY: ${data.receivedByName.toUpperCase()}`, bcX, infoY + 0.3);
    }

    // Bottom border of label
    doc.setLineWidth(0.02);
    doc.line(pad, yOffset + labelH - 0.05, W - pad, yOffset + labelH - 0.05);
  };

  // Two labels (top and bottom halves of the sheet)
  drawLabel(0);
  drawLabel(5.5);

  // Cut line (dashed) in the middle
  doc.setLineDashPattern([0.1, 0.1], 0);
  doc.setLineWidth(0.02);
  doc.line(0, 5.5, W, 5.5);
  doc.setLineDashPattern([], 0);

  // "CUT HERE" indicator
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('— CUT HERE —', W / 2, 5.5 + 0.01, { align: 'center', baseline: 'middle' });

  return doc.output('dataurlstring');
}

/**
 * Opens a new window with the generated PDF and triggers print dialog.
 */
export async function printReturnLabel(data: ReturnLabelData): Promise<void> {
  const dataUrl = await generateReturnLabel(data);
  const w = window.open('');
  if (!w) {
    // Popup blocked — fallback to direct download link
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `return-label-${data.trackingNumber}.pdf`;
    link.click();
    return;
  }
  w.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:0"></iframe>`);
  w.document.close();
}
