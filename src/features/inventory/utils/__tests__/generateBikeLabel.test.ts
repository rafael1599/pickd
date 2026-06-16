import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateBikeLabels, type LabelItem } from '../generateBikeLabel';
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

const base: LabelItem = {
  sku: '00-0000',
  item_name: 'Faultline A1 Frame 29" x MD/17',
  short_code: 'ABC123',
  public_token: 'tok-123',
  color: 'Sandstorm',
  layout: 'standard',
};

describe('generateBikeLabels PDF', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('standard layout: black & white, ordered, nothing overlapping, complete', async () => {
    await generateBikeLabels([base]);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    // Content complete: model name, color value and SKU all present.
    expectContains(rec, ['Faultline A1', 'Sandstorm', '00-0000']);
    // Ordered top-to-bottom: name → color → SKU.
    expectOrderedText(rec, ['Faultline', 'Sandstorm', '00-0000']);
  });

  it('does NOT print the literal word "COLOR"', async () => {
    await generateBikeLabels([base]);
    expect(rec.allText()).not.toMatch(/COLOR/i);
  });

  it('keeps every letter within a 10% size band', async () => {
    await generateBikeLabels([base]);
    const sizes = rec.texts().map((t) => t.fontSize);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    expect(min / max).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });

  it('vertical layout: black & white, ordered, nothing overlapping, complete', async () => {
    await generateBikeLabels([{ ...base, layout: 'vertical' }]);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['Faultline A1', 'Sandstorm', '00-0000']);
    expectOrderedText(rec, ['Faultline', 'Sandstorm', '00-0000']);
  });

  it('parsed bike: SIZE/YEAR kept, color value present, no "COLOR" label', async () => {
    await generateBikeLabels([
      {
        ...base,
        item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
        color: null,
        sku: '03-4614BK',
      },
    ]);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['FAULTLINE A1 V2', 'SIZE 15', 'GLOSS BLACK', 'YEAR 2026', '03-4614BK']);
    expect(rec.allText()).not.toMatch(/COLOR/);
  });

  it('long name + S/D prefix + extra fields still fit without overlap', async () => {
    await generateBikeLabels([
      {
        ...base,
        item_name: 'Renegade Exploit Carbon Pro Edition',
        color: 'Matte Olive',
        sku: '12-3456OL',
        prefix: 'S/D',
        upc: '0123456789012',
        serial_number: 'SN-99887766',
      },
    ]);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['S/D', 'Renegade Exploit', 'Matte Olive', '12-3456OL', 'UPC:', 'SERIAL:']);
  });
});
