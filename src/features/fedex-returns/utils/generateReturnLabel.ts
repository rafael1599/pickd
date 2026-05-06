/**
 * Generates a printable PDF with 2 identical return labels on a single 4×6"
 * thermal label sheet (portrait). User cuts the sheet in half and attaches
 * one label to each side of the box.
 *
 * Each label contains: tracking number (large), QR code, CODE_128 barcode,
 * received info. Pure black on white, large fonts.
 */

export interface ReturnLabelData {
  trackingNumber: string;
  receivedAt: string | null;
  receivedByName: string | null;
  notes?: string | null;
  /** RMA / Return Merchandise Authorization number. When present, the label
   *  prints "RMA#: XXX". When null/empty it prints "RMA#: __________"
   *  (a fillable blank for hand-writing on the printed sheet). */
  rma?: string | null;
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

  // 4×6" portrait thermal sheet → split into 2 labels of 4×3"
  const W = 4;
  const H = 6;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: [W, H] });

  // Generate QR code
  const qrDataUrl = await QRCode.toDataURL(data.trackingNumber, {
    width: 400,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  // Generate CODE_128 barcode
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
    const labelH = 3; // half of 6"
    const pad = 0.15;

    // Header: FEDEX RETURN
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('FEDEX RETURN', W / 2, yOffset + pad + 0.15, { align: 'center' });

    // Huge tracking number
    doc.setFontSize(24);
    doc.text(data.trackingNumber, W / 2, yOffset + pad + 0.6, { align: 'center' });

    // Horizontal rule under tracking
    doc.setLineWidth(0.03);
    doc.line(pad, yOffset + pad + 0.75, W - pad, yOffset + pad + 0.75);

    // QR code — left
    const qrSize = 1.2;
    const qrX = pad + 0.05;
    const qrY = yOffset + pad + 0.9;
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // CODE_128 barcode — right of QR
    const bcX = qrX + qrSize + 0.1;
    const bcY = qrY + 0.1;
    const bcW = W - bcX - pad;
    const bcH = 0.7;
    doc.addImage(barcodeDataUrl, 'PNG', bcX, bcY, bcW, bcH);

    // Tracking number under barcode (human-readable)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(data.trackingNumber, bcX + bcW / 2, bcY + bcH + 0.22, { align: 'center' });

    // Horizontal rule above bottom info
    doc.setLineWidth(0.02);
    doc.line(pad, qrY + qrSize + 0.1, W - pad, qrY + qrSize + 0.1);

    // Bottom info row — RMA on the LEFT (matches the serial print size
    // under the barcode so it stays prominent and easy to fill in by hand),
    // RECEIVED date on the RIGHT in the smaller secondary size.
    const infoY = qrY + qrSize + 0.3;

    // RMA — printed value when known, fillable blank when not.
    const rma = (data.rma ?? '').trim();
    const rmaText = rma ? `RMA#: ${rma}` : 'RMA#: __________';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(rmaText, pad + 0.05, infoY);

    // RECEIVED date — right-aligned, smaller weight for the secondary slot.
    const receivedDate = formatDate(data.receivedAt);
    if (receivedDate) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`RECEIVED: ${receivedDate}`, W - pad - 0.05, infoY, { align: 'right' });
    }
    doc.setFont('helvetica', 'normal');

    // Bottom border of label
    doc.setLineWidth(0.02);
    doc.line(pad, yOffset + labelH - 0.05, W - pad, yOffset + labelH - 0.05);
  };

  // Two labels (top and bottom halves of the sheet)
  drawLabel(0);
  drawLabel(3);

  // Cut line (dashed) in the middle
  doc.setLineDashPattern([0.08, 0.08], 0);
  doc.setLineWidth(0.02);
  doc.line(0, 3, W, 3);
  doc.setLineDashPattern([], 0);

  // "CUT HERE" indicator
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('— CUT HERE —', W / 2, 3, { align: 'center', baseline: 'middle' });

  return doc.output('dataurlstring');
}

/**
 * Opens a new window with the generated PDF and triggers print dialog.
 */
export async function printReturnLabel(data: ReturnLabelData): Promise<void> {
  const dataUrl = await generateReturnLabel(data);
  const w = window.open('');
  if (!w) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `return-label-${data.trackingNumber}.pdf`;
    link.click();
    return;
  }
  w.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:0"></iframe>`);
  w.document.close();
}
