import { describe, it, expect } from 'vitest';
import { pickBestStockRow, type StockRow } from '../stockSubstitute';
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
