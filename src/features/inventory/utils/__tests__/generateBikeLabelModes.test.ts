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
const maxFont = (r: PdfRecorder) => Math.max(...r.texts().map((t) => t.fontSize));

describe('generateBikeLabels — print modes', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  for (const layout of ['standard', 'vertical'] as const) {
    it(`${layout}: codes ON → QR image + barcode bars, B&W, no overlap, complete`, async () => {
      await generateBikeLabels([{ ...base, layout, withCodes: true }]);
      expectGrayscaleOnly(rec);
      expectNoTextOverlap(rec);
      expectContains(rec, ['FAULTLINE A1 V2', '03-4614BK']);
      expect(rec.images().length).toBeGreaterThan(0); // QR
      expect(barcodeBars(rec).length).toBeGreaterThan(10); // Code 128 bars
    });

    it(`${layout}: codes OFF → no QR, no barcode, B&W, no overlap, complete`, async () => {
      await generateBikeLabels([{ ...base, layout, withCodes: false }]);
      expectGrayscaleOnly(rec);
      expectNoTextOverlap(rec);
      expectContains(rec, ['FAULTLINE A1 V2', '03-4614BK']);
      expect(rec.images().length).toBe(0); // no QR
      expect(barcodeBars(rec).length).toBe(0); // no barcode
    });
  }

  it('codeless text is larger than coded (reclaims the QR/barcode space)', async () => {
    const on = createRecorder();
    await generateBikeLabels([{ ...base, withCodes: true }]);
    const onMax = maxFont(on);
    on.restore();

    const off = createRecorder();
    await generateBikeLabels([{ ...base, withCodes: false }]);
    const offMax = maxFont(off);
    off.restore();

    expect(offMax).toBeGreaterThan(onMax);
  });

  it('the barcode never sits under any text', async () => {
    await generateBikeLabels([{ ...base, withCodes: true }]);
    const bars = barcodeBars(rec);
    expect(bars.length).toBeGreaterThan(0);
    // Per page, the barcode occupies a y-band; no text baseline falls inside it.
    const band = new Map<number, { top: number; bot: number }>();
    for (const b of bars) {
      const cur = band.get(b.page) ?? { top: Infinity, bot: -Infinity };
      cur.top = Math.min(cur.top, b.y);
      cur.bot = Math.max(cur.bot, b.y + b.h);
      band.set(b.page, cur);
    }
    for (const t of rec.texts()) {
      const bd = band.get(t.page);
      if (!bd) continue;
      const inside = t.y > bd.top + 0.02 && t.y < bd.bot - 0.02;
      expect(inside, `"${t.text}" baseline ${t.y} inside barcode band`).toBe(false);
    }
  });
});
