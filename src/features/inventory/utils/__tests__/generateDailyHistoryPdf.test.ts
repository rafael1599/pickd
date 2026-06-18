import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import autoTable from 'jspdf-autotable';
import jsPDF from 'jspdf';
import {
  generateDailyHistoryDoc,
  type HistoryLog,
  type StockLocation,
} from '../generateDailyHistoryPdf';
import {
  createRecorder,
  expectGrayscaleOnly,
  expectNoTextOverlap,
  expectOrderedText,
  expectContains,
  type PdfRecorder,
} from '../../../../test/pdfRecorder';

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const { wrapJsPDFConstructor } = await import('../../../../test/pdfRecorder');
  const Wrapped = wrapJsPDFConstructor(actual.default);
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const logs: HistoryLog[] = [
  { sku: '03-2', action_type: 'MOVE', from_location: 'ROW 1', to_location: 'ROW 5' },
  { sku: '03-1', action_type: 'ADD', to_location: 'ROW 1' },
  {
    sku: '03-3',
    action_type: 'DEDUCT',
    from_location: 'ROW 2',
    order_number: '880123',
    note: 'FedEx Return 794613',
  },
];

// Current inventory for those SKUs (all their locations) — drives the AS400 view.
const stock: StockLocation[] = [
  { sku: '03-2', location: 'ROW 5', quantity: 12 }, // where the move landed
  { sku: '03-2', location: 'GEN', quantity: 3 }, // a SECOND location for the same SKU
  { sku: '03-1', location: 'ROW 1', quantity: 7 },
  { sku: '03-3', location: 'ROW 2', quantity: 0 }, // picked out — touched, now empty
];

describe('generateDailyHistoryDoc', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('AS400 mode: FROM/TO stock per SKU, split SKUs get a TOTAL column', async () => {
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      reportNote: 'Count carefully',
      mode: 'as400',
      stock,
    });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'AS400 Sync',
      'SKUs',
      'Count carefully', // the optional report note
      'FROM',
      'TO',
      'QTY',
      'TOTAL', // present because 03-2 is split across two current locations
      '03-1',
      '03-2',
      '03-3',
      'ROW 1', // 03-1's current location AND 03-2's move source
      'ROW 5', // 03-2 landed here…
      'GEN', // …and the mandatory second location for the same SKU
      '12',
      '7',
      '15', // 03-2's per-SKU TOTAL (12 + 3)
    ]);

    // The move-by-move detail is gone in the AS400 report.
    const all = rec.allText();
    expect(all).not.toContain('Moved');
    expect(all).not.toContain('ACTIVITY');

    // Title → single-location section → the split SKU under "Multiple locations".
    expectOrderedText(rec, ['AS400 Sync', 'Single location', '03-1', 'Multiple locations', '03-2']);
  });

  it('AS400 mode still renders every moved SKU when no stock is supplied', async () => {
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'ALL',
      getDisplayQty: () => 1,
    });
    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expect(rec.allText()).toContain('AS400 Sync');
    expectContains(rec, ['03-1', '03-2', '03-3']);
  });

  it('full mode keeps the detailed SKU / ACTIVITY / QTY table', async () => {
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      mode: 'full',
    });
    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'History',
      'SKU',
      'ACTIVITY',
      'QTY',
      'Moved ROW 1 -> ROW 5',
      'Picked from ROW 2 in #880123',
      '794613', // FedEx Return prefix stripped from the note line
    ]);
  });
});
