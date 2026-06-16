import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import autoTable from 'jspdf-autotable';
import jsPDF from 'jspdf';
import { generateDailyHistoryDoc, type HistoryLog } from '../generateDailyHistoryPdf';
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

describe('generateDailyHistoryDoc', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('is black & white, ordered, nothing overlapping, and complete', async () => {
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'TODAY',
      getDisplayQty: () => 2,
      reportNote: 'Count carefully',
      mode: 'as400',
    });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'History — AS400 Sync',
      'logs',
      'Count carefully', // the optional report note
      'SKU',
      'ACTIVITY',
      'QTY',
      '03-1',
      '03-2',
      '03-3',
      'Moved ROW 1 -> ROW 5',
      'Picked from ROW 2 in #880123',
      '794613', // FedEx Return prefix stripped from the note line
    ]);
    // Title → counts → note → column header → first (alphabetised) row.
    expectOrderedText(rec, ['History — AS400 Sync', 'logs', 'Count carefully', 'SKU', '03-1']);
  });

  it('uses the plain "History" title and keeps content when no filters/note', async () => {
    generateDailyHistoryDoc(jsPDF, autoTable, {
      logs,
      filter: 'ALL',
      userFilter: 'ALL',
      timeFilter: 'ALL',
      getDisplayQty: () => 1,
    });
    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expect(rec.allText()).toContain('History');
    expectContains(rec, ['03-1', '03-2', '03-3']);
  });
});
