/**
 * Builds the landscape A4 "inventory by warehouse" PDF (one SKU / LOCATIONS /
 * TOTAL table per warehouse) and returns its blob URL. Black & white only.
 *
 * Extracted from InventoryScreen so the layout is unit-testable; the screen
 * keeps its button/loading state and just calls this. PDF output is unchanged.
 */

/** jspdf-autotable extends the jsPDF instance with lastAutoTable after a call. */
interface JsPDFWithAutoTable {
  lastAutoTable?: { finalY: number };
}

export interface InventoryBlock {
  /** Warehouse name. */
  wh: string;
  items: { sku: string; quantity: number; location?: string | null }[];
}

export async function generateInventoryPdf(blocks: InventoryBlock[]): Promise<string> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const today = new Date().toLocaleDateString('es-ES');

  // Group items by Warehouse → SKU, keeping per-location qty so the PDF can
  // render each location with its individual quantity: ROW 1 (40), ROW 28 (27)
  const whAggregates: Record<
    string,
    Record<string, { qty: number; locations: Map<string, number> }>
  > = {};

  blocks.forEach((block) => {
    if (!whAggregates[block.wh]) whAggregates[block.wh] = {};
    const whGroup = whAggregates[block.wh];

    block.items.forEach((item) => {
      if (!whGroup[item.sku]) {
        whGroup[item.sku] = { qty: 0, locations: new Map() };
      }
      whGroup[item.sku].qty += item.quantity;
      const loc = item.location?.trim().toUpperCase();
      if (loc) {
        whGroup[item.sku].locations.set(
          loc,
          (whGroup[item.sku].locations.get(loc) ?? 0) + item.quantity
        );
      }
    });
  });

  let currentY = 15;

  Object.entries(whAggregates).forEach(([wh, skuGroups], index) => {
    if (index > 0 && currentY > 150) {
      doc.addPage();
      currentY = 15;
    }

    const totalSkus = Object.keys(skuGroups).length;
    const totalQty = Object.values(skuGroups).reduce((sum, g) => sum + g.qty, 0);

    // Header per warehouse: "LUDLOW · 156 SKUs · 4,287 units · 2026-04-29"
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(
      `${wh} · ${totalSkus} SKUs · ${totalQty.toLocaleString()} units · ${today}`,
      5,
      currentY
    );
    currentY += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('SKU', 5, currentY);
    doc.text('LOCATIONS', 105, currentY);
    doc.text('TOTAL', 285, currentY, { align: 'right' });
    currentY += 4;

    // SKU | LOCATIONS | TOTAL. Drop "(qty)" for single-location SKUs (the TOTAL
    // already shows it); multi-location keeps per-loc "(qty)" since they sum.
    const tableData = Object.entries(skuGroups)
      .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
      .map(([sku, data]) => {
        const stockedLocs = Array.from(data.locations.entries())
          .filter(([, qty]) => qty > 0)
          .sort(([a], [b]) => a.localeCompare(b));
        let locsStr: string;
        if (stockedLocs.length === 0) {
          locsStr = 'GEN';
        } else if (stockedLocs.length === 1) {
          locsStr = stockedLocs[0][0];
        } else {
          locsStr = stockedLocs.map(([loc, qty]) => `${loc} (${qty.toLocaleString()})`).join(', ');
        }
        return [sku, locsStr, data.qty.toLocaleString()];
      });

    autoTable(doc, {
      startY: currentY,
      body: tableData,
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 32,
        cellPadding: 5,
        minCellHeight: 16,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.6,
      },
      columnStyles: {
        0: { cellWidth: 100, fontStyle: 'bold' },
        1: { cellWidth: 'auto', fontSize: 18 },
        2: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
      },
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
    });

    currentY = ((doc as unknown as JsPDFWithAutoTable).lastAutoTable?.finalY ?? 15) + 12;
  });

  return doc.output('bloburl') as unknown as string;
}
