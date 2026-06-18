import { describe, it, expect } from 'vitest';
import {
  computeLabelFace,
  type LabelField,
  type LabelItem,
  type LabelTextMeasurer,
} from '../labelLayout';

// A trivial measurer — regions only need relative geometry, not real font metrics.
const fakeMeasure: LabelTextMeasurer = {
  textWidth: (t, size) => t.length * size * 0.008,
  splitText: (t) => [t],
};

const base: LabelItem = {
  sku: '03-4614BK',
  item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
  short_code: '',
  public_token: '',
};

const EDITABLE: LabelField[] = ['name', 'detail', 'extra', 'upc', 'serial', 'made_in', 'po'];

describe('computeLabelFace — editable regions', () => {
  for (const layout of ['standard', 'vertical'] as const) {
    it(`${layout}: name + detail are tappable; every region is an editable field`, () => {
      const face = computeLabelFace({ ...base, layout }, fakeMeasure, 'https://x');
      const fields = face.regions.map((r) => r.field);
      expect(fields).toContain('name');
      expect(fields).toContain('detail');
      for (const r of face.regions) {
        expect(EDITABLE).toContain(r.field); // SKU is identity → never a region
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
      }
    });

    it(`${layout}: filled per-tag + sku-level fields each become a region`, () => {
      const face = computeLabelFace(
        {
          ...base,
          layout,
          extra: 'SPECIAL ORDER',
          upc: '012345678901',
          serial_number: 'SN-1',
          made_in: 'TAIWAN',
          po_number: 'PO-1',
        },
        fakeMeasure,
        'https://x'
      );
      const fields = new Set(face.regions.map((r) => r.field));
      for (const f of EDITABLE) expect(fields.has(f)).toBe(true);
    });
  }

  it('does not create regions for empty optional fields', () => {
    const fields = new Set(
      computeLabelFace(base, fakeMeasure, 'https://x').regions.map((r) => r.field)
    );
    expect(fields.has('extra')).toBe(false);
    expect(fields.has('serial')).toBe(false);
    expect(fields.has('po')).toBe(false);
  });
});
