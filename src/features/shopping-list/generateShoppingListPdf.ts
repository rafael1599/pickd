/**
 * Generates a printable Shopping List PDF (portrait, letter size).
 * Only includes pending items — sorted urgent-first, then by date.
 */
import type { ShoppingItem } from './hooks/useShoppingList.ts';

export const generateShoppingListPdf = async (items: ShoppingItem[]) => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const pending = items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  if (pending.length === 0) return;

  const doc = new jsPDF('p', 'mm', 'letter'); // portrait, letter
  const pageW = doc.internal.pageSize.getWidth();

  const today = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // ── Header ────────────────────────────────────────────────

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(0, 0, 0);
  doc.text('SHOPPING LIST', 15, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  doc.text(`${today}  ·  ${pending.length} items`, 15, 28);

  // ── Table ─────────────────────────────────────────────────

  const body = pending.map((item, idx) => [
    (idx + 1).toString(),
    item.urgent ? '!' : '',
    item.item_name,
    item.quantity || '',
    item.requested_by_name || '',
    '', // checkbox column
  ]);

  autoTable(doc, {
    startY: 35,
    head: [['#', '', 'Item', 'Qty', 'Requested By', '✓']],
    body,
    theme: 'plain',
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [80, 80, 80],
      font: 'helvetica',
      fontSize: 9,
      fontStyle: 'bold',
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
    },
    styles: {
      font: 'helvetica',
      fontSize: 12,
      cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
      textColor: [30, 30, 30],
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', fontSize: 9, textColor: [150, 150, 150] },
      1: {
        cellWidth: 8,
        halign: 'center',
        fontSize: 14,
        textColor: [220, 50, 50],
        fontStyle: 'bold',
      },
      2: { cellWidth: 'auto', fontStyle: 'bold' },
      3: { cellWidth: 30 },
      4: { cellWidth: 35, fontSize: 10, textColor: [120, 120, 120] },
      5: { cellWidth: 14, halign: 'center' },
    },
    didDrawCell: (data) => {
      // Draw empty checkbox in the last column
      if (data.section === 'body' && data.column.index === 5) {
        const cx = data.cell.x + data.cell.width / 2;
        const cy = data.cell.y + data.cell.height / 2;
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.4);
        doc.rect(cx - 2.5, cy - 2.5, 5, 5);
      }
    },
    margin: { left: 15, right: 15, top: 10, bottom: 15 },
    didDrawPage: () => {
      // Footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text('PickD — Shopping List', 15, doc.internal.pageSize.getHeight() - 8);
      doc.text(today, pageW - 15, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    },
  });

  const blob = doc.output('bloburl');
  window.open(blob as string, '_blank');
};
