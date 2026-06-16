import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { generateShipLabel, type ShipLabelData } from '../generateShipLabel';
import {
  createRecorder,
  expectGrayscaleOnly,
  expectNoTextOverlap,
  expectOrderedText,
  expectContains,
  type PdfRecorder,
} from '../../../test/pdfRecorder';

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const { wrapJsPDFConstructor } = await import('../../../test/pdfRecorder');
  const Wrapped = wrapJsPDFConstructor(actual.default);
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const base: ShipLabelData = {
  customerName: 'Acme Bikes',
  street: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zip: '62704',
  orderNumber: '880123',
  pallets: 1,
  bikeCount: 3,
  partCount: 2,
  weightLbs: 140,
  loadNumber: 'L-7',
};

describe('generateShipLabel', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('info label: B&W, ordered, nothing overlapping, complete', async () => {
    await generateShipLabel(base);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'ACME BIKES',
      '123 MAIN ST',
      'SPRINGFIELD, IL 62704',
      'ORDER #: 880123',
      'PALLETS: 1',
      'BIKES: 3',
      'PARTS: 2',
      'LOAD: L-7',
      'WEIGHT: 140 LBS',
      'SHIPMENT', // the thank-you message rendered
    ]);
    expectOrderedText(
      rec,
      ['ACME BIKES', '123 MAIN ST', 'SPRINGFIELD', 'ORDER #: 880123', 'PALLETS: 1', 'LOAD: L-7'],
      1
    );
  });

  it('multi-pallet: adds a centred PALLET "i of N" page per pallet', async () => {
    await generateShipLabel({ ...base, pallets: 2 });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['PALLET', '1 of 2', '2 of 2']);
  });

  it('falls back to UNITS: 0 and GENERIC CUSTOMER for empty data', async () => {
    await generateShipLabel({
      ...base,
      customerName: null,
      bikeCount: 0,
      partCount: 0,
      weightLbs: 0,
    });

    expectGrayscaleOnly(rec);
    expectContains(rec, ['UNITS: 0', 'WEIGHT: N/A']);
  });
});
