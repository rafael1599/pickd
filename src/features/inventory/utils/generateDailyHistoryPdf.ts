/**
 * Builds the 6×4" daily-history thermal-label PDF and returns the jsPDF doc.
 *
 * Two modes:
 *  - 'full'   — the detailed SKU / ACTIVITY / QTY table (every action with notes).
 *  - 'as400'  — a flattened stock snapshot for AS400 reconciliation: per SKU that
 *               moved, the SKU in large type with the location(s) currently holding
 *               it and their quantities (the location touched today marked "•").
 *               No move-by-move detail.
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

// The location today's activity touched for this log — where the SKU ended up (or
// left, for picks/removals). Drives the "•" marker in the AS400 stock view.
function touchedLocation(log: HistoryLog): string | null {
  switch (log.action_type) {
    case 'DEDUCT':
    case 'DELETE':
      return log.from_location || null;
    default:
      // MOVE / ADD / EDIT / PHYSICAL_DISTRIBUTION / others: the destination.
      return log.to_location || log.from_location || null;
  }
}

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

// Flattened AS400 stock view: one large-type block per moved SKU.
function renderAs400<TLog extends HistoryLog>(
  doc: Doc,
  params: DailyHistoryParams<TLog>,
  title: string,
  today: string
) {
  const { logs } = params;

  // SKUs that moved (insertion order preserved, then alphabetised) + the locations
  // today's activity touched, per SKU.
  const touchedBySku = new Map<string, Set<string>>();
  const skuOrder: string[] = [];
  const seenSku = new Set<string>();
  for (const log of logs) {
    if (!seenSku.has(log.sku)) {
      seenSku.add(log.sku);
      skuOrder.push(log.sku);
    }
    const set = touchedBySku.get(log.sku) ?? new Set<string>();
    const loc = touchedLocation(log);
    if (loc) set.add(loc.toUpperCase());
    touchedBySku.set(log.sku, set);
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

  const subtitle = `${today} · ${skuOrder.length} ${skuOrder.length === 1 ? 'SKU' : 'SKUs'}`;
  let currentY = drawHeader(doc, { title, subtitle, reportNote: params.reportNote ?? null });

  // Legend.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('•  moved today', MARGIN, currentY);
  currentY += 4;

  const SKU_SIZE = 16;
  const LOC_SIZE = 13;
  const LOC_LINE_H = 5.2;

  const skus = [...skuOrder].sort((a, b) => a.localeCompare(b));
  for (const sku of skus) {
    const touched = touchedBySku.get(sku) ?? new Set<string>();
    const byLoc = stockBySku.get(sku) ?? new Map<string, number>();

    // Locations to show: everywhere it currently has stock, plus any location
    // touched today (even if it's now empty, so the count can be reconciled).
    const locSet = new Set<string>();
    for (const [loc, qty] of byLoc) if (qty > 0) locSet.add(loc);
    for (const loc of touched) locSet.add(loc);

    const entries = [...locSet].map((loc) => ({
      loc,
      qty: byLoc.get(loc) ?? 0,
      touched: touched.has(loc),
    }));
    // Touched first, then by quantity desc, then location name.
    entries.sort(
      (a, b) =>
        (a.touched === b.touched ? 0 : a.touched ? -1 : 1) ||
        b.qty - a.qty ||
        a.loc.localeCompare(b.loc)
    );

    const locText = entries.length
      ? entries.map((e) => `${e.touched ? '• ' : ''}${e.loc}  ${e.qty}`).join('     ')
      : '(no stock on record)';
    const total = entries.reduce((s, e) => s + e.qty, 0);
    const totalText = entries.length > 1 ? `total ${total}` : '';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(LOC_SIZE);
    const wrapped = doc.splitTextToSize(locText, CONTENT_W - 4) as string[];

    const blockH = 6 + 7 + wrapped.length * LOC_LINE_H + (totalText ? LOC_LINE_H : 0) + 4.5;
    if (currentY + blockH > PAGE_H - MARGIN) {
      doc.addPage();
      currentY = MARGIN;
    }

    // SKU — large and bold.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(SKU_SIZE);
    doc.setTextColor(0, 0, 0);
    currentY += 6;
    doc.text(sku, MARGIN, currentY);
    currentY += 7;

    // Locations + quantities.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(LOC_SIZE);
    for (const line of wrapped) {
      doc.text(line, MARGIN + 4, currentY);
      currentY += LOC_LINE_H;
    }
    if (totalText) {
      doc.setFont('helvetica', 'bold');
      doc.text(totalText, MARGIN + 4, currentY);
      currentY += LOC_LINE_H;
    }

    // Divider.
    currentY += 0.5;
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, currentY, PAGE_W - MARGIN, currentY);
    currentY += 4;
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
    ? renderAs400(doc, params, title, today)
    : renderFull(doc, autoTableInstance, params, title, today);
}
