import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { generateInventoryPdf, type InventoryBlock } from '../generateInventoryPdf';
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

const blocks: InventoryBlock[] = [
  {
    wh: 'LUDLOW',
    items: [
      { sku: '03-1', quantity: 40, location: 'ROW 1' },
      { sku: '03-2', quantity: 10, location: 'ROW 2' },
      { sku: '03-2', quantity: 5, location: 'ROW 5' }, // same SKU, 2nd location
    ],
  },
];

describe('generateInventoryPdf', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('is black & white, ordered, nothing overlapping, and complete', async () => {
    await generateInventoryPdf(blocks);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'LUDLOW',
      '2 SKUs',
      '55 units',
      'SKU',
      'LOCATIONS',
      'TOTAL',
      '03-1',
      '03-2',
      'ROW 1',
      'ROW 2 (10), ROW 5 (5)', // multi-location renders per-loc qty
      '40',
      '15',
    ]);
    // Warehouse header → column header → first (alphabetised) SKU row.
    expectOrderedText(rec, ['LUDLOW', 'LOCATIONS', '03-1']);
  });

  it('shows GEN for SKUs with no stocked location', async () => {
    await generateInventoryPdf([
      { wh: 'BAY2', items: [{ sku: '99-9', quantity: 3, location: null }] },
    ]);
    expectGrayscaleOnly(rec);
    expectContains(rec, ['BAY2', '99-9', 'GEN']);
  });
});
