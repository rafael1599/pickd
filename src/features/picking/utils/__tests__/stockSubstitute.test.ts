import { describe, it, expect } from 'vitest';
import { pickBestStockRow, pickVariantSiblingRow, type StockRow } from '../stockSubstitute';
import { toPickingOrderMap } from '../pickLocation';

const row = (over: Partial<StockRow>): StockRow => ({
  sku: '03-3768BLD',
  location: 'ROW 43',
  warehouse: 'LUDLOW',
  item_name: 'DIVIDE S/O 12X27 2025 RIPTIDE',
  quantity: 155,
  ...over,
});

describe('pickBestStockRow', () => {
  it('returns null when no row for the SKU has stock', () => {
    const rows = [
      row({ sku: '03-3768BLD', quantity: 0, location: 'ROW 41' }),
      row({ sku: '03-3768BLD', quantity: 0, location: 'FLORIDA' }),
    ];
    expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW')).toBeNull();
  });

  it('picks the in-stock row with the most units', () => {
    const rows = [
      row({ quantity: 0, location: 'ROW 41' }),
      row({ quantity: 155, location: 'ROW 43' }),
      row({ quantity: 12, location: 'ROW 9' }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.location).toBe('ROW 43');
    expect(best?.quantity).toBe(155);
  });

  it('ignores rows for other SKUs', () => {
    const rows = [
      row({ sku: '03-3768BL', quantity: 999 }),
      row({ sku: '03-3768BLD', quantity: 155 }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.sku).toBe('03-3768BLD');
    expect(best?.quantity).toBe(155);
  });

  it('ignores rows in a different warehouse', () => {
    const rows = [
      row({ warehouse: 'ATS', quantity: 999 }),
      row({ warehouse: 'LUDLOW', quantity: 155 }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.warehouse).toBe('LUDLOW');
    expect(best?.quantity).toBe(155);
  });

  // The auto-swap was the one chooser still ranking on quantity alone, so a
  // substitution could send the picker to the pallet the rest of picking avoids.
  describe('with a picking order loaded', () => {
    const order = toPickingOrderMap([
      { warehouse: 'LUDLOW', location: 'ROW 43', picking_order: 145 },
      { warehouse: 'LUDLOW', location: '42 BURIED', picking_order: 9999 },
    ]);

    it('does not swap onto a buried pallet while a normal shelf has the bike', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 39 }),
        row({ location: 'ROW 43', quantity: 17 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW', order)?.location).toBe('ROW 43');
    });

    it('still swaps onto the buried pallet when nothing else has it', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 39 }),
        row({ location: 'ROW 43', quantity: 0 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW', order)?.location).toBe('42 BURIED');
    });

    it('is the plain quantity sort when the order could not be loaded', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 39 }),
        row({ location: 'ROW 43', quantity: 17 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW')?.location).toBe('42 BURIED');
    });

    // Preferring the reachable shelf must not silently cancel the substitution:
    // the caller only swaps on a row that covers the order.
    it('reaches for the buried pallet when the reachable shelf cannot cover the order', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 39 }),
        row({ location: 'ROW 43', quantity: 17 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW', order, 20)?.location).toBe('42 BURIED');
    });

    it('still prefers the reachable shelf when it does cover the order', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 39 }),
        row({ location: 'ROW 43', quantity: 17 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW', order, 15)?.location).toBe('ROW 43');
    });

    it('falls back to the preferred shelf when nothing covers the order', () => {
      const rows = [
        row({ location: '42 BURIED', quantity: 5 }),
        row({ location: 'ROW 43', quantity: 4 }),
      ];
      expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW', order, 20)?.location).toBe('ROW 43');
    });
  });
});

describe('pickVariantSiblingRow', () => {
  // 2026-08-26, order 881288: '03-3768BLD' ordered, 0 under that name, 145 on
  // ROW 43 under '03-3768BL' — the same bike, renamed the day before.
  const family = [
    row({ sku: '03-3768BLD', quantity: 0, location: 'FLORIDA' }),
    row({ sku: '03-3768BLD', quantity: 0, location: 'ROW 41' }),
    row({ sku: '03-3768BL', quantity: 145, location: 'ROW 43' }),
    row({ sku: '03-3768BL', quantity: 0, location: 'ROW 34' }),
  ];

  it('finds the sibling that holds the stock, in either direction', () => {
    const best = pickVariantSiblingRow(family, '03-3768BLD', 'LUDLOW', undefined, 1);
    expect(best?.sku).toBe('03-3768BL');
    expect(best?.location).toBe('ROW 43');

    const flipped = family.map((r) => ({
      ...r,
      sku: r.sku === '03-3768BL' ? '03-3768BLD' : '03-3768BL',
    }));
    expect(pickVariantSiblingRow(flipped, '03-3768BL', 'LUDLOW', undefined, 1)?.sku).toBe(
      '03-3768BLD'
    );
  });

  it('never returns the ordered SKU itself', () => {
    const rows = [row({ sku: '03-3768BLD', quantity: 50, location: 'ROW 43' })];
    expect(pickVariantSiblingRow(rows, '03-3768BLD', 'LUDLOW')).toBeNull();
  });

  it('returns null when no sibling has stock, or when the SKU has no family', () => {
    const dry = family.map((r) => ({ ...r, quantity: 0 }));
    expect(pickVariantSiblingRow(dry, '03-3768BLD', 'LUDLOW')).toBeNull();
    const part = [row({ sku: '01-522A', quantity: 9, location: 'ROW 23' })];
    expect(pickVariantSiblingRow(part, '01-522', 'LUDLOW')).toBeNull();
  });

  it('ignores other colors and other warehouses', () => {
    const rows = [
      row({ sku: '03-3768BK', quantity: 40, location: 'ROW 43' }),
      row({ sku: '03-3768BL', quantity: 40, location: 'ROW 43', warehouse: 'ATS' }),
    ];
    expect(pickVariantSiblingRow(rows, '03-3768BLD', 'LUDLOW')).toBeNull();
  });

  it('takes the sibling whose shelf covers the order, else the fullest', () => {
    const rows = [
      row({ sku: '03-3768BLD', quantity: 2, location: 'ROW 41' }),
      row({ sku: '03-3768BLT', quantity: 10, location: 'ROW 43' }),
    ];
    expect(pickVariantSiblingRow(rows, '03-3768BL', 'LUDLOW', undefined, 3)?.sku).toBe(
      '03-3768BLT'
    );
    expect(pickVariantSiblingRow(rows, '03-3768BL', 'LUDLOW', undefined, 20)?.sku).toBe(
      '03-3768BLT'
    );
  });

  it('keeps a buried pallet out of the running while a normal shelf covers the order', () => {
    const order = toPickingOrderMap([
      { warehouse: 'LUDLOW', location: 'ROW 42 BURIED', picking_order: 9999 },
      { warehouse: 'LUDLOW', location: 'ROW 43', picking_order: 43 },
    ]);
    const rows = [
      row({ sku: '03-3768BLD', quantity: 100, location: 'ROW 42 BURIED' }),
      row({ sku: '03-3768BLT', quantity: 5, location: 'ROW 43' }),
    ];
    expect(pickVariantSiblingRow(rows, '03-3768BL', 'LUDLOW', order, 3)?.location).toBe('ROW 43');
    // …but it is still reached for when it is the only thing that can finish the job.
    expect(pickVariantSiblingRow(rows, '03-3768BL', 'LUDLOW', order, 50)?.location).toBe(
      'ROW 42 BURIED'
    );
  });
});
