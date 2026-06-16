/**
 * Builds the 6×4" daily-history thermal-label PDF (a SKU / ACTIVITY / QTY table)
 * and returns the jsPDF doc.
 *
 * Extracted from HistoryScreen so the layout is unit-testable. The screen's
 * callback just bundles its current filter state + logs and delegates here; the
 * PDF output is unchanged. Black & white only.
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

export interface DailyHistoryParams<TLog extends HistoryLog> {
  /** Already-filtered logs, newest-first (as HistoryScreen holds them). */
  logs: TLog[];
  filter: string;
  userFilter: string;
  timeFilter: string;
  getDisplayQty: (log: TLog) => number;
  reportNote?: string | null;
  mode?: 'full' | 'as400';
}

export function generateDailyHistoryDoc<TLog extends HistoryLog>(
  jsPDFInstance: typeof import('jspdf').default,
  autoTableInstance: typeof import('jspdf-autotable').default,
  params: DailyHistoryParams<TLog>
) {
  const { logs, filter, userFilter, timeFilter, getDisplayQty } = params;
  const reportNote = params.reportNote ?? null;
  const mode = params.mode ?? 'as400';

  // 6×4" landscape thermal label.
  const PAGE_W = 152.4;
  const PAGE_H = 101.6;
  const MARGIN = 3;
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

  const contentWidth = PAGE_W - MARGIN * 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, MARGIN, MARGIN + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `${today} · ${stats.total} logs · ${stats.qty.toLocaleString()} units`,
    MARGIN,
    MARGIN + 9
  );

  let currentY = MARGIN + 13;

  if (reportNote && reportNote.trim().length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const wrapped = doc.splitTextToSize(reportNote.trim(), contentWidth - 2);
    const lineHeight = 4.5;
    const noteHeight = wrapped.length * lineHeight + 3;
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, currentY - 2, contentWidth, noteHeight);
    doc.text(wrapped, MARGIN + 1.5, currentY + 1.5);
    currentY += noteHeight + 2;
  }

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
        if (mode !== 'as400' && path.length > 2) {
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

  const tableBody =
    mode === 'as400'
      ? [...tableData].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      : tableData;

  autoTableInstance(doc, {
    startY: currentY,
    body: tableBody,
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
