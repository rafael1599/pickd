import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateBikeLabels, type LabelItem } from '../generateBikeLabel';
import {
  createRecorder,
  expectGrayscaleOnly,
  expectNoTextOverlap,
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
  sku: '03-4614BK',
  item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
  short_code: 'PK-000A1',
  public_token: '7f3e4d2a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  color: null,
  layout: 'standard',
};

// Barcode bars = narrow, solid-black rects (the SKU box is black but wide).
const barcodeBars = (r: PdfRecorder) =>
  r.events.filter(
    (e) =>
      e.type === 'rect' &&
      e.fillColor?.[0] === 0 &&
      e.fillColor[1] === 0 &&
      e.fillColor[2] === 0 &&
      e.w < 0.1
  );

describe('generateBikeLabels — one label for everyone (30 Sep 2026)', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  const pages = (r: PdfRecorder) => new Set(r.events.map((e) => e.page)).size;

  it('always prints the QR and the barcode, whatever the item asks for', async () => {
    await generateBikeLabels([
      { ...base, layout: 'vertical', withCodes: false, withQr: false, withBarcode: false },
    ]);
    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['FAULTLINE A1 V2', '03-4614BK']);
    expect(rec.images().length).toBe(2); // one QR per copy
    expect(barcodeBars(rec).length).toBeGreaterThan(10);
  });

  it('a regular SKU still prints two copies', async () => {
    await generateBikeLabels([base]);
    expect(pages(rec)).toBe(2);
    expect(rec.texts().filter((t) => t.text.trim() === '03-4614BK')).toHaveLength(2);
  });

  it('a S/D unit prints its label, then a page with only its number', async () => {
    await generateBikeLabels([{ ...base, sd_number: 12 }]);
    expect(pages(rec)).toBe(2);
    expect(
      rec
        .texts()
        .filter((t) => t.page === 1)
        .some((t) => t.text.trim() === '03-4614BK')
    ).toBe(true);
    const page2 = rec.texts().filter((t) => t.page === 2);
    expect(page2.map((t) => t.text)).toEqual(['#12']);
    expect(rec.events.filter((e) => e.page === 2 && e.type !== 'text')).toHaveLength(0);
  });

  it('two S/D bikes in one job alternate: label, number, label, number', async () => {
    await generateBikeLabels([
      { ...base, sku: '01-0442', sd_number: 1 },
      { ...base, sku: '01-0441', sd_number: 2 },
    ]);
    expect(pages(rec)).toBe(4);
    const onPage = (p: number) =>
      rec
        .texts()
        .filter((t) => t.page === p)
        .map((t) => t.text.trim());
    expect(onPage(1)).toContain('01-0442');
    expect(onPage(2)).toEqual(['#1']);
    expect(onPage(3)).toContain('01-0441');
    expect(onPage(4)).toEqual(['#2']);
  });

  it('the number is as big as the page allows, and a long one shrinks to fit the width', async () => {
    await generateBikeLabels([
      { ...base, sd_number: 7 },
      { ...base, sd_number: 123456 },
    ]);
    const short = rec.texts().find((t) => t.text === '#7')!;
    const long = rec.texts().find((t) => t.text === '#123456')!;
    // Short: limited by the 4" height (3.6" of digits once the margins go).
    expect((short.fontSize * 0.72) / 72).toBeCloseTo(3.6, 1);
    // Long: limited by the 6" width, so smaller, but still filling it.
    expect(long.fontSize).toBeLessThan(short.fontSize);
    expect(long.w).toBeGreaterThan(5.4);
    expect(long.w).toBeLessThanOrEqual(5.6 + 0.01);
  });

  it('a serial that repeats the SKU is not printed; a different one is', async () => {
    await generateBikeLabels([{ ...base, sku: 'Y21K009518', serial_number: 'y21k009518' }]);
    expect(rec.texts().filter((t) => /Y21K009518/i.test(t.text))).toHaveLength(2); // SKU ×2 copies
    rec.restore();
    rec = createRecorder();
    await generateBikeLabels([{ ...base, serial_number: 'WRDH02985' }]);
    expectContains(rec, ['WRDH02985']);
  });
});
