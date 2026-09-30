/**
 * Generates a Picking List PDF based on a pre-ordered sequence.
 */
import { guardPdfText } from './pdfText';
export const generatePickingPdf = async (
  finalSequence: {
    sku: string;
    location: string | null;
    warehouse?: string;
    palletId?: number;
    pickingQty?: number;
    isPicked?: boolean;
    key?: string;
  }[],
  orderNumber?: string,
  totalPallets: number = 0
) => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF('l', 'mm', 'a4');

  guardPdfText(doc);
  const todayRaw = new Date();
  const today = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(todayRaw);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(0, 0, 0);
  doc.text('PICKING LIST', 5, 15);

  const metadataLine = `Generated: ${today}${orderNumber ? ` | Order: #${orderNumber}` : ''} | Pallets: ${totalPallets}`;

  let startY = 32; // Increased from 22

  // --- Picking Sequence Table ---
  const verifiedCount = finalSequence.filter((item) => item.isPicked).length;

  const sequenceData = finalSequence.map((item, idx) => [
    (idx + 1).toString(),
    item.sku,
    `${item.location}${item.warehouse ? ` / ${item.warehouse}` : ''}`,
    `P${item.palletId}`,
    item.pickingQty?.toString() || '0',
    item.isPicked ? 'VERIFIED' : '',
  ]);

  if (sequenceData.length > 0) {
    doc.setFontSize(28);
    doc.text(`SEQUENCE (Verified: ${verifiedCount}/${finalSequence.length})`, 5, startY);
    startY += 8; // Increased from 5 for more separation

    autoTable(doc, {
      startY: startY,
      head: [['#', 'SKU', 'Loc / WH', 'Pal', 'Qty', 'Check']],
      body: sequenceData,
      theme: 'plain',
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: 0,
        font: 'helvetica',
        fontSize: 20,
        fontStyle: 'bold',
        lineColor: [0, 0, 0],
        lineWidth: 1.1,
      },
      styles: {
        font: 'helvetica',
        fontSize: 40,
        cellPadding: 6,
        minCellHeight: 20,
        overflow: 'linebreak',
        lineColor: [0, 0, 0],
        lineWidth: 1.1,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center', fontSize: 16 },
        1: { cellWidth: 100, fontStyle: 'bold' },
        2: { cellWidth: 'auto', fontSize: 20 },
        3: { cellWidth: 20, halign: 'center', fontSize: 20 },
        4: { cellWidth: 25, halign: 'center', fontStyle: 'bold' },
        5: { halign: 'center', cellWidth: 40 },
      },
      didDrawCell: (data) => {
        if (
          data.section === 'body' &&
          data.column.index === 5 &&
          data.cell.text[0] === 'VERIFIED'
        ) {
          const x = data.cell.x + data.cell.width / 2;
          const y = data.cell.y + data.cell.height / 2;

          // Draw Green Checkmark manually
          doc.setDrawColor(22, 163, 74); // Green
          doc.setLineWidth(1.0);
          doc.line(x - 4, y + 1, x - 1, y + 4);
          doc.line(x - 1, y + 4, x + 5, y - 4);

          // Clear the placeholder text so it doesn't print
          data.cell.text[0] = '';
        }
      },
      margin: { left: 5, right: 5, top: 5, bottom: 5 },
      didDrawPage: () => {
        // Footer metadata
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(metadataLine, 292, 205, { align: 'right' });
      },
    });

    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
  }

  // Optional: Group by pallets if needed, but the user asked for "filament by filament" based on finalSequence.
  // However, for clarity, we can still show a summary or just stick to the sequence as requested.
  // The user said: "Simplemente recibirá esta finalSequence y la imprimirá tal cual fila por fila."
  // So I will stop here to keep it "dumb".

  doc.save(`picking_list_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`);
};
