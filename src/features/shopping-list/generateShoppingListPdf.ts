/**
 * Generates a printable Shopping List PDF on 4×6" thermal label stock (portrait).
 * Only includes pending items — sorted urgent-first, then by date.
 * Black & white only. Minimum font size: 14pt.
 */
import type { ShoppingItem } from './hooks/useShoppingList.ts';

// 4×6 inches in mm
const W = 4 * 25.4; // 101.6
const H = 6 * 25.4; // 152.4
const M = 3; // margin mm
const BLACK: [number, number, number] = [0, 0, 0];

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
  doc.setTextColor(...BLACK);
  doc.text('SHOPPING LIST', M, 7);

  // ── Separator ─────────────────────────────────────────────

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(M, 9, W - M, 9);

  // ── Table ─────────────────────────────────────────────────

  const body = pending.map((item) => [item.item_name, item.quantity || '', '']);

  autoTable(doc, {
    startY: 11,
    head: [['Item', 'Qty', '✓']],
    body,
    theme: 'plain',
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      font: 'helvetica',
      fontSize: 14,
      fontStyle: 'bold',
      lineColor: BLACK,
      lineWidth: 0.4,
      cellPadding: { top: 2, bottom: 2, left: 2, right: 1 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 16,
      cellPadding: { top: 3, bottom: 3, left: 2, right: 1 },
      lineColor: BLACK,
      lineWidth: 0.2,
      textColor: BLACK,
      valign: 'middle',
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 10, halign: 'center' },
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const cx = data.cell.x + data.cell.width / 2;
        const cy = data.cell.y + data.cell.height / 2;
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.5);
        doc.rect(cx - 2.5, cy - 2.5, 5, 5);
      }
    },
    margin: { left: M, right: M, top: 5, bottom: 8 },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...BLACK);
      doc.text('PickD', M, pageH - 3);
      doc.text(today, W - M, pageH - 3, { align: 'right' });
    },
  });

  const blob = doc.output('bloburl');
  window.open(blob as string, '_blank');
};
