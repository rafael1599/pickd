/**
 * Builds the 6×4" daily-history thermal-label PDF and returns the jsPDF doc.
 *
 * Two modes:
 *  - 'full'   — the detailed SKU / ACTIVITY / QTY table (every action with notes).
 *  - 'as400'  — a stock snapshot for AS400 reconciliation: per SKU that moved, where
 *               it was MOVED FROM today (sources + qty) and its CURRENT STOCK now
 *               (location = total). SKUs now split across 2+ locations get a per-SKU
 *               TOTAL column in a separate table. No move-by-move detail.
 *
 * Extracted from HistoryScreen so the layout is unit-testable. Black & white only.
 */

// Minimal structural shape of a log row this PDF reads. HistoryScreen's
// InventoryLog satisfies it; the generic keeps getDisplayQty's type exact.
export interface HistoryLog {
  sku: string;
  action_type: string;
  from_location?: string | null;
  to_location?: string | null;
  order_number?: string | null;
  is_reversed?: boolean | null;
  note?: string | null;
}

// A current inventory row for one of the report's SKUs. Quantities are summed per
// location (across sublocations/warehouses) for the AS400 stock view.
export interface StockLocation {
  sku: string;
  location?: string | null;
  sublocation?: string | null;
  quantity: number;
  warehouse?: string | null;
}

export interface DailyHistoryParams<TLog extends HistoryLog> {
  /** Already-filtered logs, newest-first (as HistoryScreen holds them). */
  logs: TLog[];
  filter: string;
  userFilter: string;
  timeFilter: string;
  getDisplayQty: (log: TLog) => number;
  reportNote?: string | null;
  mode?: 'full' | 'as400';
  /** Current inventory for the SKUs in `logs` (all their locations). Drives the
   *  'as400' flattened stock view; ignored by 'full' mode. */
  stock?: StockLocation[];
}

// 6×4" landscape thermal label.
const PAGE_W = 152.4;
const PAGE_H = 101.6;
const MARGIN = 3;
const CONTENT_W = PAGE_W - MARGIN * 2;

type Doc = InstanceType<typeof import('jspdf').default>;
type AutoTable = typeof import('jspdf-autotable').default;
type CellInput = import('jspdf-autotable').CellInput;
type RowInput = import('jspdf-autotable').RowInput;
type CellStyles = Partial<import('jspdf-autotable').Styles>;
type CellHook = import('jspdf-autotable').CellHookData;

// Shared header: title, one-line subtitle, optional boxed note. Returns the Y below it.
function drawHeader(
  doc: Doc,
  opts: { title: string; subtitle: string; reportNote: string | null }
): number {
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(opts.title, MARGIN, MARGIN + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(opts.subtitle, MARGIN, MARGIN + 9);

  let currentY = MARGIN + 13;
  if (opts.reportNote && opts.reportNote.trim().length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const wrapped = doc.splitTextToSize(opts.reportNote.trim(), CONTENT_W - 2);
    const lineHeight = 4.5;
    const noteHeight = wrapped.length * lineHeight + 3;
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, currentY - 2, CONTENT_W, noteHeight);
    doc.text(wrapped, MARGIN + 1.5, currentY + 1.5);
    currentY += noteHeight + 2;
  }
  return currentY;
}

// AS400 sync view: per moved SKU, where it was MOVED FROM today (the move sources,
// summed per origin) and its CURRENT STOCK now ("LOCATION = total"). SKUs now split
// across 2+ current locations go in a separate "Multiple locations" table with a
// per-SKU TOTAL column; single-location SKUs need no TOTAL. No move-by-move detail.
function renderAs400<TLog extends HistoryLog>(
  doc: Doc,
  autoTable: AutoTable,
  params: DailyHistoryParams<TLog>,
  today: string
) {
  const { logs, getDisplayQty } = params;

  // Moved SKUs (insertion order) + their move SOURCES: from_location → qty summed.
  const skuOrder: string[] = [];
  const seenSku = new Set<string>();
  const fromBySku = new Map<string, Map<string, number>>();
  for (const log of logs) {
    if (!seenSku.has(log.sku)) {
      seenSku.add(log.sku);
      skuOrder.push(log.sku);
    }
    if (log.action_type !== 'MOVE') continue;
    const from = (log.from_location || '').toUpperCase();
    if (!from) continue;
    const sources = fromBySku.get(log.sku) ?? new Map<string, number>();
    sources.set(from, (sources.get(from) ?? 0) + getDisplayQty(log));
    fromBySku.set(log.sku, sources);
  }

  // Current stock per SKU → location → summed quantity.
  const stockBySku = new Map<string, Map<string, number>>();
  for (const row of params.stock ?? []) {
    if (!row.sku) continue;
    const loc = (row.location || '').toUpperCase();
    if (!loc) continue;
    const byLoc = stockBySku.get(row.sku) ?? new Map<string, number>();
    byLoc.set(loc, (byLoc.get(loc) ?? 0) + Number(row.quantity || 0));
    stockBySku.set(row.sku, byLoc);
  }

  // MOVED FROM cell: just the source location(s), one per line (biggest origin first).
  // The per-source qty is intentionally omitted — it invited a misleading sum that
  // looked like it should equal CURRENT STOCK (which also reflects picks/shipments).
  const fromText = (sku: string): string =>
    [...(fromBySku.get(sku) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([loc]) => loc)
      .join('\n');

  // Classify each moved SKU by its number of current-stock (qty > 0) locations.
  type Entry = { sku: string; from: string; tos: { loc: string; qty: number }[] };
  const singles: Entry[] = [];
  const multis: Entry[] = [];
  for (const sku of [...skuOrder].sort((a, b) => a.localeCompare(b))) {
    const tos = [...(stockBySku.get(sku) ?? new Map<string, number>()).entries()]
      .filter(([, qty]) => qty > 0)
      .map(([loc, qty]) => ({ loc, qty }))
      .sort((a, b) => b.qty - a.qty || a.loc.localeCompare(b.loc));
    (tos.length >= 2 ? multis : singles).push({ sku, from: fromText(sku), tos });
  }

  // Largest type that fits (FROM may wrap) on the 6×4 label. 14/15 ≥ 90%.
  const BIG = 15;
  const REG = 14;
  const headStyles: CellStyles = {
    fontStyle: 'bold',
    fontSize: REG,
    fillColor: [255, 255, 255],
    textColor: [0, 0, 0],
    lineWidth: 0.3,
  };
  const styles: CellStyles = {
    font: 'helvetica',
    fontSize: REG,
    cellPadding: 0.6,
    textColor: [0, 0, 0],
    lineColor: [0, 0, 0],
    lineWidth: 0.25,
    valign: 'middle',
  };
  const margin = { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN };

  // Per-section page header: "AS400 Sync" + subtitle, with the note on the first page.
  const note = (params.reportNote ?? '').trim();
  let noteDrawn = false;
  const sectionHeader = (subtitle: string): number => {
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(BIG);
    doc.text('AS400 Sync', MARGIN, MARGIN + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(REG);
    doc.text(subtitle, MARGIN, MARGIN + 9.5);
    let y = MARGIN + 12;
    if (note && !noteDrawn) {
      noteDrawn = true;
      doc.setFontSize(12);
      const wrapped = doc.splitTextToSize(note, CONTENT_W - 3) as string[];
      const h = wrapped.length * 4.5 + 3;
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(MARGIN, y - 1, CONTENT_W, h);
      doc.text(wrapped, MARGIN + 1.5, y + 2.5);
      y += h + 2;
    }
    return y;
  };
  const plural = (n: number): string => `${n} ${n === 1 ? 'SKU' : 'SKUs'}`;

  // autoTable has no inline rich text, so the CURRENT STOCK ("LOC = total") cell is
  // drawn by hand with the LOCATION in bold and the "= total" in the regular weight —
  // so it reads "place, then amount". (MOVED FROM is plain bold via columnStyles.)
  const PT_TO_MM = 25.4 / 72;
  const boldCols: Record<number, string> = { 2: ' = ' };
  const savedLines = new Map<object, string[]>();
  const drawBoldLoc = (line: string, sep: string, x: number, y: number, fontSize: number): void => {
    const i = line.indexOf(sep);
    const loc = i >= 0 ? line.slice(0, i) : line;
    const rest = i >= 0 ? line.slice(i) : '';
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    doc.text(loc, x, y);
    if (rest) {
      doc.setFont('helvetica', 'normal');
      doc.text(rest, x + doc.getTextWidth(loc), y);
    }
  };
  const boldLocationHooks = {
    willDrawCell: (data: CellHook) => {
      if (data.section === 'body' && boldCols[data.column.index]) {
        savedLines.set(data.cell, data.cell.text);
        data.cell.text = [];
      }
    },
    didDrawCell: (data: CellHook) => {
      const sep = boldCols[data.column.index];
      const lines = savedLines.get(data.cell);
      if (data.section !== 'body' || !sep || !lines) return;
      savedLines.delete(data.cell);
      const c = data.cell;
      const lineH = c.styles.fontSize * PT_TO_MM * 1.15;
      const top = c.y + (c.height - lines.length * lineH) / 2;
      const x = c.x + c.padding('left');
      lines.forEach((ln, k) =>
        drawBoldLoc(ln, sep, x, top + lineH * (k + 0.72), c.styles.fontSize)
      );
    },
  };

  // Single location: SKU | MOVED FROM | CURRENT STOCK. "LOC = total" is the current
  // count (no separate qty column, no "Single location" label, no redundant total).
  if (singles.length) {
    autoTable(doc, {
      startY: sectionHeader(`${today} · ${plural(singles.length)}`),
      head: [['SKU', 'MOVED FROM', 'CURRENT STOCK']],
      body: singles.map((s) => [
        s.sku,
        s.from,
        s.tos[0] ? `${s.tos[0].loc} = ${s.tos[0].qty}` : '—',
      ]),
      theme: 'grid',
      styles,
      headStyles,
      columnStyles: {
        0: { cellWidth: 34, fontStyle: 'bold', fontSize: BIG },
        1: { cellWidth: 'auto', fontStyle: 'bold' },
        2: { cellWidth: 44 },
      },
      margin,
      ...boldLocationHooks,
    });
  }

  // Multiple locations: SKU | MOVED FROM | CURRENT STOCK | TOTAL — ALWAYS on a fresh
  // page so the split SKUs read as a clearly separate list. SKU/FROM/TOTAL span rows.
  if (multis.length) {
    if (singles.length) doc.addPage();
    const body: RowInput[] = [];
    for (const s of multis) {
      const total = s.tos.reduce((sum, t) => sum + t.qty, 0);
      s.tos.forEach((t, i) => {
        const row: CellInput[] = [];
        if (i === 0) {
          row.push({
            content: s.sku,
            rowSpan: s.tos.length,
            styles: { fontStyle: 'bold', fontSize: BIG },
          });
          row.push({ content: s.from, rowSpan: s.tos.length });
        }
        row.push(`${t.loc} = ${t.qty}`);
        if (i === 0) {
          row.push({
            content: String(total),
            rowSpan: s.tos.length,
            styles: { fontStyle: 'bold', fontSize: BIG, halign: 'right' },
          });
        }
        body.push(row);
      });
    }
    autoTable(doc, {
      startY: sectionHeader(`${today} · Multiple locations · ${plural(multis.length)}`),
      head: [['SKU', 'MOVED FROM', 'CURRENT STOCK', 'TOTAL']],
      body,
      theme: 'grid',
      styles,
      headStyles,
      columnStyles: {
        0: { cellWidth: 32, fontStyle: 'bold' },
        1: { cellWidth: 'auto', fontStyle: 'bold' },
        2: { cellWidth: 44 },
        3: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      },
      margin,
      ...boldLocationHooks,
    });
  }

  return doc;
}

// Detailed table: every action with its notes (unchanged).
function renderFull<TLog extends HistoryLog>(
  doc: Doc,
  autoTableInstance: typeof import('jspdf-autotable').default,
  params: DailyHistoryParams<TLog>,
  title: string,
  today: string
) {
  const { logs, timeFilter, getDisplayQty } = params;

  // Collapse MOVE chains only for a single day's activity (see HistoryScreen).
  const collapseChains = timeFilter === 'TODAY';

  const movePathBySkuQty = new Map<string, string[]>();
  if (collapseChains) {
    for (const log of [...logs].reverse()) {
      if (log.action_type !== 'MOVE') continue;
      const qty = getDisplayQty(log);
      const key = `${log.sku}::${qty}`;
      const path = movePathBySkuQty.get(key) ?? [];
      const from = log.from_location || '';
      const to = log.to_location || '';
      if (path.length === 0 && from) path.push(from);
      if (to && path[path.length - 1] !== to) path.push(to);
      movePathBySkuQty.set(key, path);
    }
  }

  const seenMove = new Set<string>();
  const dedupedLogs = collapseChains
    ? logs.filter((log) => {
        if (log.action_type !== 'MOVE') return true;
        const key = `${log.sku}::${getDisplayQty(log)}`;
        if (seenMove.has(key)) return false;
        seenMove.add(key);
        return true;
      })
    : logs;

  const stats = {
    total: dedupedLogs.length,
    qty: dedupedLogs.reduce((acc, l) => acc + Number(getDisplayQty(l)), 0),
  };

  const subtitle = `${today} · ${stats.total} logs · ${stats.qty.toLocaleString()} units`;
  let currentY = drawHeader(doc, { title, subtitle, reportNote: params.reportNote ?? null });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('SKU', MARGIN, currentY);
  doc.text('ACTIVITY', MARGIN + 30, currentY);
  doc.text('QTY', PAGE_W - MARGIN, currentY, { align: 'right' });
  currentY += 3;

  const tableData = dedupedLogs.map((log) => {
    const fromLoc = log.from_location || '';
    const toLoc = log.to_location || '';
    const qty = getDisplayQty(log);
    const rawNote = log.note;

    let activity = '';
    let chainHops: string | null = null;
    switch (log.action_type) {
      case 'MOVE': {
        const path = movePathBySkuQty.get(`${log.sku}::${qty}`) ?? [];
        const first = path[0] ?? fromLoc;
        const last = path[path.length - 1] ?? toLoc;
        activity = `Moved ${first} -> ${last}`;
        if (path.length > 2) {
          chainHops = `via ${path.slice(1, -1).join(' -> ')}`;
        }
        break;
      }
      case 'ADD':
        activity = `Added ${qty} to ${toLoc || fromLoc || 'GEN'}`;
        break;
      case 'DEDUCT':
        activity = log.order_number
          ? `Picked from ${fromLoc || 'GEN'} in #${log.order_number}`
          : `Picked ${qty} from ${fromLoc || 'GEN'}`;
        break;
      case 'DELETE':
        activity = `Removed from ${fromLoc || 'INV'}`;
        break;
      case 'EDIT':
        activity = `Edited at ${toLoc || fromLoc || 'INV'}`;
        break;
      case 'PHYSICAL_DISTRIBUTION':
        activity = `Verified at ${toLoc || fromLoc || 'INV'}`;
        break;
      case 'SYSTEM_RECONCILIATION':
        activity = `Reconciliation`;
        break;
      default:
        activity = `${log.action_type} at ${toLoc || fromLoc || '—'}`;
    }

    if (log.is_reversed) {
      activity = `Reversed: ${activity}`;
    }

    const noteLine = rawNote ? rawNote.replace(/^FedEx Return\s+/i, '') : null;
    const extraLines = [chainHops, noteLine].filter(Boolean) as string[];
    const cellText = extraLines.length > 0 ? `${activity}\n${extraLines.join('\n')}` : activity;

    return [log.sku, cellText, qty.toString()];
  });

  autoTableInstance(doc, {
    startY: currentY,
    body: tableData,
    theme: 'plain',
    styles: {
      fontSize: 11,
      cellPadding: 1.8,
      minCellHeight: 6.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
      font: 'helvetica',
      valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: 'bold', fontSize: 13, halign: 'left' },
      1: { cellWidth: 'auto', fontSize: 10.5, halign: 'left' },
      2: { cellWidth: 13, fontSize: 13, halign: 'right', fontStyle: 'bold' },
    },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
  });

  return doc;
}

export function generateDailyHistoryDoc<TLog extends HistoryLog>(
  jsPDFInstance: typeof import('jspdf').default,
  autoTableInstance: typeof import('jspdf-autotable').default,
  params: DailyHistoryParams<TLog>
) {
  const { filter, userFilter } = params;
  const mode = params.mode ?? 'as400';

  const doc = new jsPDFInstance({
    orientation: 'landscape',
    unit: 'mm',
    format: [PAGE_W, PAGE_H],
  });
  const today = new Date().toLocaleDateString('es-ES');

  let title = mode === 'as400' ? 'History — AS400 Sync' : 'History';
  if (filter !== 'ALL') {
    const labels: Record<string, string> = {
      MOVE: 'Movements',
      ADD: 'Restocks',
      DEDUCT: 'Picks',
      DELETE: 'Removals',
      SYSTEM_RECONCILIATION: 'Reconciliation',
    };
    title = `History — ${labels[filter] || filter}`;
  }
  if (userFilter !== 'ALL') {
    title += ` (${userFilter})`;
  }

  return mode === 'as400'
    ? renderAs400(doc, autoTableInstance, params, today)
    : renderFull(doc, autoTableInstance, params, title, today);
}
