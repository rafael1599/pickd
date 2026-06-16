/**
 * Builds the 6×4" pallet-labelling PDF and returns its blob URL.
 *
 * Per pallet it emits two landscape pages: a company-info page (professional
 * layout when an address is known, else a big centred customer name) and a
 * numbering page ("i OF N"). Black & white only.
 *
 * Extracted from PalletLabelsPrinter so the layout is unit-testable; the
 * component keeps the surrounding form/persistence logic.
 */
export interface PalletLabelData {
  pallets: number;
  customerName: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  orderNumber: string | null;
  loadNumber: string;
}

export async function generatePalletLabels(data: PalletLabelData): Promise<string> {
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [6, 4] });

  const { pallets, street, city, state, zip, orderNumber, loadNumber } = data;
  const customerName = (data.customerName || 'GENERIC CUSTOMER').toUpperCase();
  const hasAddress = Boolean(street && city);

  for (let i = 0; i < pallets; i++) {
    // ── PAGE A: COMPANY INFO ──
    if (i > 0) doc.addPage([6, 4], 'landscape');

    if (hasAddress) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      const nameLines = doc.splitTextToSize(customerName, 5.5);
      doc.text(nameLines, 0.5, 0.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(18);
      doc.text(`${street}`, 0.5, 1.4);
      doc.text(`${city}, ${state} ${zip}`, 0.5, 1.7);

      doc.setLineWidth(0.05);
      doc.line(0.5, 2.1, 5.5, 2.1);

      doc.setFontSize(14);
      doc.text(`ORDER #: ${orderNumber || 'N/A'}`, 0.5, 2.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(32);
      doc.text(`LOAD: ${loadNumber}`, 0.5, 3.2);

      doc.setFontSize(12);
      doc.text(`DATE: ${new Date().toLocaleDateString()}`, 0.5, 3.7);
    } else {
      let fontSize = 70;
      if (customerName.length > 20) fontSize = 50;
      if (customerName.length > 35) fontSize = 35;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      const customerLines = doc.splitTextToSize(customerName, 5.5);
      const textHeight = (customerLines.length * fontSize) / 72;
      doc.text(customerLines, 3, 2.0 - textHeight / 2, { align: 'center' });

      doc.setFontSize(24);
      doc.text(`LOAD: ${loadNumber}`, 3, 3.5, { align: 'center' });
    }

    // ── PAGE B: NUMBERING ──
    doc.addPage([6, 4], 'landscape');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(110);
    const textNum = `${i + 1} OF ${pallets}`;
    const numWidth = doc.getTextWidth(textNum);
    doc.text(textNum, (6 - numWidth) / 2, 2.3);

    doc.setFontSize(12);
    doc.text(`LOAD: ${loadNumber}`, 3, 3.8, { align: 'center' });
  }

  return doc.output('bloburl') as unknown as string;
}
