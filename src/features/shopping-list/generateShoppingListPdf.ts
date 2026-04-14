/**
 * Generates a printable Shopping List PDF on 4×6" thermal label stock (portrait).
 * Only includes pending items — sorted urgent-first, then by date.
 */
import type { ShoppingItem } from './hooks/useShoppingList.ts';

// 4×6 inches in mm
const W = 4 * 25.4; // 101.6
const H = 6 * 25.4; // 152.4
const M = 3; // margin mm

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

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] });

  const today = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  }).format(new Date());

  // ── Header ────────────────────────────────────────────────

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('SHOPPING LIST', M, 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(`${today}  ·  ${pending.length} items`, M, 12);

  // ── Separator ─────────────────────────────────────────────

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(M, 14, W - M, 14);

  // ── Table ─────────────────────────────────────────────────

  const body = pending.map((item) => [
    item.urgent ? '!' : '',
    item.item_name,
    item.quantity || '',
    '', // checkbox
  ]);

  autoTable(doc, {
    startY: 16,
    head: [['', 'Item', 'Qty', '✓']],
    body,
    theme: 'plain',
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [80, 80, 80],
      font: 'helvetica',
      fontSize: 6,
      fontStyle: 'bold',
      lineColor: [200, 200, 200],
      lineWidth: 0.2,
      cellPadding: { top: 1.5, bottom: 1.5, left: 1.5, right: 1 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1 },
      lineColor: [220, 220, 220],
      lineWidth: 0.15,
      textColor: [30, 30, 30],
      valign: 'middle',
      overflow: 'linebreak',
    },
    columnStyles: {
      0: {
        cellWidth: 5,
        halign: 'center',
        fontSize: 9,
        textColor: [220, 50, 50],
        fontStyle: 'bold',
      },
      1: { cellWidth: 'auto', fontStyle: 'bold' },
      2: { cellWidth: 18 },
      3: { cellWidth: 8, halign: 'center' },
    },
    didDrawCell: (data) => {
      // Draw empty checkbox
      if (data.section === 'body' && data.column.index === 3) {
        const cx = data.cell.x + data.cell.width / 2;
        const cy = data.cell.y + data.cell.height / 2;
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.rect(cx - 1.8, cy - 1.8, 3.6, 3.6);
      }
    },
    margin: { left: M, right: M, top: 5, bottom: 8 },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(160, 160, 160);
      doc.text('PickD', M, pageH - 3);
      doc.text(today, W - M, pageH - 3, { align: 'right' });
    },
  });

  const blob = doc.output('bloburl');
  window.open(blob as string, '_blank');
};
