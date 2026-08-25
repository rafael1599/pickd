import { describe, expect, it } from 'vitest';
import { arrangeSkuLocations } from '../skuLocations';

const row = (
  location: string,
  quantity: number,
  extra: Partial<{ warehouse: string; is_active: boolean }> = {}
) => ({
  location,
  warehouse: 'LUDLOW',
  quantity,
  is_active: true,
  ...extra,
});

describe('arrangeSkuLocations', () => {
  // 03-4066BK on 25 Aug 2026: the order froze ROW 6 (4 units) while ROW 41 held 78.
  const stock = [row('ROW 41', 78), row('ROW 6', 4), row('ROW 8', 0, { is_active: false })];

  it("puts the order's own address first, then the deepest stock", () => {
    const { rows, pickRowMissing } = arrangeSkuLocations(stock, { location: 'ROW 6' });
    expect(rows.map((r) => r.row.location)).toEqual(['ROW 6', 'ROW 41']);
    expect(rows[0].isPick).toBe(true);
    expect(rows[1].isPick).toBe(false);
    expect(pickRowMissing).toBe(false);
  });

  it('drops rows that hold nothing — a row the SKU left is history, not a stop', () => {
    const { rows } = arrangeSkuLocations(stock, null);
    expect(rows.map((r) => r.row.location)).toEqual(['ROW 41', 'ROW 6']);
  });

  it("keeps the order's address even when empty, so it reads as 0 here rather than vanishing", () => {
    const { rows, pickRowMissing } = arrangeSkuLocations(stock, { location: 'ROW 8' });
    expect(rows[0]).toMatchObject({ isPick: true, row: { location: 'ROW 8', quantity: 0 } });
    expect(pickRowMissing).toBe(false);
  });

  it('flags an address the order names but inventory has no row for', () => {
    const { rows, pickRowMissing } = arrangeSkuLocations(stock, { location: 'ROW 12' });
    expect(pickRowMissing).toBe(true);
    expect(rows.every((r) => !r.isPick)).toBe(true);
  });

  it('matches the address regardless of case and spacing', () => {
    const { rows } = arrangeSkuLocations(stock, { location: ' row 6 ' });
    expect(rows[0]).toMatchObject({ isPick: true, row: { location: 'ROW 6' } });
  });

  it('does not mark a same-named row in another warehouse', () => {
    const both = [row('E1', 3, { warehouse: 'LUDLOW' }), row('E1', 9, { warehouse: 'ATS' })];
    const { rows } = arrangeSkuLocations(both, { location: 'E1', warehouse: 'LUDLOW' });
    expect(rows.map((r) => [r.row.warehouse, r.isPick])).toEqual([
      ['LUDLOW', true],
      ['ATS', false],
    ]);
  });

  it('breaks quantity ties by row name, numerically', () => {
    const tie = [row('ROW 10', 5), row('ROW 2', 5), row('ROW 1', 5)];
    const { rows } = arrangeSkuLocations(tie, null);
    expect(rows.map((r) => r.row.location)).toEqual(['ROW 1', 'ROW 2', 'ROW 10']);
  });
});
