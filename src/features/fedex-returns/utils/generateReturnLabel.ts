/**
 * Generates a printable 4×6" vertical thermal label for a FedEx return.
 * Single label per page — the thermal printer can produce multiple copies
 * to attach to different sides of the box (print dialog "Copies: 2").
 *
 * Layout mirrors the previous Letter version scaled for 4×6":
 *   - FEDEX RETURN header (top)
 *   - Huge tracking number
 *   - Horizontal rule
 *   - QR (left) + CODE_128 (right) + tracking under barcode
 *   - RECEIVED / BY info (bottom)
 *
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

  // 4×6" portrait thermal label
  const W = 4;
  const H = 6;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: [W, H] });

  // Generate QR code (high contrast, large)
  const qrDataUrl = await QRCode.toDataURL(data.trackingNumber, {
    width: 400,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  // Generate CODE_128 barcode on an off-screen canvas
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

  const pad = 0.2;

  // Header: FEDEX RETURN
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('FEDEX RETURN', W / 2, pad + 0.2, { align: 'center' });

  // Huge tracking number
  doc.setFontSize(32);
  doc.text(data.trackingNumber, W / 2, pad + 0.9, { align: 'center' });

  // Horizontal rule under tracking
  doc.setLineWidth(0.03);
  doc.line(pad, pad + 1.15, W - pad, pad + 1.15);

  // QR code — left
  const qrSize = 1.7;
  const qrX = pad + 0.05;
  const qrY = pad + 1.35;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  // CODE_128 barcode — right of QR
  const bcX = qrX + qrSize + 0.15;
  const bcY = qrY + 0.1;
  const bcW = W - bcX - pad;
  const bcH = 0.9;
  doc.addImage(barcodeDataUrl, 'PNG', bcX, bcY, bcW, bcH);

  // Tracking number under barcode (human-readable)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(data.trackingNumber, bcX + bcW / 2, bcY + bcH + 0.3, { align: 'center' });

  // RECEIVED / BY info — below QR, full width
  doc.setFontSize(12);
  const infoY = qrY + qrSize + 0.45;
  const receivedDate = formatDate(data.receivedAt);
  if (receivedDate) {
    doc.text(`RECEIVED: ${receivedDate}`, pad + 0.1, infoY);
  }
  if (data.receivedByName) {
    doc.text(`BY: ${data.receivedByName.toUpperCase()}`, pad + 0.1, infoY + 0.28);
  }

  // Horizontal rule above bottom info
  doc.setLineWidth(0.02);
  doc.line(pad, qrY + qrSize + 0.2, W - pad, qrY + qrSize + 0.2);

  // Bottom border
  doc.setLineWidth(0.02);
  doc.line(pad, H - 0.1, W - pad, H - 0.1);

  return doc.output('dataurlstring');
}

/**
 * Opens a new window with the generated PDF and triggers print dialog.
 * Set "Copies: 2" in the print dialog if you want labels for both sides of the box.
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
