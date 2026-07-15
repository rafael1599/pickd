import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/** One aggregated SKU row of the Overstock / Slow Movers report. */
export interface OverstockRow {
  sku: string;
  itemName: string | null;
  totalQty: number;
  towers: number;
  lines: number;
  towersLines: string;
  spots: number;
  locations: string;
  orders: number;
  units: number;
  lastShipped: string | null;
}

export interface OverstockPdfMeta {
  maxOrders: number;
  /** Order-count window in months. 0 = all time. */
  months: number;
  onlyBikes: boolean;
  /** YYYY-MM-DD stamp for the header + filename. */
  generatedAt: string;
}

/** Build and download a landscape PDF of the overstock report. */
export function generateOverstockPdf(rows: OverstockRow[], meta: OverstockPdfMeta): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const totalUnits = rows.reduce((s, r) => s + r.totalQty, 0);
  const totalTowers = rows.reduce((s, r) => s + r.towers, 0);
  const windowLabel = meta.months > 0 ? `last ${meta.months} mo` : 'all time';

  doc.setFontSize(14);
  doc.text('Overstock / Slow Movers — LUDLOW', 40, 40);
  doc.setFontSize(9);
  doc.text(
    `${meta.onlyBikes ? 'Bikes' : 'All SKUs'} · ≤${meta.maxOrders} orders (${windowLabel}) · ` +
      `${rows.length} SKUs · ${totalUnits} units · ${totalTowers} towers · ${meta.generatedAt}`,
    40,
    56
  );

  autoTable(doc, {
    startY: 70,
    head: [['SKU', 'Stock', 'T / L', 'Spots', 'Locations', 'Orders', 'Units', 'Last shipped']],
    body: rows.map((r) => [
      r.sku,
      String(r.totalQty),
      r.towersLines,
      String(r.spots),
      r.locations,
      String(r.orders),
      String(r.units),
      r.lastShipped ?? '—',
    ]),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [24, 24, 24], textColor: 255 },
    columnStyles: { 4: { cellWidth: 220 } },
  });

  doc.save(`overstock-ludlow-${meta.generatedAt}.pdf`);
}
