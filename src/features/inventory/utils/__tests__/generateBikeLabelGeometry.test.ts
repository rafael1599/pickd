import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateBikeLabels, type LabelItem } from '../generateBikeLabel';
import { createRecorder, type PdfRecorder, type DrawEvent } from '../../../../test/pdfRecorder';

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

// Round to sub-micron inches so floating-point noise never trips the snapshot,
// while any real geometry shift (≥1e-6 in) still shows up.
const r = (n: number) => Math.round(n * 1e6) / 1e6;
const serialize = (events: DrawEvent[]) =>
  events.map((e) => {
    if (e.type === 'text') {
      return {
        t: 'text',
        s: e.text,
        x: r(e.x),
        y: r(e.y),
        fs: r(e.fontSize),
        color: e.color.join(','),
      };
    }
    if (e.type === 'rect') {
      return {
        t: 'rect',
        x: r(e.x),
        y: r(e.y),
        w: r(e.w),
        h: r(e.h),
        fill: e.fillColor?.join(','),
      };
    }
    if (e.type === 'line') {
      return { t: 'line', x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) };
    }
    return { t: 'image', x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) };
  });

const bike: LabelItem = {
  sku: '03-4614BK',
  item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
  short_code: 'PK-000A1',
  public_token: '7f3e4d2a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  color: null,
};
const withFields: LabelItem = {
  ...bike,
  prefix: 'S/D',
  extra: 'SPECIAL ORDER',
  upc: '012345678901',
  serial_number: 'SN-99',
  made_in: 'TAIWAN',
  po_number: 'PO-123',
};
const parts: LabelItem = {
  sku: 'PKD-215RAC',
  item_name: 'RACK STRUTS',
  short_code: 'PK-RACK',
  public_token: '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
  color: 'SILVER',
};

const codeModes: Record<string, Pick<LabelItem, 'withQr' | 'withBarcode'>> = {
  both: { withQr: true, withBarcode: true },
  'qr-only': { withQr: true, withBarcode: false },
  'barcode-only': { withQr: false, withBarcode: true },
  none: { withQr: false, withBarcode: false },
};

/**
 * Pins the EXACT printed-label draw geometry. The shared-layout refactor must
 * keep this byte-identical — if a coordinate, size or colour changes, the
 * printed label changed, and this snapshot fails.
 */
describe('generateBikeLabels — printed geometry (refactor guard)', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  for (const layout of ['standard', 'vertical'] as const) {
    for (const [mode, codes] of Object.entries(codeModes)) {
      it(`${layout} · ${mode}`, async () => {
        await generateBikeLabels([{ ...bike, layout, ...codes }]);
        expect(serialize(rec.events)).toMatchSnapshot();
      });
    }
  }

  it('standard · all extra fields + prefix + extra', async () => {
    await generateBikeLabels([{ ...withFields, layout: 'standard' }]);
    expect(serialize(rec.events)).toMatchSnapshot();
  });

  it('vertical · parts item with explicit color', async () => {
    await generateBikeLabels([{ ...parts, layout: 'vertical' }]);
    expect(serialize(rec.events)).toMatchSnapshot();
  });
});
