import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateReturnLabel, type ReturnLabelData } from '../generateReturnLabel';
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
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'mock-qr') },
  toDataURL: vi.fn(async () => 'mock-qr'),
}));
// JsBarcode needs a real 2D canvas (node-canvas) which jsdom lacks — stub it.
vi.mock('jsbarcode', () => ({ default: vi.fn() }));

const data: ReturnLabelData = {
  trackingNumber: '794613001234',
  receivedAt: '2026-06-10T00:00:00Z',
  receivedByName: 'Sam',
  rma: 'RMA-7788',
};

describe('generateReturnLabel', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('mock-barcode');
  });
  afterEach(() => {
    rec.restore();
    vi.restoreAllMocks();
  });

  it('is black & white, ordered, nothing overlapping, and complete', async () => {
    await generateReturnLabel(data);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'FEDEX RETURN',
      '794613001234',
      'RMA#: RMA-7788',
      'RECEIVED:',
      'CUT HERE',
    ]);
    // Within the top label: header → tracking → RMA, in order.
    expectOrderedText(rec, ['FEDEX RETURN', '794613001234', 'RMA#: RMA-7788']);
  });

  it('prints a fillable RMA blank when no RMA is provided', async () => {
    await generateReturnLabel({ ...data, rma: null });
    expect(rec.allText()).toContain('RMA#: __________');
    expectNoTextOverlap(rec);
    expectGrayscaleOnly(rec);
  });
});
