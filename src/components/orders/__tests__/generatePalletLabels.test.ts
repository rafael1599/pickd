import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generatePalletLabels, type PalletLabelData } from '../generatePalletLabels';
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

describe('generatePalletLabels', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('professional layout (with address): B&W, ordered, no overlap, complete', async () => {
    const data: PalletLabelData = {
      pallets: 2,
      customerName: 'Acme Bikes',
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62704',
      orderNumber: '880123',
      loadNumber: 'L-7',
    };
    await generatePalletLabels(data);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'ACME BIKES',
      '123 Main St',
      'Springfield, IL 62704',
      'ORDER #: 880123',
      'LOAD: L-7',
      '1 OF 2',
      '2 OF 2',
    ]);
    // Info page (page 1) reads top-to-bottom.
    expectOrderedText(
      rec,
      ['ACME BIKES', '123 Main St', 'Springfield, IL 62704', 'ORDER #: 880123', 'LOAD: L-7'],
      1
    );
  });

  it('simple layout (no address): big centred name + numbering', async () => {
    await generatePalletLabels({
      pallets: 1,
      customerName: 'Generic',
      street: null,
      city: null,
      state: null,
      zip: null,
      orderNumber: null,
      loadNumber: 'L-9',
    });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['GENERIC', 'LOAD: L-9', '1 OF 1']);
  });

  it('falls back to GENERIC CUSTOMER when no name is given', async () => {
    await generatePalletLabels({
      pallets: 1,
      customerName: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      orderNumber: null,
      loadNumber: 'L-1',
    });
    // The big centred name wraps (jsPDF can even break mid-word at this size),
    // so check the characters are all present regardless of where it splits.
    expect(rec.allText().replace(/\s+/g, '')).toContain('GENERICCUSTOMER');
  });
});
