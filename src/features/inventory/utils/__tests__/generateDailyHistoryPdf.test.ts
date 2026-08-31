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
      'MOVED FROM',
      'CURRENT STOCK',
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
      '794613', // 03-3's note, FedEx Return prefix stripped — same as full mode
    ]);

    // The move-by-move detail is gone in the AS400 report, but notes aren't
    // — they're per-SKU (a SKU can carry several movements' worth), not
    // per-log like the ACTIVITY column.
    const all = rec.allText();
    expect(all).not.toContain('Moved');
    expect(all).not.toContain('ACTIVITY');
    expect(all).not.toContain('FedEx Return'); // prefix stripped, same as full mode

    // Page 1 is the single-location section (no section label now), in order…
    expectOrderedText(rec, ['AS400 Sync', '03-1', '03-3']);
    // …and the split SKU lives on its own page 2 under "Multiple locations".
    expectOrderedText(rec, ['AS400 Sync', 'Multiple locations', '03-2'], 2);
  });

  it("AS400 mode folds a note into the multi-location SKU's existing note row", async () => {
    const multiLocationLogsWithNote: HistoryLog[] = [
      {
        sku: '03-2',
        action_type: 'MOVE',
        from_location: 'ROW 1',
        to_location: 'ROW 5',
        note: 'Damaged box, verify count',
      },
    ];
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs: multiLocationLogsWithNote,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      mode: 'as400',
      stock, // 03-2 has two current locations (ROW 5, GEN) — the multi-location table
    });
    expectContains(rec, ['Multiple locations', 'Damaged box, verify count']);
  });

  it('AS400 mode: rows of one storage block collapse to a single location + block total', async () => {
    // AS400 admits one location per SKU: 30/15/12 across ROW 31/32/33 (all
    // BLOCK 30-33) reads as the row holding most of it, with the block's total.
    const blockLogs: HistoryLog[] = [
      { sku: '03-7', action_type: 'MOVE', from_location: 'ROW 18', to_location: 'ROW 31' },
    ];
    const blockStock: StockLocation[] = [
      { sku: '03-7', location: 'ROW 31', quantity: 30, storage_block: 'BLOCK 30-33' },
      { sku: '03-7', location: 'ROW 32', quantity: 15, storage_block: 'BLOCK 30-33' },
      { sku: '03-7', location: 'ROW 33', quantity: 12, storage_block: 'BLOCK 30-33' },
    ];
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs: blockLogs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      mode: 'as400',
      stock: blockStock,
    });
    expectContains(rec, ['03-7', 'ROW 18', 'ROW 31', '57']);
    const all = rec.allText();
    expect(all).not.toContain('Multiple locations'); // one place → the singles table
    expect(all).not.toContain('ROW 32'); // the block's other rows stay out of AS400
    expect(all).not.toContain('ROW 33');
  });

  it('AS400 mode: a block plus stock elsewhere is still Multiple locations, block collapsed', async () => {
    const blockLogs: HistoryLog[] = [
      { sku: '03-7', action_type: 'MOVE', from_location: 'GEN', to_location: 'ROW 31' },
    ];
    const blockStock: StockLocation[] = [
      { sku: '03-7', location: 'ROW 31', quantity: 30, storage_block: 'BLOCK 30-33' },
      { sku: '03-7', location: 'ROW 32', quantity: 15, storage_block: 'BLOCK 30-33' },
      { sku: '03-7', location: 'GEN', quantity: 3 }, // outside the block → a second place
    ];
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs: blockLogs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      mode: 'as400',
      stock: blockStock,
    });
    // Top line = the block (the move landed in one of its rows), 45 = 30 + 15;
    // TOTAL = 48 with GEN; the note names the place outside the block only.
    expectContains(rec, ['Multiple locations', '03-7', 'ROW 31', '45', '48', 'Still at GEN = 3']);
    expect(rec.allText()).not.toContain('ROW 32');
  });

  it('AS400 mode heads every section with the report-wide units in stock', async () => {
    // The figure the station reconciles against AS400: the CURRENT STOCK column
    // summed over the whole report (12 + 3 + 7 = 22), the same on both sections,
    // never the section's own subtotal.
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      mode: 'as400',
      stock,
    });
    expectOrderedText(rec, ['AS400 Sync', '22 UNITS IN STOCK']);
    expectOrderedText(rec, ['AS400 Sync', '22 UNITS IN STOCK', 'Multiple locations'], 2);
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

  it('full mode inserts date separators when logs span multiple days', async () => {
    const multiDayLogs: HistoryLog[] = [
      {
        sku: '03-9',
        action_type: 'MOVE',
        from_location: 'ROW 1',
        to_location: 'ROW 2',
        created_at: '2026-07-02T15:00:00Z',
      },
      {
        sku: '03-8',
        action_type: 'MOVE',
        from_location: 'ROW 3',
        to_location: 'ROW 4',
        created_at: '2026-06-30T15:00:00Z',
      },
    ];
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs: multiDayLogs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'CUSTOM',
      getDisplayQty: () => 1,
      mode: 'full',
    });
    // One separator per distinct day, before that day's rows.
    expectOrderedText(rec, ['JUL 2', '03-9', 'JUN 30', '03-8']);
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
